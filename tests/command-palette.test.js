import { describe, it, expect } from "vitest";
import { fuzzyScore, rankCommands } from "../src/command-palette.js";

describe("fuzzyScore", () => {
  it("returns a positive score for an empty query (everything matches)", () => {
    expect(fuzzyScore("", "anything")).toBeGreaterThan(0);
  });

  it("ranks exact > prefix > substring > subsequence > no-match", () => {
    const exact = fuzzyScore("edge flood", "edge flood");
    const prefix = fuzzyScore("edge", "edge flood");
    const substring = fuzzyScore("flood", "edge flood");
    const subseq = fuzzyScore("efl", "edge flood");
    const none = fuzzyScore("zzz", "edge flood");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(0);
    expect(none).toBe(0);
  });

  it("is case-insensitive", () => {
    expect(fuzzyScore("IAM", "iam trust broker")).toBeGreaterThan(0);
  });

  it("returns 0 when query chars are not a subsequence", () => {
    expect(fuzzyScore("xyz", "scenario")).toBe(0);
  });
});

describe("rankCommands", () => {
  const commands = [
    { label: "Scenario — Steady state", keywords: "scenario" },
    { label: "Inject fault — Edge flood", keywords: "fault failure" },
    { label: "Inspect — IAM trust broker", keywords: "node" },
    { label: "Theme — dark", keywords: "appearance" },
  ];

  it("returns all commands unchanged for an empty query", () => {
    expect(rankCommands(commands, "")).toHaveLength(4);
    expect(rankCommands(commands, "  ")).toHaveLength(4);
  });

  it("filters to matching commands", () => {
    const result = rankCommands(commands, "edge");
    expect(result).toHaveLength(1);
    expect(result[0].label).toContain("Edge flood");
  });

  it("matches on keywords as well as labels", () => {
    const result = rankCommands(commands, "appearance");
    expect(result[0].label).toBe("Theme — dark");
  });

  it("orders the best label match first", () => {
    const result = rankCommands(commands, "scenario");
    expect(result[0].label).toContain("Steady");
  });

  it("returns nothing for an unmatched query", () => {
    expect(rankCommands(commands, "qqqq")).toHaveLength(0);
  });
});
