/**
 * Shape definitions — what every kind of diagram element looks like.
 *
 * Kept free of the DOM: an outline is described as `{tag, attrs}` records that
 * the scene builder turns into SVG, so the same definitions drive the live
 * canvas, SVG/PNG export, and draw.io export.
 */

const GROUP_ICON_ROOT = "assets/aws-icons/group";

/** Swatches offered by the colour pickers, draw.io style: tints then inks. */
export const PALETTE = [
  "#ffffff",
  "#f1f5f9",
  "#fee2e2",
  "#ffedd5",
  "#fef3c7",
  "#dcfce7",
  "#cffafe",
  "#dbeafe",
  "#ede9fe",
  "#fce7f3",
  "#0f172a",
  "#475569",
  "#dc2626",
  "#ea580c",
  "#d97706",
  "#16a34a",
  "#0891b2",
  "#2563eb",
  "#7c3aed",
  "#db2777",
  "#232f3e",
  "#ed7100",
  "#7aa116",
  "#00a4a6",
  "#8c4fff",
  "#e7157b",
  "#dd344c",
  "#01a88d",
];

export const DASH_PATTERNS = {
  solid: null,
  dashed: "8 5",
  dotted: "2 4",
};

export const DEFAULT_STYLE = Object.freeze({
  fill: "#ffffff",
  stroke: "#334155",
  strokeWidth: 1.5,
  dash: "solid",
  opacity: 1,
  shadow: false,
  rounded: false,
  fontSize: 13,
  fontColor: "#0f172a",
  bold: false,
  italic: false,
  underline: false,
  align: "center",
  valign: "middle",
});

/**
 * AWS architecture group containers, following the AWS Architecture Icons
 * group guidance: coloured border, the group icon flush in the top-left
 * corner, and the label beside it. `zone` links a container to a trust zone,
 * so dropping a service into a private subnet puts it in the private zone.
 */
export const CONTAINER_PRESETS = {
  "aws-cloud": {
    label: "AWS Cloud",
    stroke: "#232f3e",
    icon: `${GROUP_ICON_ROOT}/AWS-Cloud-logo_32.svg`,
    w: 640,
    h: 420,
  },
  "aws-account": {
    label: "AWS Account",
    stroke: "#e7157b",
    icon: `${GROUP_ICON_ROOT}/AWS-Account_32.svg`,
    w: 600,
    h: 400,
  },
  region: {
    label: "Region",
    stroke: "#00a4a6",
    dash: "dashed",
    icon: `${GROUP_ICON_ROOT}/Region_32.svg`,
    w: 560,
    h: 380,
  },
  "availability-zone": {
    label: "Availability Zone",
    stroke: "#147eba",
    dash: "dashed",
    align: "center",
    w: 260,
    h: 300,
  },
  vpc: {
    label: "VPC",
    stroke: "#8c4fff",
    icon: `${GROUP_ICON_ROOT}/Virtual-private-cloud-VPC_32.svg`,
    w: 520,
    h: 340,
  },
  "public-subnet": {
    label: "Public subnet",
    stroke: "#7aa116",
    fill: "#f2f6e8",
    icon: `${GROUP_ICON_ROOT}/Public-subnet_32.svg`,
    zone: "public",
    w: 240,
    h: 180,
  },
  "private-subnet": {
    label: "Private subnet",
    stroke: "#00a4a6",
    fill: "#e6f6f7",
    icon: `${GROUP_ICON_ROOT}/Private-subnet_32.svg`,
    zone: "private",
    w: 240,
    h: 180,
  },
  "security-group": {
    label: "Security group",
    stroke: "#dd344c",
    w: 200,
    h: 150,
  },
  "auto-scaling-group": {
    label: "Auto Scaling group",
    stroke: "#ed7100",
    dash: "dashed",
    icon: `${GROUP_ICON_ROOT}/Auto-Scaling-group_32.svg`,
    w: 220,
    h: 150,
  },
  "ec2-contents": {
    label: "EC2 instance contents",
    stroke: "#ed7100",
    icon: `${GROUP_ICON_ROOT}/EC2-instance-contents_32.svg`,
    w: 220,
    h: 150,
  },
  "spot-fleet": {
    label: "Spot Fleet",
    stroke: "#ed7100",
    icon: `${GROUP_ICON_ROOT}/Spot-Fleet_32.svg`,
    w: 220,
    h: 150,
  },
  "corporate-data-center": {
    label: "Corporate data center",
    stroke: "#7d8998",
    icon: `${GROUP_ICON_ROOT}/Corporate-data-center_32.svg`,
    w: 260,
    h: 200,
  },
  "server-contents": {
    label: "Server contents",
    stroke: "#7d8998",
    icon: `${GROUP_ICON_ROOT}/Server-contents_32.svg`,
    w: 220,
    h: 150,
  },
  "data-tier": {
    label: "Data tier",
    stroke: "#3b48cc",
    fill: "#eef0fc",
    dash: "dashed",
    zone: "data",
    w: 260,
    h: 180,
  },
  "management-zone": {
    label: "Management",
    stroke: "#e7157b",
    fill: "#fdf0f6",
    dash: "dashed",
    zone: "management",
    w: 260,
    h: 180,
  },
  "edge-zone": {
    label: "Edge",
    stroke: "#0972d3",
    fill: "#eef6fe",
    dash: "dashed",
    zone: "edge",
    w: 260,
    h: 180,
  },
  generic: {
    label: "Group",
    stroke: "#7d8998",
    dash: "dashed",
    w: 240,
    h: 180,
  },
};

export const CONTAINER_PRESET_IDS = Object.keys(CONTAINER_PRESETS);

/** Shape kinds, with how their label sits and which outline hit-tests edges. */
export const SHAPE_KINDS = {
  rect: { label: "Rectangle", outline: "rect", w: 140, h: 70 },
  rounded: { label: "Rounded rectangle", outline: "rect", w: 140, h: 70 },
  pill: { label: "Terminator", outline: "rect", w: 140, h: 56 },
  ellipse: { label: "Ellipse", outline: "ellipse", w: 120, h: 80 },
  diamond: { label: "Decision", outline: "diamond", w: 120, h: 90 },
  hexagon: { label: "Hexagon", outline: "rect", w: 130, h: 76 },
  triangle: { label: "Triangle", outline: "rect", w: 100, h: 86 },
  parallelogram: { label: "Data", outline: "rect", w: 140, h: 70 },
  predefined: { label: "Subprocess", outline: "rect", w: 140, h: 70 },
  cylinder: { label: "Database", outline: "rect", w: 90, h: 110 },
  document: { label: "Document", outline: "rect", w: 120, h: 80 },
  note: { label: "Note", outline: "rect", w: 150, h: 110 },
  cloud: { label: "Cloud", outline: "ellipse", w: 150, h: 96 },
  actor: { label: "Actor", outline: "rect", w: 40, h: 72, labelBelow: true },
  text: { label: "Text", outline: "rect", w: 120, h: 32 },
  image: { label: "Image", outline: "rect", w: 64, h: 64, labelBelow: true },
  table: { label: "Table", outline: "rect", w: 220, h: 86, fixedHeight: true },
  container: { label: "Container", outline: "rect", w: 240, h: 180, container: true },
  group: { label: "Group", outline: "rect", w: 200, h: 140, container: true },
};

export const SHAPE_KIND_IDS = Object.keys(SHAPE_KINDS);

export function isContainerKind(kind) {
  return Boolean(SHAPE_KINDS[kind]?.container);
}

/** Library entries for the "General" and "Flowchart" sections. */
export const GENERAL_SHAPES = [
  { kind: "rect", label: "" },
  { kind: "rounded", label: "" },
  { kind: "ellipse", label: "" },
  { kind: "text", label: "Text" },
  { kind: "note", label: "Note" },
  { kind: "cylinder", label: "" },
  { kind: "cloud", label: "" },
  { kind: "actor", label: "User" },
  { kind: "hexagon", label: "" },
  { kind: "triangle", label: "" },
  { kind: "container", label: "Container", preset: "generic" },
];

export const FLOWCHART_SHAPES = [
  { kind: "pill", label: "Start" },
  { kind: "rect", label: "Process" },
  { kind: "diamond", label: "Decision?" },
  { kind: "parallelogram", label: "Input" },
  { kind: "predefined", label: "Subprocess" },
  { kind: "document", label: "Document" },
  { kind: "cylinder", label: "Store" },
  { kind: "pill", label: "End" },
];

/** Per-kind style defaults layered under an element's own style. */
function kindDefaults(kind) {
  switch (kind) {
    case "text":
      return { fill: "none", stroke: "none", strokeWidth: 0 };
    case "note":
      return { fill: "#fef3c7", stroke: "#d6a524" };
    case "rounded":
    case "pill":
      return { rounded: true };
    case "actor":
    case "image":
      return { fill: "#ffffff", valign: "top" };
    case "group":
      return { fill: "none", stroke: "none", strokeWidth: 0 };
    case "container":
      return { fill: "none", stroke: "#7d8998", fontSize: 12, align: "left", valign: "top" };
    case "table":
      return {
        fill: "#ffffff",
        stroke: "#3b6fb6",
        strokeWidth: 1.3,
        fontSize: 12,
        fontColor: "#0f2742",
        align: "left",
      };
    default:
      return {};
  }
}

/** The full resolved style for a shape: defaults, then kind, then preset, then its own. */
export function resolveShapeStyle(shape) {
  const preset = shape.kind === "container" ? CONTAINER_PRESETS[shape.preset] : null;
  const presetStyle = preset
    ? {
        stroke: preset.stroke,
        fill: preset.fill || "none",
        dash: preset.dash || "solid",
        fontColor: preset.stroke === "#232f3e" ? "#232f3e" : preset.stroke,
        align: preset.align || "left",
      }
    : {};
  return { ...DEFAULT_STYLE, ...kindDefaults(shape.kind), ...presetStyle, ...(shape.style || {}) };
}

export const SERVICE_STYLE = Object.freeze({
  ...DEFAULT_STYLE,
  fill: "none",
  stroke: "none",
  strokeWidth: 0,
  fontSize: 12,
  fontColor: "#232f3e",
  valign: "top",
});

export function resolveServiceStyle(node) {
  return { ...SERVICE_STYLE, ...(node.style || {}) };
}

// ------------------------------------------------------------- edge styles

/** How each traffic type reads on white paper before any custom styling. */
export const EDGE_TYPE_STYLES = {
  request: { stroke: "#475569", dash: "solid" },
  event: { stroke: "#c2410c", dash: "dashed" },
  data: { stroke: "#0e7490", dash: "solid" },
  telemetry: { stroke: "#7c3aed", dash: "dotted" },
  replication: { stroke: "#0e7490", dash: "dashed" },
};

export const EDGE_ROUTINGS = ["orthogonal", "straight", "curved"];
export const ARROW_KINDS = [
  "none",
  "arrow",
  "open",
  "diamond",
  "circle",
  "one",
  "many",
  "oneMany",
  "zeroMany",
  "zeroOne",
];

export const DEFAULT_EDGE_STYLE = Object.freeze({
  routing: "orthogonal",
  rounded: true,
  strokeWidth: 1.6,
  startArrow: "none",
  endArrow: "arrow",
  fontSize: 11,
  fontColor: "#334155",
  animated: false,
});

export function resolveEdgeStyle(edge) {
  const typeStyle = EDGE_TYPE_STYLES[edge.type] || EDGE_TYPE_STYLES.request;
  return { ...DEFAULT_EDGE_STYLE, ...typeStyle, ...(edge.style || {}) };
}

// ---------------------------------------------------------------- outlines

function round(value) {
  return Math.round(value * 100) / 100;
}

function path(d, extra = {}) {
  return { tag: "path", attrs: { d, ...extra } };
}

/**
 * The drawable parts of a shape at size w x h, in the shape's local
 * coordinates. The first part is the filled outline; any further parts are
 * stroke-only decoration (a cylinder's lip, a note's folded corner).
 */
export function shapeOutline(kind, w, h, style = DEFAULT_STYLE) {
  const W = round(w);
  const H = round(h);
  switch (kind) {
    case "ellipse":
      return [{ tag: "ellipse", attrs: { cx: W / 2, cy: H / 2, rx: W / 2, ry: H / 2 } }];
    case "diamond":
      return [path(`M ${W / 2} 0 L ${W} ${H / 2} L ${W / 2} ${H} L 0 ${H / 2} Z`)];
    case "hexagon": {
      const inset = round(Math.min(W * 0.25, H * 0.3));
      return [
        path(
          `M ${inset} 0 L ${W - inset} 0 L ${W} ${H / 2} L ${W - inset} ${H} L ${inset} ${H} L 0 ${H / 2} Z`
        ),
      ];
    }
    case "triangle":
      return [path(`M ${W / 2} 0 L ${W} ${H} L 0 ${H} Z`)];
    case "parallelogram": {
      const skew = round(Math.min(W * 0.2, H * 0.6));
      return [path(`M ${skew} 0 L ${W} 0 L ${W - skew} ${H} L 0 ${H} Z`)];
    }
    case "predefined": {
      const bar = round(Math.min(14, W * 0.1));
      return [
        { tag: "rect", attrs: { x: 0, y: 0, width: W, height: H } },
        path(`M ${bar} 0 L ${bar} ${H} M ${W - bar} 0 L ${W - bar} ${H}`, { fill: "none" }),
      ];
    }
    case "cylinder": {
      const ry = round(Math.min(H * 0.15, 14, W * 0.3));
      return [
        path(
          `M 0 ${ry} A ${W / 2} ${ry} 0 0 1 ${W} ${ry} L ${W} ${H - ry} A ${W / 2} ${ry} 0 0 1 0 ${H - ry} Z`
        ),
        path(`M 0 ${ry} A ${W / 2} ${ry} 0 0 0 ${W} ${ry}`, { fill: "none" }),
      ];
    }
    case "document": {
      const wave = round(H * 0.12);
      return [
        path(
          `M 0 0 L ${W} 0 L ${W} ${H - wave} C ${round(W * 0.75)} ${round(H - wave * 2.4)} ${round(W * 0.35)} ${round(H + wave * 0.9)} 0 ${H - wave} Z`
        ),
      ];
    }
    case "note": {
      const fold = round(Math.min(16, W * 0.2, H * 0.2));
      return [
        path(`M 0 0 L ${W - fold} 0 L ${W} ${fold} L ${W} ${H} L 0 ${H} Z`),
        path(`M ${W - fold} 0 L ${W - fold} ${fold} L ${W} ${fold}`, { fill: "none" }),
      ];
    }
    case "cloud": {
      const p = (x, y) => `${round(x * W)} ${round(y * H)}`;
      return [
        path(
          `M ${p(0.26, 0.9)} C ${p(0.06, 0.9)} ${p(0, 0.62)} ${p(0.16, 0.54)} ` +
            `C ${p(0.1, 0.28)} ${p(0.36, 0.14)} ${p(0.48, 0.3)} ` +
            `C ${p(0.56, 0.06)} ${p(0.88, 0.1)} ${p(0.84, 0.38)} ` +
            `C ${p(1.02, 0.4)} ${p(1.02, 0.72)} ${p(0.86, 0.78)} ` +
            `C ${p(0.86, 0.94)} ${p(0.68, 0.96)} ${p(0.62, 0.88)} ` +
            `C ${p(0.52, 0.98)} ${p(0.34, 0.98)} ${p(0.26, 0.9)} Z`
        ),
      ];
    }
    case "actor": {
      const radius = round(Math.min(W, H) * 0.16);
      const neck = round(radius * 2.1);
      return [
        { tag: "circle", attrs: { cx: W / 2, cy: radius + 1, r: radius } },
        path(
          `M ${W / 2} ${neck} L ${W / 2} ${round(H * 0.64)} M 0 ${round(H * 0.4)} L ${W} ${round(H * 0.4)} M ${W / 2} ${round(H * 0.64)} L 0 ${H} M ${W / 2} ${round(H * 0.64)} L ${W} ${H}`,
          { fill: "none" }
        ),
      ];
    }
    case "pill":
      return [{ tag: "rect", attrs: { x: 0, y: 0, width: W, height: H, rx: round(H / 2) } }];
    default: {
      const rx = style.rounded ? round(Math.min(12, W * 0.12, H * 0.25)) : 0;
      return [{ tag: "rect", attrs: { x: 0, y: 0, width: W, height: H, ...(rx ? { rx } : {}) } }];
    }
  }
}

/** Which geometry an edge should clip against when it meets this element. */
export function outlineOf(element) {
  if (!element || element.iconId) return "rect";
  return SHAPE_KINDS[element.kind]?.outline || "rect";
}

export function labelSitsBelow(element) {
  if (!element) return false;
  if (element.iconId) return true;
  return Boolean(SHAPE_KINDS[element.kind]?.labelBelow);
}
