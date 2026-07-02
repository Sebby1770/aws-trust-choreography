import { describe, it, expect } from "vitest";
import { deriveComposedState, computeResilienceIndex } from "../src/resilience-model.js";

const indexFor = (scenario, faults = []) =>
  computeResilienceIndex(deriveComposedState(scenario, faults));

describe("computeResilienceIndex", () => {
  it("returns a 0–100 integer score with a valid grade and tone", () => {
    const { score, grade, tone } = indexFor("steady");
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"]).toContain(grade);
    expect(["strong", "watch", "strained"]).toContain(tone);
  });

  it("rates the recovery drill higher than steady state", () => {
    expect(indexFor("recovery").score).toBeGreaterThan(indexFor("steady").score);
  });

  it("drops the score as faults are injected", () => {
    const clean = indexFor("steady").score;
    const oneFault = indexFor("steady", ["identity"]).score;
    const manyFaults = indexFor("steady", ["identity", "data", "edge", "workflow"]).score;
    expect(oneFault).toBeLessThan(clean);
    expect(manyFaults).toBeLessThan(oneFault);
  });

  it("assigns grades by threshold and tanks a fully degraded system", () => {
    const wrecked = indexFor("identity", ["identity", "data", "edge", "workflow"]);
    expect(wrecked.score).toBeLessThan(55);
    expect(wrecked.grade).toBe("F");
    expect(wrecked.tone).toBe("strained");
  });

  it("handles a missing composed state defensively", () => {
    expect(computeResilienceIndex(null)).toEqual({ score: 0, grade: "—", tone: "strained" });
  });
});
