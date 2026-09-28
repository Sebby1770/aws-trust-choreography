/**
 * Scene building — a document becomes virtual SVG nodes.
 *
 * The live canvas and every export share this module, so what you see is
 * what you export. Interactive-only extras (hit areas, data attributes,
 * selection classes, analysis overlays) are switched on by `ctx.interactive`.
 */

import { ZONES, classifyCrossing, zoneOf } from "../trust-zones.js";
import { layoutLabel, FONT_FAMILY, LINE_HEIGHT } from "./text.js";
import {
  CONTAINER_PRESETS,
  DASH_PATTERNS,
  labelSitsBelow,
  outlineOf,
  resolveEdgeStyle,
  resolveServiceStyle,
  resolveShapeStyle,
  shapeOutline,
} from "./shapes.js";
import {
  arrowhead,
  connectorPathData,
  endAngles,
  labelPoint,
  routeConnector,
  routeKey,
  trimRoute,
} from "./router.js";
import { h, toMarkup } from "./vdom.js";
import { documentBounds, indexDocument, isContainer, isServiceNode, renderOrder } from "./model.js";
import { foreignKeyColumns } from "./er.js";
import { TABLE_HEADER, TABLE_ROW } from "./table.js";

export const PAPER = "#ffffff";
export const SELECTION_BLUE = "#0972d3";
export const CRITICALITY_COLORS = { high: "#d13212", medium: "#d97706", low: "#1d8102" };
export const ZONE_COLORS = {
  internet: "#d13212",
  edge: "#0972d3",
  public: "#7aa116",
  private: "#00a4a6",
  data: "#3b48cc",
  management: "#e7157b",
};

const BELOW_LABEL_WIDTH = 150;

function fmt(value) {
  return Math.round(value * 100) / 100;
}

function dashArray(dash, width = 1.5) {
  const pattern = DASH_PATTERNS[dash];
  if (!pattern) return undefined;
  const scale = Math.max(1, width / 1.5);
  return pattern
    .split(" ")
    .map((part) => fmt(Number(part) * scale))
    .join(" ");
}

function fontAttrs(style) {
  return {
    "font-size": style.fontSize,
    "font-weight": style.bold ? 700 : undefined,
    "font-style": style.italic ? "italic" : undefined,
    "text-decoration": style.underline ? "underline" : undefined,
    fill: style.fontColor,
  };
}

function textBlock(layout, style, extra = {}) {
  if (!layout.lines.length) return null;
  return h(
    "text",
    {
      x: fmt(layout.x),
      y: fmt(layout.y),
      "text-anchor": layout.anchor,
      ...fontAttrs(style),
      ...extra,
    },
    layout.lines.map((line, index) =>
      h("tspan", { x: fmt(layout.x), dy: index ? fmt(layout.lineHeight) : undefined }, line || " ")
    )
  );
}

/** Height a label under an icon occupies — the router drops south ports below it. */
export function belowLabelDepth(element, ctx) {
  if (!labelSitsBelow(element)) return 0;
  const text = isServiceNode(element) ? element.name : element.label;
  if (!text) return 4;
  const style = isServiceNode(element) ? resolveServiceStyle(element) : resolveShapeStyle(element);
  const layout = layoutLabel(
    text,
    { x: 0, y: 0, w: Math.max(BELOW_LABEL_WIDTH, element.w + 40), h: 0, padding: 0 },
    { ...style, valign: "top" },
    ctx.measure
  );
  return 6 + layout.lines.length * (style.fontSize || 12) * LINE_HEIGHT;
}

function belowLabel(element, text, style, ctx) {
  const width = Math.max(BELOW_LABEL_WIDTH, element.w + 40);
  const layout = layoutLabel(
    text,
    { x: (element.w - width) / 2, y: element.h + 4, w: width, h: 0, padding: 0 },
    { ...style, align: "center", valign: "top" },
    ctx.measure
  );
  return textBlock(layout, style, {
    class: "dg-label",
    "paint-order": "stroke",
    stroke: PAPER,
    "stroke-width": 3,
    "stroke-linejoin": "round",
  });
}

function outlineNodes(kind, element, style, ctx) {
  const parts = shapeOutline(kind, element.w, element.h, style);
  const hasStroke = style.stroke && style.stroke !== "none" && style.strokeWidth > 0;
  const stroke = hasStroke
    ? {
        stroke: style.stroke,
        "stroke-width": style.strokeWidth,
        "stroke-dasharray": dashArray(style.dash, style.strokeWidth),
        "stroke-linejoin": "round",
      }
    : {};
  const nodes = parts.map((part, index) =>
    h(part.tag, {
      ...part.attrs,
      // The first part is the filled body; the rest are line decoration,
      // except where a part asks for the body fill (an actor's head).
      fill: index === 0 || part.tag === "circle" ? style.fill || "none" : part.attrs.fill || "none",
      ...stroke,
      class: index === 0 ? "dg-outline" : undefined,
    })
  );
  // A shape with no fill still needs to be grabbable across its area; a
  // container only by its border, so the services inside stay clickable.
  if (ctx.interactive && (!style.fill || style.fill === "none" || style.fill === "transparent")) {
    const container = kind === "container";
    nodes.unshift(
      h("rect", {
        class: "dg-hit",
        x: 0,
        y: 0,
        width: fmt(element.w),
        height: fmt(element.h),
        fill: container ? "none" : "transparent",
        stroke: container ? "transparent" : undefined,
        "stroke-width": container ? 10 : undefined,
        "pointer-events": container ? "stroke" : "all",
      })
    );
  }
  return style.shadow ? [h("g", { filter: "url(#dg-shadow)" }, nodes)] : nodes;
}

// ----------------------------------------------------------------- vertices

function serviceNode(node, ctx) {
  const style = resolveServiceStyle(node);
  const overlays = ctx.overlays || {};
  const href = ctx.iconHref(node);
  const children = [
    h("rect", {
      class: "dg-hit",
      x: 0,
      y: 0,
      width: fmt(node.w),
      height: fmt(node.h),
      fill: "transparent",
    }),
    href
      ? h("image", {
          href,
          x: 0,
          y: 0,
          width: fmt(node.w),
          height: fmt(node.h),
          preserveAspectRatio: "xMidYMid meet",
        })
      : h("rect", { x: 0, y: 0, width: fmt(node.w), height: fmt(node.h), rx: 6, fill: "#ed7100" }),
    belowLabel(node, node.name, style, ctx),
  ];
  if (overlays.criticality && node.criticality === "high") {
    children.push(
      h("circle", {
        class: "dg-badge",
        cx: fmt(node.w - 1),
        cy: 1,
        r: 5,
        fill: CRITICALITY_COLORS.high,
        stroke: PAPER,
        "stroke-width": 2,
      })
    );
  }
  if (overlays.zones) {
    const zone = zoneOf(node);
    const label = ZONES[zone]?.label || zone;
    const width = ctx.measure(label, 9, true) + 12;
    children.push(
      h(
        "g",
        {
          class: "dg-zone-badge",
          transform: `translate(${fmt((node.w - width) / 2)} ${fmt(-14)})`,
        },
        h("rect", { width: fmt(width), height: 13, rx: 6.5, fill: ZONE_COLORS[zone] || "#5f6b7a" }),
        h(
          "text",
          {
            x: fmt(width / 2),
            y: 9.5,
            "text-anchor": "middle",
            "font-size": 9,
            "font-weight": 700,
            fill: "#ffffff",
          },
          label
        )
      )
    );
  }
  if (ctx.interactive && overlays.killed?.has(node.id)) {
    children.push(
      h("path", {
        class: "dg-killed-mark",
        d: `M 4 4 L ${fmt(node.w - 4)} ${fmt(node.h - 4)} M ${fmt(node.w - 4)} 4 L 4 ${fmt(node.h - 4)}`,
        stroke: "#d13212",
        "stroke-width": 3,
        "stroke-linecap": "round",
      })
    );
  }
  return children;
}

function containerNode(shape, style, ctx) {
  const preset = CONTAINER_PRESETS[shape.preset] || CONTAINER_PRESETS.generic;
  const children = outlineNodes("container", shape, style, ctx);
  const icon = preset.icon ? ctx.iconHref({ iconPath: preset.icon }) : null;
  if (icon) {
    children.push(
      h("image", { href: icon, x: 0, y: 0, width: 24, height: 24, class: "dg-container-icon" })
    );
  }
  if (shape.label) {
    const left = icon ? 30 : 8;
    const centred = (style.align || preset.align) === "center";
    const layout = layoutLabel(
      shape.label,
      centred
        ? { x: 0, y: 1, w: shape.w, h: 22, padding: 4 }
        : { x: left - 4, y: 1, w: Math.max(40, shape.w - left), h: 22, padding: 4 },
      { ...style, valign: "top", align: centred ? "center" : "left" },
      ctx.measure
    );
    children.push(textBlock(layout, style, { class: "dg-label" }));
  }
  if (shape.zone && ctx.overlays?.zones && ZONES[shape.zone]) {
    const label = `${ZONES[shape.zone].label} zone`;
    const width = ctx.measure(label, 9, true) + 12;
    children.push(
      h(
        "g",
        { class: "dg-zone-badge", transform: `translate(${fmt(shape.w - width - 6)} 5)` },
        h("rect", {
          width: fmt(width),
          height: 13,
          rx: 6.5,
          fill: ZONE_COLORS[shape.zone] || "#5f6b7a",
        }),
        h(
          "text",
          {
            x: fmt(width / 2),
            y: 9.5,
            "text-anchor": "middle",
            "font-size": 9,
            "font-weight": 700,
            fill: "#ffffff",
          },
          label
        )
      )
    );
  }
  return children;
}

/** A database table: a titled header and one row per column with key badges. */
function tableNode(shape, style, ctx) {
  const w = shape.w;
  const columns = shape.columns || [];
  const foreign = ctx.fkColumns?.get(shape.id) || new Set();
  const radius = 6;
  const header = style.headerFill || "#e3eefc";
  const stroke = style.stroke === "none" ? "#3b6fb6" : style.stroke;
  const outline = { stroke, "stroke-width": style.strokeWidth || 1.3 };
  const children = [
    h("rect", {
      class: "dg-outline",
      x: 0,
      y: 0,
      width: fmt(w),
      height: fmt(shape.h),
      rx: radius,
      fill: style.fill === "none" ? "#ffffff" : style.fill,
      ...outline,
    }),
    h("path", {
      d: `M 0 ${radius} A ${radius} ${radius} 0 0 1 ${radius} 0 L ${fmt(w - radius)} 0 A ${radius} ${radius} 0 0 1 ${fmt(w)} ${radius} L ${fmt(w)} ${TABLE_HEADER} L 0 ${TABLE_HEADER} Z`,
      fill: header,
      ...outline,
    }),
    h(
      "text",
      {
        x: fmt(w / 2),
        y: fmt(TABLE_HEADER / 2 + 4.5),
        "text-anchor": "middle",
        "font-size": 13,
        "font-weight": 700,
        fill: style.fontColor,
        class: "dg-label",
      },
      shape.label || "table"
    ),
  ];
  if (!columns.length) {
    children.push(
      h(
        "text",
        {
          x: 12,
          y: fmt(TABLE_HEADER + TABLE_ROW / 2 + 4),
          "font-size": 11,
          fill: "#8aa0b8",
          "font-style": "italic",
        },
        "No columns"
      )
    );
  }
  columns.forEach((column, index) => {
    const top = TABLE_HEADER + index * TABLE_ROW;
    const baseline = fmt(top + TABLE_ROW / 2 + 4);
    if (index % 2 === 1) {
      children.push(
        h("rect", { x: 1, y: fmt(top), width: fmt(w - 2), height: TABLE_ROW, fill: "#f4f8fe" })
      );
    }
    const isForeign = foreign.has(column.name);
    const badges =
      column.pk && isForeign
        ? ["PK", "FK"]
        : column.pk
          ? ["PK"]
          : isForeign
            ? ["FK"]
            : column.unique
              ? ["UQ"]
              : [];
    const colours = { PK: "#b7791f", FK: "#1a73e8", UQ: "#6b7c93" };
    badges.forEach((badge, badgeIndex) => {
      const stacked = badges.length > 1;
      children.push(
        h(
          "text",
          {
            x: 8,
            y: stacked ? fmt(top + (badgeIndex ? 19 : 10)) : baseline,
            "font-size": stacked ? 7.5 : 9,
            "font-weight": 800,
            fill: colours[badge],
            "letter-spacing": 0.3,
          },
          badge
        )
      );
    });
    children.push(
      h(
        "text",
        {
          x: 34,
          y: baseline,
          "font-size": 12,
          "font-weight": column.pk ? 700 : undefined,
          fill: style.fontColor,
          "text-decoration": column.pk ? "underline" : undefined,
        },
        column.name
      ),
      h(
        "text",
        { x: fmt(w - 10), y: baseline, "text-anchor": "end", "font-size": 11, fill: "#5f7896" },
        `${column.type || ""}${column.nullable === false || column.pk ? "" : "?"}`
      )
    );
  });
  return children;
}

function shapeNode(shape, ctx) {
  const style = resolveShapeStyle(shape);
  if (shape.kind === "table") return tableNode(shape, style, ctx);
  if (shape.kind === "container") return containerNode(shape, style, ctx);
  if (shape.kind === "group") {
    return [
      h("rect", {
        class: "dg-group-box",
        x: 0,
        y: 0,
        width: fmt(shape.w),
        height: fmt(shape.h),
        fill: "transparent",
        stroke: ctx.interactive ? "transparent" : "none",
        "stroke-width": 8,
        "pointer-events": "stroke",
      }),
    ];
  }
  if (shape.kind === "image") {
    const href = ctx.iconHref({ iconPath: shape.src });
    return [
      h("rect", {
        class: "dg-hit",
        x: 0,
        y: 0,
        width: fmt(shape.w),
        height: fmt(shape.h),
        fill: "transparent",
      }),
      href
        ? h("image", {
            href,
            x: 0,
            y: 0,
            width: fmt(shape.w),
            height: fmt(shape.h),
            preserveAspectRatio: "xMidYMid meet",
          })
        : null,
      shape.label ? belowLabel(shape, shape.label, style, ctx) : null,
    ];
  }
  const children = outlineNodes(shape.kind, shape, style, ctx);
  if (shape.label) {
    if (labelSitsBelow(shape)) {
      children.push(belowLabel(shape, shape.label, style, ctx));
    } else {
      const inset =
        shape.kind === "diamond" ? shape.w * 0.12 : shape.kind === "hexagon" ? shape.w * 0.1 : 0;
      const layout = layoutLabel(
        shape.label,
        {
          x: inset,
          y: 0,
          w: shape.w - inset * 2,
          h: shape.h,
          padding: shape.kind === "text" ? 2 : 6,
        },
        style,
        ctx.measure
      );
      children.push(textBlock(layout, style, { class: "dg-label" }));
    }
  }
  return children;
}

function vertexLabel(vertex) {
  if (isServiceNode(vertex)) return `${vertex.name}, ${vertex.serviceName}`;
  if (vertex.kind === "container") {
    return `${vertex.label || CONTAINER_PRESETS[vertex.preset]?.label || "Container"} container`;
  }
  return vertex.label ? `${vertex.label} (${vertex.kind})` : vertex.kind;
}

/** One vertex as a positioned group. */
export function vertexNode(vertex, ctx) {
  const service = isServiceNode(vertex);
  const style = service ? resolveServiceStyle(vertex) : resolveShapeStyle(vertex);
  const selected = ctx.selected?.has(vertex.id);
  const overlays = ctx.overlays || {};
  const classes = [
    "dg-vertex",
    service ? "dg-service" : `dg-${vertex.kind}`,
    isContainer(vertex) ? "is-container" : "",
    selected ? "is-selected" : "",
    vertex.locked ? "is-locked" : "",
    overlays.dropTarget === vertex.id ? "is-drop-target" : "",
    overlays.highlight?.has(vertex.id) ? "is-highlighted" : "",
    overlays.failed === vertex.id ? "is-failed" : "",
    overlays.killed?.has(vertex.id) ? "is-killed" : "",
    overlays.affected?.has(vertex.id) ? "is-affected" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return h(
    "g",
    {
      class: ctx.interactive ? classes : undefined,
      transform: `translate(${fmt(vertex.x)} ${fmt(vertex.y)})`,
      opacity: style.opacity < 1 ? style.opacity : undefined,
      "data-id": ctx.interactive ? vertex.id : undefined,
      role: ctx.interactive ? "img" : undefined,
      "aria-label": ctx.interactive ? vertexLabel(vertex) : undefined,
    },
    service ? serviceNode(vertex, ctx) : shapeNode(vertex, ctx)
  );
}

// -------------------------------------------------------------- connectors

/** Rects connectors should steer around: every visible, non-container vertex. */
export function obstacleRects(doc, ctx) {
  const rects = [];
  for (const vertex of [...doc.shapes, ...doc.nodes]) {
    if (isContainer(vertex) || vertex.kind === "text") continue;
    const depth = labelSitsBelow(vertex) ? belowLabelDepth(vertex, ctx) : 0;
    rects.push({ id: vertex.id, x: vertex.x, y: vertex.y, w: vertex.w, h: vertex.h + depth });
  }
  return rects;
}

/** Route every connector. Results are cached per route key across renders. */
export function computeRoutes(doc, ctx, only = null) {
  const index = indexDocument(doc);
  const obstacles = obstacleRects(doc, ctx);
  const routes = new Map();
  const cache = ctx.routeCache;
  for (const connection of doc.connections) {
    if (only && !only.has(connection.id)) continue;
    const source = connection.from ? index.get(connection.from) : null;
    const target = connection.to ? index.get(connection.to) : null;
    if ((connection.from && !source) || (connection.to && !target)) continue;
    const style = resolveEdgeStyle(connection);
    const input = {
      source: source ? { x: source.x, y: source.y, w: source.w, h: source.h } : null,
      target: target ? { x: target.x, y: target.y, w: target.w, h: target.h } : null,
      sourcePoint: source ? null : connection.fromPoint,
      targetPoint: target ? null : connection.toPoint,
      sourceOutline: outlineOf(source),
      targetOutline: outlineOf(target),
      sourceDepth: source ? belowLabelDepth(source, ctx) : 0,
      targetDepth: target ? belowLabelDepth(target, ctx) : 0,
      fromPort: connection.fromPort,
      toPort: connection.toPort,
      waypoints: connection.waypoints || [],
      routing: style.routing,
      obstacles: obstacles.filter(
        (rect) =>
          rect.id !== connection.from &&
          rect.id !== connection.to &&
          !isAncestorOf(index, rect.id, connection)
      ),
    };
    const key = routeKey(input);
    let route = cache?.get(key);
    if (!route) {
      route = routeConnector(input);
      if (cache) {
        if (cache.size > 2000) cache.clear();
        cache.set(key, route);
      }
    }
    routes.set(connection.id, route);
  }
  return routes;
}

// A connector may legitimately run inside a shape that contains one of its
// ends (a group, for example), so ancestors never block their own members.
function isAncestorOf(index, id, connection) {
  for (const end of [connection.from, connection.to]) {
    let current = end ? index.get(end) : null;
    const seen = new Set();
    while (current?.parent && !seen.has(current.parent)) {
      if (current.parent === id) return true;
      seen.add(current.parent);
      current = index.get(current.parent);
    }
  }
  return false;
}

function edgeColors(connection, style, ctx, index) {
  let stroke = style.stroke;
  const classes = [];
  const overlays = ctx.overlays || {};
  const source = index.get(connection.from);
  const target = index.get(connection.to);
  const architectural = isServiceNode(source) && isServiceNode(target);
  if (architectural && overlays.trust !== false) {
    if (connection.encrypted === false) {
      classes.push("is-unencrypted");
      if (ctx.interactive) stroke = "#d13212";
    }
    const crossing = classifyCrossing(zoneOf(source), zoneOf(target)).kind;
    classes.push(`is-crossing-${crossing}`);
    if (
      ctx.interactive &&
      (crossing === "bypass" || crossing === "egress") &&
      connection.encrypted !== false
    ) {
      stroke = "#c2410c";
    }
  }
  if (overlays.affected?.has(connection.id)) {
    classes.push("is-affected");
    if (ctx.interactive) stroke = "#d13212";
  }
  return { stroke, classes };
}

/** One connector: hit area, line, arrowheads, and label. */
export function edgeNode(connection, route, ctx, index) {
  if (!route?.points?.length) return null;
  const style = resolveEdgeStyle(connection);
  const { stroke, classes } = edgeColors(connection, style, ctx, index);
  const width = style.strokeWidth;
  const angles = endAngles(route);
  const last = route.points[route.points.length - 1];
  const first = route.points[0];
  const endHead = arrowhead(style.endArrow, last, angles.end, width);
  const startHead = arrowhead(style.startArrow, first, angles.start, width);
  const trimmed = trimRoute(route, { start: startHead?.inset || 0, end: endHead?.inset || 0 });
  const d = connectorPathData(trimmed, { rounded: style.rounded });
  const fullD = connectorPathData(route, { rounded: style.rounded });
  const dash =
    connection.encrypted === false && ctx.interactive && ctx.overlays?.trust !== false
      ? dashArray("dashed", width)
      : dashArray(style.dash, width);
  const selected = ctx.selected?.has(connection.id);
  const children = [];
  if (ctx.interactive) {
    children.push(
      h("path", {
        class: "dg-edge-hit",
        d: fullD,
        fill: "none",
        stroke: "transparent",
        "stroke-width": 14,
      })
    );
  }
  children.push(
    h("path", {
      class: ctx.interactive ? "dg-edge-line" : undefined,
      d,
      fill: "none",
      stroke,
      "stroke-width": width,
      "stroke-dasharray": dash,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
    })
  );
  for (const head of [startHead, endHead]) {
    if (!head) continue;
    if (head.circle) {
      children.push(
        h("path", {
          class: ctx.interactive ? "dg-arrow" : undefined,
          d: head.circle,
          fill: PAPER,
          stroke,
          "stroke-width": width,
        })
      );
    }
    children.push(
      h("path", {
        class: ctx.interactive ? "dg-arrow" : undefined,
        d: head.d,
        fill: head.filled ? stroke : "none",
        stroke,
        "stroke-width": head.filled ? 1 : width,
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
      })
    );
  }
  const text = connection.label;
  if (text) {
    const at = labelPoint(route, connection.labelT ?? 0.5);
    const labelStyle = { fontSize: style.fontSize, fontColor: style.fontColor, bold: false };
    const lines = String(text).split(/\r?\n/);
    const lineHeight = labelStyle.fontSize * LINE_HEIGHT;
    const width =
      Math.max(...lines.map((line) => ctx.measure(line, labelStyle.fontSize, false))) + 8;
    const height = lines.length * lineHeight + 2;
    children.push(
      h(
        "g",
        {
          class: ctx.interactive ? "dg-edge-label" : undefined,
          transform: `translate(${fmt(at.x)} ${fmt(at.y)})`,
        },
        h("rect", {
          x: fmt(-width / 2),
          y: fmt(-height / 2),
          width: fmt(width),
          height: fmt(height),
          rx: 3,
          fill: PAPER,
          "fill-opacity": 0.92,
        }),
        h(
          "text",
          {
            x: 0,
            y: fmt(-height / 2 + lineHeight * 0.5 + labelStyle.fontSize * 0.36 + 1),
            "text-anchor": "middle",
            ...fontAttrs(labelStyle),
          },
          lines.map((line, i) =>
            h("tspan", { x: 0, dy: i ? fmt(lineHeight) : undefined }, line || " ")
          )
        )
      )
    );
  }
  const classNames = [
    "dg-edge",
    `is-${connection.type || "request"}`,
    selected ? "is-selected" : "",
    style.animated ? "is-animated" : "",
    ...classes,
  ]
    .filter(Boolean)
    .join(" ");
  return h(
    "g",
    {
      class: ctx.interactive ? classNames : undefined,
      "data-edge-id": ctx.interactive ? connection.id : undefined,
      opacity: style.opacity < 1 ? style.opacity : undefined,
    },
    children
  );
}

// ------------------------------------------------------------ whole scene

/** Layers of the scene, for the live canvas to mount separately. */
export function buildLayers(doc, ctx, routes = computeRoutes(doc, ctx)) {
  if (!ctx.fkColumns) ctx = { ...ctx, fkColumns: foreignKeyColumns(doc) };
  const index = indexDocument(doc);
  const { below, above } = renderOrder(doc);
  return {
    below: below.map((vertex) => vertexNode(vertex, ctx)),
    edges: doc.connections
      .map((connection) => edgeNode(connection, routes.get(connection.id), ctx, index))
      .filter(Boolean),
    above: above.map((vertex) => vertexNode(vertex, ctx)),
    routes,
  };
}

export function shadowFilter() {
  return h(
    "filter",
    { id: "dg-shadow", x: "-20%", y: "-20%", width: "150%", height: "160%" },
    h("feDropShadow", {
      dx: 1.5,
      dy: 2.5,
      stdDeviation: 2.2,
      floodColor: "#0f172a",
      floodOpacity: 0.22,
    })
  );
}

/**
 * A standalone SVG document for the diagram (or just `ids`), cropped to the
 * content with padding. `iconHref` should return data URLs so the file is
 * self-contained. `content` embeds draw.io XML the way draw.io's own
 * "editable SVG" does, so the export reopens as a diagram.
 */
export function documentSvg(doc, ctx, options = {}) {
  const { tree, view } = documentSvgTree(doc, ctx, options);
  return { markup: toMarkup(tree), width: view.w, height: view.h, view };
}

/** The same SVG as a virtual tree, for callers that build live DOM from it. */
export function documentSvgTree(
  doc,
  ctx,
  { padding = 24, background = PAPER, ids = null, content = null, scale = 1 } = {}
) {
  const exportCtx = { ...ctx, interactive: false, selected: null, overlays: { trust: false } };
  const bounds = documentBounds(doc, ids) || { x: 0, y: 0, w: 200, h: 120 };
  const view = {
    x: Math.floor(bounds.x - padding),
    y: Math.floor(bounds.y - padding),
    w: Math.ceil(bounds.w + padding * 2),
    h: Math.ceil(bounds.h + padding * 2),
  };
  let subset = doc;
  if (ids) {
    const wanted = new Set(ids);
    subset = {
      ...doc,
      nodes: doc.nodes.filter((node) => wanted.has(node.id)),
      shapes: doc.shapes.filter((shape) => wanted.has(shape.id)),
    };
    subset.connections = doc.connections.filter(
      (c) => wanted.has(c.id) || ((!c.from || wanted.has(c.from)) && (!c.to || wanted.has(c.to)))
    );
  }
  const layers = buildLayers(subset, exportCtx);
  const root = h(
    "svg",
    {
      xmlns: "http://www.w3.org/2000/svg",
      "xmlns:xlink": "http://www.w3.org/1999/xlink",
      version: "1.1",
      width: fmt(view.w * scale),
      height: fmt(view.h * scale),
      viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
      content: content || undefined,
    },
    h("defs", {}, shadowFilter()),
    background
      ? h("rect", { x: view.x, y: view.y, width: view.w, height: view.h, fill: background })
      : null,
    h(
      "g",
      { "font-family": FONT_FAMILY },
      h("g", {}, layers.below),
      h("g", {}, layers.edges),
      h("g", {}, layers.above)
    )
  );
  return { tree: root, view };
}
