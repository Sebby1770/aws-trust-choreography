// Chaos Lab engine — pure resilience analysis over a Flow Studio graph.
// Works on plain {nodes, connections} data: node {id, name, serviceName,
// category, criticality}, connection {from, to}. No DOM, fully unit-tested.

const CRITICALITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };

// Heuristic availability estimates by service family (documented as estimates,
// not SLAs). Matched against category + service name keywords, first hit wins.
const AVAILABILITY_RULES = [
  { pattern: /route ?53|dns/i, availability: 0.9999 },
  { pattern: /cloudfront|cdn|edge/i, availability: 0.9999 },
  { pattern: /s3|storage|glacier|backup/i, availability: 0.9995 },
  { pattern: /dynamo|aurora|rds|database|neptune|documentdb|elasticache/i, availability: 0.9995 },
  {
    pattern: /lambda|fargate|serverless|step functions|eventbridge|sqs|sns|queue/i,
    availability: 0.9995,
  },
  { pattern: /load balanc|elb|alb|nlb|api gateway/i, availability: 0.9999 },
  { pattern: /ec2|compute|instance|container|ecs|eks|kubernetes/i, availability: 0.995 },
  {
    pattern: /claude|chatgpt|foundation model|ai agent|embedding|vector|guardrail/i,
    availability: 0.995,
  },
];

const DEFAULT_AVAILABILITY = 0.999;

export function estimateNodeAvailability(node) {
  const haystack = `${node.serviceName || ""} ${node.name || ""} ${node.category || ""}`;
  const rule = AVAILABILITY_RULES.find((entry) => entry.pattern.test(haystack));
  let availability = rule ? rule.availability : DEFAULT_AVAILABILITY;
  // Operator-declared criticality nudges the estimate: critical services are
  // assumed to be run with more care, low-criticality ones with less.
  if (node.criticality === "critical") availability = Math.min(0.99999, availability + 0.0004);
  if (node.criticality === "low") availability = Math.max(0.98, availability - 0.002);
  return availability;
}

function buildAdjacency(nodes, connections) {
  const ids = new Set(nodes.map((node) => node.id));
  const out = new Map();
  const undirected = new Map();
  for (const id of ids) {
    out.set(id, []);
    undirected.set(id, []);
  }
  for (const connection of connections) {
    if (!ids.has(connection.from) || !ids.has(connection.to)) continue;
    if (connection.from === connection.to) continue;
    out.get(connection.from).push(connection.to);
    undirected.get(connection.from).push(connection.to);
    undirected.get(connection.to).push(connection.from);
  }
  return { ids, out, undirected };
}

function reachableFrom(startIds, adjacency, blocked = new Set()) {
  const seen = new Set();
  const queue = [];
  for (const id of startIds) {
    if (blocked.has(id) || !adjacency.has(id)) continue;
    seen.add(id);
    queue.push(id);
  }
  while (queue.length > 0) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (seen.has(next) || blocked.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen;
}

/** Nodes with no inbound connection — where traffic enters the architecture. */
export function findEntryPoints(nodes, connections) {
  const hasInbound = new Set(connections.map((connection) => connection.to));
  return nodes.filter((node) => !hasInbound.has(node.id));
}

/** Nodes with no outbound connection — where flows terminate. */
export function findTerminals(nodes, connections) {
  const hasOutbound = new Set(connections.map((connection) => connection.from));
  return nodes.filter((node) => !hasOutbound.has(node.id));
}

/**
 * Articulation points of the undirected graph (iterative Tarjan low-link),
 * annotated with how many nodes would be stranded from the largest surviving
 * component if the node failed.
 */
export function findSinglePointsOfFailure(nodes, connections) {
  const { undirected } = buildAdjacency(nodes, connections);
  const index = new Map();
  const low = new Map();
  const parent = new Map();
  const articulation = new Set();
  let counter = 0;

  for (const root of undirected.keys()) {
    if (index.has(root)) continue;
    const stack = [{ id: root, neighborIndex: 0 }];
    index.set(root, counter);
    low.set(root, counter);
    counter += 1;
    let rootChildren = 0;

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = undirected.get(frame.id) ?? [];
      if (frame.neighborIndex < neighbors.length) {
        const next = neighbors[frame.neighborIndex];
        frame.neighborIndex += 1;
        if (!index.has(next)) {
          parent.set(next, frame.id);
          if (frame.id === root) rootChildren += 1;
          index.set(next, counter);
          low.set(next, counter);
          counter += 1;
          stack.push({ id: next, neighborIndex: 0 });
        } else if (next !== parent.get(frame.id)) {
          low.set(frame.id, Math.min(low.get(frame.id), index.get(next)));
        }
      } else {
        stack.pop();
        const up = parent.get(frame.id);
        if (up !== undefined) {
          low.set(up, Math.min(low.get(up), low.get(frame.id)));
          if (up !== root && low.get(frame.id) >= index.get(up)) {
            articulation.add(up);
          }
        }
      }
    }

    if (rootChildren >= 2) articulation.add(root);
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return [...articulation]
    .map((id) => {
      const blocked = new Set([id]);
      const remaining = nodes.filter((node) => node.id !== id).map((node) => node.id);
      const components = [];
      const seen = new Set();
      for (const start of remaining) {
        if (seen.has(start)) continue;
        const component = reachableFrom([start], undirected, blocked);
        for (const member of component) seen.add(member);
        components.push(component.size);
      }
      components.sort((a, b) => b - a);
      const stranded = components.slice(1).reduce((sum, size) => sum + size, 0);
      const node = nodeById.get(id);
      const weight = CRITICALITY_WEIGHT[node?.criticality] ?? 2;
      return {
        id,
        name: node?.name ?? id,
        serviceName: node?.serviceName ?? "",
        criticality: node?.criticality ?? "medium",
        stranded,
        severity: stranded * weight,
      };
    })
    .sort((a, b) => b.severity - a.severity || b.stranded - a.stranded);
}

/** Downstream reach of a failure at nodeId, with a blast classification. */
export function blastRadius(nodes, connections, nodeId) {
  const { out } = buildAdjacency(nodes, connections);
  if (!out.has(nodeId)) return null;
  const downstream = reachableFrom(out.get(nodeId) ?? [], out, new Set());
  downstream.delete(nodeId);
  const others = Math.max(1, nodes.length - 1);
  const pct = downstream.size / others;
  const classification = pct >= 0.6 ? "systemic" : pct >= 0.25 ? "significant" : "contained";
  return {
    id: nodeId,
    downstreamCount: downstream.size,
    pct,
    classification,
    downstream: [...downstream],
  };
}

export function blastMatrix(nodes, connections) {
  return nodes
    .map((node) => ({ name: node.name, ...blastRadius(nodes, connections, node.id) }))
    .filter(Boolean)
    .sort((a, b) => b.downstreamCount - a.downstreamCount);
}

/**
 * Best-availability route between two nodes: Dijkstra in -log space, so the
 * returned path maximizes the product of node availabilities. Cycles are fine
 * (availabilities ≤ 1 keep costs non-negative).
 */
export function bestPath(nodes, connections, fromId, toId) {
  const { out } = buildAdjacency(nodes, connections);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeById.has(fromId) || !nodeById.has(toId)) return null;

  const cost = (id) => -Math.log(estimateNodeAvailability(nodeById.get(id)));
  const dist = new Map([[fromId, cost(fromId)]]);
  const previous = new Map();
  const done = new Set();

  while (true) {
    let current = null;
    let best = Infinity;
    for (const [id, value] of dist) {
      if (!done.has(id) && value < best) {
        best = value;
        current = id;
      }
    }
    if (current === null) break;
    if (current === toId) break;
    done.add(current);
    for (const next of out.get(current) ?? []) {
      const candidate = dist.get(current) + cost(next);
      if (candidate < (dist.get(next) ?? Infinity)) {
        dist.set(next, candidate);
        previous.set(next, current);
      }
    }
  }

  if (!dist.has(toId)) return null;
  const path = [toId];
  while (path[0] !== fromId) path.unshift(previous.get(path[0]));
  return { path, availability: Math.exp(-dist.get(toId)) };
}

/** Count vertex-disjoint routes between two nodes (greedy, up to 3). */
export function disjointPathCount(nodes, connections, fromId, toId) {
  let count = 0;
  let workingNodes = nodes;
  let workingConnections = connections;
  for (let round = 0; round < 3; round++) {
    const found = bestPath(workingNodes, workingConnections, fromId, toId);
    if (!found) break;
    count += 1;
    const interior = new Set(found.path.slice(1, -1));
    if (interior.size === 0) break; // direct edge — no interior nodes to remove
    workingNodes = workingNodes.filter((node) => !interior.has(node.id));
    workingConnections = workingConnections.filter(
      (connection) => !interior.has(connection.from) && !interior.has(connection.to)
    );
  }
  return count;
}

/** Does at least one entry→terminal route survive with these nodes down? */
export function simulateFailures(nodes, connections, failedIds) {
  const blocked = new Set(failedIds);
  const { out } = buildAdjacency(nodes, connections);
  const entries = findEntryPoints(nodes, connections).filter((node) => !blocked.has(node.id));
  const terminals = findTerminals(nodes, connections);

  const reachable = reachableFrom(
    entries.map((node) => node.id),
    out,
    blocked
  );
  const flows = [];
  for (const terminal of terminals) {
    if (blocked.has(terminal.id)) {
      flows.push({ terminal: terminal.name, survives: false, reason: "terminal failed" });
    } else {
      flows.push({ terminal: terminal.name, survives: reachable.has(terminal.id), reason: null });
    }
  }

  const aliveNodes = nodes.filter((node) => !blocked.has(node.id));
  const reachablePct = aliveNodes.length
    ? aliveNodes.filter((node) => reachable.has(node.id)).length / aliveNodes.length
    : 0;
  const surviving = flows.filter((flow) => flow.survives).length;

  return {
    flows,
    survivingFlows: surviving,
    totalFlows: flows.length,
    reachablePct,
    verdict:
      flows.length === 0
        ? "no-flows"
        : surviving === flows.length
          ? "resilient"
          : surviving > 0
            ? "degraded"
            : "outage",
  };
}

export function formatAvailability(availability) {
  const pct = availability * 100;
  const digits = pct >= 99.999 ? 4 : pct >= 99.9 ? 3 : 2;
  const nines =
    availability >= 0.99999
      ? "five nines"
      : availability >= 0.9999
        ? "four nines"
        : availability >= 0.999
          ? "three nines"
          : availability >= 0.99
            ? "two nines"
            : "below two nines";
  const downtime = Math.round((1 - availability) * 365.25 * 24 * 60);
  return { pct: `${pct.toFixed(digits)}%`, nines, downtimeMinutesPerYear: downtime };
}

/**
 * Full resilience report used by the Chaos Lab panel.
 *
 * `options.entryIds` / `options.terminalIds` pin the front doors and exit
 * points to the *undamaged* topology. Without them, analyzing a graph with
 * nodes removed would treat every orphaned downstream node as a brand-new
 * entry point and report a healthier architecture after a failure.
 */
export function analyzeResilience(nodes, connections, options = {}) {
  if (!nodes.length) {
    return {
      empty: true,
      spofs: [],
      flows: [],
      blast: [],
      recommendations: ["Add nodes and connections, then re-run the analysis."],
    };
  }

  const alive = new Set(nodes.map((node) => node.id));
  const entries = options.entryIds
    ? nodes.filter((node) => options.entryIds.includes(node.id) && alive.has(node.id))
    : findEntryPoints(nodes, connections);
  const terminals = options.terminalIds
    ? nodes.filter((node) => options.terminalIds.includes(node.id) && alive.has(node.id))
    : findTerminals(nodes, connections);
  const spofs = findSinglePointsOfFailure(nodes, connections);
  const blast = blastMatrix(nodes, connections);

  const flows = [];
  for (const entry of entries) {
    for (const terminal of terminals) {
      if (entry.id === terminal.id) continue;
      const route = bestPath(nodes, connections, entry.id, terminal.id);
      if (!route) continue;
      const redundancy = disjointPathCount(nodes, connections, entry.id, terminal.id);
      let availability = route.availability;
      if (redundancy > 1) {
        // Two independent routes: combine as parallel systems.
        availability = 1 - (1 - availability) * (1 - availability);
      }
      flows.push({
        from: entry.name,
        to: terminal.name,
        path: route.path,
        hops: route.path.length,
        availability,
        redundancy,
      });
    }
  }
  flows.sort((a, b) => a.availability - b.availability);

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const overall = flows.length ? Math.min(...flows.map((flow) => flow.availability)) : null;

  const recommendations = [];
  for (const spof of spofs.slice(0, 3)) {
    if (spof.stranded > 0) {
      recommendations.push(
        `“${spof.name}” is a single point of failure — its loss strands ${spof.stranded} node${spof.stranded === 1 ? "" : "s"}. Add a redundant instance or an alternate route around it.`
      );
    }
  }
  const weakest = flows[0];
  if (weakest && weakest.redundancy < 2) {
    recommendations.push(
      `The “${weakest.from} → ${weakest.to}” flow has no independent backup route. A second path would lift it from ${formatAvailability(weakest.availability).pct} to ~${formatAvailability(1 - (1 - weakest.availability) ** 2).pct}.`
    );
  }
  if (weakest) {
    const weakestNode = weakest.path
      .map((id) => nodeById.get(id))
      .filter(Boolean)
      .sort((a, b) => estimateNodeAvailability(a) - estimateNodeAvailability(b))[0];
    if (weakestNode) {
      recommendations.push(
        `“${weakestNode.name}” is the weakest link on the most fragile flow (est. ${formatAvailability(estimateNodeAvailability(weakestNode)).pct}). Consider a managed or multi-AZ alternative.`
      );
    }
  }
  if (entries.length === 1 && nodes.length > 2) {
    recommendations.push(
      `All traffic enters through “${entries[0].name}”. A second entry point (e.g. a failover DNS record) removes a full-front-door outage mode.`
    );
  }
  if (recommendations.length === 0) {
    recommendations.push(
      "No single points of failure detected — this architecture degrades gracefully."
    );
  }

  return {
    empty: false,
    entries: entries.map((node) => node.name),
    terminals: terminals.map((node) => node.name),
    spofs,
    blast,
    flows,
    overall,
    recommendations,
  };
}
