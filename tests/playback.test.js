import { describe, it, expect } from "vitest";
import { PLAYBACK_SCRIPT, PLAYBACK_LENGTH, playbackStep } from "../src/playback.js";
import { scenarios, failureModes, nodeHints } from "../src/resilience-model.js";

describe("PLAYBACK_SCRIPT", () => {
  it("has steps and a matching length", () => {
    expect(PLAYBACK_SCRIPT.length).toBeGreaterThan(0);
    expect(PLAYBACK_LENGTH).toBe(PLAYBACK_SCRIPT.length);
  });

  it("only references scenarios, faults, and nodes that exist in the model", () => {
    for (const step of PLAYBACK_SCRIPT) {
      expect(scenarios[step.scenario], `scenario ${step.scenario}`).toBeDefined();
      expect(nodeHints[step.node], `node ${step.node}`).toBeDefined();
      for (const fault of step.faults) {
        expect(failureModes[fault], `fault ${fault}`).toBeDefined();
      }
    }
  });

  it("gives every step narration, a title, and a positive duration", () => {
    for (const step of PLAYBACK_SCRIPT) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(step.narration.length).toBeGreaterThan(0);
      expect(step.ms).toBeGreaterThan(0);
    }
  });

  it("ends on the recovery scenario with no active faults", () => {
    const last = PLAYBACK_SCRIPT[PLAYBACK_SCRIPT.length - 1];
    expect(last.scenario).toBe("recovery");
    expect(last.faults).toEqual([]);
  });
});

describe("playbackStep", () => {
  it("returns the step at a valid index", () => {
    expect(playbackStep(0)).toBe(PLAYBACK_SCRIPT[0]);
  });

  it("returns null out of range or for non-integers", () => {
    expect(playbackStep(-1)).toBeNull();
    expect(playbackStep(PLAYBACK_LENGTH)).toBeNull();
    expect(playbackStep(1.5)).toBeNull();
  });
});
