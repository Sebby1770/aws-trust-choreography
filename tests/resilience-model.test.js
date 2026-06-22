import { describe, it, expect } from "vitest";
import {
  scenarios,
  failureModes,
  clampNumber,
  deriveComposedState,
} from "../src/resilience-model.js";

describe("clampNumber", () => {
  it("returns the value when in range", () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
  });

  it("clamps below the minimum and above the maximum", () => {
    expect(clampNumber(-3, 0, 10)).toBe(0);
    expect(clampNumber(42, 0, 10)).toBe(10);
  });
});

describe("deriveComposedState — baseline (no faults)", () => {
  const composed = deriveComposedState("steady");

  it("mirrors the scenario telemetry when nothing is injected", () => {
    expect(composed.routeHealth).toBe(87);
    expect(composed.fallbackReady).toBe(58);
    expect(composed.dataDurability).toBeCloseTo(99.95, 2);
    expect(composed.recoveryMinutes).toBe(7);
  });

  it("reports a contained blast radius and no impacted nodes", () => {
    expect(composed.blastRadius).toBe("Contained");
    expect(composed.impactedNodes.size).toBe(0);
    expect(composed.summary).toBe("No faults injected");
  });

  it("identifies the lowest-scoring node as weakest", () => {
    // Manual approval lane is 58 in steady state — the lowest.
    expect(composed.weakestNode).toBe("Manual approval lane");
    expect(composed.weakestScore).toBe(58);
  });

  it("falls back to the steady scenario for unknown names", () => {
    expect(deriveComposedState("nope").routeHealth).toBe(deriveComposedState("steady").routeHealth);
  });
});

describe("deriveComposedState — single fault", () => {
  it("applies score deltas and marks impacted nodes", () => {
    const composed = deriveComposedState("steady", ["identity"]);
    // IAM trust broker: 64 - 30 = 34
    expect(composed.scores["IAM trust broker"]).toBe(34);
    expect(composed.impactedNodes.has("IAM trust broker")).toBe(true);
    expect(composed.activeModeObjects).toHaveLength(1);
  });

  it("classifies a wide single fault as Domain-wide", () => {
    // identity touches 4 nodes -> Domain-wide
    expect(deriveComposedState("steady", ["identity"]).blastRadius).toBe("Domain-wide");
  });

  it("classifies a narrow single fault as Localized", () => {
    // data touches 3 nodes -> Localized
    expect(deriveComposedState("steady", ["data"]).blastRadius).toBe("Localized");
  });

  it("summarizes the injected fault", () => {
    const composed = deriveComposedState("steady", ["edge"]);
    expect(composed.summary).toBe("1 fault injected: Edge flood");
    expect(composed.recommendation).toBe(failureModes.edge.recommendation);
  });
});

describe("deriveComposedState — stacked faults", () => {
  it("classifies two faults as Cross-domain", () => {
    expect(deriveComposedState("steady", ["edge", "data"]).blastRadius).toBe("Cross-domain");
  });

  it("classifies three or more faults as Systemic", () => {
    expect(deriveComposedState("steady", ["edge", "data", "workflow"]).blastRadius).toBe(
      "Systemic"
    );
  });

  it("accumulates recovery minutes and joins recommendations", () => {
    const composed = deriveComposedState("steady", ["edge", "data"]);
    // base 7 + edge 5 + data 10 = 22
    expect(composed.recoveryMinutes).toBe(22);
    expect(composed.summary).toBe("2 faults injected: Edge flood + Data lag");
    expect(composed.recommendation).toContain(failureModes.edge.recommendation);
    expect(composed.recommendation).toContain(failureModes.data.recommendation);
  });

  it("accepts a Set of failure ids", () => {
    const composed = deriveComposedState("steady", new Set(["edge", "data"]));
    expect(composed.activeModeObjects).toHaveLength(2);
  });
});

describe("deriveComposedState — bounds and robustness", () => {
  it("keeps scores within [12, 99]", () => {
    const composed = deriveComposedState("identity", ["identity", "workflow", "data", "edge"]);
    Object.values(composed.scores).forEach((score) => {
      expect(score).toBeGreaterThanOrEqual(12);
      expect(score).toBeLessThanOrEqual(99);
    });
  });

  it("keeps durability within [95, 99.99] and recovery within [1, 99]", () => {
    const composed = deriveComposedState("recovery", ["data", "data"]);
    expect(composed.dataDurability).toBeGreaterThanOrEqual(95);
    expect(composed.dataDurability).toBeLessThanOrEqual(99.99);
    expect(composed.recoveryMinutes).toBeGreaterThanOrEqual(1);
    expect(composed.recoveryMinutes).toBeLessThanOrEqual(99);
  });

  it("ignores unknown failure ids", () => {
    const composed = deriveComposedState("steady", ["edge", "bogus"]);
    expect(composed.activeModeObjects).toHaveLength(1);
  });

  it("does not mutate the source scenario scores", () => {
    const before = { ...scenarios.steady.scores };
    deriveComposedState("steady", ["identity", "edge"]);
    expect(scenarios.steady.scores).toEqual(before);
  });
});
