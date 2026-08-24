/**
 * Network device icons.
 *
 * The palette and the canvas used single text glyphs ("▣", "⇆", "DB"), which
 * told you almost nothing about what a device was. These are line-art icons
 * drawn on a 24x24 grid in the conventional shapes people already recognise
 * from network diagrams: a router is a puck with four-way arrows, a switch is
 * a chassis with parallel arrows, a firewall is a brick wall, a database is a
 * cylinder, and so on.
 *
 * Every icon is stroke-only and inherits `currentColor`, so it picks up the
 * per-device colour the lab already assigns.
 */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Path data per device id. Values are an array of `d` strings so an icon can
 * be several strokes without needing a wrapper element.
 */
export const DEVICE_ICON_PATHS = {
  // --- endpoints ---
  pc: ["M3 5h18v11H3z", "M9 20h6", "M12 16v4"],
  laptop: ["M5 6h14v9H5z", "M2 18h20l-1.6-3H3.6z"],
  printer: [
    "M7 8V3h10v5",
    "M5 8h14a2 2 0 0 1 2 2v6h-4",
    "M7 16H3v-6a2 2 0 0 1 2-2",
    "M7 13h10v8H7z",
  ],
  "ip-phone": [
    "M4 4h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    "M5 7h9v4H5z",
    "M5 14h2M9 14h2M13 14h1M5 17h2M9 17h2M13 17h1",
    "M19 8h3v6h-3",
  ],

  // --- network infrastructure ---
  // A router puck with traffic leaving in four directions.
  router: [
    "M3 14h18v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
    "M3 14a9 3 0 0 1 18 0",
    "M8 11V6M8 6l-2 2M8 6l2 2",
    "M16 4v5M16 9l-2-2M16 9l2-2",
  ],
  // A chassis with parallel flows — the classic layer-2 switch.
  "l2-switch": [
    "M2 9h20v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z",
    "M6 6h12M18 6l-2-2M18 6l-2 2",
    "M18 3H6M6 3l2-2M6 3l2 2",
    "M6 13h2M10 13h2M14 13h2M18 13h1",
  ],
  // Same chassis, but crossing arrows to signal routing between subnets.
  "l3-switch": [
    "M2 9h20v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z",
    "M6 6h12M18 6l-2-2M18 6l-2 2",
    "M18 3H6M6 3l2-2M6 3l2 2",
    "M7 13.5l2.5 2.5M12 13h1M16 13h3",
  ],
  "wireless-ap": ["M4 16h16v4H4z", "M12 16v-3", "M8.5 9.5a5 5 0 0 1 7 0", "M6 6.5a9 9 0 0 1 12 0"],
  firewall: [
    "M3 5h18v14H3z",
    "M3 9.7h18M3 14.3h18",
    "M9 5v4.7M15 5v4.7",
    "M6 9.7v4.6M12 9.7v4.6M18 9.7v4.6",
    "M9 14.3V19M15 14.3V19",
  ],
  "load-balancer": [
    "M2 12h5",
    "M7 12a3 3 0 0 1 3-3h2M7 12a3 3 0 0 0 3 3h2",
    "M7 12h5",
    "M15 6h6v4h-6zM15 14h6v4h-6z",
    "M12 9h3M12 12h3M12 15h3",
  ],
  "vpn-gateway": ["M3 12h4M17 12h4", "M9 11V9a3 3 0 0 1 6 0v2", "M8 11h8v7H8z", "M12 14v2"],

  // --- servers ---
  // A shared rack silhouette keeps the server family reading as one group;
  // the mark inside says which service it runs.
  "web-server": ["M3 3h18v18H3z", "M3 12h18", "M12 3a9 9 0 0 1 0 18a9 9 0 0 1 0-18"],
  "dns-server": [
    "M3 4h18v6H3zM3 14h18v6H3z",
    "M6 7h.01M6 17h.01",
    "M11 6.2v3.6M11 6.2l2.6 3.6V6.2",
    "M15.6 17.2c0 .6.7 1 1.6 1s1.6-.4 1.6-1-.7-.9-1.6-1s-1.6-.4-1.6-1 .7-1 1.6-1 1.6.4 1.6 1",
  ],
  "dhcp-server": [
    "M3 4h18v6H3zM3 14h18v6H3z",
    "M6 7h.01M6 17h.01",
    "M10 6v4M10 8h3M13 6v4",
    "M10 15h2.4a2 2 0 0 1 0 4H10z",
    "M16 15h3M17.5 15v4",
  ],
  "database-server": [
    "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z",
    "M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6",
    "M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
  ],
  "mail-server": ["M3 5h18v14H3z", "M3 6.5l9 6.5 9-6.5"],
  "linux-server": [
    "M3 4h18v6H3zM3 14h18v6H3z",
    "M6 7h.01M6 17h.01",
    "M10 6.2c0-1 .8-1.7 2-1.7s2 .7 2 1.7c0 1.6 1.4 2.4 1.4 3.3 0 .4-.4.5-1 .5h-4.8c-.6 0-1-.1-1-.5 0-.9 1.4-1.7 1.4-3.3z",
    "M11 15h2M12 15v4",
  ],
  "windows-server": [
    "M3 4h18v6H3zM3 14h18v6H3z",
    "M6 7h.01M6 17h.01",
    "M10 5.6l4-.6v4.4h-4zM15 4.9l4-.6v4.9h-4z",
    "M11 15h2M12 15v4",
  ],

  // --- edges of the world ---
  internet: [
    "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18z",
    "M3 12h18",
    "M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z",
  ],
  cloud: ["M7.5 19a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.5 11a4 4 0 0 1-.5 8z"],
};

/** Devices whose icon is drawn with a filled mark rather than strokes only. */
const FILLED_DOTS = new Set(["dns-server", "dhcp-server", "linux-server", "windows-server"]);

export function hasDeviceIcon(deviceId) {
  return Object.hasOwn(DEVICE_ICON_PATHS, deviceId);
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
  const paths = DEVICE_ICON_PATHS[deviceId];
  if (!paths || !doc) return null;

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("network-device-icon");

  for (const d of paths) {
    const path = doc.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    // The status LEDs on server chassis read better solid.
    if (FILLED_DOTS.has(deviceId) && d.includes(".01")) {
      path.setAttribute("stroke-width", "2.4");
    }
    svg.append(path);
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
    return false;
  }
  element.replaceChildren(icon);
  return true;
}
