// @vitest-environment jsdom
/* global document */

import { describe, expect, it, vi } from "vitest";
import {
  ASSIST_MODEL,
  buildPrompt,
  describeError,
  looksLikeApiKey,
  readStoredKey,
  requestReview,
  textFrom,
  writeStoredKey,
} from "../src/sql-assist.js";
import { renderAssistText } from "../src/sql-lab.js";
import { reviewSql } from "../src/sql-review.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

/** Minimal stand-in for the SDK client — no network. */
function fakeClient(handler) {
  return { beta: { messages: { create: handler } } };
}

describe("api key handling", () => {
  it("recognises a well-formed key and rejects obvious mistakes", () => {
    expect(looksLikeApiKey(`sk-ant-${"a".repeat(30)}`)).toBe(true);
    expect(looksLikeApiKey("sk-ant-short")).toBe(false);
    expect(looksLikeApiKey("sk-proj-abcdefghijklmnopqrstuvwxyz")).toBe(false);
    expect(looksLikeApiKey("")).toBe(false);
    expect(looksLikeApiKey(undefined)).toBe(false);
  });

  it("round-trips through storage and can forget the key", () => {
    const storage = memoryStorage();
    const key = `sk-ant-${"b".repeat(30)}`;
    expect(writeStoredKey(storage, key)).toBe(true);
    expect(readStoredKey(storage)).toBe(key);

    writeStoredKey(storage, "");
    expect(readStoredKey(storage)).toBe("");
  });

  it("degrades quietly when storage throws", () => {
    const hostile = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
      removeItem() {
        throw new Error("blocked");
      },
    };
    expect(readStoredKey(hostile)).toBe("");
    expect(writeStoredKey(hostile, "x")).toBe(false);
  });
});

describe("prompt construction", () => {
  it("includes the SQL in a fenced block", () => {
    const prompt = buildPrompt("SELECT 1", reviewSql("SELECT 1"), "");
    expect(prompt).toContain("```sql");
    expect(prompt).toContain("SELECT 1");
  });

  it("passes the local findings through so Claude does not repeat them", () => {
    const sql = "DELETE FROM users";
    const prompt = buildPrompt(sql, reviewSql(sql), "");
    expect(prompt).toMatch(/\[critical\] line 1/);
    expect(prompt).toContain("DELETE with no WHERE clause");
    expect(prompt).toMatch(/scored this \d+\/100/);
  });

  it("includes the engineer's question when given", () => {
    const prompt = buildPrompt("SELECT 1", null, "  why is this slow?  ");
    expect(prompt).toContain("why is this slow?");
  });

  it("omits the question section when blank", () => {
    expect(buildPrompt("SELECT 1", null, "   ")).not.toMatch(/engineer asks/i);
  });
});

describe("response handling", () => {
  it("joins text blocks and ignores thinking blocks", () => {
    const message = {
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: "First. " },
        { type: "text", text: "Second." },
      ],
    };
    expect(textFrom(message)).toBe("First. Second.");
  });

  it("returns the review text on success", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "end_turn",
      model: ASSIST_MODEL,
      usage: { input_tokens: 10, output_tokens: 20 },
      content: [{ type: "text", text: "Looks fine." }],
    }));

    const result = await requestReview({ apiKey: "sk-ant-x", sql: "SELECT 1", client });
    expect(result.ok).toBe(true);
    expect(result.text).toBe("Looks fine.");
    expect(result.model).toBe(ASSIST_MODEL);
    expect(result.usage.output_tokens).toBe(20);
  });

  it("sends the documented request shape", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "ok" }],
    }));
    await requestReview({ apiKey: "sk-ant-x", sql: "SELECT 1", client: fakeClient(create) });

    const body = create.mock.calls[0][0];
    expect(body.model).toBe("claude-opus-5");
    expect(body.thinking).toEqual({ type: "adaptive" });
    // A policy decline should route to a fallback rather than returning nothing.
    expect(body.betas).toContain("server-side-fallback-2026-07-01");
    expect(body.fallbacks).toBe("default");
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body.messages[0].role).toBe("user");
  });

  it("treats a refusal as a handled outcome, not a crash", async () => {
    const client = fakeClient(async () => ({
      stop_reason: "refusal",
      content: [],
    }));
    const result = await requestReview({ apiKey: "sk-ant-x", sql: "SELECT 1", client });
    expect(result.ok).toBe(false);
    expect(result.refused).toBe(true);
  });

  it("reports an empty response rather than rendering nothing", async () => {
    const client = fakeClient(async () => ({ stop_reason: "end_turn", content: [] }));
    const result = await requestReview({ apiKey: "sk-ant-x", sql: "SELECT 1", client });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/empty/i);
  });

  it("requires a key and some SQL before calling out", async () => {
    const create = vi.fn();
    expect(
      await requestReview({ apiKey: "", sql: "SELECT 1", client: fakeClient(create) })
    ).toEqual({
      ok: false,
      error: "Add an API key first.",
    });
    expect(
      await requestReview({ apiKey: "sk-ant-x", sql: "  ", client: fakeClient(create) })
    ).toEqual({
      ok: false,
      error: "Paste some SQL first.",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("surfaces a cancelled request as cancelled", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const client = fakeClient(async () => {
      throw abort;
    });
    const result = await requestReview({ apiKey: "sk-ant-x", sql: "SELECT 1", client });
    expect(result.error).toBe("Cancelled.");
  });

  it("maps API errors to actionable messages", () => {
    expect(describeError({ status: 401 })).toMatch(/rejected/i);
    expect(describeError({ status: 429 })).toMatch(/rate limit/i);
    expect(describeError({ status: 500 })).toMatch(/server error/i);
    expect(describeError({ name: "APIConnectionError" })).toMatch(/could not reach/i);
    expect(describeError({ message: "boom" })).toBe("boom");
  });
});

describe("assist rendering", () => {
  it("renders fenced SQL as a code block and prose as paragraphs", () => {
    const node = renderAssistText("Here is the fix.\n\n```sql\nSELECT 1;\n```\n\nDone.", document);
    expect(node.querySelectorAll("p")).toHaveLength(2);
    const code = node.querySelector("pre.sql-assist-code code");
    expect(code.textContent).toBe("SELECT 1;");
  });

  it("never turns model output into markup", () => {
    const node = renderAssistText("<img src=x onerror=alert(1)> and <b>bold</b>", document);
    expect(node.querySelector("img")).toBeNull();
    expect(node.querySelector("b")).toBeNull();
    expect(node.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("handles empty input", () => {
    expect(renderAssistText("", document).childElementCount).toBe(0);
    expect(renderAssistText(undefined, document).childElementCount).toBe(0);
  });
});
