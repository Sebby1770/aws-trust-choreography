/**
 * Optional Claude assist for the SQL reviewer.
 *
 * The local analyser (src/sql-review.js) is the product; this goes further
 * when you supply your own Anthropic API key — explaining what a query does,
 * proposing a rewrite, and reasoning about things static rules cannot see.
 *
 * The key is yours: it is kept in this browser's localStorage, sent only to
 * api.anthropic.com, and never logged. Because this is a static site the call
 * is made straight from the page, which is why the SDK needs
 * `dangerouslyAllowBrowser` — an API key in a browser is readable by anything
 * running on the page, so this is only appropriate for a personal key you
 * control, not a shared or production one.
 */

import Anthropic from "@anthropic-ai/sdk";

export const ASSIST_MODEL = "claude-opus-5";
export const STORAGE_KEY = "aws-command-atlas-sql-assist-key";

const SYSTEM_PROMPT = `You are reviewing SQL for an engineer who has already run a static analyser over it.

Be concrete and specific to the query in front of you. Prefer naming the exact
column, join, or clause over general advice. If the query is fine, say so
plainly rather than inventing problems.

Structure your answer as:
1. What this query does — one short paragraph in plain English.
2. Correctness risks — anything that would return wrong or surprising results.
3. Performance — what will hurt at scale, and why.
4. A rewrite — the improved SQL in a fenced code block, when a rewrite helps.

Do not repeat a static finding unless you can add something to it — the
engineer can already see those.`;

/** Reads the stored key. Returns "" when absent or unreadable. */
export function readStoredKey(storage) {
  try {
    return storage?.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeStoredKey(storage, key) {
  try {
    if (key) storage?.setItem(STORAGE_KEY, key);
    else storage?.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Anthropic keys start with a known prefix; catch obvious paste mistakes early. */
export function looksLikeApiKey(key) {
  return typeof key === "string" && /^sk-ant-[\w-]{20,}$/.test(key.trim());
}

/**
 * Build the user prompt. Pure and exported so the wording is testable without
 * touching the network.
 */
export function buildPrompt(sql, localReview, question) {
  const lines = [];

  if (localReview && !localReview.empty) {
    const summary = localReview.findings
      .map((f) => `- [${f.severity}] line ${f.line}: ${f.title}`)
      .join("\n");
    lines.push(
      `The static analyser scored this ${localReview.score}/100 (grade ${localReview.grade}).`,
      summary ? `It reported:\n${summary}` : "It reported no findings.",
      ""
    );
  }

  if (question && question.trim()) {
    lines.push(`The engineer asks: ${question.trim()}`, "");
  }

  lines.push("SQL under review:", "```sql", String(sql ?? "").trim(), "```");
  return lines.join("\n");
}

/** Turn an SDK error into something worth showing a user. */
export function describeError(error) {
  const status = error?.status;
  if (status === 401) return "That API key was rejected. Check it and try again.";
  if (status === 403) return "That key is not permitted to call the Messages API.";
  if (status === 429) return "Rate limited by the API. Wait a moment and retry.";
  if (status === 400) return `The request was rejected: ${error?.message ?? "bad request"}`;
  if (typeof status === "number" && status >= 500) {
    return "The API had a server error. This is usually transient — retry.";
  }
  if (error?.name === "APIConnectionError" || /fetch|network/i.test(error?.message ?? "")) {
    return "Could not reach api.anthropic.com. Check your connection, or whether a browser extension is blocking the request.";
  }
  return error?.message || "The request failed.";
}

/** Concatenate the text blocks of a response, ignoring thinking blocks. */
export function textFrom(message) {
  return (message?.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

export function createClient(apiKey) {
  return new Anthropic({
    apiKey: String(apiKey ?? "").trim(),
    // Required for a browser-side call; see the note at the top of this file.
    dangerouslyAllowBrowser: true,
  });
}

/**
 * Ask Claude to review the SQL.
 *
 * @returns {Promise<{ok: true, text: string, model: string, usage: object}
 *                 | {ok: false, error: string, refused?: boolean}>}
 */
export async function requestReview({ apiKey, sql, localReview, question, client, signal } = {}) {
  const key = String(apiKey ?? "").trim();
  if (!key) return { ok: false, error: "Add an API key first." };
  if (!String(sql ?? "").trim()) return { ok: false, error: "Paste some SQL first." };

  const anthropic = client ?? createClient(key);

  try {
    const message = await anthropic.beta.messages.create(
      {
        model: ASSIST_MODEL,
        max_tokens: 16000,
        // SQL review benefits from reasoning; adaptive lets Claude decide depth.
        thinking: { type: "adaptive" },
        // Route around a policy decline instead of returning nothing.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPrompt(sql, localReview, question) }],
      },
      signal ? { signal } : undefined
    );

    // A refusal is an HTTP 200 — check before reading content.
    if (message?.stop_reason === "refusal") {
      return {
        ok: false,
        refused: true,
        error: "Claude declined to answer this one. Rephrasing the question usually helps.",
      };
    }

    const text = textFrom(message);
    if (!text) return { ok: false, error: "The model returned an empty response." };

    return {
      ok: true,
      text,
      model: message.model ?? ASSIST_MODEL,
      usage: message.usage ?? null,
    };
  } catch (error) {
    if (error?.name === "AbortError") return { ok: false, error: "Cancelled." };
    return { ok: false, error: describeError(error) };
  }
}
