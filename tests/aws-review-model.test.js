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

describe("topology-aware security scoring", () => {
  const guarded = {
    nodes: [
      { id: "waf", name: "Edge WAF", serviceName: "AWS WAF" },
      { id: "api", name: "Public API", serviceName: "Amazon API Gateway" },
      { id: "fn", name: "Handler", serviceName: "AWS Lambda" },
      { id: "auth", name: "Users", serviceName: "Amazon Cognito" },
    ],
    connections: [
      { id: "c1", from: "waf", to: "api", encrypted: true },
      { id: "c2", from: "api", to: "fn", encrypted: true },
      { id: "c3", from: "api", to: "auth", encrypted: true },
    ],
  };

  it("credits a WAF that untrusted traffic actually passes through", () => {
    expect(scoreAwsArchitecture(guarded).security).toBeGreaterThanOrEqual(80);
  });

  it("does not credit a WAF that is wired to nothing", () => {
    const orphaned = {
      ...guarded,
      // Same nodes, but the WAF is no longer on the path.
      connections: guarded.connections.filter((c) => c.id !== "c1"),
    };
    expect(scoreAwsArchitecture(orphaned).security).toBeLessThan(
      scoreAwsArchitecture(guarded).security
    );
    const check = reviewAwsChecks(orphaned).find((c) => c.id === "trust-guard-off-path");
    expect(check).toEqual(
      expect.objectContaining({ tone: "fail", target: { kind: "node", id: "waf" } })
    );
  });

  it("reports a trust dimension alongside the other four", () => {
    const analysis = scoreAwsArchitecture(guarded);
    expect(analysis.trust).toBeGreaterThan(0);
    expect(analysis.trust).toBeLessThanOrEqual(100);
  });

  it("passes the trust-boundary check when every crossing holds", () => {
    const check = reviewAwsChecks(guarded).find((c) => c.id === "trust-boundaries");
    expect(check.tone).toBe("pass");
  });

  it("asks for zones when a multi-service design declares none", () => {
    const flat = {
      nodes: [
        { id: "a", name: "One", serviceName: "AWS Lambda" },
        { id: "b", name: "Two", serviceName: "AWS Lambda" },
      ],
      connections: [{ id: "c", from: "a", to: "b", encrypted: true }],
    };
    const check = reviewAwsChecks(flat).find((c) => c.id === "trust-boundaries");
    expect(check.tone).toBe("warn");
  });

  it("raises a critical finding for a datastore on the internet", () => {
    const exposed = {
      nodes: [
        { id: "net", name: "Callers", serviceName: "Internet", zone: "internet" },
        { id: "db", name: "Orders", serviceName: "Amazon RDS" },
      ],
      connections: [{ id: "c", from: "net", to: "db", encrypted: true }],
    };
    const check = reviewAwsChecks(exposed).find((c) => c.id.startsWith("trust-exposed-data"));
    expect(check).toEqual(
      expect.objectContaining({ tone: "fail", target: { kind: "node", id: "db" } })
    );
  });
});
