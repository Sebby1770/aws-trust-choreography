/**
 * Editing overlay — selection outlines, handles, guides, the marquee, hover
 * connection arrows, and the live connector preview.
 *
 * Drawn in *screen* space on top of the scaled world, so handles stay the
 * same size at every zoom level. Every grabbable part carries a
 * `data-handle` attribute the editor's pointer handler dispatches on.
 */

import { h } from "./vdom.js";
import { sidePoint, SIDES } from "./geometry.js";
import { worldRectToScreen, worldToScreen } from "./viewport.js";
import { isServiceNode } from "./model.js";

export const ACCENT = "#0972d3";
const GUIDE = "#e5198a";
const HANDLE = 8;

function fmt(value) {
  return Math.round(value * 10) / 10;
}

function resizeHandles(rect, id, fixedHeight = false) {
  const { x, y, w, h: height } = rect;
  const points = {
    nw: [x, y],
    n: [x + w / 2, y],
    ne: [x + w, y],
    e: [x + w, y + height / 2],
    se: [x + w, y + height],
    s: [x + w / 2, y + height],
    sw: [x, y + height],
    w: [x, y + height / 2],
  };
  // Tiny shapes keep only their corners so the handles stay grabbable, and
  // shapes whose height follows their content only resize sideways.
  const names = fixedHeight
    ? ["e", "w"]
    : w < 24 || height < 24
      ? ["nw", "ne", "se", "sw"]
      : Object.keys(points);
  return names.map((name) =>
    h("rect", {
      class: `dg-handle dg-handle-${name}`,
      "data-handle": `resize:${name}`,
      "data-id": id,
      x: fmt(points[name][0] - HANDLE / 2),
      y: fmt(points[name][1] - HANDLE / 2),
      width: HANDLE,
      height: HANDLE,
      rx: 1.5,
    })
  );
}

function vertexSelection(vertex, view, { handles }) {
  const screen = worldRectToScreen(view, vertex);
  const box = { x: screen.x - 3, y: screen.y - 3, w: screen.w + 6, h: screen.h + 6 };
  const parts = [
    h("rect", {
      class: `dg-selection-box${vertex.locked ? " is-locked" : ""}`,
      x: fmt(box.x),
      y: fmt(box.y),
      width: fmt(box.w),
      height: fmt(box.h),
    }),
  ];
  if (vertex.locked) {
    parts.push(
      h(
        "g",
        {
          class: "dg-lock-badge",
          transform: `translate(${fmt(box.x + box.w - 8)} ${fmt(box.y - 8)})`,
        },
        h("circle", { cx: 8, cy: 8, r: 8 }),
        h("path", { d: "M5.5 8.5h5v4h-5z M6.5 8.5v-1.6a1.5 1.5 0 0 1 3 0v1.6", fill: "none" })
      )
    );
  } else if (handles) {
    parts.push(...resizeHandles(screen, vertex.id, vertex.kind === "table"));
  }
  return parts;
}

function edgeSelection(connection, route, view) {
  if (!route?.points?.length) return [];
  const parts = [];
  const screenPoints = route.points.map((point) => worldToScreen(view, point));
  const style = connection.style || {};
  const routing = style.routing || "orthogonal";
  const first = screenPoints[0];
  const last = screenPoints[screenPoints.length - 1];

  if (routing === "orthogonal") {
    // Drag an interior segment sideways, draw.io style.
    for (let index = 1; index < screenPoints.length - 2; index += 1) {
      const a = screenPoints[index];
      const b = screenPoints[index + 1];
      const horizontal = Math.abs(a.y - b.y) < 0.5;
      const length = horizontal ? Math.abs(a.x - b.x) : Math.abs(a.y - b.y);
      if (length < 18) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      parts.push(
        h("rect", {
          class: `dg-handle dg-segment-handle ${horizontal ? "is-horizontal" : "is-vertical"}`,
          "data-handle": `segment:${index}`,
          "data-edge-id": connection.id,
          x: fmt(mid.x - (horizontal ? 9 : 3.5)),
          y: fmt(mid.y - (horizontal ? 3.5 : 9)),
          width: horizontal ? 18 : 7,
          height: horizontal ? 7 : 18,
          rx: 3.5,
        })
      );
    }
    // A straight run gets one handle to pull a detour out of it.
    if (screenPoints.length === 2) {
      const mid = { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 };
      parts.push(
        h("circle", {
          class: "dg-handle dg-bend-handle",
          "data-handle": "segment:0",
          "data-edge-id": connection.id,
          cx: fmt(mid.x),
          cy: fmt(mid.y),
          r: 4.5,
        })
      );
    }
  } else {
    const through = [
      route.points[0],
      ...(connection.waypoints || []),
      route.points[route.points.length - 1],
    ].map((point) => worldToScreen(view, point));
    for (let index = 1; index < through.length; index += 1) {
      const a = through[index - 1];
      const b = through[index];
      parts.push(
        h("circle", {
          class: "dg-handle dg-bend-handle",
          "data-handle": `bend:${index - 1}`,
          "data-edge-id": connection.id,
          cx: fmt((a.x + b.x) / 2),
          cy: fmt((a.y + b.y) / 2),
          r: 4.5,
        })
      );
    }
  }
  (connection.waypoints || []).forEach((point, index) => {
    if (routing === "orthogonal") return;
    const screen = worldToScreen(view, point);
    parts.push(
      h("rect", {
        class: "dg-handle dg-waypoint-handle",
        "data-handle": `waypoint:${index}`,
        "data-edge-id": connection.id,
        x: fmt(screen.x - 5),
        y: fmt(screen.y - 5),
        width: 10,
        height: 10,
        rx: 2,
      })
    );
  });
  for (const [end, point, attached] of [
    ["source", first, Boolean(connection.from)],
    ["target", last, Boolean(connection.to)],
  ]) {
    parts.push(
      h("circle", {
        class: `dg-handle dg-end-handle${attached ? " is-attached" : ""}`,
        "data-handle": `end:${end}`,
        "data-edge-id": connection.id,
        cx: fmt(point.x),
        cy: fmt(point.y),
        r: 5.5,
      })
    );
  }
  return parts;
}

/** The four blue "drag to connect / click to clone" arrows around a vertex. */
function hoverArrows(vertex, view, depth, { ports = true } = {}) {
  const screen = worldRectToScreen(view, vertex);
  const parts = [];
  const gap = 24;
  const size = 8;
  for (const side of SIDES) {
    const base = sidePoint(screen, side);
    const extra = side === "s" ? depth * view.zoom : 0;
    const center = {
      x: base.x + (side === "e" ? gap : side === "w" ? -gap : 0),
      y: base.y + (side === "s" ? gap + extra : side === "n" ? -gap : 0),
    };
    const rotate = { n: -90, e: 0, s: 90, w: 180 }[side];
    parts.push(
      h(
        "g",
        {
          class: "dg-hover-arrow",
          "data-handle": `arrow:${side}`,
          "data-id": vertex.id,
          transform: `translate(${fmt(center.x)} ${fmt(center.y)}) rotate(${rotate})`,
        },
        h("circle", { class: "dg-hover-arrow-hit", r: 12 }),
        h("path", { d: `M ${-size * 0.7} ${-size} L ${size} 0 L ${-size * 0.7} ${size} Z` })
      )
    );
    if (!ports) continue;
    const port = { x: base.x, y: base.y + extra };
    parts.push(
      h("circle", {
        class: "dg-port",
        "data-handle": `port:${side}`,
        "data-id": vertex.id,
        cx: fmt(port.x),
        cy: fmt(port.y),
        r: 4,
      })
    );
  }
  return parts;
}

/**
 * Build the overlay.
 *
 * @param {object} state
 * @param {{x,y,zoom}} state.view
 * @param {Array} state.selectedVertices
 * @param {Array} state.selectedEdges
 * @param {Map} state.routes
 * @param {Array} [state.guides]  world-space guide lines
 * @param {{x,y,w,h}} [state.marquee] world rect
 * @param {object} [state.hover] a vertex to show connect arrows around
 * @param {object} [state.connect] {from, to, target, port} live connector
 * @param {(vertex) => number} [state.labelDepth]
 */
export function buildOverlay(state) {
  const { view } = state;
  const parts = [];
  const vertices = state.selectedVertices || [];
  const single = vertices.length === 1 && !(state.selectedEdges || []).length;

  for (const guide of state.guides || []) {
    const a = worldToScreen(
      view,
      guide.axis === "x" ? { x: guide.at, y: guide.from } : { x: guide.from, y: guide.at }
    );
    const b = worldToScreen(
      view,
      guide.axis === "x" ? { x: guide.at, y: guide.to } : { x: guide.to, y: guide.at }
    );
    parts.push(
      h("line", {
        class: "dg-guide",
        x1: fmt(a.x),
        y1: fmt(a.y),
        x2: fmt(b.x),
        y2: fmt(b.y),
        stroke: GUIDE,
      })
    );
  }

  for (const vertex of vertices) {
    parts.push(...vertexSelection(vertex, view, { handles: single && vertex.kind !== "group" }));
  }
  if (vertices.length > 1) {
    const xs = vertices.flatMap((vertex) => [vertex.x, vertex.x + vertex.w]);
    const ys = vertices.flatMap((vertex) => [vertex.y, vertex.y + vertex.h]);
    const box = worldRectToScreen(view, {
      x: Math.min(...xs),
      y: Math.min(...ys),
      w: Math.max(...xs) - Math.min(...xs),
      h: Math.max(...ys) - Math.min(...ys),
    });
    parts.push(
      h("rect", {
        class: "dg-group-selection",
        x: fmt(box.x - 7),
        y: fmt(box.y - 7),
        width: fmt(box.w + 14),
        height: fmt(box.h + 14),
      })
    );
  }

  for (const connection of state.selectedEdges || []) {
    parts.push(...edgeSelection(connection, state.routes?.get(connection.id), view));
  }

  if (state.hover && !state.connect) {
    const depth =
      state.labelDepth && isServiceNode(state.hover) ? state.labelDepth(state.hover) : 0;
    // A selected shape already shows resize handles where the ports would sit.
    const selected = vertices.some((vertex) => vertex.id === state.hover.id);
    parts.push(...hoverArrows(state.hover, view, depth, { ports: !selected }));
  }

  if (state.connect) {
    const { from, to, target, port } = state.connect;
    if (target) {
      const screen = worldRectToScreen(view, target);
      parts.push(
        h("rect", {
          class: "dg-connect-target",
          x: fmt(screen.x - 4),
          y: fmt(screen.y - 4),
          width: fmt(screen.w + 8),
          height: fmt(screen.h + 8),
        })
      );
      for (const side of SIDES) {
        const point = sidePoint(screen, side);
        parts.push(
          h("circle", {
            class: `dg-port is-visible${port === side ? " is-active" : ""}`,
            cx: fmt(point.x),
            cy: fmt(point.y),
            r: port === side ? 6 : 4,
          })
        );
      }
    }
    const a = worldToScreen(view, from);
    const b = worldToScreen(view, to);
    parts.push(
      h("line", {
        class: "dg-connect-preview",
        x1: fmt(a.x),
        y1: fmt(a.y),
        x2: fmt(b.x),
        y2: fmt(b.y),
      })
    );
  }

  if (state.marquee) {
    const box = worldRectToScreen(view, state.marquee);
    parts.push(
      h("rect", {
        class: "dg-marquee",
        x: fmt(box.x),
        y: fmt(box.y),
        width: fmt(box.w),
        height: fmt(box.h),
      })
    );
  }
  return parts;
}
