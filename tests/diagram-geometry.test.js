import { describe, expect, it } from "vitest";
import {
  alignRects,
  computeSnap,
  distributeRects,
  nearestOnPolyline,
  nearestSide,
  perimeterPoint,
  pointAlongPolyline,
  rectFromPoints,
  resizeRect,
  simplifyPolyline,
  unionRects,
} from "../src/diagram/geometry.js";

describe("rect helpers", () => {
  it("unions rects and ignores empty input", () => {
    expect(unionRects([])).toBeNull();
    expect(
      unionRects([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: -5, w: 5, h: 5 },
      ])
    ).toEqual({ x: 0, y: -5, w: 25, h: 15 });
  });

  it("builds a rect from corners dragged in any direction", () => {
    expect(rectFromPoints({ x: 50, y: 40 }, { x: 10, y: 5 })).toEqual({
      x: 10,
      y: 5,
      w: 40,
      h: 35,
    });
  });

  it("finds the side of a rect facing a point", () => {
    const rect = { x: 0, y: 0, w: 100, h: 40 };
    expect(nearestSide(rect, { x: 300, y: 10 })).toBe("e");
    expect(nearestSide(rect, { x: 50, y: 400 })).toBe("s");
    expect(nearestSide(rect, { x: -300, y: 20 })).toBe("w");
    expect(nearestSide(rect, { x: 50, y: -100 })).toBe("n");
  });
});

describe("perimeterPoint", () => {
  it("clips a ray to a rect, an ellipse, and a diamond", () => {
    const rect = { x: 0, y: 0, w: 100, h: 100 };
    expect(perimeterPoint(rect, { x: 500, y: 50 })).toEqual({ x: 100, y: 50 });
    const ellipse = perimeterPoint(rect, { x: 500, y: 500 }, "ellipse");
    expect(Math.hypot(ellipse.x - 50, ellipse.y - 50)).toBeCloseTo(50, 5);
    const diamond = perimeterPoint(rect, { x: 500, y: 500 }, "diamond");
    expect(diamond.x).toBeCloseTo(75, 5);
  });
});

describe("polylines", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
  ];

  it("walks a fraction of the way along", () => {
    expect(pointAlongPolyline(line, 0.5)).toMatchObject({ x: 100, y: 0 });
    expect(pointAlongPolyline(line, 0.75)).toMatchObject({ x: 100, y: 50 });
  });

  it("finds the nearest point and its fraction", () => {
    const near = nearestOnPolyline(line, { x: 130, y: 50 });
    expect(near).toMatchObject({ x: 100, y: 50, distance: 30 });
    expect(near.t).toBeCloseTo(0.75, 5);
  });

  it("drops duplicate and collinear points but keeps real corners", () => {
    expect(
      simplifyPolyline([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 80 },
      ])
    ).toEqual([
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ]);
  });
});

describe("resizeRect", () => {
  const rect = { x: 10, y: 10, w: 100, h: 50 };

  it("pins the opposite corner", () => {
    expect(resizeRect(rect, "se", 20, 10)).toEqual({ x: 10, y: 10, w: 120, h: 60 });
    expect(resizeRect(rect, "nw", 20, 10)).toEqual({ x: 30, y: 20, w: 80, h: 40 });
  });

  it("never collapses below the minimum", () => {
    expect(resizeRect(rect, "e", -500, 0, { minimum: 12 }).w).toBe(12);
  });

  it("keeps the aspect ratio for icons", () => {
    const icon = { x: 0, y: 0, w: 48, h: 48 };
    const next = resizeRect(icon, "se", 30, 2, { keepAspect: true });
    expect(next.w).toBe(next.h);
    expect(next.w).toBe(78);
  });
});

describe("align and distribute", () => {
  const rects = [
    { x: 0, y: 0, w: 20, h: 20 },
    { x: 50, y: 40, w: 40, h: 10 },
    { x: 200, y: 10, w: 10, h: 30 },
  ];

  it("aligns to the group bounds", () => {
    expect(alignRects(rects, "left").map((p) => p.x)).toEqual([0, 0, 0]);
    expect(alignRects(rects, "right").map((p) => p.x)).toEqual([190, 170, 200]);
    expect(alignRects(rects, "middle").map((p) => p.y)).toEqual([15, 20, 10]);
  });

  it("distributes equal gaps while pinning the ends", () => {
    const next = distributeRects(rects, "horizontal");
    expect(next[0].x).toBe(0);
    expect(next[2].x).toBe(200);
    const gapA = next[1].x - (next[0].x + 20);
    const gapB = next[2].x - (next[1].x + 40);
    expect(gapA).toBeCloseTo(gapB, 5);
  });
});

describe("computeSnap (smart guides)", () => {
  it("snaps an edge to a neighbour within the threshold and reports a guide", () => {
    const snap = computeSnap({ x: 103, y: 300, w: 50, h: 50 }, [{ x: 100, y: 0, w: 50, h: 50 }], {
      threshold: 6,
    });
    expect(snap.dx).toBe(-3);
    expect(snap.guides).toHaveLength(1);
    expect(snap.guides[0]).toMatchObject({ axis: "x", at: 100 });
  });

  it("falls back to the grid when nothing is close", () => {
    const snap = computeSnap({ x: 23, y: 47, w: 10, h: 10 }, [], { gridSize: 10, snapGrid: true });
    expect(snap.dx).toBe(-3);
    expect(snap.dy).toBe(3);
  });
});
