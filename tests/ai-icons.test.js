import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AI_ICONS } from "../src/ai-icons.js";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("AI_ICONS", () => {
  it("exposes the expected provider and pattern nodes", () => {
    const names = AI_ICONS.map((icon) => icon.name);
    expect(names).toContain("Claude");
    expect(names).toContain("ChatGPT");
    expect(names).toContain("Vector Database");
    expect(AI_ICONS).toHaveLength(7);
  });

  it("matches the catalog item shape with the dedicated ai type", () => {
    for (const icon of AI_ICONS) {
      expect(icon).toHaveProperty("id");
      expect(icon.type).toBe("ai");
      expect(icon.category).toBe("AI & LLM");
      expect(icon.path).toMatch(/^assets\/ai-icons\/.+\.svg$/);
      expect(icon.search).toContain("ai");
    }
  });

  it("has unique ids and paths", () => {
    expect(new Set(AI_ICONS.map((i) => i.id)).size).toBe(AI_ICONS.length);
    expect(new Set(AI_ICONS.map((i) => i.path)).size).toBe(AI_ICONS.length);
  });

  it("points every icon at a real SVG file on disk", () => {
    for (const icon of AI_ICONS) {
      expect(existsSync(new URL(icon.path, `file://${root}`))).toBe(true);
    }
  });

  it("includes a lowercase search string with the display name", () => {
    for (const icon of AI_ICONS) {
      expect(icon.search).toBe(icon.search.toLowerCase());
      expect(icon.search).toContain(icon.name.toLowerCase());
    }
  });
});
