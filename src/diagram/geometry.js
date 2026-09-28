/**
 * Diagram geometry — pure functions over rectangles, points, and polylines.
 *
 * Everything in the diagram lives in *world* coordinates: CSS pixels at 100%
 * zoom, origin at the top left, y growing downward. A rect is `{x, y, w, h}`
 * with (x, y) at its top-left corner, the same convention draw.io's
 * mxGeometry uses, so import and export never have to translate origins.
 */

export const SIDES = ["n", "e", "s", "w"];

export const SIDE_VECTORS = {
  n: { x: 0, y: -1 },
  e: { x: 1, y: 0 },
  s: { x: 0, y: 1 },
  w: { x: -1, y: 0 },
};

export const OPPOSITE_SIDE = { n: "s", s: "n", e: "w", w: "e" };

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function rectCenter(rect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

export function inflate(rect, margin) {
  return { x: rect.x - margin, y: rect.y - margin, w: rect.w + margin * 2, h: rect.h + margin * 2 };
}

/** The rect spanned by two corner points, in either order. */
export function rectFromPoints(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

/** Bounding box of rects, or null when there are none. */
export function unionRects(rects) {
  const list = rects.filter(Boolean);
  if (!list.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of list) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsOfPoints(points) {
  if (!points.length) return null;
  return unionRects(points.map((point) => ({ x: point.x, y: point.y, w: 0, h: 0 })));
}

export function rectContainsPoint(rect, point) {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

export function rectContainsRect(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function rectsIntersect(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function snapToGrid(value, size) {
  if (!size || size <= 0) return value;
  return Math.round(value / size) * size;
}

/** Midpoint of a rect's side. */
export function sidePoint(rect, side) {
  switch (side) {
    case "n":
      return { x: rect.x + rect.w / 2, y: rect.y };
    case "s":
      return { x: rect.x + rect.w / 2, y: rect.y + rect.h };
    case "e":
      return { x: rect.x + rect.w, y: rect.y + rect.h / 2 };
    default:
      return { x: rect.x, y: rect.y + rect.h / 2 };
  }
}

/** Which side of `rect` a point is closest to, measured from the centre. */
export function nearestSide(rect, point) {
  const center = rectCenter(rect);
  const dx = (point.x - center.x) / Math.max(1, rect.w / 2);
  const dy = (point.y - center.y) / Math.max(1, rect.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "e" : "w";
  return dy >= 0 ? "s" : "n";
}

/**
 * Where the ray from the rect's centre toward `target` leaves the shape.
 * Ellipses use the analytic intersection; everything else uses the box.
 */
export function perimeterPoint(rect, target, outline = "rect") {
  const center = rectCenter(rect);
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (!dx && !dy) return { ...center };
  const hw = Math.max(0.5, rect.w / 2);
  const hh = Math.max(0.5, rect.h / 2);
  if (outline === "ellipse") {
    const t = 1 / Math.sqrt((dx * dx) / (hw * hw) + (dy * dy) / (hh * hh));
    return { x: center.x + dx * t, y: center.y + dy * t };
  }
  if (outline === "diamond") {
    const t = 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh);
    return { x: center.x + dx * t, y: center.y + dy * t };
  }
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function polylineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1], points[index]);
  }
  return length;
}

/**
 * The point a fraction `t` (0-1) of the way along a polyline, with the
 * direction of travel there in radians.
 */
export function pointAlongPolyline(points, t) {
  if (!points.length) return { x: 0, y: 0, angle: 0, segment: 0 };
  if (points.length === 1) return { ...points[0], angle: 0, segment: 0 };
  const total = polylineLength(points);
  let remaining = clamp(t, 0, 1) * total;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = distance(a, b);
    if (remaining <= length || index === points.length - 1) {
      const ratio = length ? clamp(remaining / length, 0, 1) : 0;
      return {
        x: a.x + (b.x - a.x) * ratio,
        y: a.y + (b.y - a.y) * ratio,
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        segment: index - 1,
      };
    }
    remaining -= length;
  }
  const last = points[points.length - 1];
  return { ...last, angle: 0, segment: points.length - 2 };
}

export function closestPointOnSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1)
    : 0;
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

/**
 * Nearest point on a polyline to `point`, reported with the fraction of the
 * total length it sits at. Used to drop an edge label where it was dragged.
 */
export function nearestOnPolyline(points, point) {
  if (points.length < 2) {
    const only = points[0] || { x: 0, y: 0 };
    return { x: only.x, y: only.y, t: 0, distance: distance(only, point), segment: 0 };
  }
  const total = polylineLength(points) || 1;
  let travelled = 0;
  let best = null;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const closest = closestPointOnSegment(point, a, b);
    const gap = distance(closest, point);
    const segmentLength = distance(a, b);
    if (!best || gap < best.distance) {
      best = {
        x: closest.x,
        y: closest.y,
        t: (travelled + segmentLength * closest.t) / total,
        distance: gap,
        segment: index - 1,
      };
    }
    travelled += segmentLength;
  }
  return best;
}

/** Drop repeated points and interior points that sit on a straight run. */
export function simplifyPolyline(points, epsilon = 0.5) {
  const deduped = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (!last || Math.abs(last.x - point.x) > epsilon || Math.abs(last.y - point.y) > epsilon) {
      deduped.push({ x: point.x, y: point.y });
    }
  }
  if (deduped.length < 3) return deduped;
  const result = [deduped[0]];
  for (let index = 1; index < deduped.length - 1; index += 1) {
    const a = result[result.length - 1];
    const b = deduped[index];
    const c = deduped[index + 1];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const sameDirection = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0;
    if (Math.abs(cross) > epsilon || !sameDirection) result.push(b);
  }
  result.push(deduped[deduped.length - 1]);
  return result;
}

// ---------------------------------------------------------------- resizing

export const RESIZE_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * Resize `rect` by dragging `handle` by (dx, dy). The opposite edge or corner
 * stays pinned. `keepAspect` preserves the original proportions, which is what
 * an AWS icon needs; `minimum` stops a shape collapsing through itself.
 */
export function resizeRect(rect, handle, dx, dy, { keepAspect = false, minimum = 12 } = {}) {
  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.w;
  let bottom = rect.y + rect.h;
  if (handle.includes("w")) left = Math.min(left + dx, right - minimum);
  if (handle.includes("e")) right = Math.max(right + dx, left + minimum);
  if (handle.includes("n")) top = Math.min(top + dy, bottom - minimum);
  if (handle.includes("s")) bottom = Math.max(bottom + dy, top + minimum);

  let next = { x: left, y: top, w: right - left, h: bottom - top };
  if (!keepAspect || !rect.w || !rect.h) return next;

  const ratio = rect.w / rect.h;
  const horizontalOnly = handle === "e" || handle === "w";
  const verticalOnly = handle === "n" || handle === "s";
  let w = next.w;
  let h = next.h;
  if (horizontalOnly) h = w / ratio;
  else if (verticalOnly) w = h * ratio;
  else if (w / h > ratio) h = w / ratio;
  else w = h * ratio;
  w = Math.max(minimum, w);
  h = Math.max(minimum, h);

  const x = handle.includes("w")
    ? rect.x + rect.w - w
    : verticalOnly
      ? rect.x + (rect.w - w) / 2
      : rect.x;
  const y = handle.includes("n")
    ? rect.y + rect.h - h
    : horizontalOnly
      ? rect.y + (rect.h - h) / 2
      : rect.y;
  next = { x, y, w, h };
  return next;
}

// ------------------------------------------------------ align & distribute

/**
 * Align rects to the bounding box of the group, like draw.io's Arrange panel.
 * Returns the new top-left for each rect, in input order.
 *
 * @param {Array<{x,y,w,h}>} rects
 * @param {"left"|"center"|"right"|"top"|"middle"|"bottom"} mode
 */
export function alignRects(rects, mode) {
  const bounds = unionRects(rects);
  if (!bounds) return [];
  return rects.map((rect) => {
    switch (mode) {
      case "left":
        return { x: bounds.x, y: rect.y };
      case "center":
        return { x: bounds.x + (bounds.w - rect.w) / 2, y: rect.y };
      case "right":
        return { x: bounds.x + bounds.w - rect.w, y: rect.y };
      case "top":
        return { x: rect.x, y: bounds.y };
      case "middle":
        return { x: rect.x, y: bounds.y + (bounds.h - rect.h) / 2 };
      case "bottom":
        return { x: rect.x, y: bounds.y + bounds.h - rect.h };
      default:
        return { x: rect.x, y: rect.y };
    }
  });
}

/**
 * Space rects so the gaps between neighbours are equal, keeping the first and
 * last in place. Returns new top-left positions in input order.
 *
 * @param {"horizontal"|"vertical"} axis
 */
export function distributeRects(rects, axis) {
  const horizontal = axis === "horizontal";
  const order = rects
    .map((rect, index) => ({ rect, index }))
    .sort((a, b) => (horizontal ? a.rect.x - b.rect.x : a.rect.y - b.rect.y));
  const result = rects.map((rect) => ({ x: rect.x, y: rect.y }));
  if (order.length < 3) return result;
  const first = order[0].rect;
  const last = order[order.length - 1].rect;
  const span = horizontal ? last.x + last.w - first.x : last.y + last.h - first.y;
  const occupied = order.reduce((sum, { rect }) => sum + (horizontal ? rect.w : rect.h), 0);
  const gap = (span - occupied) / (order.length - 1);
  let cursor = horizontal ? first.x : first.y;
  for (const { rect, index } of order) {
    if (horizontal) result[index] = { x: cursor, y: rect.y };
    else result[index] = { x: rect.x, y: cursor };
    cursor += (horizontal ? rect.w : rect.h) + gap;
  }
  return result;
}

// ------------------------------------------------------------ smart guides

function axisCandidates(rect, axis) {
  return axis === "x"
    ? [rect.x, rect.x + rect.w / 2, rect.x + rect.w]
    : [rect.y, rect.y + rect.h / 2, rect.y + rect.h];
}

/**
 * Snap a moving rect to the edges and centres of the others (smart guides),
 * falling back to the grid on an axis where no guide is close enough.
 *
 * @returns {{dx: number, dy: number, guides: Array<{axis: "x"|"y", at: number, from: number, to: number}>}}
 *   dx/dy is the correction to add to the rect's position.
 */
export function computeSnap(
  moving,
  others,
  { threshold = 6, gridSize = 0, snapGrid = false } = {}
) {
  const result = { dx: 0, dy: 0, guides: [] };
  for (const axis of ["x", "y"]) {
    const mine = axisCandidates(moving, axis);
    let best = null;
    for (const other of others) {
      const theirs = axisCandidates(other, axis);
      for (const value of mine) {
        for (const target of theirs) {
          const delta = target - value;
          if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
            best = { delta, at: target };
          }
        }
      }
    }
    if (best) {
      if (axis === "x") result.dx = best.delta;
      else result.dy = best.delta;
      const snapped = {
        x: moving.x + (axis === "x" ? best.delta : 0),
        y: moving.y + (axis === "y" ? best.delta : 0),
        w: moving.w,
        h: moving.h,
      };
      // Every rect sharing the guide contributes to its drawn extent.
      const touching = others.filter((other) =>
        axisCandidates(other, axis).some((value) => Math.abs(value - best.at) < 0.5)
      );
      const span = unionRects([snapped, ...touching]);
      result.guides.push(
        axis === "x"
          ? { axis, at: best.at, from: span.y, to: span.y + span.h }
          : { axis, at: best.at, from: span.x, to: span.x + span.w }
      );
    } else if (snapGrid && gridSize > 0) {
      const origin = axis === "x" ? moving.x : moving.y;
      const delta = snapToGrid(origin, gridSize) - origin;
      if (axis === "x") result.dx = delta;
      else result.dy = delta;
    }
  }
  return result;
}
