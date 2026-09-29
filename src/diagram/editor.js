/**
 * The interactive diagram editor.
 *
 * Owns the document, selection, viewport, and undo history, and turns
 * pointer and keyboard input into edits. Rendering goes through the shared
 * scene builder; panels (library, format, insights) talk to it through the
 * API returned by {@link createDiagramEditor}.
 */

import {
  alignRects,
  computeSnap,
  distance,
  distributeRects,
  nearestOnPolyline,
  nearestSide,
  OPPOSITE_SIDE,
  rectCenter,
  rectFromPoints,
  rectContainsRect,
  rectsIntersect,
  resizeRect,
  sidePoint,
  SIDE_VECTORS,
  snapToGrid,
  unionRects,
} from "./geometry.js";
import {
  analysisView,
  bringToFront,
  containerAt,
  containerZone,
  copySelection,
  deleteElements,
  descendants,
  documentBounds,
  fitGroups,
  groupElements,
  indexDocument,
  inheritedZone,
  isClipboardPayload,
  isContainer,
  isServiceNode,
  makeConnection,
  makeServiceNode,
  makeShape,
  moveElements,
  pastePayload,
  rectOf,
  reparent,
  sendToBack,
  ungroup,
  vertices,
  zForNew,
} from "./model.js";
import {
  buildLayers,
  belowLabelDepth,
  computeRoutes,
  edgeNode,
  shadowFilter,
  vertexNode,
} from "./scene.js";
import { buildOverlay } from "./overlay.js";
import { createHistory } from "./history.js";
import { createMeasurer, LINE_HEIGHT } from "./text.js";
import { h, SVG_NS, toDom } from "./vdom.js";
import {
  clampZoom,
  fitView,
  revealRect,
  screenToWorld,
  steppedZoom,
  visibleWorld,
  worldRectToScreen,
  worldToScreen,
  zoomAt,
} from "./viewport.js";
import { layeredLayout } from "./layout.js";
import { SHAPE_KINDS } from "./shapes.js";
import { foreignKeyColumns } from "./er.js";
import { fitTable } from "./table.js";

const DRAG_THRESHOLD = 3;
const SNAP_PX = 6;

/** Escape a value for use inside a quoted attribute selector. */
function attributeValue(value) {
  return String(value).replace(/["\\]/g, "\\$&");
}

function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target?.isContentEditable
  );
}

/**
 * @param {object} options
 * @param {HTMLElement} options.root            element the canvas fills
 * @param {(id: string) => object|null} options.resolveIcon  catalog lookup by icon id
 * @param {(from, to) => object} [options.connectionDefaults]  type/label/encrypted for new connectors
 * @param {() => object} [options.getOverlays]  analysis overlays for the scene
 * @param {(event: {type: string, label?: string}) => void} [options.onChange]
 * @param {(ids: string[]) => void} [options.onSelectionChange]
 * @param {(view: object) => void} [options.onViewChange]
 * @param {(message: string, tone?: string) => void} [options.onStatus]
 * @param {(request: object) => void} [options.onQuickInsert]   open the quick-insert popover
 * @param {(request: object) => void} [options.onContextMenu]
 * @param {() => boolean} [options.isActive]    whether global shortcuts should apply
 */
export function createDiagramEditor(options) {
  const root = options.root;
  const measure = createMeasurer();
  const history = createHistory();
  const routeCache = new Map();
  const noop = () => {};
  const onChange = options.onChange || noop;
  const onSelectionChange = options.onSelectionChange || noop;
  const onViewChange = options.onViewChange || noop;
  const onStatus = options.onStatus || noop;
  const isActive = options.isActive || (() => true);

  let doc = null;
  let view = { x: 0, y: 0, zoom: 1 };
  let selection = [];
  let tool = "select";
  let gesture = null;
  let hoverId = null;
  let hoverTimer = null;
  let routes = new Map();
  let guides = [];
  let dropTargetId = null;
  let clipboard = null;
  let pasteCount = 0;
  let spaceHeld = false;
  let textEdit = null;
  let frame = 0;
  let pendingPointer = null;
  let highlight = new Set();
  let pendingFit = null;

  // ------------------------------------------------------------ DOM scaffold

  root.classList.add("dg-root");
  const canvas = document.createElement("div");
  canvas.className = "dg-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-roledescription", "diagram editor");
  canvas.setAttribute(
    "aria-label",
    "Diagram canvas. Use the shape library to add shapes; Tab moves between shapes."
  );
  const grid = document.createElement("div");
  grid.className = "dg-grid";
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "dg-svg");
  svg.append(toDom(h("defs", {}, shadowFilter())));
  const world = document.createElementNS(SVG_NS, "g");
  world.setAttribute("class", "dg-world");
  const layerBelow = document.createElementNS(SVG_NS, "g");
  const layerEdges = document.createElementNS(SVG_NS, "g");
  const layerAbove = document.createElementNS(SVG_NS, "g");
  layerBelow.setAttribute("class", "dg-layer-below");
  layerEdges.setAttribute("class", "dg-layer-edges");
  layerAbove.setAttribute("class", "dg-layer-above");
  world.append(layerBelow, layerEdges, layerAbove);
  const overlay = document.createElementNS(SVG_NS, "g");
  overlay.setAttribute("class", "dg-overlay");
  svg.append(world, overlay);
  const textarea = document.createElement("textarea");
  textarea.className = "dg-text-editor";
  textarea.hidden = true;
  textarea.setAttribute("aria-label", "Edit label");
  textarea.spellcheck = true;
  const live = document.createElement("div");
  live.className = "visually-hidden";
  live.setAttribute("aria-live", "polite");
  canvas.append(grid, svg, textarea, live);
  root.append(canvas);

  const announce = (message) => {
    live.textContent = message;
  };

  // --------------------------------------------------------------- helpers

  const snapshot = () => JSON.stringify(doc);
  const size = () => ({ width: canvas.clientWidth || 1, height: canvas.clientHeight || 1 });
  const index = () => indexDocument(doc);
  const get = (id) => index().get(id) || null;
  const isVertex = (element) => Boolean(element && "w" in element);
  const selectedElements = () => {
    const map = index();
    return selection.map((id) => map.get(id)).filter(Boolean);
  };
  const selectedVertices = () => selectedElements().filter(isVertex);
  const selectedEdges = () => selectedElements().filter((element) => !isVertex(element));
  const labelDepth = (vertex) => belowLabelDepth(vertex, sceneContext());

  function sceneContext(extra = {}) {
    const overlays = { trust: true, ...(options.getOverlays?.() || {}) };
    overlays.dropTarget = dropTargetId;
    overlays.highlight = highlight;
    return {
      interactive: true,
      measure,
      routeCache,
      fkColumns: doc ? foreignKeyColumns(doc) : new Map(),
      selected: new Set(selection),
      overlays,
      iconHref: (element) => element.iconPath || null,
      ...extra,
    };
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function worldPoint(event) {
    return screenToWorld(view, pointerPosition(event));
  }

  // ------------------------------------------------------------- rendering

  function applyView() {
    world.setAttribute("transform", `translate(${view.x} ${view.y}) scale(${view.zoom})`);
    const step = (doc?.gridSize || 10) * view.zoom;
    const major = step * 5;
    grid.style.setProperty("--dg-grid-step", `${step}px`);
    grid.style.setProperty("--dg-grid-major", `${major}px`);
    grid.style.setProperty("--dg-grid-x", `${view.x}px`);
    grid.style.setProperty("--dg-grid-y", `${view.y}px`);
    grid.classList.toggle("is-fine", step < 6);
    grid.hidden = doc?.grid === false;
    canvas.style.setProperty("--dg-zoom", String(view.zoom));
  }

  function render() {
    if (!doc) return;
    const ctx = sceneContext();
    const layers = buildLayers(doc, ctx);
    routes = layers.routes;
    layerBelow.replaceChildren(...layers.below.map((node) => toDom(node)));
    layerEdges.replaceChildren(...layers.edges.map((node) => toDom(node)));
    layerAbove.replaceChildren(...layers.above.map((node) => toDom(node)));
    applyView();
    renderOverlay();
    canvas.classList.toggle("is-empty", !doc.nodes.length && !doc.shapes.length);
  }

  function elementNode(id) {
    return svg.querySelector(`[data-id="${attributeValue(id)}"]`);
  }

  function edgeElement(id) {
    return svg.querySelector(`[data-edge-id="${attributeValue(id)}"].dg-edge`);
  }

  /** Re-render only some vertices and their connectors (used while dragging). */
  function renderPartial(vertexIds) {
    const ctx = sceneContext();
    const map = index();
    const moved = new Set(vertexIds);
    for (const id of vertexIds) {
      const vertex = map.get(id);
      const current = elementNode(id);
      if (vertex && current) current.replaceWith(toDom(vertexNode(vertex, ctx)));
    }
    const affected = new Set(
      doc.connections
        .filter((c) => moved.has(c.from) || moved.has(c.to) || moved.has(c.id))
        .map((connection) => connection.id)
    );
    const fresh = computeRoutes(doc, ctx, affected);
    for (const [id, route] of fresh) routes.set(id, route);
    for (const id of affected) {
      const connection = map.get(id);
      const current = edgeElement(id);
      const next = connection ? edgeNode(connection, routes.get(id), ctx, map) : null;
      if (current && next) current.replaceWith(toDom(next));
    }
    renderOverlay();
  }

  function renderOverlay() {
    if (!doc) return;
    const hover =
      hoverId && tool !== "hand" && !gesture && !textEdit && !selectedEdges().length
        ? get(hoverId)
        : null;
    const nodes = buildOverlay({
      view,
      selectedVertices: textEdit ? [] : selectedVertices(),
      selectedEdges: textEdit ? [] : selectedEdges(),
      routes,
      guides,
      marquee: gesture?.type === "marquee" && gesture.moved ? gesture.rect : null,
      hover: hover && isVertex(hover) && hover.kind !== "group" && !hover.locked ? hover : null,
      connect: gesture?.type === "connect" && gesture.moved ? gesture.preview : null,
      labelDepth,
    });
    overlay.replaceChildren(...nodes.map((node) => toDom(node)));
  }

  /** Coalesce pointer work into one update per animation frame. */
  function scheduleFrame(callback) {
    pendingPointer = callback;
    if (frame) return;
    const request = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 16));
    frame = -1;
    const handle = request(() => {
      frame = 0;
      flushFrame();
    });
    if (frame === -1) frame = handle || -1;
  }

  function flushFrame() {
    const run = pendingPointer;
    pendingPointer = null;
    run?.();
  }

  // --------------------------------------------------------------- changes

  /**
   * Apply a mutation as one undoable step.
   * @param {string} label
   * @param {(doc: object) => void} mutate
   * @param {{coalesce?: string, select?: string[], silent?: boolean}} [opts]
   */
  function commit(label, mutate, opts = {}) {
    const before = snapshot();
    const result = mutate(doc);
    const after = snapshot();
    if (before === after) return result;
    history.record(before, label, { coalesce: opts.coalesce });
    if (opts.select) setSelection(opts.select, { silent: true });
    pruneSelection();
    render();
    onChange({ type: "commit", label });
    if (!opts.silent) onStatus(label);
    return result;
  }

  function pruneSelection() {
    const map = index();
    const next = selection.filter((id) => map.has(id));
    if (next.length !== selection.length) {
      selection = next;
      onSelectionChange([...selection]);
    }
  }

  function restore(entry, verb) {
    if (!entry) return;
    doc = JSON.parse(entry.snapshot);
    routeCache.clear();
    pruneSelection();
    render();
    onChange({ type: verb, label: entry.label });
    onStatus(
      `${verb === "undo" ? "Undid" : "Redid"} ${entry.label.charAt(0).toLowerCase()}${entry.label.slice(1)}`
    );
  }

  function undo() {
    cancelTextEdit();
    restore(history.undo(snapshot()), "undo");
  }

  function redo() {
    cancelTextEdit();
    restore(history.redo(snapshot()), "redo");
  }

  // -------------------------------------------------------------- selection

  function setSelection(ids, { silent = false } = {}) {
    const map = index();
    const next = [...new Set(ids)].filter((id) => map.has(id));
    const changed = next.length !== selection.length || next.some((id, i) => id !== selection[i]);
    selection = next;
    if (!silent) {
      renderSelectionClasses();
      renderOverlay();
    }
    if (changed) {
      onSelectionChange([...selection]);
      if (selection.length === 1) {
        const element = map.get(selection[0]);
        announce(`${element?.name || element?.label || element?.kind || "Connector"} selected`);
      } else if (selection.length > 1) {
        announce(`${selection.length} items selected`);
      }
    }
  }

  function renderSelectionClasses() {
    const chosen = new Set(selection);
    for (const node of svg.querySelectorAll("[data-id].dg-vertex")) {
      node.classList.toggle("is-selected", chosen.has(node.dataset.id));
    }
    for (const node of svg.querySelectorAll(".dg-edge[data-edge-id]")) {
      node.classList.toggle("is-selected", chosen.has(node.dataset.edgeId));
    }
  }

  /** Clicking inside an invisible group selects the group first, then its members. */
  function selectableFor(id) {
    const map = index();
    const target = map.get(id);
    if (!target) return id;
    const chain = [];
    let current = target;
    const seen = new Set();
    while (current?.parent && !seen.has(current.parent)) {
      seen.add(current.parent);
      const parent = map.get(current.parent);
      if (!parent) break;
      if (parent.kind === "group") chain.push(parent);
      current = parent;
    }
    if (!chain.length) return id;
    // Outermost group first; once it (or a member) is selected, drill in.
    const outermost = chain[chain.length - 1];
    if (selection.includes(outermost.id) || chain.some((group) => selection.includes(group.id))) {
      const selectedIndex = chain.findIndex((group) => selection.includes(group.id));
      return selectedIndex > 0 ? chain[selectedIndex - 1].id : id;
    }
    if (
      selection.some((selected) => descendants(doc, [outermost.id]).some((v) => v.id === selected))
    )
      return id;
    return outermost.id;
  }

  // ------------------------------------------------------------ view control

  function setView(next, { silent = false } = {}) {
    view = { x: next.x, y: next.y, zoom: clampZoom(next.zoom) };
    applyView();
    renderOverlay();
    positionTextEditor();
    if (!silent) onViewChange({ ...view });
  }

  function zoomBy(direction, anchor = null) {
    const { width, height } = size();
    setView(
      zoomAt(view, anchor || { x: width / 2, y: height / 2 }, steppedZoom(view.zoom, direction))
    );
  }

  function zoomTo(zoom) {
    const { width, height } = size();
    setView(zoomAt(view, { x: width / 2, y: height / 2 }, zoom));
  }

  function fit(ids = null) {
    // A hidden or not-yet-laid-out canvas has no size to fit into; fit as
    // soon as it gets one instead of parking the view off-screen.
    if (size().width < 40 || size().height < 40) {
      pendingFit = ids || true;
      return;
    }
    pendingFit = null;
    const bounds = documentBounds(doc, ids && ids.length ? ids : null);
    if (!bounds) {
      setView({ x: size().width / 2 - 400, y: size().height / 2 - 250, zoom: 1 });
      return;
    }
    setView(fitView(bounds, size(), { padding: 56, maxZoom: ids?.length ? 1.5 : 1.1 }));
  }

  function reveal(id) {
    const element = get(id);
    if (!element) return false;
    const rect = isVertex(element)
      ? rectOf(element)
      : unionRects((routes.get(id)?.points || []).map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })));
    if (rect) setView(revealRect(view, size(), rect));
    setSelection([id]);
    return true;
  }

  function centerOfView() {
    const { width, height } = size();
    return screenToWorld(view, { x: width / 2, y: height / 2 });
  }

  // ----------------------------------------------------------------- insert

  function freeSpotNear(point, w, h) {
    const occupied = vertices(doc)
      .filter((vertex) => !isContainer(vertex))
      .map(rectOf);
    const step = doc.gridSize || 10;
    let candidate = {
      x: snapToGrid(point.x - w / 2, step),
      y: snapToGrid(point.y - h / 2, step),
      w,
      h,
    };
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const padded = { x: candidate.x - 20, y: candidate.y - 20, w: w + 40, h: h + 50 };
      if (!occupied.some((rect) => rectsIntersect(rect, padded))) return candidate;
      const ring = Math.floor(attempt / 8) + 1;
      const angle = (attempt % 8) * (Math.PI / 4);
      candidate = {
        x: snapToGrid(point.x - w / 2 + Math.cos(angle) * ring * (w + 50), step),
        y: snapToGrid(point.y - h / 2 + Math.sin(angle) * ring * (h + 60), step),
        w,
        h,
      };
    }
    return candidate;
  }

  function adoptContainer(vertex) {
    const container = containerAt(doc, rectOf(vertex), new Set([vertex.id]));
    vertex.parent = container?.id || null;
    if (isServiceNode(vertex)) {
      const inherited = inheritedZone(doc, vertex.id);
      if (inherited) vertex.zone = inherited.zone;
    }
  }

  /**
   * Insert a vertex. `at` is a world point for its centre (defaults to a free
   * spot in view). With `connectFrom`, a connector from that vertex is added.
   */
  function insertVertex(
    build,
    { at = null, connectFrom = null, label = "Added shape", edit = false } = {}
  ) {
    let created = null;
    commit(label, () => {
      created = build();
      const anchor = at || centerOfView();
      const spot = at
        ? { x: anchor.x - created.w / 2, y: anchor.y - created.h / 2 }
        : freeSpotNear(anchor, created.w, created.h);
      created.x = snapToGrid(spot.x, doc.snap ? doc.gridSize : 1);
      created.y = snapToGrid(spot.y, doc.snap ? doc.gridSize : 1);
      created.z = zForNew(doc, created);
      if (isServiceNode(created)) doc.nodes.push(created);
      else doc.shapes.push(created);
      adoptContainer(created);
      if (connectFrom && get(connectFrom)) {
        const source = get(connectFrom);
        const connection = makeConnection(
          connectFrom,
          created.id,
          options.connectionDefaults?.(source, created) || {}
        );
        doc.connections.push(connection);
        options.onConnectionCreated?.(doc, connection);
      }
    });
    if (created) {
      setSelection([created.id]);
      if (edit) startTextEdit(created.id);
    }
    return created;
  }

  function insertShape(kind, opts = {}, placement = {}) {
    return insertVertex(() => makeShape(kind, opts), {
      label: `Added ${SHAPE_KINDS[kind]?.label?.toLowerCase() || "shape"}`,
      edit: placement.edit ?? kind === "text",
      ...placement,
    });
  }

  function insertService(icon, placement = {}) {
    return insertVertex(() => makeServiceNode(icon, {}), {
      label: `Added ${icon.name}`,
      ...placement,
    });
  }

  /**
   * Insert something next to the selected vertex and connect to it — what
   * clicking a library item does when a shape is selected (as in draw.io).
   */
  function insertConnected(build, label, side = "e", sourceId = null) {
    const source = sourceId
      ? get(sourceId)
      : selectedVertices().length === 1
        ? selectedVertices()[0]
        : null;
    if (!source || !isVertex(source)) return null;
    const probe = build();
    const gap = 90;
    const center = rectCenter(source);
    const vector = SIDE_VECTORS[side];
    const depth = side === "s" ? labelDepth(source) : 0;
    const at = {
      x: center.x + vector.x * (source.w / 2 + gap + probe.w / 2),
      y: center.y + vector.y * (source.h / 2 + gap + probe.h / 2 + depth),
    };
    const spot = freeSpotNear(at, probe.w, probe.h);
    return insertVertex(() => probe, {
      at: { x: spot.x + probe.w / 2, y: spot.y + probe.h / 2 },
      connectFrom: source.id,
      label,
    });
  }

  /** Clone a vertex one step away in a direction and connect to it (hover arrows). */
  function cloneToward(id, side) {
    const source = get(id);
    if (!source || !isVertex(source)) return;
    const clone = JSON.parse(JSON.stringify(source));
    clone.id = undefined;
    const build = () =>
      isServiceNode(source)
        ? makeServiceNode(
            {
              id: source.iconId,
              path: source.iconPath,
              type: source.iconType,
              category: source.category,
              name: source.serviceName,
            },
            { w: source.w, h: source.h, style: source.style }
          )
        : makeShape(source.kind, {
            ...clone,
            id: undefined,
            parent: null,
            label: source.kind === "text" ? "Text" : "",
          });
    insertConnected(build, "Added connected copy", side, id);
  }

  // ------------------------------------------------------------ operations

  function deleteSelection() {
    const ids = selection.filter((id) => !get(id)?.locked);
    if (!ids.length) return;
    const count = ids.length;
    commit(count === 1 ? "Deleted 1 item" : `Deleted ${count} items`, () => {
      const removed = deleteElements(doc, ids);
      const extra = removed.size - ids.length;
      if (extra > 0) onStatus(`Deleted ${removed.size} items including contents — ⌘Z to undo`);
    });
    setSelection([]);
  }

  function copy() {
    if (!selection.length) return null;
    clipboard = copySelection(doc, selection);
    pasteCount = 0;
    onStatus(`Copied ${selection.length} item${selection.length === 1 ? "" : "s"}`);
    return clipboard;
  }

  function cut() {
    if (!copy()) return;
    deleteSelection();
  }

  function paste(payload = clipboard, { at = null } = {}) {
    if (!isClipboardPayload(payload)) return;
    pasteCount += 1;
    let dx = 20 * pasteCount;
    let dy = 20 * pasteCount;
    if (at) {
      const xs = [...(payload.nodes || []), ...(payload.shapes || [])].map((v) => v.x);
      const ys = [...(payload.nodes || []), ...(payload.shapes || [])].map((v) => v.y);
      if (xs.length) {
        dx = at.x - Math.min(...xs);
        dy = at.y - Math.min(...ys);
      }
    }
    let pasted = [];
    commit("Pasted", () => {
      pasted = pastePayload(doc, payload, dx, dy);
      for (const id of pasted) {
        const vertex = get(id);
        if (vertex && isVertex(vertex) && !vertex.parent) adoptContainer(vertex);
      }
    });
    setSelection(pasted);
  }

  function duplicate() {
    if (!selection.length) return;
    const payload = copySelection(doc, selection);
    let pasted = [];
    commit("Duplicated", () => {
      pasted = pastePayload(doc, payload, 20, 20);
    });
    setSelection(pasted);
  }

  function selectAll() {
    const map = index();
    const inGroup = (vertex) => map.get(vertex.parent)?.kind === "group";
    setSelection([
      ...vertices(doc)
        .filter((vertex) => !inGroup(vertex))
        .map((vertex) => vertex.id),
      ...doc.connections.map((connection) => connection.id),
    ]);
  }

  function nudge(dx, dy) {
    const ids = selectedVertices()
      .filter((vertex) => !vertex.locked)
      .map((vertex) => vertex.id);
    const free = selectedEdges()
      .filter((edge) => !edge.from || !edge.to)
      .map((edge) => edge.id);
    if (!ids.length && !free.length) return;
    commit(
      "Moved selection",
      () => {
        moveElements(doc, [...ids, ...free], dx, dy);
        reparent(doc, ids);
        fitGroups(doc);
      },
      { coalesce: "nudge", silent: true }
    );
  }

  function align(mode) {
    const items = selectedVertices().filter((v) => !v.locked);
    if (items.length < 2) return;
    commit(`Aligned ${mode}`, () => {
      const targets = alignRects(items.map(rectOf), mode);
      items.forEach((vertex, i) =>
        moveElements(doc, [vertex.id], targets[i].x - vertex.x, targets[i].y - vertex.y)
      );
      fitGroups(doc);
    });
  }

  function distribute(axis) {
    const items = selectedVertices().filter((v) => !v.locked);
    if (items.length < 3) return;
    commit(`Distributed ${axis}ly`, () => {
      const targets = distributeRects(items.map(rectOf), axis);
      items.forEach((vertex, i) =>
        moveElements(doc, [vertex.id], targets[i].x - vertex.x, targets[i].y - vertex.y)
      );
      fitGroups(doc);
    });
  }

  function toFront() {
    const ids = selectedVertices().map((v) => v.id);
    if (ids.length) commit("Brought to front", () => bringToFront(doc, ids));
  }

  function toBack() {
    const ids = selectedVertices().map((v) => v.id);
    if (ids.length) commit("Sent to back", () => sendToBack(doc, ids));
  }

  function group() {
    const ids = selectedVertices().map((v) => v.id);
    if (ids.length < 2) return;
    let created = null;
    commit("Grouped", () => {
      created = groupElements(doc, ids);
    });
    if (created) setSelection([created.id]);
  }

  function ungroupSelection() {
    const groups = selectedVertices().filter((v) => v.kind === "group");
    if (!groups.length) return;
    let released = [];
    commit("Ungrouped", () => {
      released = ungroup(
        doc,
        groups.map((g) => g.id)
      );
    });
    setSelection(released);
  }

  function toggleLock() {
    const items = selectedVertices();
    if (!items.length) return;
    const lock = items.some((v) => !v.locked);
    commit(lock ? "Locked" : "Unlocked", () => {
      for (const vertex of items) {
        const target = get(vertex.id);
        if (lock) target.locked = true;
        else delete target.locked;
      }
    });
  }

  function autoLayout(direction = "LR") {
    const chosen = selectedVertices().filter((v) => !v.locked);
    const pool = chosen.length >= 2 ? chosen : vertices(doc).filter((v) => !v.parent && !v.locked);
    if (pool.length < 2) return;
    const ids = new Set(pool.map((v) => v.id));
    const map = index();
    const owner = (id) => {
      let current = map.get(id);
      const seen = new Set();
      while (current && !ids.has(current.id) && current.parent && !seen.has(current.parent)) {
        seen.add(current.parent);
        current = map.get(current.parent);
      }
      return current && ids.has(current.id) ? current.id : null;
    };
    const links = doc.connections
      .map((c) => ({ from: owner(c.from), to: owner(c.to) }))
      .filter((link) => link.from && link.to && link.from !== link.to);
    const bounds = unionRects(pool.map(rectOf));
    const items = pool.map((vertex) => ({
      id: vertex.id,
      w: vertex.w + (isServiceNode(vertex) ? 70 : 0),
      h: vertex.h + (isServiceNode(vertex) ? labelDepth(vertex) : 0),
    }));
    const positions = layeredLayout(items, links, {
      direction,
      origin: { x: bounds.x, y: bounds.y },
    });
    commit("Arranged automatically", () => {
      for (const vertex of pool) {
        const next = positions.get(vertex.id);
        if (!next) continue;
        const offset = isServiceNode(vertex) ? 35 : 0;
        moveElements(
          doc,
          [vertex.id],
          snapToGrid(next.x + offset, doc.gridSize) - vertex.x,
          snapToGrid(next.y, doc.gridSize) - vertex.y
        );
      }
      for (const connection of doc.connections) {
        if (ids.has(owner(connection.from)) || ids.has(owner(connection.to)))
          connection.waypoints = [];
      }
      fitGroups(doc);
    });
    fit();
  }

  /** Change properties of the selection from the Format panel. */
  function updateSelected(label, mutate, { coalesce = null, ids = selection } = {}) {
    const wanted = new Set(ids);
    commit(
      label,
      () => {
        for (const element of [...doc.nodes, ...doc.shapes, ...doc.connections]) {
          if (wanted.has(element.id)) mutate(element);
        }
        fitGroups(doc);
      },
      { coalesce, silent: true }
    );
  }

  /** Set a container's trust zone and pass it to every service inside. */
  function applyContainerZone(containerId, zone) {
    commit("Trust zone updated", () => {
      const container = get(containerId);
      if (!container) return;
      if (zone) container.zone = zone;
      else delete container.zone;
      const effective = containerZone(container);
      if (!effective) return;
      for (const child of descendants(doc, [containerId])) {
        if (isServiceNode(child) && inheritedZone(doc, child.id)?.container.id === containerId)
          child.zone = effective;
      }
    });
  }

  // -------------------------------------------------------------- text edit

  function editBox(element) {
    if (!isVertex(element)) {
      const route = routes.get(element.id);
      const point = route?.points?.length ? pointAt(route, element.labelT ?? 0.5) : { x: 0, y: 0 };
      const screen = worldToScreen(view, point);
      return { x: screen.x - 80, y: screen.y - 14, w: 160, h: 28, align: "center", fontSize: 11 };
    }
    const screen = worldRectToScreen(view, element);
    const fontSize =
      (element.style?.fontSize || (isServiceNode(element) ? 12 : isContainer(element) ? 12 : 13)) *
      view.zoom;
    if (isServiceNode(element) || element.kind === "actor" || element.kind === "image") {
      const width = Math.max(150, element.w + 40) * view.zoom;
      return {
        x: screen.x + screen.w / 2 - width / 2,
        y: screen.y + screen.h + 2,
        w: width,
        h: fontSize * LINE_HEIGHT * 2.4,
        align: "center",
        fontSize,
      };
    }
    if (isContainer(element)) {
      return {
        x: screen.x + 28 * view.zoom,
        y: screen.y,
        w: Math.max(80, screen.w - 32 * view.zoom),
        h: fontSize * LINE_HEIGHT + 8,
        align: "left",
        fontSize,
      };
    }
    return { ...screen, align: element.style?.align || "center", fontSize };
  }

  function pointAt(route, t) {
    const points = route.points;
    let total = 0;
    for (let i = 1; i < points.length; i += 1) total += distance(points[i - 1], points[i]);
    let remaining = total * t;
    for (let i = 1; i < points.length; i += 1) {
      const length = distance(points[i - 1], points[i]);
      if (remaining <= length) {
        const r = length ? remaining / length : 0;
        return {
          x: points[i - 1].x + (points[i].x - points[i - 1].x) * r,
          y: points[i - 1].y + (points[i].y - points[i - 1].y) * r,
        };
      }
      remaining -= length;
    }
    return points[points.length - 1];
  }

  function positionTextEditor() {
    if (!textEdit) return;
    const element = get(textEdit.id);
    if (!element) {
      cancelTextEdit();
      return;
    }
    const box = editBox(element);
    Object.assign(textarea.style, {
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${Math.max(60, box.w)}px`,
      height: `${Math.max(24, box.h)}px`,
      fontSize: `${Math.max(9, box.fontSize)}px`,
      textAlign: box.align,
    });
  }

  function startTextEdit(id, initial = null) {
    const element = get(id);
    if (!element || element.locked || element.kind === "group") return;
    finishTextEdit();
    textEdit = { id, original: isServiceNode(element) ? element.name : element.label || "" };
    textarea.value = initial ?? textEdit.original;
    textarea.hidden = false;
    textarea.classList.toggle("is-edge", !isVertex(element));
    canvas.classList.add("is-editing-text");
    positionTextEditor();
    renderOverlay();
    const node = isVertex(element) ? elementNode(id) : edgeElement(id);
    node?.classList.add("is-editing");
    // Focus synchronously: when editing starts from a keystroke, the next
    // keystrokes must already land in the editor.
    textarea.focus({ preventScroll: true });
    if (initial === null) textarea.select();
    else textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function finishTextEdit() {
    if (!textEdit) return;
    const { id, original } = textEdit;
    const value = textarea.value.replace(/\s+$/g, "");
    textEdit = null;
    textarea.hidden = true;
    canvas.classList.remove("is-editing-text");
    if (value !== original) {
      commit("Edited label", () => {
        const element = get(id);
        if (!element) return;
        if (isServiceNode(element)) element.name = value.slice(0, 80) || element.serviceName;
        else element.label = value.slice(0, isVertex(element) ? 400 : 120);
        if (element.kind === "table") fitTable(element, measure);
      });
    } else {
      render();
    }
    canvas.focus({ preventScroll: true });
  }

  function cancelTextEdit() {
    if (!textEdit) return;
    textEdit = null;
    textarea.hidden = true;
    canvas.classList.remove("is-editing-text");
    render();
    canvas.focus({ preventScroll: true });
  }

  textarea.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      cancelTextEdit();
    } else if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      finishTextEdit();
    }
  });
  textarea.addEventListener("blur", () => finishTextEdit());

  // ---------------------------------------------------------------- gestures

  function hitTest(event) {
    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest("[data-handle]");
    if (handle) {
      const [kind, value] = handle.dataset.handle.split(":");
      return {
        kind: "handle",
        handle: kind,
        value,
        id: handle.dataset.id || handle.dataset.edgeId,
      };
    }
    const label = target?.closest(".dg-edge-label");
    const edge = target?.closest("[data-edge-id]");
    if (edge) return { kind: label ? "edge-label" : "edge", id: edge.dataset.edgeId };
    const vertex = target?.closest("[data-id]");
    if (vertex) return { kind: "vertex", id: vertex.dataset.id };
    return { kind: "empty" };
  }

  /** The vertex under a screen point, ignoring overlay chrome and `exclude`. */
  function vertexAtPoint(clientX, clientY, exclude = new Set()) {
    const stack = document.elementsFromPoint?.(clientX, clientY) || [];
    for (const node of stack) {
      const hit = node.closest?.("[data-id].dg-vertex");
      if (hit && !exclude.has(hit.dataset.id)) {
        const element = get(hit.dataset.id);
        if (element && element.kind !== "group") return element;
      }
    }
    return null;
  }

  function nearestPort(vertex, point) {
    let best = null;
    for (const side of ["n", "e", "s", "w"]) {
      const base = sidePoint(vertex, side);
      const port =
        side === "s" && isServiceNode(vertex)
          ? { x: base.x, y: base.y + labelDepth(vertex) }
          : base;
      const gap = distance(port, point) * view.zoom;
      if (gap < 16 && (!best || gap < best.gap)) best = { side, gap, point: port };
    }
    return best;
  }

  function snapTargets(excluded) {
    const visible = visibleWorld(view, size());
    return vertices(doc)
      .filter((vertex) => !excluded.has(vertex.id) && vertex.kind !== "group")
      .map(rectOf)
      .filter((rect) =>
        rectsIntersect(rect, {
          x: visible.x - 200,
          y: visible.y - 200,
          w: visible.w + 400,
          h: visible.h + 400,
        })
      )
      .slice(0, 400);
  }

  function beginMove(event, id) {
    const element = get(id);
    let ids = selection.includes(id) ? selectedVertices().map((v) => v.id) : [id];
    ids = ids.filter((vid) => !get(vid)?.locked);
    const freeEdges = selectedEdges()
      .filter((e) => !e.from || !e.to)
      .map((e) => e.id);
    if (!ids.length && !element?.locked) return null;
    const moving = new Set(ids);
    descendants(doc, ids).forEach((vertex) => moving.add(vertex.id));
    const primary = unionRects(ids.map((vid) => rectOf(get(vid))));
    return {
      type: "move",
      start: worldPoint(event),
      before: snapshot(),
      ids,
      freeEdges,
      moving,
      applied: { x: 0, y: 0 },
      primary,
      others: snapTargets(moving),
      duplicate: event.altKey,
      moved: false,
    };
  }

  function updateMove(event) {
    const point = worldPoint(event);
    let dx = point.x - gesture.start.x;
    let dy = point.y - gesture.start.y;
    if (event.shiftKey) {
      if (Math.abs(dx) > Math.abs(dy)) dy = 0;
      else dx = 0;
    }
    guides = [];
    if (!event.altKey || gesture.duplicate) {
      const moved = { ...gesture.primary, x: gesture.primary.x + dx, y: gesture.primary.y + dy };
      const snap = computeSnap(moved, gesture.others, {
        threshold: SNAP_PX / view.zoom,
        gridSize: doc.gridSize,
        snapGrid: doc.snap !== false,
      });
      dx += snap.dx;
      dy += snap.dy;
      guides = snap.guides;
    }
    const stepX = dx - gesture.applied.x;
    const stepY = dy - gesture.applied.y;
    if (stepX || stepY) {
      moveElements(doc, [...gesture.ids, ...gesture.freeEdges], stepX, stepY);
      gesture.applied = { x: dx, y: dy };
    }
    const primaryNow = { ...gesture.primary, x: gesture.primary.x + dx, y: gesture.primary.y + dy };
    const container = containerAt(doc, primaryNow, gesture.moving);
    const currentParents = new Set(gesture.ids.map((id) => get(id)?.parent || null));
    const nextDrop =
      container && !(currentParents.size === 1 && currentParents.has(container.id))
        ? container.id
        : null;
    if (nextDrop !== dropTargetId) {
      const previous = dropTargetId;
      dropTargetId = nextDrop;
      renderPartial([
        ...gesture.moving,
        ...gesture.freeEdges,
        ...[previous, nextDrop].filter(Boolean),
      ]);
    } else {
      renderPartial([...gesture.moving, ...gesture.freeEdges]);
    }
  }

  function endMove() {
    const { ids, before, duplicate: isDuplicate } = gesture;
    guides = [];
    dropTargetId = null;
    if (!gesture.moved) return;
    if (isDuplicate) {
      // Alt-drag: leave copies where the originals were.
      const movedDoc = snapshot();
      const payload = copySelection(JSON.parse(movedDoc), ids);
      doc = JSON.parse(before);
      const pasted = pastePayload(doc, payload, 0, 0);
      history.record(before, "Duplicated");
      setSelection(pasted, { silent: true });
      render();
      onChange({ type: "commit", label: "Duplicated" });
      return;
    }
    const changes = reparent(doc, ids);
    for (const change of changes) {
      const vertex = get(change.id);
      if (isServiceNode(vertex) && change.to) {
        const inherited = inheritedZone(doc, vertex.id);
        if (inherited && vertex.zone !== inherited.zone) {
          vertex.zone = inherited.zone;
          onStatus(
            `${vertex.name} is now in the ${inherited.container.label || "container"} trust zone`
          );
        }
      }
    }
    fitGroups(doc);
    history.record(before, ids.length === 1 ? "Moved shape" : `Moved ${ids.length} shapes`);
    render();
    onChange({ type: "commit", label: "Moved" });
  }

  function beginResize(event, id, handle) {
    const element = get(id);
    if (!element || element.locked) return null;
    return {
      type: "resize",
      id,
      handle,
      start: worldPoint(event),
      origin: rectOf(element),
      before: snapshot(),
      others: snapTargets(new Set([id, ...descendants(doc, [id]).map((v) => v.id)])),
      moved: false,
    };
  }

  function updateResize(event) {
    const element = get(gesture.id);
    const point = worldPoint(event);
    const keepAspect =
      isServiceNode(element) || element.kind === "image" ? !event.shiftKey : event.shiftKey;
    let next = resizeRect(
      gesture.origin,
      gesture.handle,
      point.x - gesture.start.x,
      point.y - gesture.start.y,
      {
        keepAspect,
        minimum: isServiceNode(element) ? 16 : 10,
      }
    );
    if (doc.snap !== false && !event.altKey && !keepAspect) {
      const step = doc.gridSize;
      const right = gesture.handle.includes("e")
        ? snapToGrid(next.x + next.w, step)
        : next.x + next.w;
      const bottom = gesture.handle.includes("s")
        ? snapToGrid(next.y + next.h, step)
        : next.y + next.h;
      const left = gesture.handle.includes("w") ? snapToGrid(next.x, step) : next.x;
      const top = gesture.handle.includes("n") ? snapToGrid(next.y, step) : next.y;
      next = { x: left, y: top, w: Math.max(10, right - left), h: Math.max(10, bottom - top) };
    }
    if (SHAPE_KINDS[element.kind]?.fixedHeight)
      next = { ...next, y: gesture.origin.y, h: gesture.origin.h };
    Object.assign(element, { x: next.x, y: next.y, w: next.w, h: next.h });
    renderPartial([gesture.id]);
  }

  function endResize() {
    if (!gesture.moved) return;
    const element = get(gesture.id);
    if (isContainer(element))
      reparent(
        doc,
        vertices(doc)
          .filter((v) => v.id !== element.id)
          .map((v) => v.id)
      );
    history.record(gesture.before, "Resized");
    render();
    onChange({ type: "commit", label: "Resized" });
  }

  function beginConnect(event, sourceId, fixedPort = null) {
    const source = get(sourceId);
    if (!source) return null;
    const start = fixedPort ? portPoint(source, fixedPort) : rectCenter(source);
    return {
      type: "connect",
      sourceId,
      fixedPort,
      moved: false,
      preview: { from: start, to: worldPoint(event), target: null, port: null },
    };
  }

  function portPoint(vertex, side) {
    const base = sidePoint(vertex, side);
    return side === "s" && isServiceNode(vertex)
      ? { x: base.x, y: base.y + labelDepth(vertex) }
      : base;
  }

  function updateConnect(event) {
    const point = worldPoint(event);
    const source = get(gesture.sourceId);
    const target = vertexAtPoint(event.clientX, event.clientY, new Set([gesture.sourceId]));
    const port = target ? nearestPort(target, point) : null;
    const from = gesture.fixedPort
      ? portPoint(source, gesture.fixedPort)
      : portPoint(source, nearestSide(source, target ? rectCenter(target) : point));
    gesture.preview = {
      from,
      to: port ? port.point : target ? rectCenter(target) : point,
      target,
      port: port?.side || null,
    };
    renderOverlay();
  }

  function endConnect(event) {
    const { preview, sourceId, fixedPort } = gesture;
    if (!gesture.moved) return;
    const source = get(sourceId);
    if (preview.target) {
      commit(
        "Connected",
        () => {
          const connection = makeConnection(sourceId, preview.target.id, {
            ...(options.connectionDefaults?.(source, preview.target) || {}),
            fromPort: fixedPort || "auto",
            toPort: preview.port || "auto",
          });
          doc.connections.push(connection);
          options.onConnectionCreated?.(doc, connection);
        },
        { select: [] }
      );
      const created = doc.connections[doc.connections.length - 1];
      setSelection([created.id]);
      return;
    }
    // Released on empty canvas: offer to create something there, connected.
    const at = preview.to;
    options.onQuickInsert?.({
      screen: pointerPosition(event),
      world: at,
      connectFrom: sourceId,
      fromPort: fixedPort,
    });
  }

  function beginEndpoint(event, edgeId, end) {
    const connection = get(edgeId);
    if (!connection) return null;
    return {
      type: "endpoint",
      edgeId,
      end,
      before: snapshot(),
      moved: false,
      target: null,
      port: null,
    };
  }

  function updateEndpoint(event) {
    const connection = get(gesture.edgeId);
    const point = worldPoint(event);
    const otherId = gesture.end === "source" ? connection.to : connection.from;
    const target = vertexAtPoint(event.clientX, event.clientY, new Set([otherId].filter(Boolean)));
    const port = target ? nearestPort(target, point) : null;
    gesture.target = target;
    gesture.port = port?.side || null;
    if (gesture.end === "source") {
      connection.from = null;
      connection.fromPoint = port ? port.point : point;
    } else {
      connection.to = null;
      connection.toPoint = port ? port.point : point;
    }
    renderPartial([gesture.edgeId]);
    const preview = target ? worldRectToScreen(view, target) : null;
    if (preview) {
      overlay.append(
        toDom(
          h("rect", {
            class: "dg-connect-target",
            x: preview.x - 4,
            y: preview.y - 4,
            width: preview.w + 8,
            height: preview.h + 8,
          })
        )
      );
    }
  }

  function endEndpoint() {
    if (!gesture.moved) return;
    const connection = get(gesture.edgeId);
    const key = gesture.end === "source" ? "from" : "to";
    if (gesture.target) {
      connection[key] = gesture.target.id;
      delete connection[`${key}Point`];
      connection[`${key}Port`] = gesture.port || "auto";
      const source = get(connection.from);
      const target = get(connection.to);
      if (source && target && isServiceNode(source) && isServiceNode(target) && !connection.label) {
        Object.assign(connection, options.connectionDefaults?.(source, target) || {});
      }
      if (source && target) {
        // The ends changed, so any recorded column mapping no longer applies.
        delete connection.relation;
        options.onConnectionCreated?.(doc, connection);
      }
    } else {
      connection[`${key}Port`] = "auto";
    }
    history.record(gesture.before, gesture.target ? "Reconnected" : "Detached connector end");
    render();
    onChange({ type: "commit", label: "Reconnected" });
  }

  function beginSegment(event, edgeId, segmentIndex) {
    const connection = get(edgeId);
    const route = routes.get(edgeId);
    if (!connection || !route) return null;
    const routing = connection.style?.routing || "orthogonal";
    if (routing !== "orthogonal") return null;
    const before = snapshot();
    const points = route.points;
    let waypoints;
    let first;
    let second;
    let horizontal;
    if (points.length === 2) {
      // A straight run: pull a two-corner detour out of the middle.
      const [a, b] = points;
      horizontal = Math.abs(a.y - b.y) < 0.5;
      const q1 = { x: a.x + (b.x - a.x) * 0.3, y: a.y + (b.y - a.y) * 0.3 };
      const q2 = { x: a.x + (b.x - a.x) * 0.7, y: a.y + (b.y - a.y) * 0.7 };
      waypoints = [q1, q2];
      first = 0;
      second = 1;
    } else {
      // Freeze the automatic route's corners as waypoints, then move the two
      // that bound the dragged segment.
      waypoints = points.slice(1, -1).map((p) => ({ ...p }));
      first = segmentIndex - 1;
      second = segmentIndex;
      const a = points[segmentIndex];
      const b = points[segmentIndex + 1];
      horizontal = Math.abs(a.y - b.y) < 0.5;
    }
    connection.waypoints = waypoints;
    return {
      type: "segment",
      edgeId,
      before,
      start: worldPoint(event),
      horizontal,
      first,
      second,
      origin: waypoints.map((p) => ({ ...p })),
      moved: false,
    };
  }

  function updateSegment(event) {
    const connection = get(gesture.edgeId);
    const point = worldPoint(event);
    const delta = gesture.horizontal ? point.y - gesture.start.y : point.x - gesture.start.x;
    const snapped = (value) => (doc.snap !== false ? snapToGrid(value, doc.gridSize) : value);
    connection.waypoints = gesture.origin.map((p, index) => {
      if (index !== gesture.first && index !== gesture.second) return { ...p };
      return gesture.horizontal
        ? { x: p.x, y: snapped(p.y + delta) }
        : { x: snapped(p.x + delta), y: p.y };
    });
    renderPartial([gesture.edgeId]);
  }

  function beginBend(event, edgeId, bendIndex, existing = false) {
    const connection = get(edgeId);
    if (!connection) return null;
    const before = snapshot();
    const point = worldPoint(event);
    if (!existing) {
      connection.waypoints = [...(connection.waypoints || [])];
      connection.waypoints.splice(bendIndex, 0, point);
    }
    return { type: "bend", edgeId, index: bendIndex, before, moved: false };
  }

  function updateBend(event) {
    const connection = get(gesture.edgeId);
    const point = worldPoint(event);
    const snapped =
      doc.snap !== false && !event.altKey
        ? { x: snapToGrid(point.x, doc.gridSize), y: snapToGrid(point.y, doc.gridSize) }
        : point;
    connection.waypoints[gesture.index] = snapped;
    renderPartial([gesture.edgeId]);
  }

  function endEdgeShape(label) {
    if (!gesture.moved) {
      doc = JSON.parse(gesture.before);
      render();
      return;
    }
    history.record(gesture.before, label);
    render();
    onChange({ type: "commit", label });
  }

  function beginLabelDrag(event, edgeId) {
    return { type: "label", edgeId, before: snapshot(), moved: false };
  }

  function updateLabelDrag(event) {
    const route = routes.get(gesture.edgeId);
    const connection = get(gesture.edgeId);
    if (!route || !connection) return;
    connection.labelT =
      Math.round(nearestOnPolyline(route.points, worldPoint(event)).t * 1000) / 1000;
    renderPartial([gesture.edgeId]);
  }

  function beginMarquee(event, additive) {
    const start = worldPoint(event);
    return {
      type: "marquee",
      start,
      rect: { ...start, w: 0, h: 0 },
      additive,
      base: additive ? [...selection] : [],
      moved: false,
    };
  }

  function updateMarquee(event) {
    const point = worldPoint(event);
    gesture.rect = rectFromPoints(gesture.start, point);
    const inside = vertices(doc)
      .filter((vertex) => rectContainsRect(gesture.rect, rectOf(vertex)))
      .filter(
        (vertex) =>
          !vertex.parent ||
          !get(vertex.parent) ||
          !rectContainsRect(gesture.rect, rectOf(get(vertex.parent))) ||
          get(vertex.parent).kind !== "group"
      )
      .map((vertex) => vertex.id);
    const edges = doc.connections
      .filter((connection) => {
        const route = routes.get(connection.id);
        return route?.points?.every(
          (p) =>
            p.x >= gesture.rect.x &&
            p.x <= gesture.rect.x + gesture.rect.w &&
            p.y >= gesture.rect.y &&
            p.y <= gesture.rect.y + gesture.rect.h
        );
      })
      .map((connection) => connection.id);
    setSelection([...gesture.base, ...inside, ...edges], { silent: true });
    renderSelectionClasses();
    renderOverlay();
  }

  function beginPan(event) {
    canvas.classList.add("is-panning");
    return { type: "pan", origin: pointerPosition(event), view: { ...view }, moved: false };
  }

  function updatePan(event) {
    const point = pointerPosition(event);
    setView({
      ...gesture.view,
      x: gesture.view.x + point.x - gesture.origin.x,
      y: gesture.view.y + point.y - gesture.origin.y,
    });
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!doc || event.button === 2) return;
    if (textEdit && event.target !== textarea) finishTextEdit();
    canvas.focus({ preventScroll: true });
    const hit = hitTest(event);
    const panning = event.button === 1 || spaceHeld || tool === "hand";
    let next = null;

    if (panning) {
      next = beginPan(event);
    } else if (hit.kind === "handle") {
      if (hit.handle === "resize") next = beginResize(event, hit.id, hit.value);
      else if (hit.handle === "end") next = beginEndpoint(event, hit.id, hit.value);
      else if (hit.handle === "segment") next = beginSegment(event, hit.id, Number(hit.value));
      else if (hit.handle === "bend") next = beginBend(event, hit.id, Number(hit.value));
      else if (hit.handle === "waypoint") next = beginBend(event, hit.id, Number(hit.value), true);
      else if (hit.handle === "arrow")
        next = { ...beginConnect(event, hit.id), arrowSide: hit.value };
      else if (hit.handle === "port") next = beginConnect(event, hit.id, hit.value);
    } else if (hit.kind === "vertex") {
      const id = selectableFor(hit.id);
      if (tool === "connect" && get(id)?.kind !== "group") {
        next = beginConnect(event, id);
      } else {
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
          setSelection(
            selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]
          );
        } else if (!selection.includes(id)) {
          setSelection([id]);
        }
        next = beginMove(event, id);
        if (next) next.clickId = id;
      }
    } else if (hit.kind === "edge" || hit.kind === "edge-label") {
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        setSelection(
          selection.includes(hit.id)
            ? selection.filter((s) => s !== hit.id)
            : [...selection, hit.id]
        );
      } else if (!selection.includes(hit.id)) {
        setSelection([hit.id]);
      }
      if (hit.kind === "edge-label") next = beginLabelDrag(event, hit.id);
      else {
        const connection = get(hit.id);
        if (connection && (!connection.from || !connection.to)) next = beginMove(event, hit.id);
      }
    } else {
      next = beginMarquee(event, event.shiftKey || event.metaKey || event.ctrlKey);
      if (!next.additive) setSelection([]);
    }

    if (next) {
      gesture = {
        ...next,
        pointerId: event.pointerId,
        origin: next.origin || pointerPosition(event),
        downAt: pointerPosition(event),
      };
      canvas.setPointerCapture?.(event.pointerId);
      hoverId = null;
      event.preventDefault();
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!doc) return;
    if (!gesture) {
      scheduleFrame(() => updateHover(event));
      return;
    }
    if (!gesture.moved) {
      const point = pointerPosition(event);
      if (distance(point, gesture.downAt) < DRAG_THRESHOLD) return;
      gesture.moved = true;
      if (gesture.type === "move" && gesture.duplicate) canvas.classList.add("is-duplicating");
    }
    const handler = {
      move: updateMove,
      resize: updateResize,
      connect: updateConnect,
      endpoint: updateEndpoint,
      segment: updateSegment,
      bend: updateBend,
      label: updateLabelDrag,
      marquee: updateMarquee,
      pan: updatePan,
    }[gesture.type];
    scheduleFrame(() => gesture && handler?.(event));
  });

  function endGesture(event) {
    if (!gesture) return;
    if (frame) {
      // Apply the last pointer position before the gesture ends.
      if (frame > 0) globalThis.cancelAnimationFrame?.(frame);
      frame = 0;
      flushFrame();
    }
    const current = gesture;
    try {
      switch (current.type) {
        case "move":
          endMove();
          if (
            !current.moved &&
            current.clickId &&
            !(event.shiftKey || event.metaKey || event.ctrlKey)
          ) {
            setSelection([current.clickId]);
          }
          break;
        case "resize":
          endResize();
          break;
        case "connect":
          if (!current.moved && current.arrowSide) cloneToward(current.sourceId, current.arrowSide);
          else endConnect(event);
          break;
        case "endpoint":
          endEndpoint();
          break;
        case "segment":
          endEdgeShape("Rerouted connector");
          break;
        case "bend":
          endEdgeShape("Moved waypoint");
          break;
        case "label":
          if (current.moved) {
            history.record(current.before, "Moved label");
            onChange({ type: "commit", label: "Moved label" });
          }
          break;
        default:
          break;
      }
    } finally {
      gesture = null;
      guides = [];
      dropTargetId = null;
      canvas.classList.remove("is-panning", "is-duplicating");
      canvas.releasePointerCapture?.(event.pointerId);
      if (current.type === "pan" && current.moved) onViewChange({ ...view });
      renderOverlay();
    }
  }

  canvas.addEventListener("pointerup", endGesture);
  // Safety net: if pointer capture is unavailable and the release happens off
  // the canvas (or on a node re-rendered mid-drag), still end the gesture.
  window.addEventListener("pointerup", (event) => {
    if (gesture) endGesture(event);
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (gesture?.before) {
      doc = JSON.parse(gesture.before);
      render();
    }
    endGesture(event);
  });

  function updateHover(event) {
    const hit = hitTest(event);
    let next = null;
    if (hit.kind === "vertex") next = hit.id;
    else if (hit.kind === "handle" && (hit.handle === "arrow" || hit.handle === "port"))
      next = hit.id;
    if (next) {
      clearTimeout(hoverTimer);
      if (next !== hoverId) {
        hoverId = next;
        renderOverlay();
      }
    } else if (hoverId) {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        hoverId = null;
        renderOverlay();
      }, 420);
    }
  }

  canvas.addEventListener("pointerleave", () => {
    if (gesture) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => {
      hoverId = null;
      renderOverlay();
    }, 300);
  });

  canvas.addEventListener("dblclick", (event) => {
    if (!doc) return;
    const hit = hitTest(event);
    if (hit.kind === "vertex") {
      const element = get(hit.id);
      startTextEdit(element?.kind === "group" ? hit.id : hit.id);
    } else if (hit.kind === "edge" || hit.kind === "edge-label") {
      startTextEdit(hit.id);
    } else if (hit.kind === "handle" && hit.handle === "waypoint") {
      commit("Removed waypoint", () => {
        const connection = get(hit.id);
        connection.waypoints.splice(Number(hit.value), 1);
      });
    } else if (hit.kind === "handle" && hit.handle === "segment") {
      commit("Reset connector route", () => {
        get(hit.id).waypoints = [];
      });
    } else if (hit.kind === "empty") {
      options.onQuickInsert?.({ screen: pointerPosition(event), world: worldPoint(event) });
    }
  });

  canvas.addEventListener("contextmenu", (event) => {
    if (!doc) return;
    event.preventDefault();
    const hit = hitTest(event);
    let id = null;
    if (hit.kind === "vertex") id = selectableFor(hit.id);
    else if (hit.kind === "edge" || hit.kind === "edge-label") id = hit.id;
    if (id && !selection.includes(id)) setSelection([id]);
    if (!id && hit.kind === "empty" && selection.length) setSelection([]);
    options.onContextMenu?.({
      clientX: event.clientX,
      clientY: event.clientY,
      world: worldPoint(event),
      targetId: id,
    });
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (!doc) return;
      event.preventDefault();
      const anchor = pointerPosition(event);
      if (event.ctrlKey || event.metaKey) {
        // Pinch-zoom on trackpads arrives as ctrl+wheel with small deltas.
        const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0022));
        setView(zoomAt(view, anchor, view.zoom * factor));
      } else {
        const scale = event.deltaMode === 1 ? 16 : 1;
        const dx = event.shiftKey && !event.deltaX ? event.deltaY : event.deltaX;
        const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY;
        setView({ ...view, x: view.x - dx * scale, y: view.y - dy * scale });
      }
    },
    { passive: false }
  );

  // Library drag and drop.
  canvas.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    const types = [...event.dataTransfer.types];
    if (!types.includes("application/x-diagram-item") && !types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    canvas.classList.add("is-drop-target");
  });
  canvas.addEventListener("dragleave", (event) => {
    if (!canvas.contains(event.relatedTarget)) canvas.classList.remove("is-drop-target");
  });
  canvas.addEventListener("drop", (event) => {
    canvas.classList.remove("is-drop-target");
    if (!event.dataTransfer) return;
    event.preventDefault();
    const at = worldPoint(event);
    const raw = event.dataTransfer.getData("application/x-diagram-item");
    if (raw) {
      try {
        options.onDropItem?.(JSON.parse(raw), at);
      } catch {
        /* malformed drag payload */
      }
      return;
    }
    const [file] = event.dataTransfer.files || [];
    if (file) options.onDropFile?.(file, at);
  });

  // ------------------------------------------------------------- keyboard

  const toolKeys = { v: "select", h: "hand", c: "connect" };
  const insertKeys = { r: "rect", o: "ellipse", t: "text", n: "note", d: "diamond" };

  function handleKey(event) {
    if (!doc || textEdit) return false;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    const step = event.shiftKey ? doc.gridSize || 10 : 1;
    if (mod && key === "z") {
      if (event.shiftKey) redo();
      else undo();
      return true;
    }
    if (mod && key === "y") return (redo(), true);
    if (mod && key === "a") return (selectAll(), true);
    if (mod && key === "d") return (duplicate(), true);
    if (mod && key === "g") {
      if (event.shiftKey) ungroupSelection();
      else group();
      return true;
    }
    if (mod && event.shiftKey && key === "u") return (ungroupSelection(), true);
    if (mod && event.shiftKey && key === "l") return (toggleLock(), true);
    if ((mod && event.shiftKey && key === "f") || (mod && event.key === "]"))
      return (toFront(), true);
    if ((mod && event.shiftKey && key === "b") || (mod && event.key === "["))
      return (toBack(), true);
    if (mod && (event.key === "=" || event.key === "+")) return (zoomBy(1), true);
    if (mod && event.key === "-") return (zoomBy(-1), true);
    if (mod && event.key === "0") return (zoomTo(1), true);
    if (mod) return false;
    if (event.shiftKey && (event.code === "Digit1" || event.key === "!")) return (fit(), true);
    if (event.shiftKey && (event.code === "Digit2" || event.key === "@"))
      return (fit(selection), true);
    switch (event.key) {
      case "Delete":
      case "Backspace":
        deleteSelection();
        return true;
      case "Escape":
        if (gesture) {
          if (gesture.before) doc = JSON.parse(gesture.before);
          gesture = null;
          render();
        } else if (tool !== "select") setTool("select");
        else setSelection([]);
        return true;
      case "ArrowLeft":
        nudge(-step, 0);
        return true;
      case "ArrowRight":
        nudge(step, 0);
        return true;
      case "ArrowUp":
        nudge(0, -step);
        return true;
      case "ArrowDown":
        nudge(0, step);
        return true;
      case "Enter":
      case "F2":
        if (selection.length === 1) startTextEdit(selection[0]);
        return true;
      case "Tab": {
        // Only cycle while something is selected, so Tab can still leave the canvas.
        if (!selection.length) return false;
        const order = vertices(doc).filter((v) => v.kind !== "group");
        if (!order.length) return false;
        const current = order.findIndex((v) => v.id === selection[0]);
        const next = order[(current + (event.shiftKey ? -1 : 1) + order.length) % order.length];
        reveal(next.id);
        return true;
      }
      default:
        break;
    }
    if (event.altKey || event.key.length !== 1 || !/\S/.test(event.key)) return false;
    if (selection.length === 1 && event.key !== "?") {
      // Typing over a single selected shape replaces its label, as in draw.io.
      startTextEdit(selection[0], event.key);
      return true;
    }
    if (event.shiftKey) return false;
    if (toolKeys[key]) return (setTool(toolKeys[key]), true);
    if (insertKeys[key]) {
      insertShape(insertKeys[key], insertKeys[key] === "text" ? { label: "Text" } : {});
      return true;
    }
    return false;
  }

  canvas.addEventListener("keydown", (event) => {
    if (event.key === " " && !textEdit) {
      spaceHeld = true;
      canvas.classList.add("is-space-pan");
      event.preventDefault();
      return;
    }
    if (handleKey(event)) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  canvas.addEventListener("keyup", (event) => {
    if (event.key === " ") {
      spaceHeld = false;
      canvas.classList.remove("is-space-pan");
    }
  });
  window.addEventListener("blur", () => {
    spaceHeld = false;
    canvas.classList.remove("is-space-pan");
  });

  // Native clipboard events carry data across tabs without permission prompts.
  function clipboardEnabled(event) {
    if (!doc || textEdit || !isActive()) return false;
    const active = document.activeElement;
    if (isTypingTarget(active) || isTypingTarget(event.target)) return false;
    return root.contains(active) || active === document.body;
  }

  document.addEventListener("copy", (event) => {
    if (!clipboardEnabled(event) || !selection.length) return;
    const payload = copy();
    event.clipboardData?.setData("text/plain", JSON.stringify(payload));
    event.preventDefault();
  });
  document.addEventListener("cut", (event) => {
    if (!clipboardEnabled(event) || !selection.length) return;
    const payload = copy();
    event.clipboardData?.setData("text/plain", JSON.stringify(payload));
    deleteSelection();
    event.preventDefault();
  });
  document.addEventListener("paste", (event) => {
    if (!clipboardEnabled(event)) return;
    const text = event.clipboardData?.getData("text/plain") || "";
    const files = [...(event.clipboardData?.files || [])];
    event.preventDefault();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (isClipboardPayload(parsed)) {
          paste(parsed);
          return;
        }
      } catch {
        /* not our payload */
      }
      if (options.onPasteText?.(text)) return;
      insertShape(
        "text",
        { label: text.slice(0, 400), w: Math.min(360, Math.max(80, text.length * 7)) },
        { edit: false }
      );
      return;
    }
    if (files.length) {
      options.onDropFile?.(files[0], centerOfView());
      return;
    }
    if (clipboard) paste(clipboard);
  });

  // --------------------------------------------------------------- tools

  function setTool(next) {
    tool = ["select", "hand", "connect"].includes(next) ? next : "select";
    canvas.dataset.tool = tool;
    renderOverlay();
    options.onToolChange?.(tool);
  }

  // --------------------------------------------------------------- resize

  if (typeof ResizeObserver === "function") {
    let last = null;
    new ResizeObserver(() => {
      const current = size();
      if (pendingFit && doc && current.width >= 40 && current.height >= 40) {
        fit(pendingFit === true ? null : pendingFit);
      } else if (
        last &&
        last.width >= 40 &&
        (last.width !== current.width || last.height !== current.height) &&
        doc
      ) {
        // Keep the centre of the view steady as the canvas changes size.
        setView(
          {
            ...view,
            x: view.x + (current.width - last.width) / 2,
            y: view.y + (current.height - last.height) / 2,
          },
          { silent: true }
        );
      }
      last = current;
    }).observe(canvas);
  }

  // ------------------------------------------------------------------- API

  function setDocument(next, { resetHistory = false, keepView = false, label = null } = {}) {
    const before = doc ? snapshot() : null;
    doc = next;
    routeCache.clear();
    if (resetHistory) history.clear();
    else if (before && label) history.record(before, label);
    selection = [];
    onSelectionChange([]);
    render();
    if (!keepView) requestAnimationFrame(() => fit());
    onChange({ type: resetHistory ? "load" : "commit", label: label || "Loaded" });
  }

  canvas.dataset.tool = tool;

  return {
    get doc() {
      return doc;
    },
    get view() {
      return { ...view };
    },
    get tool() {
      return tool;
    },
    get routes() {
      return routes;
    },
    canvas,
    history,
    measure,
    setDocument,
    commit,
    undo,
    redo,
    render,
    renderOverlay,
    selection: () => [...selection],
    selectedElements,
    setSelection,
    selectAll,
    deleteSelection,
    copy,
    cut,
    paste,
    get clipboard() {
      return clipboard;
    },
    duplicate,
    insertShape,
    insertService,
    insertVertex,
    insertConnected,
    align,
    distribute,
    toFront,
    toBack,
    group,
    ungroup: ungroupSelection,
    toggleLock,
    autoLayout,
    updateSelected,
    applyContainerZone,
    startTextEdit,
    setTool,
    setView,
    zoomBy,
    zoomTo,
    fit,
    reveal,
    centerOfView,
    size,
    labelDepth,
    analysisView: () => analysisView(doc),
    setHighlight(ids) {
      highlight = new Set(ids || []);
      render();
    },
    handleKey,
    focus: () => canvas.focus({ preventScroll: true }),
    worldToScreen: (point) => worldToScreen(view, point),
    screenToWorld: (point) => screenToWorld(view, point),
    sceneContext,
    isEditingText: () => Boolean(textEdit),
    zForNew: (element) => zForNew(doc, element),
    snap: (value) => (doc?.snap !== false ? snapToGrid(value, doc.gridSize) : value),
    OPPOSITE_SIDE,
  };
}
