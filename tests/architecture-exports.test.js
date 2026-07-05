import { describe, it, expect } from "vitest";
import { estimateNodeCost, estimateArchitectureCost, formatUsd } from "../src/cost-model.js";
import { toTerraform, tfName } from "../src/terraform-export.js";
import { toMermaid, mermaidId } from "../src/mermaid-export.js";

const state = {
  name: "Claude RAG assistant",
  region: "ap-southeast-2",
  nodes: [
    {
      id: "n1",
      serviceName: "Amazon API Gateway",
      name: "Chat API",
      criticality: "high",
      environment: "Production",
    },
    { id: "n2", serviceName: "AWS Lambda", name: "Orchestrator", criticality: "medium" },
    { id: "n3", serviceName: "Claude", name: "Claude — reasoning", criticality: "high" },
    { id: "n4", serviceName: "Vector Database", name: "Knowledge index", criticality: "low" },
  ],
  connections: [
    { from: "n1", to: "n2", type: "request", label: "HTTPS", encrypted: true },
    { from: "n2", to: "n3", type: "request", label: "Prompt", encrypted: false },
    { from: "n2", to: "n4", type: "data", label: "Query" },
  ],
};

describe("cost model", () => {
  it("prices known services and scales by criticality", () => {
    expect(estimateNodeCost({ serviceName: "AWS Lambda", criticality: "medium" }).usd).toBe(8);
    expect(estimateNodeCost({ serviceName: "AWS Lambda", criticality: "high" }).usd).toBe(12);
    expect(estimateNodeCost({ serviceName: "Claude", criticality: "medium" }).usd).toBe(200);
  });

  it("falls back to a generic price for unknown services", () => {
    const { usd, why } = estimateNodeCost({ serviceName: "Mystery Thing" });
    expect(usd).toBe(20);
    expect(why).toBe("generic service");
  });

  it("totals an architecture with lines sorted by cost", () => {
    const { total, lines } = estimateArchitectureCost(state.nodes);
    expect(total).toBeGreaterThan(0);
    expect(lines[0].usd).toBeGreaterThanOrEqual(lines[lines.length - 1].usd);
    expect(total).toBe(lines.reduce((s, l) => s + l.usd, 0));
  });

  it("formats dollars compactly", () => {
    expect(formatUsd(840)).toBe("$840");
    expect(formatUsd(1240)).toBe("$1.2k");
    expect(formatUsd(2000)).toBe("$2k");
  });
});

describe("terraform export", () => {
  const tf = toTerraform(state);

  it("emits provider with the architecture region", () => {
    expect(tf).toContain('provider "aws"');
    expect(tf).toContain('region = "ap-southeast-2"');
  });

  it("maps services to terraform resource types", () => {
    expect(tf).toContain('resource "aws_apigatewayv2_api" "chat_api"');
    expect(tf).toContain('resource "aws_lambda_function" "orchestrator"');
  });

  it("renders AI services as SaaS placeholders, not AWS resources", () => {
    expect(tf).toContain('resource "null_resource" "claude_reasoning"');
    expect(tf).not.toContain('resource "aws_cloudformation_stack" "claude_reasoning"');
  });

  it("comments the topology and flags unencrypted paths", () => {
    expect(tf).toContain("# chat_api --request--> orchestrator");
    expect(tf).toContain("(UNENCRYPTED!)");
  });

  it("keeps terraform identifiers unique and valid", () => {
    const taken = new Set();
    expect(tfName("Chat API!", taken)).toBe("chat_api");
    expect(tfName("Chat API!", taken)).toBe("chat_api_2");
    expect(tfName("42 Things", new Set())).toBe("_42_things");
  });
});

describe("mermaid export", () => {
  const mmd = toMermaid(state);

  it("emits a fenced mermaid flowchart", () => {
    expect(mmd.startsWith("```mermaid\nflowchart LR")).toBe(true);
    expect(mmd.endsWith("```")).toBe(true);
  });

  it("renders nodes with labels and high-criticality styling", () => {
    expect(mmd).toContain('["Chat API"]:::critical');
    expect(mmd).toContain("classDef critical");
  });

  it("renders labelled edges with per-type arrows", () => {
    expect(mmd).toMatch(/AmazonAPIGateway0 -->\|HTTPS\| AWSLambda1/);
    expect(mmd).toMatch(/AWSLambda1 -->\|Query\| VectorDatabase3/);
  });

  it("makes safe ids", () => {
    expect(mermaidId("Amazon S3!", 4)).toBe("AmazonS34");
    expect(mermaidId("", 9)).toBe("n9");
  });
});
