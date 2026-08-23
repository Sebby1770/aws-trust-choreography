import { describe, expect, it } from "vitest";
import {
  normalizeProjectDraft,
  projectMatchesFilter,
  PROJECT_TEMPLATES,
} from "../src/project-launchpad.js";

describe("project launchpad", () => {
  it("normalizes a configured architecture draft", () => {
    expect(
      normalizeProjectDraft({
        name: "  Checkout platform  ",
        template: "serverless",
        region: "ap-southeast-2",
        stage: "production",
      })
    ).toEqual({
      name: "Checkout platform",
      template: "serverless",
      region: "ap-southeast-2",
      stage: "production",
    });
  });

  it("falls back safely for unsupported form values", () => {
    expect(
      normalizeProjectDraft({
        template: "unknown-template",
        region: "moon-1",
        stage: "chaos",
      })
    ).toEqual({
      name: "My AWS architecture",
      template: "blank",
      region: "ap-southeast-2",
      stage: "production",
    });
  });

  it("provides a useful default name for every starter", () => {
    PROJECT_TEMPLATES.forEach((template) => {
      const draft = normalizeProjectDraft({ template });
      expect(draft.name.length).toBeGreaterThan(5);
      expect(draft.template).toBe(template);
    });
  });

  it("filters projects while always retaining the blank card", () => {
    expect(projectMatchesFilter("ai", "ai")).toBe(true);
    expect(projectMatchesFilter("apps", "ai")).toBe(false);
    expect(projectMatchesFilter("all", "data")).toBe(true);
    expect(projectMatchesFilter("apps", "all")).toBe(true);
  });
});
