import { describe, it, expect } from "vitest";
import { encodeState, decodeState } from "../src/url-state.js";

describe("encodeState", () => {
  it("encodes scenario, faults, and node", () => {
    const encoded = encodeState({
      scenario: "surge",
      failures: ["edge", "data"],
      node: "IAM trust broker",
    });
    const params = new URLSearchParams(encoded);
    expect(params.get("scenario")).toBe("surge");
    expect(params.get("faults")).toBe("edge,data");
    expect(params.get("node")).toBe("IAM trust broker");
  });

  it("omits empty fields", () => {
    expect(encodeState({ scenario: "steady" })).toBe("scenario=steady");
    expect(encodeState({})).toBe("");
  });

  it("accepts a Set of failures and drops falsy entries", () => {
    const encoded = encodeState({ failures: new Set(["edge", ""]) });
    expect(encoded).toBe("faults=edge");
  });
});

describe("decodeState", () => {
  it("round-trips with encodeState", () => {
    const state = { scenario: "recovery", failures: ["workflow"], node: "Aurora data mesh" };
    const decoded = decodeState(encodeState(state));
    expect(decoded.scenario).toBe("recovery");
    expect(decoded.failures).toEqual(["workflow"]);
    expect(decoded.node).toBe("Aurora data mesh");
  });

  it("tolerates a leading hash", () => {
    expect(decodeState("#scenario=surge").scenario).toBe("surge");
  });

  it("drops unknown scenarios", () => {
    expect(decodeState("scenario=hacker").scenario).toBeNull();
  });

  it("returns sane defaults for an empty hash", () => {
    const decoded = decodeState("");
    expect(decoded.scenario).toBeNull();
    expect(decoded.failures).toEqual([]);
    expect(decoded.node).toBeNull();
  });

  it("trims and filters fault lists", () => {
    expect(decodeState("faults=edge, data ,").failures).toEqual(["edge", "data"]);
  });
});
