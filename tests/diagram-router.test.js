import { describe, expect, it } from "vitest";
import {
  arrowhead,
  candidateSides,
  connectorPathData,
  orthogonalPath,
  routeConnector,
  routeKey,
  trimRoute,
} from "../src/diagram/router.js";

function isOrthogonal(points) {
  return points.every(
    (point, index) =>
      index === 0 || point.x === points[index - 1].x || point.y === points[index - 1].y
  );
}

function crosses(points, rect) {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const minX = Math.min(a.x, b.x);
    const maxX = Math.max(a.x, b.x);
    const minY = Math.min(a.y, b.y);
    const maxY = Math.max(a.y, b.y);
    if (maxX > rect.x && minX < rect.x + rect.w && maxY > rect.y && minY < rect.y + rect.h)
      return true;
  }
  return false;
}

describe("orthogonal routing", () => {
  const source = { x: 0, y: 0, w: 60, h: 40 };
  const target = { x: 300, y: 0, w: 60, h: 40 };

  it("draws a straight run between aligned shapes", () => {
    const { points } = routeConnector({ source, target });
    expect(points).toEqual([
      { x: 60, y: 20 },
      { x: 300, y: 20 },
    ]);
  });

  it("routes around a shape in the way instead of through it", () => {
    const blocker = { x: 150, y: -30, w: 40, h: 100 };
    const { points } = routeConnector({ source, target, obstacles: [blocker] });
    expect(isOrthogonal(points)).toBe(true);
    expect(crosses(points, blocker)).toBe(false);
    expect(points[0]).toEqual({ x: 60, y: 20 });
    expect(points[points.length - 1]).toEqual({ x: 300, y: 20 });
  });

  it("uses an L-shape for diagonal neighbours", () => {
    const { points } = routeConnector({ source, target: { x: 300, y: 200, w: 60, h: 40 } });
    expect(isOrthogonal(points)).toBe(true);
    expect(points.length).toBe(3);
  });

  it("honours fixed ports", () => {
    const { points } = routeConnector({ source, target, fromPort: "s", toPort: "s" });
    expect(points[0]).toEqual({ x: 30, y: 40 });
    expect(points[points.length - 1]).toEqual({ x: 330, y: 40 });
    expect(Math.max(...points.map((p) => p.y))).toBeGreaterThan(40);
  });

  it("drops the south port below a label", () => {
    const { points } = routeConnector({
      source: { x: 0, y: 0, w: 48, h: 48 },
      target: { x: 0, y: 300, w: 48, h: 48 },
      sourceDepth: 30,
    });
    expect(points[0]).toEqual({ x: 24, y: 78 });
  });

  it("goes through hand-placed waypoints with elbows", () => {
    const { points } = routeConnector({
      source,
      target,
      waypoints: [{ x: 150, y: 150 }],
    });
    expect(isOrthogonal(points)).toBe(true);
    expect(points).toContainEqual({ x: 150, y: 150 });
  });

  it("finds a path through a gap in a wall", () => {
    const path = orthogonalPath({ x: 0, y: 0 }, { x: 200, y: 0 }, [
      { x: 90, y: -300, w: 20, h: 280 },
      { x: 90, y: 20, w: 20, h: 280 },
    ]);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ]);
  });
});

describe("free ends, straight, and curved connectors", () => {
  it("routes a dangling connector to a point", () => {
    const { points } = routeConnector({
      source: { x: 0, y: 0, w: 40, h: 40 },
      targetPoint: { x: 200, y: 100 },
    });
    expect(points[points.length - 1]).toEqual({ x: 200, y: 100 });
  });

  it("clips straight connectors to the outlines", () => {
    const { points } = routeConnector({
      routing: "straight",
      source: { x: 0, y: 0, w: 100, h: 100 },
      target: { x: 300, y: 0, w: 100, h: 100 },
    });
    expect(points).toEqual([
      { x: 100, y: 50 },
      { x: 300, y: 50 },
    ]);
  });

  it("builds cubic segments for curved connectors", () => {
    const route = routeConnector({
      routing: "curved",
      source: { x: 0, y: 0, w: 40, h: 40 },
      target: { x: 300, y: 200, w: 40, h: 40 },
    });
    expect(route.curve).toHaveLength(1);
    expect(connectorPathData(route)).toMatch(/^M [\d.]+ [\d.]+ C /);
  });
});

describe("side choice and output", () => {
  it("prefers the facing sides first", () => {
    expect(candidateSides({ x: 0, y: 0, w: 10, h: 10 }, { x: 100, y: 0, w: 10, h: 10 })[0]).toEqual(
      ["e", "w"]
    );
    expect(candidateSides({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 100, w: 10, h: 10 })[0]).toEqual(
      ["s", "n"]
    );
  });

  it("rounds corners with quadratic curves", () => {
    const d = connectorPathData({
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
      ],
    });
    expect(d).toContain("Q 100 0");
  });

  it("trims the line so a filled arrowhead meets the shape", () => {
    const head = arrowhead("arrow", { x: 100, y: 0 }, 0, 1.5);
    const trimmed = trimRoute(
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      },
      { end: head.inset }
    );
    expect(trimmed.points[1].x).toBeLessThan(100);
    expect(arrowhead("none", { x: 0, y: 0 }, 0)).toBeNull();
  });

  it("keys routes on nearby obstacles only", () => {
    const base = { source: { x: 0, y: 0, w: 10, h: 10 }, target: { x: 100, y: 0, w: 10, h: 10 } };
    const far = routeKey({ ...base, obstacles: [{ x: 5000, y: 5000, w: 10, h: 10 }] });
    const none = routeKey({ ...base, obstacles: [] });
    const near = routeKey({ ...base, obstacles: [{ x: 50, y: 0, w: 10, h: 10 }] });
    expect(far).toBe(none);
    expect(near).not.toBe(none);
  });
});
