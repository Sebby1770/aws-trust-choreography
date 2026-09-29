/**
 * Minimap — an overview of the whole diagram with the visible area marked.
 * Click or drag inside it to move the view there.
 */

import { unionRects } from "./geometry.js";
import { isContainer, isServiceNode, vertices } from "./model.js";
import { visibleWorld } from "./viewport.js";

export function createMinimap({ host, editor }) {
  const wrapper = document.createElement("div");
  wrapper.className = "dg-minimap";
  wrapper.setAttribute("aria-label", "Diagram overview. Drag to move the view.");
  wrapper.setAttribute("role", "img");
  const canvas = document.createElement("canvas");
  wrapper.append(canvas);
  host.append(wrapper);
  const width = 184;
  const height = 120;
  const ratio = Math.max(1, globalThis.devicePixelRatio || 1);
  canvas.width = width * ratio;
  canvas.height = height * ratio;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  let transform = null;
  let dragging = false;

  function draw() {
    const doc = editor.doc;
    const context = canvas.getContext?.("2d");
    if (!doc || !context || wrapper.hidden) return;
    const viewport = visibleWorld(editor.view, editor.size());
    const content = unionRects(vertices(doc).map((v) => ({ x: v.x, y: v.y, w: v.w, h: v.h })));
    const bounds = unionRects([content, viewport].filter(Boolean));
    const pad = 20;
    const scale = Math.min((width - 8) / (bounds.w + pad * 2), (height - 8) / (bounds.h + pad * 2));
    const offsetX = (width - (bounds.w + pad * 2) * scale) / 2 - (bounds.x - pad) * scale;
    const offsetY = (height - (bounds.h + pad * 2) * scale) / 2 - (bounds.y - pad) * scale;
    transform = { scale, offsetX, offsetY };
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const map = (rect) => [
      rect.x * scale + offsetX,
      rect.y * scale + offsetY,
      Math.max(1.5, rect.w * scale),
      Math.max(1.5, rect.h * scale),
    ];
    for (const vertex of vertices(doc)) {
      const [x, y, w, h] = map(vertex);
      if (isContainer(vertex)) {
        context.strokeStyle = "rgba(100,116,139,0.55)";
        context.lineWidth = 1;
        context.strokeRect(x, y, w, h);
      } else if (vertex.kind !== "group") {
        context.fillStyle = isServiceNode(vertex) ? "#ed7100" : "rgba(71,85,105,0.55)";
        context.fillRect(x, y, w, h);
      }
    }
    const [vx, vy, vw, vh] = map(viewport);
    context.fillStyle = "rgba(9,114,211,0.08)";
    context.fillRect(vx, vy, vw, vh);
    context.strokeStyle = "#0972d3";
    context.lineWidth = 1.5;
    context.strokeRect(vx, vy, vw, vh);
  }

  function moveTo(event) {
    if (!transform) return;
    const rect = canvas.getBoundingClientRect();
    const worldX = (event.clientX - rect.left - transform.offsetX) / transform.scale;
    const worldY = (event.clientY - rect.top - transform.offsetY) / transform.scale;
    const view = editor.view;
    const size = editor.size();
    editor.setView({
      zoom: view.zoom,
      x: size.width / 2 - worldX * view.zoom,
      y: size.height / 2 - worldY * view.zoom,
    });
  }

  canvas.addEventListener("pointerdown", (event) => {
    dragging = true;
    canvas.setPointerCapture?.(event.pointerId);
    moveTo(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (dragging) moveTo(event);
  });
  canvas.addEventListener("pointerup", () => {
    dragging = false;
  });

  return {
    draw,
    setVisible(visible) {
      wrapper.hidden = !visible;
      if (visible) draw();
    },
  };
}
