/**
 * Connector routing.
 *
 * Three routing styles, all returning a polyline plus its SVG path:
 *
 *  - **orthogonal** — right-angled connectors that route *around* other shapes.
 *    draw.io's orthogonal style will happily run a connector straight through
 *    an unrelated box; here the router builds a sparse orthogonal visibility
 *    grid from the obstacles near the connector and runs A* over it with a
 *    penalty per bend, so the result is short, tidy, and unobstructed.
 *  - **straight** — centre-to-centre, clipped to each shape's outline.
 *  - **curved** — a cubic Bézier leaving and entering perpendicular to the
 *    chosen sides (or a smooth spline through waypoints).
 *
 * Hand-placed waypoints always win: an orthogonal connector with waypoints is
 * routed through them with elbows, with no obstacle avoidance.
 */

import {
  distance,
  inflate,
  nearestSide,
  OPPOSITE_SIDE,
  perimeterPoint,
  pointAlongPolyline,
  rectCenter,
  sidePoint,
  SIDE_VECTORS,
  simplifyPolyline,
} from "./geometry.js";

const STUB = 18;
const OBSTACLE_MARGIN = 12;
const BEND_PENALTY = 28;
const SEARCH_MARGIN = 160;
const MAX_GRID_POINTS = 40000;

// ---------------------------------------------------------------- helpers

function offset(point, side, amount) {
  const vector = SIDE_VECTORS[side];
  return { x: point.x + vector.x * amount, y: point.y + vector.y * amount };
}

/**
 * A side's connection point. Service icons carry their label underneath, so
 * the south port drops below the label (`depth`) instead of cutting through it.
 */
function portPoint(rect, side, depth = 0) {
  if (side === "s" && depth) return { x: rect.x + rect.w / 2, y: rect.y + rect.h + depth };
  return sidePoint(rect, side);
}

function withDepth(rect, depth = 0) {
  return depth ? { ...rect, h: rect.h + depth } : rect;
}

function uniqueSorted(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const result = [];
  for (const value of sorted) {
    if (!result.length || Math.abs(result[result.length - 1] - value) > 0.5) result.push(value);
  }
  return result;
}

// ----------------------------------------------------------- binary heap

class MinHeap {
  constructor() {
    this.items = [];
  }
  get size() {
    return this.items.length;
  }
  push(item) {
    const items = this.items;
    items.push(item);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].f <= item.f) break;
      items[index] = items[parent];
      index = parent;
    }
    items[index] = item;
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      // Sift `last` down from the root.
      let index = 0;
      const length = items.length;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let smallest = index;
        let smallestF = last.f;
        if (left < length && items[left].f < smallestF) {
          smallest = left;
          smallestF = items[left].f;
        }
        if (right < length && items[right].f < smallestF) smallest = right;
        if (smallest === index) break;
        items[index] = items[smallest];
        index = smallest;
      }
      items[index] = last;
    }
    return top;
  }
}

// ------------------------------------------------------- orthogonal A*

const DIRECTIONS = ["n", "e", "s", "w"];

/**
 * Shortest orthogonal path from `start` to `end` avoiding `obstacles`,
 * preferring few bends. `startDirection` is the heading the path leaves in
 * and `endDirection` the heading it should arrive with.
 *
 * @returns {Array<{x,y}>|null}
 */
export function orthogonalPath(start, end, obstacles, { startDirection, endDirection } = {}) {
  const region = {
    minX: Math.min(start.x, end.x) - SEARCH_MARGIN,
    maxX: Math.max(start.x, end.x) + SEARCH_MARGIN,
    minY: Math.min(start.y, end.y) - SEARCH_MARGIN,
    maxY: Math.max(start.y, end.y) + SEARCH_MARGIN,
  };
  const relevant = obstacles.filter(
    (rect) =>
      rect.x < region.maxX &&
      rect.x + rect.w > region.minX &&
      rect.y < region.maxY &&
      rect.y + rect.h > region.minY
  );
  for (const rect of relevant) {
    region.minX = Math.min(region.minX, rect.x - SEARCH_MARGIN / 2);
    region.maxX = Math.max(region.maxX, rect.x + rect.w + SEARCH_MARGIN / 2);
    region.minY = Math.min(region.minY, rect.y - SEARCH_MARGIN / 2);
    region.maxY = Math.max(region.maxY, rect.y + rect.h + SEARCH_MARGIN / 2);
  }

  const xs = [start.x, end.x, region.minX, region.maxX];
  const ys = [start.y, end.y, region.minY, region.maxY];
  for (const rect of relevant) {
    xs.push(rect.x, rect.x + rect.w);
    ys.push(rect.y, rect.y + rect.h);
  }
  // Midlines between neighbouring lines let a route run centred in a gap.
  const baseX = uniqueSorted(xs);
  const baseY = uniqueSorted(ys);
  const gridX = uniqueSorted([...baseX, ...baseX.slice(1).map((x, i) => (x + baseX[i]) / 2)]);
  const gridY = uniqueSorted([...baseY, ...baseY.slice(1).map((y, i) => (y + baseY[i]) / 2)]);
  if (gridX.length * gridY.length > MAX_GRID_POINTS) return null;

  const columns = gridX.length;
  const rows = gridY.length;
  const key = (ix, iy) => iy * columns + ix;
  // Obstacle edges are themselves grid lines, so a step between neighbouring
  // grid points enters an obstacle exactly when its midpoint is inside one.
  // That lets blocked points and blocked steps be marked once per obstacle
  // instead of testing every obstacle on every step of the search.
  const blocked = new Uint8Array(columns * rows);
  const blockedRight = new Uint8Array(columns * rows);
  const blockedDown = new Uint8Array(columns * rows);
  const firstAbove = (list, value) => {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (list[mid] <= value + 0.01) low = mid + 1;
      else high = mid;
    }
    return low;
  };
  const lastBelow = (list, value) => {
    let low = 0;
    let high = list.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (list[mid] < value - 0.01) low = mid + 1;
      else high = mid;
    }
    return low - 1;
  };
  for (const rect of relevant) {
    const x0 = firstAbove(gridX, rect.x);
    const x1 = lastBelow(gridX, rect.x + rect.w);
    const y0 = firstAbove(gridY, rect.y);
    const y1 = lastBelow(gridY, rect.y + rect.h);
    // Lines on or inside the rect: steps between them run through it.
    const xa = Math.max(0, x0 - 1);
    const xb = Math.min(columns - 1, x1 + 1);
    const ya = Math.max(0, y0 - 1);
    const yb = Math.min(rows - 1, y1 + 1);
    for (let iy = y0; iy <= y1; iy += 1) {
      for (let ix = x0; ix <= x1; ix += 1) blocked[key(ix, iy)] = 1;
      for (let ix = xa; ix < xb; ix += 1) {
        if (gridX[ix] >= rect.x - 0.01 && gridX[ix + 1] <= rect.x + rect.w + 0.01)
          blockedRight[key(ix, iy)] = 1;
      }
    }
    for (let ix = x0; ix <= x1; ix += 1) {
      for (let iy = ya; iy < yb; iy += 1) {
        if (gridY[iy] >= rect.y - 0.01 && gridY[iy + 1] <= rect.y + rect.h + 0.01)
          blockedDown[key(ix, iy)] = 1;
      }
    }
  }
  const stepBlocked = (ix, iy, direction) => {
    switch (direction) {
      case 0:
        return blockedDown[key(ix, iy - 1)] === 1;
      case 1:
        return blockedRight[key(ix, iy)] === 1;
      case 2:
        return blockedDown[key(ix, iy)] === 1;
      default:
        return blockedRight[key(ix - 1, iy)] === 1;
    }
  };
  const findIndex = (list, value) =>
    list.findIndex((candidate) => Math.abs(candidate - value) <= 0.5);
  const startIx = findIndex(gridX, start.x);
  const startIy = findIndex(gridY, start.y);
  const endIx = findIndex(gridX, end.x);
  const endIy = findIndex(gridY, end.y);
  if (startIx < 0 || startIy < 0 || endIx < 0 || endIy < 0) return null;
  blocked[key(startIx, startIy)] = 0;
  blocked[key(endIx, endIy)] = 0;

  const heuristic = (ix, iy) => Math.abs(gridX[ix] - end.x) + Math.abs(gridY[iy] - end.y);
  const stateKey = (ix, iy, direction) => key(ix, iy) * 4 + direction;
  const best = new Map();
  const parent = new Map();
  const heap = new MinHeap();
  const initialDirection = startDirection ? DIRECTIONS.indexOf(startDirection) : -1;
  const startState = {
    ix: startIx,
    iy: startIy,
    d: initialDirection < 0 ? 0 : initialDirection,
    g: 0,
  };
  startState.f = heuristic(startIx, startIy);
  heap.push(startState);
  best.set(stateKey(startIx, startIy, startState.d), 0);
  const targetDirection = endDirection ? DIRECTIONS.indexOf(endDirection) : -1;
  const steps = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  let found = null;
  let expanded = 0;
  while (heap.size) {
    const current = heap.pop();
    const currentKey = stateKey(current.ix, current.iy, current.d);
    if (current.g > (best.get(currentKey) ?? Infinity)) continue;
    if (current.ix === endIx && current.iy === endIy) {
      const arrivalPenalty =
        targetDirection >= 0 && current.d !== targetDirection ? BEND_PENALTY : 0;
      if (!found || current.g + arrivalPenalty < found.cost) {
        found = { state: current, cost: current.g + arrivalPenalty };
      }
      // Keep searching briefly in case a better-aligned arrival is cheaper.
      if (arrivalPenalty === 0) break;
      continue;
    }
    if ((expanded += 1) > 60000) break;
    for (let direction = 0; direction < 4; direction += 1) {
      // No U-turns: reversing along a line is never useful.
      if (direction === (current.d + 2) % 4 && (current.g > 0 || initialDirection >= 0)) continue;
      const nx = current.ix + steps[direction][0];
      const ny = current.iy + steps[direction][1];
      if (nx < 0 || ny < 0 || nx >= columns || ny >= rows) continue;
      if (blocked[key(nx, ny)] || stepBlocked(current.ix, current.iy, direction)) continue;
      const from = { x: gridX[current.ix], y: gridY[current.iy] };
      const to = { x: gridX[nx], y: gridY[ny] };
      const turning = current.g === 0 && initialDirection < 0 ? false : direction !== current.d;
      const g = current.g + distance(from, to) + (turning ? BEND_PENALTY : 0);
      const nextKey = stateKey(nx, ny, direction);
      if (g >= (best.get(nextKey) ?? Infinity)) continue;
      best.set(nextKey, g);
      parent.set(nextKey, currentKey);
      heap.push({ ix: nx, iy: ny, d: direction, g, f: g + heuristic(nx, ny) });
    }
  }
  if (!found) return null;

  const points = [];
  let cursor = stateKey(found.state.ix, found.state.iy, found.state.d);
  const seen = new Set();
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    const cell = Math.floor(cursor / 4);
    points.push({ x: gridX[cell % columns], y: gridY[Math.floor(cell / columns)] });
    cursor = parent.get(cursor);
  }
  points.reverse();
  return simplifyPolyline(points);
}

/** A simple elbow between two points leaving `side` (no obstacle avoidance). */
function elbow(start, end, startSide, endSide) {
  const horizontalStart = startSide === "e" || startSide === "w";
  const horizontalEnd = endSide === "e" || endSide === "w";
  if (horizontalStart && horizontalEnd) {
    const midX = (start.x + end.x) / 2;
    return [start, { x: midX, y: start.y }, { x: midX, y: end.y }, end];
  }
  if (!horizontalStart && !horizontalEnd) {
    const midY = (start.y + end.y) / 2;
    return [start, { x: start.x, y: midY }, { x: end.x, y: midY }, end];
  }
  if (horizontalStart) return [start, { x: end.x, y: start.y }, end];
  return [start, { x: start.x, y: end.y }, end];
}

/** Orthogonal polyline through fixed points, bending once between each pair. */
function throughWaypoints(points, firstSide) {
  const result = [points[0]];
  let horizontal = firstSide ? firstSide === "e" || firstSide === "w" : true;
  for (let index = 1; index < points.length; index += 1) {
    const a = result[result.length - 1];
    const b = points[index];
    if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
      result.push(horizontal ? { x: b.x, y: a.y } : { x: a.x, y: b.y });
    } else {
      horizontal = Math.abs(a.y - b.y) <= 0.5;
    }
    result.push(b);
    horizontal = !horizontal;
  }
  return simplifyPolyline(result);
}

// ------------------------------------------------------------ side choice

/**
 * Candidate (sourceSide, targetSide) pairs worth trying for an automatic
 * orthogonal connector, most natural first.
 */
export function candidateSides(source, target) {
  const a = rectCenter(source);
  const b = rectCenter(target);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const horizontalGap =
    dx > 0 ? target.x - (source.x + source.w) : source.x - (target.x + target.w);
  const verticalGap = dy > 0 ? target.y - (source.y + source.h) : source.y - (target.y + target.h);
  const h = dx >= 0 ? ["e", "w"] : ["w", "e"];
  const v = dy >= 0 ? ["s", "n"] : ["n", "s"];
  const pairs = [];
  const preferHorizontal = horizontalGap >= verticalGap;
  if (preferHorizontal) pairs.push(h);
  else pairs.push(v);
  // L-shaped exits when the shapes are offset on both axes.
  if (horizontalGap > 10 && verticalGap > 10) {
    pairs.push([h[0], v[1]], [v[0], h[1]]);
  }
  if (preferHorizontal) pairs.push(v);
  else pairs.push(h);
  return pairs;
}

function polylineCost(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1)
    length += distance(points[index - 1], points[index]);
  return length + Math.max(0, points.length - 2) * BEND_PENALTY;
}

// -------------------------------------------------------------- the API

/**
 * Route one connector.
 *
 * @param {object} input
 * @param {{x,y,w,h}|null} input.source  source rect (null for a free end)
 * @param {{x,y,w,h}|null} input.target
 * @param {{x,y}} [input.sourcePoint]    free source end
 * @param {{x,y}} [input.targetPoint]
 * @param {string} [input.sourceOutline] "rect" | "ellipse" | "diamond"
 * @param {string} [input.targetOutline]
 * @param {string} [input.fromPort]      "auto" | "n" | "e" | "s" | "w"
 * @param {string} [input.toPort]
 * @param {Array<{x,y}>} [input.waypoints]
 * @param {string} [input.routing]       "orthogonal" | "straight" | "curved"
 * @param {number} [input.sourceDepth]   label depth under the source (south port drops below it)
 * @param {number} [input.targetDepth]
 * @param {Array<{x,y,w,h}>} [input.obstacles]
 * @returns {{points: Array<{x,y}>, curve: Array|null}}
 *   `curve` holds cubic control points when the connector is curved.
 */
export function routeConnector(input) {
  const routing = input.routing || "orthogonal";
  const waypoints = input.waypoints || [];
  const source = input.source || null;
  const target = input.target || null;
  const sourceAnchor = source ? rectCenter(source) : input.sourcePoint;
  const targetAnchor = target ? rectCenter(target) : input.targetPoint;
  if (!sourceAnchor || !targetAnchor) return { points: [], curve: null };

  if (routing === "straight" || routing === "curved") {
    return routeFree(input, routing, source, target, sourceAnchor, targetAnchor, waypoints);
  }

  const fixedFrom = input.fromPort && input.fromPort !== "auto" ? input.fromPort : null;
  const fixedTo = input.toPort && input.toPort !== "auto" ? input.toPort : null;

  if (waypoints.length) {
    const firstSide = fixedFrom || (source ? nearestSide(source, waypoints[0]) : null);
    const lastSide =
      fixedTo || (target ? nearestSide(target, waypoints[waypoints.length - 1]) : null);
    const start = source ? portPoint(source, firstSide, input.sourceDepth) : sourceAnchor;
    const end = target ? portPoint(target, lastSide, input.targetDepth) : targetAnchor;
    const leading = source ? [start, offset(start, firstSide, STUB)] : [start];
    const trailing = target ? [offset(end, lastSide, STUB), end] : [end];
    const path = throughWaypoints([...leading, ...waypoints, ...trailing], firstSide);
    return { points: path, curve: null };
  }

  // Free ends: one elbow is all a dangling connector needs.
  if (!source || !target) {
    const startSide = source ? fixedFrom || nearestSide(source, targetAnchor) : null;
    const endSide = target ? fixedTo || nearestSide(target, sourceAnchor) : null;
    const start = source ? portPoint(source, startSide, input.sourceDepth) : sourceAnchor;
    const end = target ? portPoint(target, endSide, input.targetDepth) : targetAnchor;
    const inferredStart = startSide || (endSide ? OPPOSITE_SIDE[endSide] : "e");
    const inferredEnd = endSide || OPPOSITE_SIDE[inferredStart];
    return { points: simplifyPolyline(elbow(start, end, inferredStart, inferredEnd)), curve: null };
  }

  const pairs =
    fixedFrom || fixedTo
      ? [
          [
            fixedFrom || candidateSides(source, target)[0][0],
            fixedTo || candidateSides(source, target)[0][1],
          ],
        ]
      : candidateSides(source, target);
  const obstacles = (input.obstacles || []).map((rect) => inflate(rect, OBSTACLE_MARGIN));
  const sourceBox = inflate(withDepth(source, input.sourceDepth), STUB - 6);
  const targetBox = inflate(withDepth(target, input.targetDepth), STUB - 6);
  let best = null;
  for (const [fromSide, toSide] of pairs) {
    const start = portPoint(source, fromSide, input.sourceDepth);
    const end = portPoint(target, toSide, input.targetDepth);
    const stubStart = offset(start, fromSide, STUB);
    const stubEnd = offset(end, toSide, STUB);
    const blockers = [...obstacles, sourceBox, targetBox];
    const middle = orthogonalPath(stubStart, stubEnd, blockers, {
      startDirection: fromSide,
      endDirection: OPPOSITE_SIDE[toSide],
    });
    const route = middle
      ? simplifyPolyline([start, ...middle, end])
      : simplifyPolyline(elbow(start, end, fromSide, toSide));
    const cost = polylineCost(route) + (middle ? 0 : 5000);
    if (!best || cost < best.cost) best = { cost, route };
  }
  return { points: best.route, curve: null };
}

function routeFree(input, routing, source, target, sourceAnchor, targetAnchor, waypoints) {
  const firstToward = waypoints[0] || targetAnchor;
  const lastToward = waypoints[waypoints.length - 1] || sourceAnchor;
  const fixedFrom = input.fromPort && input.fromPort !== "auto" ? input.fromPort : null;
  const fixedTo = input.toPort && input.toPort !== "auto" ? input.toPort : null;

  const clip = (rect, toward, outline, depth) => {
    const point = perimeterPoint(rect, toward, outline);
    // Leaving through the bottom would cross the label: clip below it instead.
    if (depth && point.y >= rect.y + rect.h - 0.5 && toward.y > rect.y + rect.h) {
      return perimeterPoint(withDepth(rect, depth), toward, "rect");
    }
    return point;
  };
  if (routing === "straight") {
    const start = source
      ? fixedFrom
        ? portPoint(source, fixedFrom, input.sourceDepth)
        : clip(source, firstToward, input.sourceOutline, input.sourceDepth)
      : sourceAnchor;
    const end = target
      ? fixedTo
        ? portPoint(target, fixedTo, input.targetDepth)
        : clip(target, lastToward, input.targetOutline, input.targetDepth)
      : targetAnchor;
    return { points: [start, ...waypoints, end], curve: null };
  }

  // Curved: leave and arrive perpendicular to a side.
  const fromSide = source ? fixedFrom || nearestSide(source, firstToward) : null;
  const toSide = target ? fixedTo || nearestSide(target, lastToward) : null;
  const start = source ? portPoint(source, fromSide, input.sourceDepth) : sourceAnchor;
  const end = target ? portPoint(target, toSide, input.targetDepth) : targetAnchor;
  const through = [start, ...waypoints, end];
  const curve = [];
  for (let index = 1; index < through.length; index += 1) {
    const a = through[index - 1];
    const b = through[index];
    const span = Math.max(40, distance(a, b) * 0.4);
    const before = through[index - 2];
    const after = through[index + 1];
    const c1 =
      index === 1 && fromSide
        ? offset(a, fromSide, span)
        : before
          ? { x: a.x + (b.x - before.x) / 6, y: a.y + (b.y - before.y) / 6 }
          : { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 };
    const c2 =
      index === through.length - 1 && toSide
        ? offset(b, toSide, span)
        : after
          ? { x: b.x - (after.x - a.x) / 6, y: b.y - (after.y - a.y) / 6 }
          : { x: b.x - (b.x - a.x) / 3, y: b.y - (b.y - a.y) / 3 };
    curve.push({ from: a, c1, c2, to: b });
  }
  // A sampled polyline stands in for the curve in hit-testing and labels.
  const points = [start];
  for (const segment of curve) {
    for (let step = 1; step <= 12; step += 1) points.push(cubicAt(segment, step / 12));
  }
  return { points, curve };
}

function cubicAt({ from, c1, c2, to }, t) {
  const u = 1 - t;
  return {
    x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * to.x,
    y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * to.y,
  };
}

/**
 * A key that changes exactly when a connector's route could change: its own
 * inputs plus every obstacle close enough to matter. Used to cache routes so
 * editing one corner of a large diagram does not re-route all of it.
 */
export function routeKey(input) {
  const anchors = [input.source, input.target].filter(Boolean);
  const points = [input.sourcePoint, input.targetPoint, ...(input.waypoints || [])].filter(Boolean);
  const box = [...anchors, ...points.map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))].reduce(
    (acc, rect) => ({
      minX: Math.min(acc.minX, rect.x),
      minY: Math.min(acc.minY, rect.y),
      maxX: Math.max(acc.maxX, rect.x + rect.w),
      maxY: Math.max(acc.maxY, rect.y + rect.h),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
  const reach = SEARCH_MARGIN + STUB + OBSTACLE_MARGIN + 40;
  const near =
    input.routing && input.routing !== "orthogonal"
      ? []
      : (input.obstacles || []).filter(
          (rect) =>
            rect.x < box.maxX + reach &&
            rect.x + rect.w > box.minX - reach &&
            rect.y < box.maxY + reach &&
            rect.y + rect.h > box.minY - reach
        );
  const r = (rect) => (rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : "-");
  const p = (point) => (point ? `${point.x},${point.y}` : "-");
  return [
    input.routing || "orthogonal",
    r(input.source),
    r(input.target),
    p(input.sourcePoint),
    p(input.targetPoint),
    input.sourceOutline || "",
    input.targetOutline || "",
    input.fromPort || "",
    input.toPort || "",
    input.sourceDepth || 0,
    input.targetDepth || 0,
    (input.waypoints || []).map(p).join(";"),
    near.map(r).join(";"),
  ].join("|");
}

// ------------------------------------------------------------ SVG output

function fmt(value) {
  return Math.round(value * 10) / 10;
}

/**
 * SVG path data for a routed connector. Orthogonal corners are rounded with
 * a small radius when `rounded` is set, the way draw.io's rounded=1 draws.
 */
export function connectorPathData(route, { rounded = true, radius = 8 } = {}) {
  const { points, curve } = route;
  if (!points.length) return "";
  if (curve?.length) {
    return [
      `M ${fmt(curve[0].from.x)} ${fmt(curve[0].from.y)}`,
      ...curve.map(
        (segment) =>
          `C ${fmt(segment.c1.x)} ${fmt(segment.c1.y)} ${fmt(segment.c2.x)} ${fmt(segment.c2.y)} ${fmt(segment.to.x)} ${fmt(segment.to.y)}`
      ),
    ].join(" ");
  }
  if (!rounded || points.length < 3) {
    return points
      .map((point, index) => `${index ? "L" : "M"} ${fmt(point.x)} ${fmt(point.y)}`)
      .join(" ");
  }
  const parts = [`M ${fmt(points[0].x)} ${fmt(points[0].y)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const r = Math.min(radius, distance(previous, corner) / 2, distance(corner, next) / 2);
    const before = {
      x: corner.x + ((previous.x - corner.x) / (distance(previous, corner) || 1)) * r,
      y: corner.y + ((previous.y - corner.y) / (distance(previous, corner) || 1)) * r,
    };
    const after = {
      x: corner.x + ((next.x - corner.x) / (distance(corner, next) || 1)) * r,
      y: corner.y + ((next.y - corner.y) / (distance(corner, next) || 1)) * r,
    };
    parts.push(
      `L ${fmt(before.x)} ${fmt(before.y)}`,
      `Q ${fmt(corner.x)} ${fmt(corner.y)} ${fmt(after.x)} ${fmt(after.y)}`
    );
  }
  const last = points[points.length - 1];
  parts.push(`L ${fmt(last.x)} ${fmt(last.y)}`);
  return parts.join(" ");
}

/**
 * Pull a route's end back so a filled arrowhead's tip lands exactly on the
 * shape rather than the line poking through it.
 */
export function trimRoute(route, { start = 0, end = 0 } = {}) {
  const points = route.points.map((point) => ({ ...point }));
  const curve = route.curve ? route.curve.map((segment) => ({ ...segment })) : null;
  const pull = (from, to, amount) => {
    const length = distance(from, to);
    if (!length || amount <= 0) return to;
    const ratio = Math.max(0, (length - Math.min(amount, length - 0.5)) / length);
    return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
  };
  if (points.length >= 2 && end) {
    const last = points.length - 1;
    points[last] = pull(points[last - 1], points[last], end);
    if (curve?.length)
      curve[curve.length - 1].to = pull(
        curve[curve.length - 1].c2,
        curve[curve.length - 1].to,
        end
      );
  }
  if (points.length >= 2 && start) {
    points[0] = pull(points[1], points[0], start);
    if (curve?.length) curve[0].from = pull(curve[0].c1, curve[0].from, start);
  }
  return { points, curve };
}

/** Direction of travel at each end of a route, for drawing arrowheads. */
export function endAngles(route) {
  const { points, curve } = route;
  if (points.length < 2) return { start: 0, end: 0 };
  if (curve?.length) {
    const first = curve[0];
    const last = curve[curve.length - 1];
    const startFrom = distance(first.c1, first.from) > 0.5 ? first.c1 : first.to;
    const endFrom = distance(last.c2, last.to) > 0.5 ? last.c2 : last.from;
    return {
      start: Math.atan2(first.from.y - startFrom.y, first.from.x - startFrom.x),
      end: Math.atan2(last.to.y - endFrom.y, last.to.x - endFrom.x),
    };
  }
  const a = points[0];
  const b = points[1];
  const y = points[points.length - 2];
  const z = points[points.length - 1];
  return { start: Math.atan2(a.y - b.y, a.x - b.x), end: Math.atan2(z.y - y.y, z.x - y.x) };
}

/**
 * Arrowhead geometry at `tip`, pointing along `angle`.
 * @returns {{d: string, filled: boolean, inset: number}|null}
 *   `inset` is how far to trim the line so it meets the head cleanly.
 */
export function arrowhead(kind, tip, angle, strokeWidth = 1.5) {
  if (!kind || kind === "none") return null;
  const size = 7 + strokeWidth * 2.2;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (along, across) => ({
    x: tip.x - cos * along - sin * across,
    y: tip.y - sin * along + cos * across,
  });
  const p = (point) => `${fmt(point.x)} ${fmt(point.y)}`;
  switch (kind) {
    case "open": {
      const a = at(size, size * 0.55);
      const b = at(size, -size * 0.55);
      return { d: `M ${p(a)} L ${p(tip)} L ${p(b)}`, filled: false, inset: 0 };
    }
    case "diamond": {
      const back = at(size * 1.6, 0);
      return {
        d: `M ${p(tip)} L ${p(at(size * 0.8, size * 0.5))} L ${p(back)} L ${p(at(size * 0.8, -size * 0.5))} Z`,
        filled: true,
        inset: size * 1.5,
      };
    }
    case "circle": {
      const r = size * 0.42;
      const center = at(r, 0);
      return {
        d: `M ${p({ x: center.x + r, y: center.y })} A ${fmt(r)} ${fmt(r)} 0 1 0 ${p({ x: center.x - r, y: center.y })} A ${fmt(r)} ${fmt(r)} 0 1 0 ${p({ x: center.x + r, y: center.y })} Z`,
        filled: true,
        inset: r * 2 - 0.5,
      };
    }
    case "one":
    case "many":
    case "oneMany":
    case "zeroMany":
    case "zeroOne":
      return erEnd(kind, tip, at, p, strokeWidth);
    default: {
      const a = at(size, size * 0.5);
      const b = at(size, -size * 0.5);
      return { d: `M ${p(tip)} L ${p(a)} L ${p(b)} Z`, filled: true, inset: size * 0.85 };
    }
  }
}

/**
 * Crow's-foot (information engineering) ends: a bar means "one", the foot
 * means "many", and a circle means the relationship is optional. Drawn as
 * strokes on top of the line, which runs all the way to the shape.
 */
function erEnd(kind, tip, at, p, strokeWidth) {
  const spread = 7 + strokeWidth;
  const foot = 13 + strokeWidth;
  const parts = [];
  const bar = (distance) => {
    const a = at(distance, spread * 0.85);
    const b = at(distance, -spread * 0.85);
    parts.push(`M ${p(a)} L ${p(b)}`);
  };
  const crow = () => {
    const heel = at(foot, 0);
    parts.push(
      `M ${p(heel)} L ${p(at(0, spread))} M ${p(heel)} L ${p(tip)} M ${p(heel)} L ${p(at(0, -spread))}`
    );
  };
  let circleAt = null;
  if (kind === "one") {
    bar(7);
    bar(12);
  } else if (kind === "many") {
    crow();
  } else if (kind === "oneMany") {
    crow();
    bar(foot + 4);
  } else if (kind === "zeroMany") {
    crow();
    circleAt = foot + 6;
  } else if (kind === "zeroOne") {
    bar(7);
    circleAt = 16;
  }
  let circle = "";
  if (circleAt) {
    const r = 4.2;
    const center = at(circleAt, 0);
    circle = `M ${p({ x: center.x + r, y: center.y })} A ${r} ${r} 0 1 0 ${p({ x: center.x - r, y: center.y })} A ${r} ${r} 0 1 0 ${p({ x: center.x + r, y: center.y })} Z`;
  }
  return { d: parts.join(" "), circle, filled: false, inset: 0, er: true };
}

/** Where a connector's label sits: a fraction of the way along its route. */
export function labelPoint(route, t = 0.5) {
  return pointAlongPolyline(route.points, t);
}
