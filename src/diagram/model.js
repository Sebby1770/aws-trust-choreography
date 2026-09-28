/**
 * The diagram document — schema, migration, and structural operations.
 *
 * A document holds three ordered collections:
 *
 *  - `nodes`: AWS service nodes. These are the architecture — the review
 *    model, trust zones, Chaos Lab, cost, and Terraform all read them. They
 *    keep every field the v2 studio stored (serviceName, environment,
 *    criticality, zone, notes) so those modules work unchanged.
 *  - `shapes`: everything else a diagram needs — containers (VPC, subnets,
 *    security groups…), invisible groups, flowchart shapes, notes, and text.
 *  - `connections`: connectors between any two vertices. Only connections
 *    between two service nodes take part in architecture analysis.
 *
 * Geometry is absolute world coordinates (top-left x/y plus w/h). Containment
 * is recorded as `parent`, and a vertex's `z` decides paint order: vertices
 * with z < 0 sit below the connector layer (containers, backdrops), z >= 0
 * above it.
 */

import { inferZone, normalizeZone, ZONE_IDS } from "../trust-zones.js";
import { cleanColumns, cleanRelation, tableHeight } from "./table.js";
import { rectCenter, rectContainsPoint, unionRects } from "./geometry.js";
import {
  ARROW_KINDS,
  CONTAINER_PRESETS,
  DASH_PATTERNS,
  EDGE_ROUTINGS,
  isContainerKind,
  SHAPE_KINDS,
} from "./shapes.js";

export const DOC_VERSION = 3;
export const SERVICE_SIZE = 48;
export const CLIPBOARD_FORMAT = "trust-choreography/diagram-clipboard@1";

/**
 * v2 stored service centres as fractions of a fixed surface. This is the
 * world-space box those fractions are mapped onto when an old diagram is
 * opened, chosen so the built-in layouts keep comfortable spacing.
 */
export const LEGACY_SURFACE = { width: 1600, height: 1000 };

export const ENVIRONMENTS = ["Production", "Staging", "Development", "Shared"];
export const CRITICALITIES = ["high", "medium", "low"];
export const TRAFFIC_TYPES = ["request", "event", "data", "telemetry", "replication"];
export const PORTS = ["auto", "n", "e", "s", "w"];

let sequence = 0;

/** A reasonably unique id with a readable prefix. */
export function nextId(prefix) {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function createDocument(overrides = {}) {
  return {
    version: DOC_VERSION,
    name: "Untitled architecture",
    region: "us-east-1",
    grid: true,
    gridSize: 10,
    snap: true,
    nodes: [],
    shapes: [],
    connections: [],
    ...overrides,
  };
}

// ------------------------------------------------------------- predicates

export function isServiceNode(element) {
  return Boolean(element && typeof element.iconId === "string" && element.iconId);
}

export function isEdge(element) {
  return Boolean(element && ("from" in element || "fromPoint" in element) && !("w" in element));
}

export function isContainer(element) {
  return Boolean(element && !isServiceNode(element) && isContainerKind(element.kind));
}

export function vertices(doc) {
  return [...doc.shapes, ...doc.nodes];
}

/** Every element by id: vertices and connections. */
export function indexDocument(doc) {
  const map = new Map();
  for (const shape of doc.shapes) map.set(shape.id, shape);
  for (const node of doc.nodes) map.set(node.id, node);
  for (const connection of doc.connections) map.set(connection.id, connection);
  return map;
}

export function findElement(doc, id) {
  return (
    doc.nodes.find((node) => node.id === id) ||
    doc.shapes.find((shape) => shape.id === id) ||
    doc.connections.find((connection) => connection.id === id) ||
    null
  );
}

export function rectOf(element) {
  return { x: element.x, y: element.y, w: element.w, h: element.h };
}

// ------------------------------------------------------------- containment

export function ancestors(doc, id, index = indexDocument(doc)) {
  const chain = [];
  const seen = new Set([id]);
  let current = index.get(id);
  while (current?.parent && !seen.has(current.parent)) {
    seen.add(current.parent);
    const parent = index.get(current.parent);
    if (!parent) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}

/** All vertices nested (at any depth) inside the given container ids. */
export function descendants(doc, ids) {
  const roots = new Set(Array.isArray(ids) ? ids : [ids]);
  const index = indexDocument(doc);
  return vertices(doc).filter(
    (vertex) =>
      !roots.has(vertex.id) && ancestors(doc, vertex.id, index).some((a) => roots.has(a.id))
  );
}

/**
 * The innermost container that should own a vertex occupying `rect`: the
 * smallest container that holds the rect's centre, skipping `excluded` ids
 * (the things being moved) and anything nested inside them.
 */
export function containerAt(doc, rect, excluded = new Set()) {
  const index = indexDocument(doc);
  const center = rectCenter(rect);
  let best = null;
  for (const shape of doc.shapes) {
    if (!isContainer(shape) || excluded.has(shape.id)) continue;
    if (ancestors(doc, shape.id, index).some((ancestor) => excluded.has(ancestor.id))) continue;
    if (!rectContainsPoint(rectOf(shape), center)) continue;
    if (shape.w * shape.h <= rect.w * rect.h) continue;
    if (!best || shape.w * shape.h < best.w * best.h) best = shape;
  }
  return best;
}

/**
 * Re-derive `parent` for the given vertices from where they now sit. Returns
 * the changes so the caller can react (a service entering a private subnet
 * takes on the private trust zone).
 *
 * @returns {Array<{id: string, from: string|null, to: string|null}>}
 */
export function reparent(doc, ids) {
  const moving = new Set(ids);
  const changes = [];
  const index = indexDocument(doc);
  for (const id of ids) {
    const vertex = index.get(id);
    if (!vertex || isEdge(vertex)) continue;
    // A moved child whose container moved with it keeps its container.
    if (vertex.parent && moving.has(vertex.parent)) continue;
    const excluded = new Set([id, ...descendants(doc, [id]).map((item) => item.id)]);
    const container = containerAt(doc, rectOf(vertex), excluded);
    const next = container?.id || null;
    if ((vertex.parent || null) !== next) {
      changes.push({ id, from: vertex.parent || null, to: next });
      vertex.parent = next;
    }
  }
  return changes;
}

/** The trust zone a container confers on the services inside it, if any. */
export function containerZone(container) {
  if (!container) return null;
  if (container.zone && ZONE_IDS.includes(container.zone)) return container.zone;
  const preset = CONTAINER_PRESETS[container.preset];
  return preset?.zone || null;
}

/** Innermost zoned container around a vertex, if any. */
export function inheritedZone(doc, id) {
  for (const ancestor of ancestors(doc, id)) {
    const zone = containerZone(ancestor);
    if (zone) return { zone, container: ancestor };
  }
  return null;
}

// ------------------------------------------------------------- paint order

/**
 * Paint order for vertices: `below` renders under connectors, `above` over
 * them. Within each band a container always paints before its descendants,
 * so a filled subnet never hides the services inside it.
 */
export function renderOrder(doc) {
  const all = vertices(doc)
    .map((vertex, position) => ({ vertex, position }))
    .sort((a, b) => (a.vertex.z ?? 0) - (b.vertex.z ?? 0) || a.position - b.position)
    .map(({ vertex }) => vertex);
  const index = indexDocument(doc);
  const ordered = [];
  const placed = new Set();
  const place = (vertex, trail = new Set()) => {
    if (placed.has(vertex.id) || trail.has(vertex.id)) return;
    trail.add(vertex.id);
    const parent = vertex.parent ? index.get(vertex.parent) : null;
    if (parent && !placed.has(parent.id) && all.includes(parent)) place(parent, trail);
    placed.add(vertex.id);
    ordered.push(vertex);
  };
  all.forEach((vertex) => place(vertex));
  return {
    below: ordered.filter((vertex) => (vertex.z ?? 0) < 0),
    above: ordered.filter((vertex) => (vertex.z ?? 0) >= 0),
  };
}

function zExtent(doc) {
  const values = vertices(doc).map((vertex) => vertex.z ?? 0);
  return {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}

/** z for a new vertex: containers stack below the connector layer. */
export function zForNew(doc, element) {
  const { min, max } = zExtent(doc);
  if (isContainer(element)) return Math.min(-1, min - 1);
  return Math.max(1, max + 1);
}

export function bringToFront(doc, ids) {
  const targets = orderedByZ(doc, ids);
  let { max } = zExtent(doc);
  for (const vertex of targets) {
    max += 1;
    vertex.z = Math.max(max, 1);
    max = vertex.z;
    for (const child of descendants(doc, [vertex.id]).sort((a, b) => (a.z ?? 0) - (b.z ?? 0))) {
      max += 1;
      child.z = max;
    }
  }
}

export function sendToBack(doc, ids) {
  const targets = orderedByZ(doc, ids).reverse();
  let { min } = zExtent(doc);
  for (const vertex of targets) {
    min -= 1;
    vertex.z = Math.min(min, -1);
    min = vertex.z;
  }
}

function orderedByZ(doc, ids) {
  const wanted = new Set(ids);
  return vertices(doc)
    .filter((vertex) => wanted.has(vertex.id))
    .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));
}

// -------------------------------------------------------------- creation

export function makeServiceNode(icon, options = {}) {
  const w = options.w || SERVICE_SIZE;
  const h = options.h || SERVICE_SIZE;
  return {
    id: options.id || nextId("flow-node"),
    iconId: icon.id,
    iconPath: icon.path,
    iconType: icon.type,
    category: icon.category,
    serviceName: icon.name,
    name: String(options.name || icon.name).slice(0, 80),
    x: options.x ?? 0,
    y: options.y ?? 0,
    w,
    h,
    z: options.z ?? 1,
    parent: options.parent || null,
    environment: ENVIRONMENTS.includes(options.environment) ? options.environment : "Production",
    criticality: CRITICALITIES.includes(options.criticality) ? options.criticality : "medium",
    // Placement starts from what the service implies, so a diagram gains trust
    // zones without anyone re-labelling every node by hand.
    zone: normalizeZone(options.zone, inferZone(icon.name, options.name)),
    notes: String(options.notes || "").slice(0, 280),
    style: options.style ? { ...options.style } : {},
  };
}

export function makeShape(kind, options = {}) {
  const definition = SHAPE_KINDS[kind] || SHAPE_KINDS.rect;
  const preset =
    kind === "container" ? CONTAINER_PRESETS[options.preset] || CONTAINER_PRESETS.generic : null;
  const shape = {
    id: options.id || nextId("shape"),
    kind: SHAPE_KINDS[kind] ? kind : "rect",
    x: options.x ?? 0,
    y: options.y ?? 0,
    w: options.w || preset?.w || definition.w,
    h: options.h || preset?.h || definition.h,
    z: options.z ?? 1,
    parent: options.parent || null,
    label: String(options.label ?? preset?.label ?? "").slice(0, 400),
    style: options.style ? { ...options.style } : {},
  };
  if (kind === "container") {
    shape.preset = CONTAINER_PRESETS[options.preset] ? options.preset : "generic";
    if (options.zone && ZONE_IDS.includes(options.zone)) shape.zone = options.zone;
  }
  if (kind === "image" && options.src) shape.src = String(options.src);
  if (kind === "table") {
    shape.columns = cleanColumns(options.columns);
    shape.h = tableHeight(shape.columns);
    if (!shape.label) shape.label = "table";
  }
  if (options.locked) shape.locked = true;
  return shape;
}

export function makeConnection(from, to, options = {}) {
  return {
    id: options.id || nextId("flow-link"),
    from: from || null,
    to: to || null,
    ...(options.fromPoint ? { fromPoint: { ...options.fromPoint } } : {}),
    ...(options.toPoint ? { toPoint: { ...options.toPoint } } : {}),
    type: TRAFFIC_TYPES.includes(options.type) ? options.type : "request",
    label: String(options.label ?? "").slice(0, 120),
    encrypted: options.encrypted !== false,
    fromPort: PORTS.includes(options.fromPort) ? options.fromPort : "auto",
    toPort: PORTS.includes(options.toPort) ? options.toPort : "auto",
    waypoints: Array.isArray(options.waypoints)
      ? options.waypoints.map((p) => ({ x: p.x, y: p.y }))
      : [],
    labelT: Number.isFinite(options.labelT) ? options.labelT : 0.5,
    style: options.style ? { ...options.style } : {},
    ...(options.relation ? { relation: cleanRelation(options.relation) } : {}),
  };
}

// ------------------------------------------------------------- migration

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanStyle(style) {
  if (!style || typeof style !== "object") return {};
  const clean = {};
  const colour = /^(#[0-9a-f]{3,8}|none|transparent|rgba?\([^)]*\))$/i;
  for (const key of ["fill", "stroke", "fontColor"]) {
    if (typeof style[key] === "string" && colour.test(style[key].trim()))
      clean[key] = style[key].trim();
  }
  for (const key of ["strokeWidth", "fontSize", "opacity"]) {
    if (Number.isFinite(Number(style[key]))) clean[key] = Number(style[key]);
  }
  if (clean.fontSize) clean.fontSize = Math.min(96, Math.max(6, clean.fontSize));
  if (clean.strokeWidth !== undefined)
    clean.strokeWidth = Math.min(20, Math.max(0, clean.strokeWidth));
  if (clean.opacity !== undefined) clean.opacity = Math.min(1, Math.max(0.05, clean.opacity));
  for (const key of ["shadow", "rounded", "bold", "italic", "underline", "animated"]) {
    if (typeof style[key] === "boolean") clean[key] = style[key];
  }
  if (style.dash in DASH_PATTERNS) clean.dash = style.dash;
  if (["left", "center", "right"].includes(style.align)) clean.align = style.align;
  if (["top", "middle", "bottom"].includes(style.valign)) clean.valign = style.valign;
  if (EDGE_ROUTINGS.includes(style.routing)) clean.routing = style.routing;
  if (ARROW_KINDS.includes(style.startArrow)) clean.startArrow = style.startArrow;
  if (ARROW_KINDS.includes(style.endArrow)) clean.endArrow = style.endArrow;
  return clean;
}

function cleanPoint(point) {
  if (!point || typeof point !== "object") return null;
  const x = Number(point.x);
  const y = Number(point.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Is this a pre-v3 architecture (normalised 0-1 centres, no sizes)?
 * Generated sources such as the IaC importer still emit that shape.
 */
export function isLegacyArchitecture(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (Number(raw.version) >= DOC_VERSION) return false;
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  return nodes.every(
    (node) => !("w" in node) && finite(node.x, 0.5) <= 1.5 && finite(node.y, 0.5) <= 1.5
  );
}

/**
 * Turn anything architecture-shaped into a valid v3 document.
 *
 * Accepts a v3 document, a v2 studio save, or a generated architecture. Icons
 * are resolved through `resolveIcon(node)`; a service whose icon cannot be
 * found is dropped and reported rather than failing the whole load.
 *
 * @param {object} raw
 * @param {{resolveIcon: (node: object) => object|null}} options
 * @returns {{doc: object, skipped: string[]}}
 */
export function normalizeDocument(raw, { resolveIcon } = {}) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.nodes)) {
    throw new Error("This file does not contain an AWS Flow Studio architecture.");
  }
  const legacy = isLegacyArchitecture(raw);
  const skipped = [];
  const doc = createDocument({
    name: String(raw.name || "Imported architecture").slice(0, 80),
    region: String(raw.region || "us-east-1").slice(0, 40),
    grid: raw.grid !== false,
    gridSize: Math.min(80, Math.max(4, finite(raw.gridSize, 10))),
    snap: raw.snap !== false,
  });
  const usedIds = new Set();
  const uniqueId = (candidate, prefix) => {
    let id = String(candidate || "").slice(0, 120) || nextId(prefix);
    while (usedIds.has(id)) id = nextId(prefix);
    usedIds.add(id);
    return id;
  };

  raw.nodes.forEach((node, index) => {
    const icon = resolveIcon ? resolveIcon(node) : null;
    if (!icon) {
      skipped.push(String(node?.name || node?.serviceName || "Unknown service"));
      return;
    }
    const w = legacy ? SERVICE_SIZE : Math.min(400, Math.max(16, finite(node.w, SERVICE_SIZE)));
    const h = legacy ? SERVICE_SIZE : Math.min(400, Math.max(16, finite(node.h, SERVICE_SIZE)));
    const x = legacy
      ? finite(node.x, 0.5) * LEGACY_SURFACE.width - w / 2
      : finite(node.x, index * 120);
    const y = legacy ? finite(node.y, 0.5) * LEGACY_SURFACE.height - h / 2 : finite(node.y, 80);
    const made = makeServiceNode(icon, {
      id: uniqueId(node.id, "flow-node"),
      name: node.name || icon.name,
      x,
      y,
      w,
      h,
      z: legacy ? index + 1 : finite(node.z, index + 1),
      parent: legacy ? null : node.parent || null,
      environment: node.environment,
      criticality: node.criticality,
      zone: ZONE_IDS.includes(node.zone) ? node.zone : undefined,
      notes: node.notes,
      style: cleanStyle(node.style),
    });
    if (node.locked === true) made.locked = true;
    doc.nodes.push(made);
  });

  (legacy ? [] : Array.isArray(raw.shapes) ? raw.shapes : []).forEach((shape, index) => {
    if (!shape || typeof shape !== "object") return;
    const kind = SHAPE_KINDS[shape.kind] ? shape.kind : "rect";
    const made = makeShape(kind, {
      id: uniqueId(shape.id, "shape"),
      x: finite(shape.x, 0),
      y: finite(shape.y, 0),
      w: Math.min(20000, Math.max(8, finite(shape.w, SHAPE_KINDS[kind].w))),
      h: Math.min(20000, Math.max(8, finite(shape.h, SHAPE_KINDS[kind].h))),
      z: finite(shape.z, isContainerKind(kind) ? -1 - index : index + 1),
      parent: shape.parent || null,
      label: typeof shape.label === "string" ? shape.label : "",
      preset: shape.preset,
      zone: shape.zone,
      src:
        typeof shape.src === "string" && /^(data:image\/|assets\/|https?:)/.test(shape.src)
          ? shape.src
          : undefined,
      columns: shape.columns,
      style: cleanStyle(shape.style),
      locked: shape.locked === true,
    });
    doc.shapes.push(made);
  });

  const vertexIds = new Set([...doc.nodes, ...doc.shapes].map((vertex) => vertex.id));
  // Parents must be containers that survived validation.
  const containers = new Set(doc.shapes.filter(isContainer).map((shape) => shape.id));
  for (const vertex of [...doc.nodes, ...doc.shapes]) {
    if (vertex.parent && (!containers.has(vertex.parent) || vertex.parent === vertex.id))
      vertex.parent = null;
  }
  breakParentCycles(doc);

  (Array.isArray(raw.connections) ? raw.connections : []).forEach((connection) => {
    if (!connection || typeof connection !== "object") return;
    const from = vertexIds.has(String(connection.from)) ? String(connection.from) : null;
    const to = vertexIds.has(String(connection.to)) ? String(connection.to) : null;
    const fromPoint = from ? null : cleanPoint(connection.fromPoint);
    const toPoint = to ? null : cleanPoint(connection.toPoint);
    if ((!from && !fromPoint) || (!to && !toPoint)) return;
    doc.connections.push(
      makeConnection(from, to, {
        id: uniqueId(connection.id, "flow-link"),
        fromPoint,
        toPoint,
        type: connection.type,
        label: connection.label ?? (legacy ? "HTTPS" : ""),
        encrypted: connection.encrypted,
        fromPort: connection.fromPort,
        toPort: connection.toPort,
        waypoints: (Array.isArray(connection.waypoints) ? connection.waypoints : [])
          .map(cleanPoint)
          .filter(Boolean)
          .slice(0, 64),
        labelT: Math.min(1, Math.max(0, finite(connection.labelT, 0.5))),
        style: cleanStyle(connection.style),
        relation: connection.relation,
      })
    );
  });

  return { doc, skipped };
}

function breakParentCycles(doc) {
  const index = indexDocument(doc);
  for (const vertex of vertices(doc)) {
    const seen = new Set([vertex.id]);
    let current = vertex;
    while (current.parent) {
      if (seen.has(current.parent)) {
        current.parent = null;
        break;
      }
      seen.add(current.parent);
      current = index.get(current.parent);
      if (!current) break;
    }
  }
}

/**
 * The architecture as the analysis modules understand it: service nodes, and
 * only the connections that run between two of them.
 */
export function analysisView(doc) {
  const ids = new Set(doc.nodes.map((node) => node.id));
  return {
    name: doc.name,
    region: doc.region,
    nodes: doc.nodes,
    connections: doc.connections.filter(
      (connection) => ids.has(connection.from) && ids.has(connection.to)
    ),
  };
}

// ---------------------------------------------------------- manipulation

/**
 * Move vertices (and everything inside moved containers) by (dx, dy). Edge
 * waypoints move too when both ends are moving, so a moved sub-diagram keeps
 * its hand-routed connectors.
 */
export function moveElements(doc, ids, dx, dy) {
  const wanted = new Set(ids);
  const moving = new Set(ids);
  descendants(
    doc,
    vertices(doc)
      .filter((vertex) => wanted.has(vertex.id))
      .map((vertex) => vertex.id)
  ).forEach((vertex) => moving.add(vertex.id));
  for (const vertex of vertices(doc)) {
    if (!moving.has(vertex.id)) continue;
    vertex.x += dx;
    vertex.y += dy;
  }
  for (const connection of doc.connections) {
    const fromMoves = connection.from ? moving.has(connection.from) : wanted.has(connection.id);
    const toMoves = connection.to ? moving.has(connection.to) : wanted.has(connection.id);
    if (!connection.from && fromMoves && connection.fromPoint) {
      connection.fromPoint = { x: connection.fromPoint.x + dx, y: connection.fromPoint.y + dy };
    }
    if (!connection.to && toMoves && connection.toPoint) {
      connection.toPoint = { x: connection.toPoint.x + dx, y: connection.toPoint.y + dy };
    }
    if (fromMoves && toMoves && connection.waypoints?.length) {
      connection.waypoints = connection.waypoints.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      }));
    }
  }
  return moving;
}

/**
 * Delete elements. Deleting a container deletes what is inside it (as in
 * draw.io); deleting a vertex deletes its connectors.
 *
 * @returns {Set<string>} every id that was removed
 */
export function deleteElements(doc, ids) {
  const removed = new Set(ids);
  const vertexIds = vertices(doc)
    .filter((vertex) => removed.has(vertex.id))
    .map((vertex) => vertex.id);
  descendants(doc, vertexIds).forEach((vertex) => removed.add(vertex.id));
  doc.nodes = doc.nodes.filter((node) => !removed.has(node.id));
  doc.shapes = doc.shapes.filter((shape) => !removed.has(shape.id));
  doc.connections = doc.connections.filter((connection) => {
    const gone =
      removed.has(connection.id) || removed.has(connection.from) || removed.has(connection.to);
    if (gone) removed.add(connection.id);
    return !gone;
  });
  return removed;
}

/** Remove an invisible group, handing its children to the group's parent. */
export function ungroup(doc, ids) {
  const released = [];
  for (const id of ids) {
    const group = doc.shapes.find((shape) => shape.id === id && shape.kind === "group");
    if (!group) continue;
    for (const vertex of vertices(doc)) {
      if (vertex.parent === group.id) {
        vertex.parent = group.parent || null;
        released.push(vertex.id);
      }
    }
    doc.shapes = doc.shapes.filter((shape) => shape.id !== group.id);
    doc.connections = doc.connections.filter((c) => c.from !== group.id && c.to !== group.id);
  }
  return released;
}

/** Wrap vertices in a new invisible group sized to their bounds. */
export function groupElements(doc, ids, padding = 10) {
  const wanted = new Set(ids);
  const members = vertices(doc).filter((vertex) => wanted.has(vertex.id));
  // Only the outermost selected vertices join; nested ones travel with them.
  const roots = members.filter(
    (vertex) => !ancestors(doc, vertex.id).some((a) => wanted.has(a.id))
  );
  if (roots.length < 2) return null;
  const bounds = unionRects(roots.map(rectOf));
  const sharedParent = roots.every(
    (vertex) => (vertex.parent || null) === (roots[0].parent || null)
  )
    ? roots[0].parent || null
    : null;
  const group = makeShape("group", {
    x: bounds.x - padding,
    y: bounds.y - padding,
    w: bounds.w + padding * 2,
    h: bounds.h + padding * 2,
    parent: sharedParent,
    label: "",
  });
  group.z = Math.min(...roots.map((vertex) => vertex.z ?? 0)) - 0.5;
  doc.shapes.push(group);
  roots.forEach((vertex) => {
    vertex.parent = group.id;
  });
  return group;
}

/** Recompute an invisible group's box from its children. */
export function fitGroups(doc) {
  for (const group of doc.shapes.filter((shape) => shape.kind === "group")) {
    const children = vertices(doc).filter((vertex) => vertex.parent === group.id);
    if (!children.length) continue;
    const bounds = unionRects(children.map(rectOf));
    Object.assign(group, {
      x: bounds.x - 10,
      y: bounds.y - 10,
      w: bounds.w + 20,
      h: bounds.h + 20,
    });
  }
}

// --------------------------------------------------------------- clipboard

/**
 * Serialise a selection for the clipboard. Descendants of selected containers
 * come along, as do connectors whose two ends are both copied.
 */
export function copySelection(doc, ids) {
  const wanted = new Set(ids);
  const vertexIds = vertices(doc)
    .filter((vertex) => wanted.has(vertex.id))
    .map((vertex) => vertex.id);
  descendants(doc, vertexIds).forEach((vertex) => wanted.add(vertex.id));
  const nodes = doc.nodes.filter((node) => wanted.has(node.id));
  const shapes = doc.shapes.filter((shape) => wanted.has(shape.id));
  const connections = doc.connections.filter(
    (connection) =>
      (wanted.has(connection.from) && wanted.has(connection.to)) ||
      (wanted.has(connection.id) &&
        (!connection.from || wanted.has(connection.from)) &&
        (!connection.to || wanted.has(connection.to)))
  );
  return JSON.parse(JSON.stringify({ format: CLIPBOARD_FORMAT, nodes, shapes, connections }));
}

export function isClipboardPayload(value) {
  return Boolean(value && typeof value === "object" && value.format === CLIPBOARD_FORMAT);
}

/**
 * Paste a clipboard payload into a document with fresh ids, offset by
 * (dx, dy). Returns the ids of the new top-level elements to select.
 */
export function pastePayload(doc, payload, dx = 20, dy = 20) {
  if (!isClipboardPayload(payload)) return [];
  const idMap = new Map();
  const fresh = (id, prefix) => {
    const next = nextId(prefix);
    idMap.set(id, next);
    return next;
  };
  const { min, max } = zExtent(doc);
  const nodes = (payload.nodes || []).map((node) => ({
    ...JSON.parse(JSON.stringify(node)),
    id: fresh(node.id, "flow-node"),
  }));
  const shapes = (payload.shapes || []).map((shape) => ({
    ...JSON.parse(JSON.stringify(shape)),
    id: fresh(shape.id, "shape"),
  }));
  const pastedVertices = [...shapes, ...nodes];
  pastedVertices.forEach((vertex, index) => {
    vertex.x += dx;
    vertex.y += dy;
    vertex.parent = vertex.parent && idMap.has(vertex.parent) ? idMap.get(vertex.parent) : null;
    vertex.z = (vertex.z ?? 0) < 0 ? min - pastedVertices.length + index : max + 1 + index;
  });
  const connections = (payload.connections || []).map((connection) => ({
    ...JSON.parse(JSON.stringify(connection)),
    id: nextId("flow-link"),
    from: connection.from ? idMap.get(connection.from) || null : null,
    to: connection.to ? idMap.get(connection.to) || null : null,
    fromPoint: connection.fromPoint
      ? { x: connection.fromPoint.x + dx, y: connection.fromPoint.y + dy }
      : undefined,
    toPoint: connection.toPoint
      ? { x: connection.toPoint.x + dx, y: connection.toPoint.y + dy }
      : undefined,
    waypoints: (connection.waypoints || []).map((point) => ({ x: point.x + dx, y: point.y + dy })),
  }));
  doc.nodes.push(...nodes);
  doc.shapes.push(...shapes);
  const valid = connections.filter(
    (connection) =>
      (connection.from || connection.fromPoint) && (connection.to || connection.toPoint)
  );
  valid.forEach((connection) => {
    if (!connection.fromPoint) delete connection.fromPoint;
    if (!connection.toPoint) delete connection.toPoint;
  });
  doc.connections.push(...valid);
  // Parents outside the payload were cleared above, so a remaining parent is
  // a pasted container and the vertex travels with it.
  const topLevel = pastedVertices.filter((vertex) => !vertex.parent);
  return [
    ...topLevel.map((vertex) => vertex.id),
    ...valid.filter((c) => !c.from || !c.to).map((c) => c.id),
  ];
}

/** Bounding box of vertices (and free connector points) for fit/export. */
export function documentBounds(doc, ids = null) {
  const wanted = ids ? new Set(ids) : null;
  const rects = vertices(doc)
    .filter((vertex) => !wanted || wanted.has(vertex.id))
    .map((vertex) =>
      isServiceNode(vertex) || vertex.kind === "actor" || vertex.kind === "image"
        ? { x: vertex.x - 30, y: vertex.y, w: vertex.w + 60, h: vertex.h + 34 }
        : rectOf(vertex)
    );
  for (const connection of doc.connections) {
    if (wanted && !wanted.has(connection.id)) continue;
    for (const point of [
      connection.fromPoint,
      connection.toPoint,
      ...(connection.waypoints || []),
    ]) {
      if (point) rects.push({ x: point.x, y: point.y, w: 0, h: 0 });
    }
  }
  return unionRects(rects);
}
