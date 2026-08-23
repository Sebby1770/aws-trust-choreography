import { describe, expect, it } from "vitest";
import {
  reviewAwsArchitecture,
  reviewAwsChecks,
  scoreAwsArchitecture,
} from "../src/aws-review-model.js";

function architecture(overrides = {}) {
  return {
    name: "Payments API",
    region: "ap-southeast-2",
    nodes: [
      {
        id: "edge",
        name: "Public API",
        serviceName: "Amazon API Gateway",
        environment: "Production",
      },
      {
        id: "worker",
        name: "Processor",
        serviceName: "AWS Lambda",
        environment: "Production",
      },
    ],
    connections: [{ id: "path-1", from: "edge", to: "worker", encrypted: true, type: "request" }],
    ...overrides,
  };
}

describe("AWS design review model", () => {
  it("handles an empty or malformed diagram without throwing", () => {
    const result = reviewAwsArchitecture({ nodes: "bad", connections: null });
    expect(result.analysis.overall).toBeGreaterThanOrEqual(0);
    expect(result.checks.length).toBeGreaterThan(0);
  });

  it("returns stable dimensions and actionable missing-control findings", () => {
    const result = reviewAwsArchitecture(architecture());
    expect(result.analysis).toEqual(
      expect.objectContaining({
        security: expect.any(Number),
        reliability: expect.any(Number),
        observability: expect.any(Number),
        recovery: expect.any(Number),
        overall: expect.any(Number),
      })
    );
    expect(result.checks.find((check) => check.id === "observability")).toEqual(
      expect.objectContaining({ tone: "warn", target: { kind: "library", query: "CloudWatch" } })
    );
    expect(result.checks.find((check) => check.id === "identity")).toEqual(
      expect.objectContaining({ tone: "warn", target: { kind: "library", query: "IAM" } })
    );
  });

  it("targets the first explicitly unencrypted connection", () => {
    const state = architecture({
      connections: [
        { id: "plain-path", from: "edge", to: "worker", encrypted: false, type: "request" },
      ],
    });
    const encryption = reviewAwsChecks(state).find((check) => check.id === "encryption");
    expect(encryption).toEqual(
      expect.objectContaining({
        tone: "fail",
        target: { kind: "connection", id: "plain-path", field: "encrypted" },
      })
    );
  });

  it("does not mutate source architecture state", () => {
    const state = architecture();
    const before = JSON.stringify(state);
    scoreAwsArchitecture(state);
    reviewAwsChecks(state);
    expect(JSON.stringify(state)).toBe(before);
  });
});
