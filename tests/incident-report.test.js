import { describe, it, expect } from "vitest";
import { buildIncidentReport } from "../src/incident-report.js";
import { deriveComposedState } from "../src/resilience-model.js";

describe("buildIncidentReport", () => {
  const composed = deriveComposedState("surge", ["edge", "identity"]);
  const report = buildIncidentReport({
    scenarioName: "surge",
    scenarioTitle: "Traffic pressure shifts through CloudFront while EKS capacity expands.",
    composed,
    selectedNode: "IAM trust broker",
    url: "https://example.com/#scenario=surge&faults=edge,identity",
  });

  it("renders a Markdown heading and scenario", () => {
    expect(report).toMatch(/^# AWS Resilience Command Atlas/);
    expect(report).toContain("**Scenario:** Surge");
    expect(report).toContain("> Traffic pressure shifts");
  });

  it("lists the injected faults by label", () => {
    expect(report).toContain("**Injected faults:** Edge flood + Identity breach");
  });

  it("includes a telemetry table with live values", () => {
    expect(report).toContain("| Route health | " + composed.routeHealth + "% |");
    expect(report).toContain("| Blast radius | " + composed.blastRadius + " |");
    expect(report).toContain(composed.weakestNode);
  });

  it("includes the recommendation and shared URL", () => {
    expect(report).toContain("## Recommendation");
    expect(report).toContain(composed.recommendation);
    expect(report).toContain("Shared view: https://example.com/");
  });

  it("reports 'None' when no faults are injected and omits the URL when absent", () => {
    const clean = buildIncidentReport({
      scenarioName: "steady",
      scenarioTitle: "All good.",
      composed: deriveComposedState("steady"),
    });
    expect(clean).toContain("**Injected faults:** None");
    expect(clean).not.toContain("Shared view:");
  });
});
