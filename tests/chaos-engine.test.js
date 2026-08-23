import { describe, expect, it } from "vitest";
import {
  analyzeResilience,
  bestPath,
  blastRadius,
  disjointPathCount,
  estimateNodeAvailability,
  findEntryPoints,
  findSinglePointsOfFailure,
  findTerminals,
  formatAvailability,
  simulateFailures,
} from "../src/chaos-engine.js";

function node(id, name, serviceName = name, criticality = "medium") {
  return { id, name, serviceName, category: "Services", criticality };
}

function link(from, to) {
  return { id: `${from}->${to}`, from, to };
}

// cdn → alb → app → db  (a chain: alb and app are articulation points)
const CHAIN = {
  nodes: [
    node("cdn", "CloudFront"),
    node("alb", "Application Load Balancer"),
    node("app", "EC2 App"),
    node("db", "Aurora"),
  ],
  connections: [link("cdn", "alb"), link("alb", "app"), link("app", "db")],
};

// cdn → (appA | appB) → db  (redundant middle tier, no SPOF in the middle)
const REDUNDANT = {
  nodes: [
    node("cdn", "CloudFront"),
    node("appA", "EC2 App A"),
    node("appB", "EC2 App B"),
    node("db", "Aurora"),
  ],
  connections: [link("cdn", "appA"), link("cdn", "appB"), link("appA", "db"), link("appB", "db")],
};

describe("availability estimates", () => {
  it("ranks managed services above raw compute", () => {
    expect(estimateNodeAvailability(node("a", "Lambda"))).toBeGreaterThan(
      estimateNodeAvailability(node("b", "EC2 App"))
    );
    expect(estimateNodeAvailability(node("c", "Route 53"))).toBeGreaterThan(
      estimateNodeAvailability(node("d", "Aurora"))
    );
  });

  it("adjusts for declared criticality", () => {
    const base = estimateNodeAvailability(node("a", "EC2 App"));
    expect(estimateNodeAvailability(node("a", "EC2 App", "EC2 App", "critical"))).toBeGreaterThan(
      base
    );
    expect(estimateNodeAvailability(node("a", "EC2 App", "EC2 App", "low"))).toBeLessThan(base);
  });

  it("falls back to a default for unknown services", () => {
    const availability = estimateNodeAvailability({ id: "x", name: "Mystery Box" });
    expect(availability).toBeGreaterThan(0.99);
    expect(availability).toBeLessThan(1);
  });

  it("formats availability with nines and yearly downtime", () => {
    const formatted = formatAvailability(0.9999);
    expect(formatted.nines).toBe("four nines");
    expect(formatted.pct).toBe("99.990%");
    expect(formatted.downtimeMinutesPerYear).toBe(53);
  });
});

describe("topology discovery", () => {
  it("finds entry points and terminals", () => {
    expect(findEntryPoints(CHAIN.nodes, CHAIN.connections).map((n) => n.id)).toEqual(["cdn"]);
    expect(findTerminals(CHAIN.nodes, CHAIN.connections).map((n) => n.id)).toEqual(["db"]);
  });

  it("treats an isolated node as both entry and terminal", () => {
    const nodes = [...CHAIN.nodes, node("lonely", "Orphan")];
    expect(findEntryPoints(nodes, CHAIN.connections).map((n) => n.id)).toContain("lonely");
    expect(findTerminals(nodes, CHAIN.connections).map((n) => n.id)).toContain("lonely");
  });
});

describe("single points of failure", () => {
  it("identifies articulation points in a chain", () => {
    const spofs = findSinglePointsOfFailure(CHAIN.nodes, CHAIN.connections);
    expect(spofs.map((s) => s.id).sort()).toEqual(["alb", "app"]);
  });

  it("finds none when the middle tier is redundant", () => {
    const spofs = findSinglePointsOfFailure(REDUNDANT.nodes, REDUNDANT.connections);
    expect(spofs.map((s) => s.id)).toEqual([]);
  });

  it("reports how many nodes each SPOF strands", () => {
    const spofs = findSinglePointsOfFailure(CHAIN.nodes, CHAIN.connections);
    const alb = spofs.find((s) => s.id === "alb");
    // removing alb splits {cdn} from {app, db} — the smaller side is stranded
    expect(alb.stranded).toBe(1);
  });

  it("weights severity by criticality", () => {
    const nodes = [
      node("cdn", "CloudFront"),
      node("alb", "ALB", "Application Load Balancer", "critical"),
      node("app", "App", "EC2 App", "low"),
      node("db", "Aurora"),
    ];
    const spofs = findSinglePointsOfFailure(nodes, CHAIN.connections);
    const alb = spofs.find((s) => s.id === "alb");
    const app = spofs.find((s) => s.id === "app");
    expect(alb.severity).toBeGreaterThan(app.severity);
  });

  it("handles empty and single-node graphs", () => {
    expect(findSinglePointsOfFailure([], [])).toEqual([]);
    expect(findSinglePointsOfFailure([node("solo", "Solo")], [])).toEqual([]);
  });
});

describe("blast radius", () => {
  it("counts everything downstream of a node", () => {
    expect(blastRadius(CHAIN.nodes, CHAIN.connections, "cdn").downstreamCount).toBe(3);
    expect(blastRadius(CHAIN.nodes, CHAIN.connections, "app").downstreamCount).toBe(1);
    expect(blastRadius(CHAIN.nodes, CHAIN.connections, "db").downstreamCount).toBe(0);
  });

  it("classifies systemic versus contained failures", () => {
    expect(blastRadius(CHAIN.nodes, CHAIN.connections, "cdn").classification).toBe("systemic");
    expect(blastRadius(CHAIN.nodes, CHAIN.connections, "db").classification).toBe("contained");
  });

  it("returns null for unknown nodes and survives cycles", () => {
    expect(blastRadius(CHAIN.nodes, CHAIN.connections, "nope")).toBeNull();
    const cyclic = {
      nodes: [node("a", "A"), node("b", "B")],
      connections: [link("a", "b"), link("b", "a")],
    };
    expect(blastRadius(cyclic.nodes, cyclic.connections, "a").downstreamCount).toBe(1);
  });

  it("ranks the blast matrix by reach", () => {
    const matrix = blastRadius(CHAIN.nodes, CHAIN.connections, "cdn");
    expect(matrix.downstream).toEqual(expect.arrayContaining(["alb", "app", "db"]));
  });
});

describe("best path and redundancy", () => {
  it("finds a route and multiplies availabilities along it", () => {
    const route = bestPath(CHAIN.nodes, CHAIN.connections, "cdn", "db");
    expect(route.path).toEqual(["cdn", "alb", "app", "db"]);
    expect(route.availability).toBeGreaterThan(0.99);
    expect(route.availability).toBeLessThan(1);
  });

  it("prefers the higher-availability route when two exist", () => {
    const nodes = [
      node("in", "CloudFront"),
      node("fast", "Lambda"),
      node("slow", "EC2 App", "EC2 App", "low"),
      node("out", "Aurora"),
    ];
    const connections = [
      link("in", "fast"),
      link("in", "slow"),
      link("fast", "out"),
      link("slow", "out"),
    ];
    expect(bestPath(nodes, connections, "in", "out").path).toContain("fast");
  });

  it("returns null when unreachable", () => {
    expect(bestPath(CHAIN.nodes, CHAIN.connections, "db", "cdn")).toBeNull();
    expect(bestPath(CHAIN.nodes, CHAIN.connections, "cdn", "ghost")).toBeNull();
  });

  it("counts vertex-disjoint routes", () => {
    expect(disjointPathCount(CHAIN.nodes, CHAIN.connections, "cdn", "db")).toBe(1);
    expect(disjointPathCount(REDUNDANT.nodes, REDUNDANT.connections, "cdn", "db")).toBe(2);
  });
});

describe("failure simulation", () => {
  it("reports an outage when a chain link dies", () => {
    const result = simulateFailures(CHAIN.nodes, CHAIN.connections, ["app"]);
    expect(result.verdict).toBe("outage");
    expect(result.survivingFlows).toBe(0);
  });

  it("stays resilient when a redundant peer dies", () => {
    const result = simulateFailures(REDUNDANT.nodes, REDUNDANT.connections, ["appA"]);
    expect(result.verdict).toBe("resilient");
    expect(result.survivingFlows).toBe(result.totalFlows);
  });

  it("reports an outage when the entry point itself dies", () => {
    expect(simulateFailures(CHAIN.nodes, CHAIN.connections, ["cdn"]).verdict).toBe("outage");
  });

  it("flags a failed terminal explicitly", () => {
    const result = simulateFailures(CHAIN.nodes, CHAIN.connections, ["db"]);
    expect(result.flows[0].reason).toBe("terminal failed");
    expect(result.verdict).toBe("outage");
  });

  it("survives multi-node failures that leave a route", () => {
    const result = simulateFailures(REDUNDANT.nodes, REDUNDANT.connections, ["appB"]);
    expect(result.verdict).toBe("resilient");
    expect(simulateFailures(REDUNDANT.nodes, REDUNDANT.connections, ["appA", "appB"]).verdict).toBe(
      "outage"
    );
  });
});

describe("resilience report", () => {
  it("reports emptiness for a blank canvas", () => {
    const report = analyzeResilience([], []);
    expect(report.empty).toBe(true);
    expect(report.recommendations).toHaveLength(1);
  });

  it("summarizes flows, SPOFs, and recommendations for a chain", () => {
    const report = analyzeResilience(CHAIN.nodes, CHAIN.connections);
    expect(report.empty).toBe(false);
    expect(report.entries).toEqual(["CloudFront"]);
    expect(report.terminals).toEqual(["Aurora"]);
    expect(report.flows).toHaveLength(1);
    expect(report.flows[0].redundancy).toBe(1);
    expect(report.spofs.length).toBeGreaterThan(0);
    expect(report.recommendations.join(" ")).toMatch(/single point of failure/i);
  });

  it("credits redundancy with higher availability and cleaner advice", () => {
    const chainReport = analyzeResilience(CHAIN.nodes, CHAIN.connections);
    const redundantReport = analyzeResilience(REDUNDANT.nodes, REDUNDANT.connections);

    expect(redundantReport.flows[0].redundancy).toBe(2);
    expect(redundantReport.overall).toBeGreaterThan(chainReport.overall);
    expect(redundantReport.spofs).toHaveLength(0);
  });

  it("names the weakest link on the most fragile flow", () => {
    const nodes = [
      node("cdn", "CloudFront"),
      node("weak", "Legacy VM", "EC2 App", "low"),
      node("db", "Aurora"),
    ];
    const connections = [link("cdn", "weak"), link("weak", "db")];
    const report = analyzeResilience(nodes, connections);
    expect(report.recommendations.join(" ")).toContain("Legacy VM");
  });

  it("keeps pinned entry points when analyzing a damaged graph", () => {
    // Kill the ALB: without pinning, "app" would look like a brand-new front
    // door and the report would claim a *healthier* architecture after failure.
    const alive = CHAIN.nodes.filter((n) => n.id !== "alb");
    const aliveConnections = CHAIN.connections.filter((c) => c.from !== "alb" && c.to !== "alb");
    const entryIds = findEntryPoints(CHAIN.nodes, CHAIN.connections).map((n) => n.id);
    const terminalIds = findTerminals(CHAIN.nodes, CHAIN.connections).map((n) => n.id);

    const unpinned = analyzeResilience(alive, aliveConnections);
    const pinned = analyzeResilience(alive, aliveConnections, { entryIds, terminalIds });

    // Unpinned invents "app" as an entry and still finds a flow to the DB...
    expect(unpinned.flows.length).toBeGreaterThan(0);
    // ...while pinned correctly reports that nothing reaches the terminal.
    expect(pinned.flows).toHaveLength(0);
    expect(pinned.overall).toBeNull();
  });

  it("drops pinned entries that are themselves dead", () => {
    const alive = CHAIN.nodes.filter((n) => n.id !== "cdn");
    const aliveConnections = CHAIN.connections.filter((c) => c.from !== "cdn" && c.to !== "cdn");
    const pinned = analyzeResilience(alive, aliveConnections, {
      entryIds: ["cdn"],
      terminalIds: ["db"],
    });
    expect(pinned.flows).toHaveLength(0);
  });

  it("is deterministic", () => {
    expect(analyzeResilience(CHAIN.nodes, CHAIN.connections)).toEqual(
      analyzeResilience(CHAIN.nodes, CHAIN.connections)
    );
  });
});
