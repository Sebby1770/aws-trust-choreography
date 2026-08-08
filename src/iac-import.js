/**
 * Infrastructure-as-code import — turn real Terraform or CloudFormation into a
 * live Flow Studio architecture.
 *
 * This is the other half of the Terraform/Mermaid exporters: instead of drawing
 * a diagram and generating a stub, you paste the stack you already run and get
 * a diagram you can review, score, and rehearse against.
 *
 * How it works:
 *
 *  1. **Scan** — a small string/heredoc/comment-aware HCL scanner pulls out
 *     top-level blocks (no regex-only parsing, so braces inside policy heredocs
 *     and `${…}` interpolation do not corrupt block boundaries). CloudFormation
 *     JSON goes through `JSON.parse` instead.
 *  2. **Classify** — each resource becomes a canvas node, or is marked as
 *     plumbing (see `iac-service-map.js`).
 *  3. **Trace** — references between resources become a directed graph, then
 *     paths *through* plumbing are contracted, so
 *     `alb → listener → target group → attachment → instance` collapses into a
 *     single `alb → instance` edge. Attributes that name a parent rather than a
 *     callee are inverted first, which is what makes queue → function and
 *     api → function come out pointing the right way.
 *  4. **Lay out** — nodes are placed in dependency layers.
 *
 * The result is a best-effort reading of the diagram implied by the code, not a
 * plan or a deployment: nothing here talks to AWS, and unresolved modules or
 * `count`/`for_each` fan-out are reported as warnings rather than guessed at.
 */

import {
  CLOUDFORMATION_SERVICES,
  CLOUDFORMATION_SKIP,
  IGNORED_ATTRIBUTES,
  INTERNAL_ONLY_SIGNALS,
  INVERTED_ATTRIBUTES,
  KIND_CONNECTION,
  KIND_CRITICALITY,
  networkRole,
  PARENT_ATTRIBUTES_BY_TYPE,
  PLAINTEXT_SIGNALS,
  PUBLIC_SUBNET_SIGNALS,
  PUBLICLY_ACCESSIBLE_SIGNALS,
  TERRAFORM_PREFIX_FALLBACKS,
  TERRAFORM_SKIP_PREFIXES,
  TERRAFORM_TYPES,
} from "./iac-service-map.js";
import { inferZone } from "./trust-zones.js";

/** Upper bounds so a 4,000-resource stack cannot lock up the canvas. */
export const MAX_NODES = 60;
export const MAX_CONNECTIONS = 150;

/**
 * Beyond this, a dependency level wraps into another column.
 * Four nodes in one column already clips two-line labels at typical canvas
 * heights, so three is the readable ceiling.
 */
const MAX_NODES_PER_COLUMN = 3;

const ENVIRONMENTS = ["Production", "Staging", "Development", "Shared"];
const CONNECTION_LABELS = {
  request: "HTTPS",
  data: "Query",
  event: "Events",
  telemetry: "Telemetry",
  replication: "Replication",
};

// --- HCL scanning ---------------------------------------------------------

/**
 * Walk HCL once, recording which characters are code (outside strings,
 * comments, and heredocs) so brace matching cannot be fooled by a JSON policy
 * document or an interpolated expression.
 *
 * @returns {{mask: Uint8Array, comments: Array<{text: string, index: number}>}}
 */
export function analyzeHcl(text) {
  const source = String(text || "");
  const length = source.length;
  const mask = new Uint8Array(length);
  const comments = [];
  let i = 0;

  while (i < length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "#" || (char === "/" && next === "/")) {
      const start = i;
      while (i < length && source[i] !== "\n") i += 1;
      comments.push({ text: source.slice(start, i), index: start });
      continue;
    }

    if (char === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i = Math.min(length, i + 2);
      comments.push({ text: source.slice(start, i), index: start });
      continue;
    }

    if (char === '"') {
      i += 1;
      while (i < length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          i = skipInterpolation(source, i + 1);
          continue;
        }
        if (source[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (char === "<" && next === "<") {
      const opener = /^<<-?\s*"?([A-Za-z_][A-Za-z0-9_]*)"?/.exec(source.slice(i, i + 80));
      if (opener) {
        const tag = opener[1];
        i += opener[0].length;
        const terminator = new RegExp(`^[ \\t]*${tag}[ \\t]*$`, "m");
        const found = terminator.exec(source.slice(i));
        i = found ? i + found.index + found[0].length : length;
        continue;
      }
    }

    mask[i] = 1;
    i += 1;
  }

  return { mask, comments };
}

/** Skip a balanced `${ … }` interpolation, tolerating nested strings. */
function skipInterpolation(source, openBraceIndex) {
  let depth = 0;
  let i = openBraceIndex;
  while (i < source.length) {
    const char = source[i];
    if (char === '"') {
      i += 1;
      while (i < source.length && source[i] !== '"') {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
    i += 1;
  }
  return i;
}

/**
 * Pull out top-level HCL blocks (`resource "type" "name" { … }`).
 * @returns {Array<{type: string, labels: string[], body: string, index: number}>}
 */
export function scanHclBlocks(text) {
  const source = String(text || "");
  const { mask, comments } = analyzeHcl(source);
  const blocks = [];
  const length = source.length;
  let i = 0;

  while (i < length) {
    if (!mask[i] || /\s/.test(source[i])) {
      i += 1;
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(source.slice(i));
    if (!identifier) {
      i += 1;
      continue;
    }
    const type = identifier[0];
    const blockStart = i;
    let cursor = i + type.length;
    const labels = [];

    for (let guard = 0; guard < 8; guard += 1) {
      while (cursor < length && (source[cursor] === " " || source[cursor] === "\t")) cursor += 1;
      if (source[cursor] !== '"') break;
      cursor += 1;
      const labelStart = cursor;
      while (cursor < length && source[cursor] !== '"') {
        if (source[cursor] === "\\") cursor += 1;
        cursor += 1;
      }
      labels.push(source.slice(labelStart, cursor));
      cursor += 1;
    }

    while (cursor < length && (source[cursor] === " " || source[cursor] === "\t")) cursor += 1;
    if (source[cursor] !== "{" || !mask[cursor]) {
      i = blockStart + type.length;
      continue;
    }

    let depth = 0;
    let end = cursor;
    for (; end < length; end += 1) {
      if (!mask[end]) continue;
      if (source[end] === "{") depth += 1;
      else if (source[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }

    blocks.push({
      type,
      labels,
      body: source.slice(cursor + 1, Math.max(cursor + 1, end - 1)),
      index: blockStart,
    });
    i = end;
  }

  return { blocks, comments };
}

const REFERENCE_PATTERN =
  /(?:^|[^A-Za-z0-9_.])(data\.)?(aws_[a-z0-9_]+)\.([A-Za-z_][A-Za-z0-9_-]*)/g;
const ATTRIBUTE_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)\s*=/g;

/**
 * Find every resource reference in a block body, tagged with the nearest
 * enclosing attribute name so parent-pointing attributes can be inverted.
 * `data.aws_*` lookups are ignored — they read existing infrastructure rather
 * than describing a path between resources in this stack.
 *
 * @returns {Array<{attr: string, target: string}>}
 */
export function extractReferences(body) {
  const source = String(body || "");
  const attributes = [];
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let attributeMatch = ATTRIBUTE_PATTERN.exec(source);
  while (attributeMatch) {
    attributes.push({ name: attributeMatch[1].toLowerCase(), index: attributeMatch.index });
    attributeMatch = ATTRIBUTE_PATTERN.exec(source);
  }

  const references = [];
  REFERENCE_PATTERN.lastIndex = 0;
  let referenceMatch = REFERENCE_PATTERN.exec(source);
  while (referenceMatch) {
    if (!referenceMatch[1]) {
      const position = referenceMatch.index;
      let attr = "";
      for (let i = attributes.length - 1; i >= 0; i -= 1) {
        if (attributes[i].index <= position) {
          attr = attributes[i].name;
          break;
        }
      }
      references.push({ attr, target: `${referenceMatch[2]}.${referenceMatch[3]}` });
    }
    referenceMatch = REFERENCE_PATTERN.exec(source);
  }

  return references;
}

/** Read the inner text of a nested `key { … }` or `key = { … }` block. */
function readNestedBlock(body, key) {
  const opener = new RegExp(`\\b${key}\\s*=?\\s*\\{`, "i");
  const match = opener.exec(body);
  if (!match) return "";
  const start = match.index + match[0].length;
  let depth = 1;
  for (let i = start; i < body.length; i += 1) {
    if (body[i] === "{") depth += 1;
    else if (body[i] === "}") {
      depth -= 1;
      if (!depth) return body.slice(start, i);
    }
  }
  return body.slice(start);
}

/** Read `Name`, `Environment`, and `Criticality` out of a Terraform tags block. */
function readTerraformTags(body) {
  const tags = readNestedBlock(body, "tags");
  if (!tags) return {};
  const read = (key) => {
    const match = new RegExp(`\\b${key}\\s*=\\s*"([^"]*)"`, "i").exec(tags);
    return match ? match[1] : "";
  };
  return { Name: read("Name"), Environment: read("Environment"), Criticality: read("Criticality") };
}

// --- Classification -------------------------------------------------------

/**
 * Decide what a Terraform resource type becomes on the canvas.
 * @returns {{service: string, kind: string}|null} null when it is plumbing.
 */
export function classifyTerraformType(type) {
  const name = String(type || "").toLowerCase();
  if (TERRAFORM_TYPES[name]) return TERRAFORM_TYPES[name];
  if (TERRAFORM_SKIP_PREFIXES.some((prefix) => name.startsWith(prefix))) return null;
  const fallback = TERRAFORM_PREFIX_FALLBACKS.find(([prefix]) => name.startsWith(prefix));
  return fallback ? fallback[1] : null;
}

/**
 * Decide what a CloudFormation resource type becomes on the canvas.
 * @returns {{service: string, kind: string}|null} null when it is plumbing.
 */
export function classifyCloudFormationType(type) {
  const name = String(type || "");
  if (CLOUDFORMATION_SKIP.includes(name)) return null;
  const family = name.split("::").slice(0, 2).join("::");
  return CLOUDFORMATION_SERVICES[family] || null;
}

// --- Shared architecture builder -----------------------------------------

/**
 * Turn classified resources into nodes and connections.
 *
 * @param {Array} resources `{key, type, localName, body, refs, tags, mapping}`
 * @param {object} context `{name, region, format, warnings, extraConnections}`
 */
/**
 * Work out which subnets are internet-facing.
 *
 * A subnet is public if it auto-assigns public IPs, or if it is associated with
 * a route table that routes to an internet gateway. None of these resources is
 * drawn, but the graph they form decides whether the compute inside them sits
 * in the public or the private trust zone.
 *
 * @returns {Set<string>} keys of public subnets
 */
export function findPublicSubnets(resources = []) {
  const role = new Map(resources.map((resource) => [resource.key, networkRole(resource.type)]));
  const publicSubnets = new Set();

  for (const resource of resources) {
    if (role.get(resource.key) !== "subnet") continue;
    if (PUBLIC_SUBNET_SIGNALS.some((pattern) => pattern.test(resource.body || ""))) {
      publicSubnets.add(resource.key);
    }
  }

  // Route tables that reach an internet gateway, either directly or via a route.
  const publicRouteTables = new Set();
  for (const resource of resources) {
    const kind = role.get(resource.key);
    if (kind !== "route-table" && kind !== "route") continue;
    const reachesGateway = resource.refs.some((ref) => role.get(ref.target) === "gateway");
    if (!reachesGateway) continue;
    if (kind === "route-table") {
      publicRouteTables.add(resource.key);
    } else {
      for (const ref of resource.refs) {
        if (role.get(ref.target) === "route-table") publicRouteTables.add(ref.target);
      }
    }
  }

  // Subnets associated with one of those route tables.
  for (const resource of resources) {
    if (role.get(resource.key) !== "association") continue;
    if (!resource.refs.some((ref) => publicRouteTables.has(ref.target))) continue;
    for (const ref of resource.refs) {
      if (role.get(ref.target) === "subnet") publicSubnets.add(ref.target);
    }
  }

  return publicSubnets;
}

/**
 * Decide the trust zone for an imported resource.
 *
 * The service name gives a starting zone; subnet placement then refines *only*
 * compute. A database in a private subnet belongs in the data tier, not the
 * private tier, so `data`, `edge`, and `management` are never overridden.
 */
function resolveZone(resource, publicSubnets, role) {
  const base = inferZone(resource.mapping?.service, resource.tags?.Name || resource.localName);
  if (base !== "private" && base !== "public") return base;

  // An internal load balancer is not a public entry point.
  if (base === "public" && INTERNAL_ONLY_SIGNALS.some((p) => p.test(resource.body || ""))) {
    return "private";
  }
  if (base === "public") return base;

  const subnets = (resource.placement || []).filter((key) => role.get(key) === "subnet");
  if (!subnets.length) return base;
  return subnets.some((key) => publicSubnets.has(key)) ? "public" : "private";
}

function buildArchitecture(resources, context = {}) {
  const warnings = [...(context.warnings || [])];
  const byKey = new Map(resources.map((resource) => [resource.key, resource]));
  const role = new Map(resources.map((resource) => [resource.key, networkRole(resource.type)]));
  const publicSubnets = findPublicSubnets(resources);

  // `publicly_accessible` on a datastore is a strong, checkable signal that the
  // data tier is reachable from outside — worth saying out loud on import.
  for (const resource of resources) {
    if (!resource.mapping) continue;
    if (PUBLICLY_ACCESSIBLE_SIGNALS.some((pattern) => pattern.test(resource.body || ""))) {
      warnings.push(
        `${resource.key} declares public accessibility — it is reachable from outside your VPC.`
      );
    }
  }

  // Directed reference graph over *every* resource, plumbing included.
  const outgoing = new Map(resources.map((resource) => [resource.key, new Set()]));
  for (const resource of resources) {
    const parentAttrs = PARENT_ATTRIBUTES_BY_TYPE[resource.type] || [];
    for (const reference of resource.refs) {
      if (!byKey.has(reference.target) || reference.target === resource.key) continue;
      if (IGNORED_ATTRIBUTES.has(reference.attr)) {
        // Placement is not traffic, so it draws no edge — but it is exactly the
        // evidence needed to tell a public subnet from a private one, so keep it
        // instead of discarding it.
        resource.placement.push(reference.target);
        continue;
      }
      const inverted =
        INVERTED_ATTRIBUTES.has(reference.attr) || parentAttrs.includes(reference.attr);
      const from = inverted ? reference.target : resource.key;
      const to = inverted ? resource.key : reference.target;
      outgoing.get(from)?.add(to);
    }
  }

  const mapped = resources.filter((resource) => resource.mapping);
  const truncated = mapped.length > MAX_NODES;
  const kept = mapped.slice(0, MAX_NODES);
  if (truncated) {
    warnings.push(
      `Showing the first ${MAX_NODES} of ${mapped.length} services — import a module or stack at a time for the full picture.`
    );
  }
  const keptKeys = new Set(kept.map((resource) => resource.key));

  // Contract paths through plumbing: alb → listener → target group → instance
  // becomes a single alb → instance edge. A plaintext signal anywhere along the
  // contracted path (typically an `HTTP` listener) travels with the edge, since
  // that is the resource that actually declares the protocol.
  const edgeMap = new Map();
  for (const resource of kept) {
    const queue = [...(outgoing.get(resource.key) || [])].map((key) => ({
      key,
      depth: 0,
      plain: false,
    }));
    const visited = new Set([resource.key]);
    while (queue.length) {
      const { key, depth, plain } = queue.shift();
      if (visited.has(key) || depth > 6) continue;
      visited.add(key);
      if (keptKeys.has(key)) {
        const id = `${resource.key}->${key}`;
        const existing = edgeMap.get(id);
        if (existing) existing.plain = existing.plain || plain;
        else edgeMap.set(id, { from: resource.key, to: key, plain });
        continue;
      }
      const hop = byKey.get(key);
      if (!hop?.mapping) {
        const carried = plain || hasPlaintextSignal(hop);
        for (const nextKey of outgoing.get(key) || []) {
          queue.push({ key: nextKey, depth: depth + 1, plain: carried });
        }
      }
    }
  }
  const edges = [...edgeMap.values()];

  const fanIn = new Map();
  for (const edge of edges) fanIn.set(edge.to, (fanIn.get(edge.to) || 0) + 1);

  const nodeIds = new Map();
  const nodes = kept.map((resource, index) => {
    const id = `iac-node-${index + 1}`;
    nodeIds.set(resource.key, id);
    const kind = resource.mapping.kind;
    const environment = ENVIRONMENTS.includes(resource.tags.Environment)
      ? resource.tags.Environment
      : "Production";
    const declared = String(resource.tags.Criticality || "").toLowerCase();
    let criticality = ["high", "medium", "low"].includes(declared)
      ? declared
      : KIND_CRITICALITY[kind] || "medium";
    if (criticality === "medium" && (fanIn.get(resource.key) || 0) >= 3) criticality = "high";
    return {
      id,
      serviceName: resource.mapping.service,
      name: (resource.tags.Name || humanize(resource.localName)).slice(0, 60),
      environment,
      criticality,
      zone: resolveZone(resource, publicSubnets, role),
      notes: `Imported from ${resource.key}`.slice(0, 280),
      kind,
      x: 0.5,
      y: 0.5,
    };
  });

  const connections = [];
  const seenConnections = new Set();
  const pushConnection = (fromId, toId, options = {}) => {
    if (!fromId || !toId || fromId === toId) return;
    const id = `${fromId}->${toId}`;
    if (seenConnections.has(id) || connections.length >= MAX_CONNECTIONS) return;
    seenConnections.add(id);
    const type = options.type || "request";
    const encrypted = options.encrypted !== false;
    connections.push({
      id: `iac-link-${connections.length + 1}`,
      from: fromId,
      to: toId,
      type,
      label: encrypted ? CONNECTION_LABELS[type] || "HTTPS" : type === "request" ? "HTTP" : "Plain",
      encrypted,
    });
  };

  for (const edge of edges) {
    const source = byKey.get(edge.from);
    const target = byKey.get(edge.to);
    const encrypted = !edge.plain && !hasPlaintextSignal(source) && !hasPlaintextSignal(target);
    pushConnection(nodeIds.get(edge.from), nodeIds.get(edge.to), {
      type: connectionType(source?.mapping?.kind, target?.mapping?.kind),
      encrypted,
    });
  }

  // Topology comments emitted by this app's own Terraform export, so a
  // round-trip through `main.tf` keeps the paths that stubs cannot express.
  for (const extra of context.extraConnections || []) {
    const fromId = nodeIds.get(extra.from);
    const toId = nodeIds.get(extra.to);
    pushConnection(fromId, toId, { type: extra.type, encrypted: extra.encrypted });
  }

  layoutNodes(nodes, connections);

  return {
    format: context.format || "terraform",
    name: (context.name || "Imported architecture").slice(0, 80),
    region: context.region || "us-east-1",
    nodes: nodes.map(({ kind: _kind, ...node }) => node),
    connections,
    warnings,
    stats: {
      resources: resources.length,
      services: nodes.length,
      plumbing: resources.length - mapped.length,
      connections: connections.length,
    },
  };
}

/**
 * Pick the Flow Studio path type for an edge.
 *
 * The destination usually decides — a table is queried, CloudWatch is written
 * to — but anything *leaving* a queue, topic, or stream is an event delivery
 * even though the destination is ordinary compute.
 */
function connectionType(sourceKind, targetKind) {
  if (targetKind === "telemetry") return "telemetry";
  if (sourceKind === "event" || targetKind === "event") return "event";
  return KIND_CONNECTION[targetKind] || "request";
}

/** True when a resource explicitly declares a plaintext path or unencrypted storage. */
function hasPlaintextSignal(resource) {
  if (!resource?.body) return false;
  return PLAINTEXT_SIGNALS.some((pattern) => pattern.test(resource.body));
}

/** `api_handler` → `Api handler`. */
function humanize(value) {
  const text = String(value || "")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!text) return "Service";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Place nodes in dependency layers: entry points on the left, whatever they
 * reach to the right, spread evenly down each column.
 */
function layoutNodes(nodes, connections) {
  const depth = new Map(nodes.map((node) => [node.id, 0]));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  for (const connection of connections) {
    incoming.get(connection.to)?.push(connection.from);
  }
  // Relax longest-path depths; the pass count bounds cyclic graphs.
  for (let pass = 0; pass < Math.min(nodes.length, 12); pass += 1) {
    let changed = false;
    for (const node of nodes) {
      const sources = incoming.get(node.id) || [];
      if (!sources.length) continue;
      const best = Math.max(...sources.map((id) => (depth.get(id) ?? 0) + 1));
      if (best > (depth.get(node.id) ?? 0) && best < nodes.length) {
        depth.set(node.id, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map();
  for (const node of nodes) {
    const level = depth.get(node.id) || 0;
    if (!columns.has(level)) columns.set(level, []);
    columns.get(level).push(node);
  }

  // A wide dependency level would stack too many icons to read, so split it
  // across adjacent columns instead of cramming one.
  const visualColumns = [];
  for (const level of [...columns.keys()].sort((a, b) => a - b)) {
    const column = columns.get(level);
    const slices = Math.max(1, Math.ceil(column.length / MAX_NODES_PER_COLUMN));
    const perSlice = Math.ceil(column.length / slices);
    for (let index = 0; index < slices; index += 1) {
      visualColumns.push(column.slice(index * perSlice, (index + 1) * perSlice));
    }
  }

  visualColumns.forEach((column, columnIndex) => {
    column.forEach((node, rowIndex) => {
      node.x = clamp01((columnIndex + 1) / (visualColumns.length + 1), 0.08, 0.92);
      node.y = clamp01((rowIndex + 1) / (column.length + 1), 0.12, 0.88);
    });
  });
}

function clamp01(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// --- Terraform ------------------------------------------------------------

const TOPOLOGY_COMMENT = /^#\s*([a-z0-9_]+)\s*--([a-z]+)-->\s*([a-z0-9_]+)(\s*\(UNENCRYPTED!\))?/i;
const SAAS_COMMENT = /"([^"]+)"\s+is an external AI\/SaaS dependency\s*\(([^)]+)\)/i;
const TITLE_COMMENT = /^#\s*(.+?)\s+—\s+generated by AWS Flow Studio/;

/**
 * Parse Terraform HCL into a Flow Studio architecture.
 * @returns {{format: string, name: string, region: string, nodes: Array, connections: Array, warnings: string[], stats: object}}
 */
export function parseTerraform(text) {
  const source = String(text || "");
  if (!source.trim()) throw new Error("Paste some Terraform before importing.");

  const { blocks, comments } = scanHclBlocks(source);
  const warnings = [];
  const resources = [];
  const localNames = new Map();
  let region = "";
  let name = "";

  for (const comment of comments) {
    const title = TITLE_COMMENT.exec(comment.text.trim());
    if (title) {
      name = title[1];
      break;
    }
  }

  for (const block of blocks) {
    if (block.type === "provider" && block.labels[0] === "aws" && !region) {
      const match = /\bregion\s*=\s*"([^"]+)"/.exec(block.body);
      if (match) region = match[1];
      continue;
    }
    if (block.type === "module") {
      warnings.push(
        `Module "${block.labels[0] || "unnamed"}" was not expanded — import the module's own resources to see inside it.`
      );
      continue;
    }
    if (block.type !== "resource") continue;

    const [type, localName] = block.labels;
    if (!type || !localName) continue;
    const key = `${type}.${localName}`;

    // `null_resource` stubs are how this app's own exporter represents external
    // AI/SaaS nodes; the preceding comment carries the real service name.
    if (type === "null_resource") {
      const note = nearestComment(comments, block.index, SAAS_COMMENT);
      if (note) {
        resources.push({
          key,
          type,
          localName,
          body: block.body,
          refs: extractReferences(block.body),
          placement: [],
          tags: { Name: note[1] },
          mapping: { service: note[2], kind: "compute" },
        });
        localNames.set(localName, key);
        continue;
      }
    }

    if (/\bcount\s*=|\bfor_each\s*=/.test(block.body)) {
      warnings.push(
        `${key} uses count/for_each — it is drawn once rather than fanned out to every instance.`
      );
    }

    resources.push({
      key,
      type,
      localName,
      body: block.body,
      refs: extractReferences(block.body),
      placement: [],
      tags: readTerraformTags(block.body),
      mapping: classifyTerraformType(type),
    });
    localNames.set(localName, key);
  }

  if (!resources.length) {
    throw new Error("No Terraform `resource` blocks were found in that input.");
  }

  const extraConnections = [];
  for (const comment of comments) {
    const match = TOPOLOGY_COMMENT.exec(comment.text.trim());
    if (!match) continue;
    const from = localNames.get(match[1]);
    const to = localNames.get(match[3]);
    if (!from || !to) continue;
    extraConnections.push({
      from,
      to,
      type: ["request", "event", "data", "telemetry", "replication"].includes(
        match[2].toLowerCase()
      )
        ? match[2].toLowerCase()
        : "request",
      encrypted: !match[4],
    });
  }

  const nonAws = new Set();
  for (const block of blocks) {
    if (block.type !== "resource") continue;
    const type = block.labels[0] || "";
    if (type && !type.startsWith("aws_") && type !== "null_resource") {
      nonAws.add(type.split("_")[0]);
    }
  }
  if (nonAws.size) {
    warnings.push(
      `Ignored non-AWS resources from: ${[...nonAws].sort().join(", ")}. Only AWS services are drawn.`
    );
  }

  return buildArchitecture(resources, {
    format: "terraform",
    name: name || "Imported Terraform stack",
    region: region || "us-east-1",
    warnings,
    extraConnections,
  });
}

/** Find the closest comment before `index` that matches `pattern`. */
function nearestComment(comments, index, pattern) {
  let best = null;
  for (const comment of comments) {
    if (comment.index >= index) break;
    const match = pattern.exec(comment.text);
    if (match) best = match;
  }
  return best;
}

// --- CloudFormation -------------------------------------------------------

/**
 * Parse a CloudFormation JSON template into a Flow Studio architecture.
 * @returns {object} the same shape as {@link parseTerraform}
 */
export function parseCloudFormation(text) {
  let template;
  try {
    template = JSON.parse(String(text || ""));
  } catch {
    throw new Error("That CloudFormation template is not valid JSON.");
  }
  const declared = template?.Resources;
  if (!declared || typeof declared !== "object") {
    throw new Error("That template has no `Resources` section.");
  }

  const logicalIds = new Set(Object.keys(declared));
  const resources = [];
  const warnings = [];

  for (const [logicalId, definition] of Object.entries(declared)) {
    const type = definition?.Type || "";
    if (!type.startsWith("AWS::")) {
      if (type) warnings.push(`Skipped ${logicalId} (${type}) — only AWS::* resources are drawn.`);
      continue;
    }
    const properties = definition?.Properties || {};
    const refs = [];
    collectCfnReferences(properties, logicalIds, refs, "");
    for (const dependency of toArray(definition?.DependsOn)) {
      if (logicalIds.has(dependency)) refs.push({ attr: "depends_on", target: dependency });
    }
    if (definition?.Condition) {
      warnings.push(`${logicalId} is conditional (${definition.Condition}) — drawn as if enabled.`);
    }

    resources.push({
      key: logicalId,
      type,
      localName: logicalId,
      body: JSON.stringify(properties),
      refs,
      placement: [],
      tags: readCfnTags(properties),
      mapping: classifyCloudFormationType(type),
    });
  }

  if (!resources.length) throw new Error("No AWS resources were found in that template.");

  return buildArchitecture(resources, {
    format: "cloudformation",
    name: template?.Description ? String(template.Description).slice(0, 80) : "Imported CFN stack",
    region: "us-east-1",
    warnings,
  });
}

/** Walk template properties collecting Ref / GetAtt / Sub references. */
function collectCfnReferences(value, logicalIds, out, attr) {
  if (Array.isArray(value)) {
    for (const item of value) collectCfnReferences(item, logicalIds, out, attr);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (key === "Ref" && typeof child === "string" && logicalIds.has(child)) {
      out.push({ attr, target: child });
      continue;
    }
    if (key === "Fn::GetAtt") {
      const target = Array.isArray(child) ? child[0] : String(child || "").split(".")[0];
      if (logicalIds.has(target)) out.push({ attr, target });
      continue;
    }
    if (key === "Fn::Sub") {
      const template = Array.isArray(child) ? child[0] : child;
      if (typeof template === "string") {
        for (const match of template.matchAll(/\$\{([A-Za-z0-9:._-]+)\}/g)) {
          const target = match[1].split(".")[0];
          if (logicalIds.has(target)) out.push({ attr, target });
        }
      }
      if (Array.isArray(child)) collectCfnReferences(child[1], logicalIds, out, attr);
      continue;
    }
    collectCfnReferences(child, logicalIds, out, key.toLowerCase());
  }
}

function readCfnTags(properties) {
  const tags = properties?.Tags;
  if (!Array.isArray(tags)) return {};
  const read = (key) => {
    const hit = tags.find((tag) => String(tag?.Key || "").toLowerCase() === key);
    return typeof hit?.Value === "string" ? hit.Value : "";
  };
  return { Name: read("name"), Environment: read("environment"), Criticality: read("criticality") };
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// --- Entry point ----------------------------------------------------------

/**
 * Guess which IaC dialect some pasted text is.
 * @returns {"terraform"|"cloudformation-json"|"cloudformation-yaml"|null}
 */
export function detectIacFormat(text) {
  const source = String(text || "").trim();
  if (!source) return null;
  if (source.startsWith("{")) {
    try {
      const parsed = JSON.parse(source);
      if (parsed?.Resources) return "cloudformation-json";
    } catch {
      /* fall through to the text heuristics */
    }
  }
  if (/^\s*resource\s+"/m.test(source) || /^\s*provider\s+"aws"/m.test(source)) return "terraform";
  if (/AWSTemplateFormatVersion|^Resources:\s*$/m.test(source)) return "cloudformation-yaml";
  if (/^\s*(terraform|module|variable|locals)\s*[{"]/m.test(source)) return "terraform";
  return null;
}

/**
 * Import Terraform or CloudFormation text as a Flow Studio architecture.
 *
 * @param {string} text raw HCL or a CloudFormation JSON template
 * @param {{format?: string}} [options] force a dialect instead of detecting one
 * @returns {object} `{format, name, region, nodes, connections, warnings, stats}`
 * @throws {Error} with a message safe to show the user
 */
export function importInfrastructure(text, options = {}) {
  const format = options.format || detectIacFormat(text);
  if (format === "cloudformation-json") return parseCloudFormation(text);
  if (format === "cloudformation-yaml") {
    throw new Error(
      "YAML CloudFormation is not supported yet — convert it to JSON (`aws cloudformation package`, `cfn-flip`) and paste that."
    );
  }
  if (format === "terraform") return parseTerraform(text);
  throw new Error(
    "Could not tell whether that is Terraform or CloudFormation. Paste a `.tf` file or a CloudFormation JSON template."
  );
}
