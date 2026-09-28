/**
 * A tiny virtual-node layer for SVG.
 *
 * The scene is described once as plain `{tag, attrs, children}` records and
 * then either materialised as live DOM for the canvas or serialised to markup
 * for SVG/PNG export — so an exported diagram is exactly what is on screen.
 */

export const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** Build a virtual node. Falsy children are dropped; arrays are flattened. */
export function h(tag, attrs = {}, ...children) {
  return { tag, attrs: attrs || {}, children: flatten(children) };
}

/** A text child. */
export function t(value) {
  return { text: String(value ?? "") };
}

function flatten(children) {
  const result = [];
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === "") continue;
    if (Array.isArray(child)) result.push(...flatten(child));
    else if (typeof child === "string" || typeof child === "number") result.push(t(child));
    else result.push(child);
  }
  return result;
}

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attributeName(name) {
  // camelCase keys for SVG attributes that are hyphenated in markup.
  if (name === "className") return "class";
  if (name.startsWith("data") || name.startsWith("aria")) {
    return name.replace(/([A-Z])/g, "-$1").toLowerCase();
  }
  return name.replace(/([a-z])([A-Z])/g, (_, a, b) => `${a}-${b.toLowerCase()}`);
}

// Attributes whose camelCase spelling is the real SVG name.
const CAMEL_ATTRIBUTES = new Set([
  "viewBox",
  "preserveAspectRatio",
  "stdDeviation",
  "floodOpacity",
  "floodColor",
]);

function resolvedName(name) {
  if (CAMEL_ATTRIBUTES.has(name)) {
    return name === "floodOpacity" ? "flood-opacity" : name === "floodColor" ? "flood-color" : name;
  }
  return attributeName(name);
}

/** Serialise a virtual node to markup. */
export function toMarkup(node) {
  if (!node) return "";
  if ("text" in node) return escapeXml(node.text);
  const attrs = Object.entries(node.attrs)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([name, value]) => {
      const text = escapeXml(value === true ? "" : value);
      // Older SVG renderers only understand xlink:href on <image>.
      return name === "href"
        ? ` href="${text}" xlink:href="${text}"`
        : ` ${resolvedName(name)}="${text}"`;
    })
    .join("");
  if (!node.children.length) return `<${node.tag}${attrs}/>`;
  return `<${node.tag}${attrs}>${node.children.map(toMarkup).join("")}</${node.tag}>`;
}

/** Materialise a virtual node as live SVG DOM. */
export function toDom(node, doc = globalThis.document) {
  if ("text" in node) return doc.createTextNode(node.text);
  const element = doc.createElementNS(SVG_NS, node.tag);
  for (const [name, value] of Object.entries(node.attrs)) {
    if (value === undefined || value === null || value === false) continue;
    const resolved = resolvedName(name);
    if (resolved === "href") {
      element.setAttribute("href", String(value));
      element.setAttributeNS(XLINK_NS, "xlink:href", String(value));
    } else {
      element.setAttribute(resolved, value === true ? "" : String(value));
    }
  }
  for (const child of node.children) element.append(toDom(child, doc));
  return element;
}
