import { describe, it, expect } from "vitest";
import { sanitizeScore, normalizeProfile, emptyProfile } from "../src/personalize.js";

describe("sanitizeScore", () => {
  it("clamps to [12, 99] and rounds", () => {
    expect(sanitizeScore(50.4)).toBe(50);
    expect(sanitizeScore(5)).toBe(12);
    expect(sanitizeScore(120)).toBe(99);
    expect(sanitizeScore("73")).toBe(73);
  });

  it("returns null for non-numbers", () => {
    expect(sanitizeScore("abc")).toBeNull();
    expect(sanitizeScore(NaN)).toBeNull();
  });
});

describe("normalizeProfile", () => {
  it("returns an empty profile for junk input", () => {
    expect(normalizeProfile(null)).toEqual(emptyProfile());
    expect(normalizeProfile("nope")).toEqual(emptyProfile());
  });

  it("keeps valid title/lede and trims length", () => {
    const p = normalizeProfile({ title: "My System", lede: "x".repeat(500) });
    expect(p.title).toBe("My System");
    expect(p.lede.length).toBe(240);
  });

  it("keeps non-empty name overrides and drops blanks", () => {
    const p = normalizeProfile({ names: { "CloudFront edge": "Edge", "IAM trust broker": "  " } });
    expect(p.names["CloudFront edge"]).toBe("Edge");
    expect(p.names["IAM trust broker"]).toBeUndefined();
  });

  it("sanitizes score overrides and drops invalid ones", () => {
    const p = normalizeProfile({ scores: { "CloudFront edge": 150, "IAM trust broker": "bad" } });
    expect(p.scores["CloudFront edge"]).toBe(99);
    expect(p.scores["IAM trust broker"]).toBeUndefined();
  });
});
