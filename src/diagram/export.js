/**
 * Export plumbing that needs the browser: inlining icon artwork as data URLs,
 * rasterising SVG to PNG, and saving files.
 */

import { CONTAINER_PRESETS } from "./shapes.js";
import { vertices, isServiceNode } from "./model.js";

const cache = new Map();

async function toDataUrl(path) {
  if (!path) return null;
  if (path.startsWith("data:")) return path;
  if (cache.has(path)) return cache.get(path);
  const pending = (async () => {
    try {
      const response = await fetch(path);
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  })();
  cache.set(path, pending);
  return pending;
}

/** Every artwork path a document uses, resolved to base64 data URLs. */
export async function iconDataUrls(doc) {
  const paths = new Set();
  for (const vertex of vertices(doc)) {
    if (isServiceNode(vertex)) paths.add(vertex.iconPath);
    else if (vertex.kind === "container" && CONTAINER_PRESETS[vertex.preset]?.icon)
      paths.add(CONTAINER_PRESETS[vertex.preset].icon);
    else if (vertex.kind === "image" && vertex.src) paths.add(vertex.src);
  }
  const entries = await Promise.all([...paths].map(async (path) => [path, await toDataUrl(path)]));
  const map = new Map(
    entries.filter(([, value]) => value).map(([path, value]) => [path, normaliseDataUrl(value)])
  );
  return map;
}

/** FileReader may label SVGs oddly; make sure they read as image/svg+xml;base64. */
function normaliseDataUrl(value) {
  return value.replace(
    /^data:(?:application\/octet-stream|text\/xml|image\/svg);base64,/,
    "data:image/svg+xml;base64,"
  );
}

/** Rasterise SVG markup to a PNG blob at `scale`. */
export function svgToPng(markup, width, height, { scale = 2, background = "#ffffff" } = {}) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        const limit = 16000;
        const factor = Math.min(scale, limit / Math.max(width, height));
        canvas.width = Math.max(1, Math.round(width * factor));
        canvas.height = Math.max(1, Math.round(height * factor));
        const context = canvas.getContext("2d");
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        canvas.toBlob(
          (png) => (png ? resolve(png) : reject(new Error("PNG export failed."))),
          "image/png"
        );
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The diagram could not be rendered to PNG."));
    };
    image.src = url;
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text, filename, type = "text/plain") {
  downloadBlob(new Blob([text], { type }), filename);
}

export function fileSlug(name) {
  return (
    String(name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "aws-architecture"
  );
}
