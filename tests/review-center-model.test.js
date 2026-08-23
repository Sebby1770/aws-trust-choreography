import { describe, expect, it } from "vitest";
import { NETWORK_TEMPLATES } from "../src/network-lab.js";
import { buildReviewMarkdown, createReviewSnapshot } from "../src/review-center.js";

const awsState = {
  name: "Serverless API",
  region: "ap-southeast-2",
  nodes: [
    {
      id: "api",
      name: "Public API",
      serviceName: "Amazon API Gateway",
      environment: "Production",
      criticality: "high",
    },
    {
      id: "lambda",
      name: "Processor",
      serviceName: "AWS Lambda",
      environment: "Production",
      criticality: "high",
    },
  ],
  connections: [{ id: "request", from: "api", to: "lambda", type: "request", encrypted: false }],
};

describe("combined Review Center model", () => {
  it("combines real AWS and Network Lab evidence and orders must-fix findings first", () => {
    const review = createReviewSnapshot({
      awsState,
      networkState: NETWORK_TEMPLATES["small-office"],
    });
    expect(review.hasDesign).toBe(true);
    expect(review.score).toBeGreaterThan(0);
    expect(review.lenses.map((lens) => lens.id)).toEqual([
      "security",
      "trust",
      "reliability",
      "observability",
      "recovery",
      "network",
    ]);
    expect(review.findings[0].status).toBe("must");
    expect(review.topFinding.target.view).toBe("studio");
    expect(review.aws.nodes).toBe(2);
    expect(review.network.nodes).toBeGreaterThan(0);
  });

  it("does not dilute an AWS review with an unused blank Network Lab", () => {
    const awsOnly = createReviewSnapshot({ awsState, scope: "aws" });
    const combined = createReviewSnapshot({
      awsState,
      networkState: NETWORK_TEMPLATES.blank,
      scope: "combined",
    });
    expect(combined.score).toBe(awsOnly.score);
    expect(combined.findings.every((finding) => finding.source === "aws")).toBe(true);
  });

  it("supports a network-only starting review", () => {
    const review = createReviewSnapshot({
      networkState: NETWORK_TEMPLATES.blank,
      scope: "network",
    });
    expect(review.score).toBe(0);
    expect(review.verdict).toBe("Early design stage");
    expect(review.findings.every((finding) => finding.source === "network")).toBe(true);
  });

  it("produces a portable Markdown architecture passport", () => {
    const review = createReviewSnapshot({
      awsState,
      networkState: NETWORK_TEMPLATES["small-office"],
    });
    const markdown = buildReviewMarkdown(review, new Date("2026-07-28T00:00:00.000Z"));
    expect(markdown).toContain("# Trust Choreography — Design Review");
    expect(markdown).toContain("Serverless API");
    expect(markdown).toContain("## Open priorities");
    expect(markdown).toContain("not a live AWS account audit");
  });
});
