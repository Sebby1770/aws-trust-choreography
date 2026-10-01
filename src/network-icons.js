/**
 * Network device icons, drawn in the AWS architecture-icon style: a rounded
 * square in the device family's colour with a detailed white glyph. The
 * shapes follow the conventions people already read in network diagrams —
 * a router is a puck with crossing traffic, a switch a chassis with
 * parallel flows, a firewall a brick wall — and every server shares one rack
 * silhouette with a badge that says what it runs.
 *
 * Icons are self-contained SVG (no gradients or ids), so they render the same
 * inline in the Network Lab, as images in the diagram studio's library, and
 * in exported diagrams.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const WHITE = "#ffffff";

/** Family colours, matched to the AWS icon palette. */
export const DEVICE_TONES = {
  endpoints: "#2563eb",
  network: "#8c4fff",
  servers: "#ed7100",
  database: "#c925d1",
  security: "#dd344c",
  internet: "#3f4b5b",
  cloud: "#0a84d6",
};

// ------------------------------------------------------------ part helpers

const path = (d, style = {}) => ({ tag: "path", attrs: { d }, ...style });
const rect = (x, y, width, height, rx, style = {}) => ({
  tag: "rect",
  attrs: { x, y, width, height, rx },
  ...style,
});
const circle = (cx, cy, r, style = {}) => ({ tag: "circle", attrs: { cx, cy, r }, ...style });
const ellipse = (cx, cy, rx, ry, style = {}) => ({
  tag: "ellipse",
  attrs: { cx, cy, rx, ry },
  ...style,
});

const LINE = { stroke: "white", fill: "none" };
const SOLID = { fill: "white" };
const SOFT = { fill: "soft", stroke: "white" };
const TONE_LINE = { stroke: "tone", fill: "none" };
const TONE_SOLID = { fill: "tone" };

/** Two stacked rack units: the shared body of every server icon. */
function rack() {
  return [
    rect(9, 8, 26, 11, 2.5, SOFT),
    rect(9, 21, 26, 11, 2.5, SOFT),
    circle(14, 13.5, 1.6, SOLID),
    circle(14, 26.5, 1.6, SOLID),
    path("M19 13.5h11M19 26.5h11", LINE),
  ];
}

/** A white badge in the lower right corner holding a role mark. */
function badge(mark) {
  return [circle(33, 33, 9.5, { fill: "white", stroke: "tone-dark", width: 1.2 }), ...mark];
}

// ------------------------------------------------------------------ icons

/**
 * id → { tone, parts }. Parts are drawn on a 48-unit grid inside the tile.
 * `fill`/`stroke` take "white", "soft" (translucent white), "tone" (the
 * tile colour) or "none".
 */
export const DEVICE_ICONS = {
  // --- endpoints ---
  pc: {
    tone: "endpoints",
    parts: [
      rect(9, 10, 30, 21, 2.5, SOFT),
      rect(12.5, 13.5, 23, 14, 1, { fill: "white", stroke: "none" }),
      path("M24 31v6M16 38h16", LINE),
    ],
  },
  laptop: {
    tone: "endpoints",
    parts: [
      rect(12, 11, 24, 17, 2, SOFT),
      rect(15, 14, 18, 11, 1, { fill: "white", stroke: "none" }),
      path("M7 31h34l-3 5H10z", { fill: "white", stroke: "white" }),
      path("M21 33.5h6", TONE_LINE),
    ],
  },
  printer: {
    tone: "endpoints",
    parts: [
      rect(15, 8, 18, 9, 1, SOFT),
      rect(8, 17, 32, 14, 3, SOFT),
      rect(15, 26, 18, 13, 1, { fill: "white", stroke: "white" }),
      path("M19 30h10M19 34h7", TONE_LINE),
      circle(34, 21.5, 1.6, SOLID),
    ],
  },
  "ip-phone": {
    tone: "endpoints",
    parts: [
      path("M12 17c0-6 24-6 24 0v3h-6v-3c0-2.4-12-2.4-12 0v3h-6z", {
        fill: "white",
        stroke: "white",
      }),
      rect(11, 22, 26, 17, 3, SOFT),
      circle(18, 27, 1.5, SOLID),
      circle(24, 27, 1.5, SOLID),
      circle(30, 27, 1.5, SOLID),
      circle(18, 33, 1.5, SOLID),
      circle(24, 33, 1.5, SOLID),
      circle(30, 33, 1.5, SOLID),
    ],
  },

  // --- network infrastructure ---
  // The classic router puck, with traffic crossing its top face.
  router: {
    tone: "network",
    parts: [
      path("M8 18v10c0 3.3 7.2 6 16 6s16-2.7 16-6V18", SOFT),
      ellipse(24, 18, 16, 6, { fill: "white", stroke: "white" }),
      path("M13 16.5l6 3M19 16.5l-6 3M29 16.5l6 3M35 16.5l-6 3", TONE_LINE),
      path("M18.5 18h11", { stroke: "tone", fill: "none", width: 1.6 }),
    ],
  },
  // A chassis with opposing lanes of traffic: the layer-2 switch.
  "l2-switch": {
    tone: "network",
    parts: [
      path("M7 20l5-6h24l5 6v12H7z", SOFT),
      path("M7 20h34", LINE),
      path("M14 25h18m0 0l-3-2.5m3 2.5l-3 2.5", LINE),
      path("M34 29.5H16m0 0l3-2.5m-3 2.5l3 2.5", LINE),
      path("M12 17h24", { stroke: "white", fill: "none", width: 1.2 }),
    ],
  },
  // Same chassis, with a routing cross on the lid: switching plus routing.
  "l3-switch": {
    tone: "network",
    parts: [
      path("M7 20l5-6h24l5 6v12H7z", SOFT),
      path("M7 20h34", LINE),
      path("M14 25h18m0 0l-3-2.5m3 2.5l-3 2.5", LINE),
      path("M34 29.5H16m0 0l3-2.5m-3 2.5l3 2.5", LINE),
      path("M20 15.5l8 3M28 15.5l-8 3", LINE),
    ],
  },
  "wireless-ap": {
    tone: "network",
    parts: [
      rect(11, 30, 26, 8, 3, { fill: "white", stroke: "white" }),
      circle(17, 34, 1.4, TONE_SOLID),
      path("M24 30v-5", LINE),
      path("M18.5 21a7.5 7.5 0 0 1 11 0", LINE),
      path("M14.5 16.5a13 13 0 0 1 19 0", LINE),
      path("M10.5 12a18.5 18.5 0 0 1 27 0", LINE),
    ],
  },

  // --- servers: one rack, a badge per role ---
  "web-server": {
    tone: "servers",
    parts: [
      ...rack(),
      ...badge([
        circle(33, 33, 6, TONE_LINE),
        path("M27 33h12M33 27c2.4 2.2 2.4 9.8 0 12M33 27c-2.4 2.2-2.4 9.8 0 12", TONE_LINE),
      ]),
    ],
  },
  "dns-server": {
    tone: "servers",
    parts: [
      ...rack(),
      ...badge([
        circle(33, 28.5, 2, TONE_SOLID),
        circle(28.5, 37, 2, TONE_SOLID),
        circle(37.5, 37, 2, TONE_SOLID),
        path("M33 30.5v2.5M33 33l-4.5 2.2M33 33l4.5 2.2", TONE_LINE),
      ]),
    ],
  },
  "dhcp-server": {
    tone: "servers",
    parts: [
      ...rack(),
      ...badge([
        path("M28 31.5a5.5 5.5 0 0 1 9.8-2.4M38 34.5a5.5 5.5 0 0 1-9.8 2.4", TONE_LINE),
        path("M38.3 26.3v3.2h-3.2M27.7 39.7v-3.2h3.2", TONE_LINE),
      ]),
    ],
  },
  "database-server": {
    tone: "database",
    parts: [
      path("M11 12v24c0 3 5.8 5 13 5s13-2 13-5V12", SOFT),
      ellipse(24, 12, 13, 5, { fill: "white", stroke: "white" }),
      path("M11 20c0 3 5.8 5 13 5s13-2 13-5M11 28c0 3 5.8 5 13 5s13-2 13-5", LINE),
    ],
  },
  "mail-server": {
    tone: "servers",
    parts: [
      ...rack(),
      ...badge([
        rect(27, 29, 12, 8.5, 1, TONE_LINE),
        path("M27.5 29.5l5.5 4.5 5.5-4.5", TONE_LINE),
      ]),
    ],
  },
  "linux-server": {
    tone: "servers",
    parts: [
      ...rack(),
      ...badge([
        rect(27, 28, 12, 10, 1.5, TONE_SOLID),
        path("M29.5 31l2.5 2-2.5 2M33.5 35.5h3", LINE),
      ]),
    ],
  },
  "windows-server": {
    tone: "servers",
    parts: [
      ...rack(),
      ...badge([
        rect(28, 28, 4.6, 4.6, 0.4, TONE_SOLID),
        rect(33.4, 28, 4.6, 4.6, 0.4, TONE_SOLID),
        rect(28, 33.4, 4.6, 4.6, 0.4, TONE_SOLID),
        rect(33.4, 33.4, 4.6, 4.6, 0.4, TONE_SOLID),
      ]),
    ],
  },

  // --- security and the edges of the world ---
  firewall: {
    tone: "security",
    parts: [
      rect(8, 11, 15, 7, 1, SOLID),
      rect(25, 11, 15, 7, 1, SOLID),
      rect(8, 20.5, 6.5, 7, 1, SOLID),
      rect(16.5, 20.5, 15, 7, 1, SOLID),
      rect(33.5, 20.5, 6.5, 7, 1, SOLID),
      rect(8, 30, 15, 7, 1, SOLID),
      rect(25, 30, 15, 7, 1, SOLID),
    ],
  },
  "load-balancer": {
    tone: "network",
    parts: [
      path("M8 24h8", LINE),
      circle(19, 24, 4, SOLID),
      path("M23 24h12M22 21.5l10-7.5h3M22 26.5l10 7.5h3", LINE),
      path("M33 11l4 3-4 3M33 21l4 3-4 3M33 31l4 3-4 3", LINE),
    ],
  },
  "vpn-gateway": {
    tone: "security",
    parts: [
      path("M7 28h8M33 28h8", LINE),
      path("M18.5 22v-3.5a5.5 5.5 0 0 1 11 0V22", LINE),
      rect(15, 22, 18, 14, 2.5, { fill: "white", stroke: "white" }),
      circle(24, 27.5, 2, TONE_SOLID),
      path("M24 29v3", TONE_LINE),
    ],
  },
  internet: {
    tone: "internet",
    parts: [
      circle(24, 24, 14, SOFT),
      path("M10 24h28M12 17h24M12 31h24", LINE),
      path(
        "M24 10c4.2 3.7 6.3 8.4 6.3 14s-2.1 10.3-6.3 14c-4.2-3.7-6.3-8.4-6.3-14s2.1-10.3 6.3-14z",
        LINE
      ),
    ],
  },
  cloud: {
    tone: "cloud",
    parts: [
      path("M15 35a7 7 0 0 1-.7-14 10 10 0 0 1 19.4-2.4A7.8 7.8 0 0 1 34 35z", {
        fill: "white",
        stroke: "white",
      }),
    ],
  },
};

/** Stable id list, so callers can iterate the icon set. */
export const DEVICE_ICON_IDS = Object.keys(DEVICE_ICONS);

export function hasDeviceIcon(deviceId) {
  return Object.hasOwn(DEVICE_ICONS, deviceId);
}

export function deviceTone(deviceId) {
  return DEVICE_TONES[DEVICE_ICONS[deviceId]?.tone] || DEVICE_TONES.network;
}

function darken(hex, amount = 0.25) {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift) => Math.round(((value >> shift) & 255) * (1 - amount));
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
}

function paint(value, tone) {
  if (value === "white") return WHITE;
  if (value === "soft") return "rgba(255,255,255,0.22)";
  if (value === "tone") return tone;
  if (value === "tone-dark") return darken(tone, 0.12);
  return "none";
}

/**
 * The drawable elements of an icon as plain records (tile first), shared by
 * the DOM builder and the markup serialiser.
 */
export function deviceIconParts(deviceId) {
  const icon = DEVICE_ICONS[deviceId];
  if (!icon) return null;
  const tone = deviceTone(deviceId);
  const tile = [
    { tag: "rect", attrs: { x: 0, y: 0, width: 48, height: 48, rx: 10, fill: tone } },
    // A soft top-left sheen gives the tile the depth of the AWS icon set.
    {
      tag: "path",
      attrs: { d: "M0 10A10 10 0 0 1 10 0h28L0 38z", fill: "#ffffff", "fill-opacity": 0.12 },
    },
  ];
  const glyph = icon.parts.map((part) => {
    const fill = paint(part.fill ?? "none", tone);
    const stroke = paint(part.stroke ?? "none", tone);
    const attrs = { ...part.attrs, fill };
    if (stroke !== "none") {
      attrs.stroke = stroke;
      attrs["stroke-width"] = part.width ?? 2.2;
      attrs["stroke-linecap"] = "round";
      attrs["stroke-linejoin"] = "round";
    }
    return { tag: part.tag, attrs };
  });
  return [...tile, ...glyph];
}

/** Standalone SVG markup for an icon (for images and exports). */
export function deviceIconMarkup(deviceId) {
  const parts = deviceIconParts(deviceId);
  if (!parts) return null;
  const body = parts
    .map(
      ({ tag, attrs }) =>
        `<${tag}${Object.entries(attrs)
          .map(([key, value]) => ` ${key}="${value}"`)
          .join("")}/>`
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">${body}</svg>`;
}

/** A data URL for an icon, for <img> tags and diagram image shapes. */
export function deviceIconDataUrl(deviceId) {
  const markup = deviceIconMarkup(deviceId);
  if (!markup) return null;
  return `data:image/svg+xml;base64,${globalThis.btoa(markup)}`;
}

/**
 * Build an `<svg>` element for a device.
 *
 * @param {string} deviceId
 * @param {Document} doc - passed in so the module stays testable under jsdom
 * @returns {SVGElement|null} null when the device has no icon, so callers can
 *   fall back to the text glyph rather than render an empty box.
 */
export function createDeviceIcon(deviceId, doc = globalThis.document) {
  const parts = deviceIconParts(deviceId);
  if (!parts || !doc) return null;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 48 48");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("network-device-icon");
  for (const { tag, attrs } of parts) {
    const element = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    svg.append(element);
  }
  return svg;
}

/**
 * Replace a glyph element's contents with the device icon, keeping the text
 * glyph as the fallback when no icon exists for that device.
 */
export function paintDeviceGlyph(element, device, doc = globalThis.document) {
  const icon = createDeviceIcon(device?.id, doc);
  if (!icon) {
    element.textContent = device?.glyph ?? "";
    element.classList?.remove("has-device-icon");
    return false;
  }
  element.replaceChildren(icon);
  element.classList?.add("has-device-icon");
  return true;
}
