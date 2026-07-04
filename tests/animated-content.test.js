import { describe, it, expect } from "vitest";
import { staggerDelays } from "../src/animated-content.js";

describe("staggerDelays", () => {
  it("produces evenly spaced delays from the base", () => {
    expect(staggerDelays(4, 0, 100)).toEqual([0, 100, 200, 300]);
    expect(staggerDelays(3, 50, 90)).toEqual([50, 140, 230]);
  });

  it("caps the multiplier so long lists don't wait forever", () => {
    expect(staggerDelays(10, 0, 100, 3)).toEqual([0, 100, 200, 300, 300, 300, 300, 300, 300, 300]);
  });

  it("handles empty or invalid counts", () => {
    expect(staggerDelays(0)).toEqual([]);
    expect(staggerDelays(-5)).toEqual([]);
  });
});
