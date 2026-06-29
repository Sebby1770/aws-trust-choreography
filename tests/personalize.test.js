import { describe, it, expect } from "vitest";
import {
  sanitizeScore,
  normalizeProfile,
  emptyProfile,
  isProfileEmpty,
  encodeProfile,
  decodeProfile,
  readSharedProfile,
} from "../src/personalize.js";

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

describe("isProfileEmpty", () => {
  it("is true for an empty profile and false once customized", () => {
    expect(isProfileEmpty(emptyProfile())).toBe(true);
    expect(isProfileEmpty({ title: "Mine" })).toBe(false);
    expect(isProfileEmpty({ scores: { "IAM trust broker": 90 } })).toBe(false);
  });
});

describe("encodeProfile / decodeProfile", () => {
  it("round-trips a customized profile", () => {
    const profile = {
      title: "Acme Payments Resilience",
      lede: "How Acme stays up",
      names: { "CloudFront edge": "Acme Edge (CDN)" },
      scores: { "CloudFront edge": 97 },
    };
    const decoded = decodeProfile(encodeProfile(profile));
    expect(decoded.title).toBe(profile.title);
    expect(decoded.lede).toBe(profile.lede);
    expect(decoded.names["CloudFront edge"]).toBe("Acme Edge (CDN)");
    expect(decoded.scores["CloudFront edge"]).toBe(97);
  });

  it("produces a URL-safe string (no +, /, or =)", () => {
    const encoded = encodeProfile({ title: "A/B + test = ✓ 日本語" });
    expect(encoded).not.toMatch(/[+/=]/);
    expect(decodeProfile(encoded).title).toBe("A/B + test = ✓ 日本語");
  });

  it("returns an empty profile for garbage input", () => {
    expect(isProfileEmpty(decodeProfile("!!!not-base64!!!"))).toBe(true);
  });
});

describe("readSharedProfile", () => {
  const win = (hash) => ({ location: { hash } });

  it("reads a profile from the p parameter", () => {
    const encoded = encodeProfile({ title: "Shared Atlas" });
    const profile = readSharedProfile(win(`#scenario=surge&p=${encoded}`));
    expect(profile.title).toBe("Shared Atlas");
  });

  it("returns null when there is no p parameter", () => {
    expect(readSharedProfile(win("#scenario=surge"))).toBeNull();
  });

  it("returns null for an empty shared profile", () => {
    expect(readSharedProfile(win(`#p=${encodeProfile(emptyProfile())}`))).toBeNull();
  });
});
