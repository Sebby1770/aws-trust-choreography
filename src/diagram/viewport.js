/**
 * Viewport maths for an infinite canvas: `screen = world * zoom + offset`.
 * Pure so pan/zoom behaviour can be unit tested without a browser.
 */

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 4;
export const ZOOM_STOPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];

export function clampZoom(zoom) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number.isFinite(zoom) ? zoom : 1));
}

export function screenToWorld(view, point) {
  return { x: (point.x - view.x) / view.zoom, y: (point.y - view.y) / view.zoom };
}

export function worldToScreen(view, point) {
  return { x: point.x * view.zoom + view.x, y: point.y * view.zoom + view.y };
}

export function worldRectToScreen(view, rect) {
  const origin = worldToScreen(view, rect);
  return { x: origin.x, y: origin.y, w: rect.w * view.zoom, h: rect.h * view.zoom };
}

/** Zoom to `zoom` keeping the world point under `anchor` (screen) still. */
export function zoomAt(view, anchor, zoom) {
  const next = clampZoom(zoom);
  const world = screenToWorld(view, anchor);
  return { zoom: next, x: anchor.x - world.x * next, y: anchor.y - world.y * next };
}

/** Next zoom stop in a direction (+1 in, -1 out) from the current zoom. */
export function steppedZoom(zoom, direction) {
  if (direction > 0) return ZOOM_STOPS.find((stop) => stop > zoom + 0.001) ?? MAX_ZOOM;
  return [...ZOOM_STOPS].reverse().find((stop) => stop < zoom - 0.001) ?? MIN_ZOOM;
}

/**
 * The view that frames `bounds` inside a viewport of `size`, with `padding`
 * screen pixels around it and zoom capped at `maxZoom` so a tiny diagram is
 * not blown up to fill the screen.
 */
export function fitView(bounds, size, { padding = 48, maxZoom = 1.25 } = {}) {
  if (!bounds || !size.width || !size.height) return { x: 0, y: 0, zoom: 1 };
  const zoom = clampZoom(
    Math.min(
      maxZoom,
      (size.width - padding * 2) / Math.max(1, bounds.w),
      (size.height - padding * 2) / Math.max(1, bounds.h)
    )
  );
  return {
    zoom,
    x: size.width / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: size.height / 2 - (bounds.y + bounds.h / 2) * zoom,
  };
}

/** The world-space rect currently visible. */
export function visibleWorld(view, size) {
  const topLeft = screenToWorld(view, { x: 0, y: 0 });
  return { x: topLeft.x, y: topLeft.y, w: size.width / view.zoom, h: size.height / view.zoom };
}

/** Scroll the view by the least amount that brings `rect` fully into sight. */
export function revealRect(view, size, rect, margin = 60) {
  const screen = worldRectToScreen(view, rect);
  let dx = 0;
  let dy = 0;
  if (screen.x < margin) dx = margin - screen.x;
  else if (screen.x + screen.w > size.width - margin)
    dx = size.width - margin - (screen.x + screen.w);
  if (screen.y < margin) dy = margin - screen.y;
  else if (screen.y + screen.h > size.height - margin)
    dy = size.height - margin - (screen.y + screen.h);
  return { ...view, x: view.x + dx, y: view.y + dy };
}
