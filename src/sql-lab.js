/**
 * SQL review workspace controller.
 *
 * Wires the textarea to the local analyser (instant, offline, no key) and the
 * optional Claude assist. Rendering is DOM-node based rather than innerHTML so
 * pasted SQL can never become markup.
 */

import { reviewSql } from "./sql-review.js";
import {
  buildPrompt,
  looksLikeApiKey,
  readStoredKey,
  requestReview,
  writeStoredKey,
} from "./sql-assist.js";

const SAMPLE_SQL = `-- A query with a few of the problems this catches
SELECT *
FROM orders o
JOIN customers c
WHERE c.name LIKE '%smith'
  AND YEAR(o.created_at) = 2024
ORDER BY o.created_at;`;

const DEBOUNCE_MS = 180;

/** Minimal, safe markdown: fenced code blocks and paragraphs. Never innerHTML. */
export function renderAssistText(text, doc = globalThis.document) {
  const wrap = doc.createElement("div");
  const parts = String(text ?? "").split(/```(?:sql)?\n?/i);

  parts.forEach((part, index) => {
    if (!part.trim()) return;
    if (index % 2 === 1) {
      const pre = doc.createElement("pre");
      pre.className = "sql-assist-code";
      const code = doc.createElement("code");
      code.textContent = part.replace(/\n$/, "");
      pre.append(code);
      wrap.append(pre);
    } else {
      for (const para of part.split(/\n{2,}/)) {
        if (!para.trim()) continue;
        const p = doc.createElement("p");
        p.textContent = para.trim();
        wrap.append(p);
      }
    }
  });

  return wrap;
}

export function initSqlLab({ root = document, storage = globalThis.localStorage } = {}) {
  const input = root.querySelector("#sqlInput");
  if (!input) return null;

  const el = (id) => root.querySelector(id);
  const findingsBox = el("#sqlFindings");
  const structureBox = el("#sqlStructure");
  const scoreValue = el("#sqlScoreValue");
  const scoreGrade = el("#sqlScoreGrade");
  const scoreBox = el("#sqlScore");
  const countsBox = el("#sqlCounts");
  const statsBox = el("#sqlStats");
  const keyInput = el("#sqlApiKey");
  const keyState = el("#sqlKeyState");
  const assistOut = el("#sqlAssistOutput");
  const assistRun = el("#sqlAssistRun");

  let latest = reviewSql("");
  let timer = null;
  let inFlight = null;

  function setKeyState(message) {
    if (keyState) keyState.textContent = message;
  }

  function renderStructure(review) {
    structureBox.replaceChildren();
    if (review.empty) return;
    for (const statement of review.statements) {
      const row = document.createElement("div");
      row.className = "sql-structure-row";

      const kind = document.createElement("span");
      kind.className = `sql-kind sql-kind-${statement.kind}`;
      kind.textContent = statement.kind;

      const detail = document.createElement("span");
      const bits = [];
      if (statement.tables.length) bits.push(`${statement.tables.join(", ")}`);
      if (statement.joinCount)
        bits.push(`${statement.joinCount} join${statement.joinCount === 1 ? "" : "s"}`);
      if (statement.ctes.length) bits.push(`${statement.ctes.length} CTE`);
      if (statement.subqueryCount) bits.push(`${statement.subqueryCount} subquery`);
      detail.textContent = bits.join(" · ") || "—";

      row.append(kind, detail);
      structureBox.append(row);
    }
  }

  function renderFindings(review) {
    findingsBox.replaceChildren();

    if (review.empty) {
      const empty = document.createElement("p");
      empty.className = "sql-empty";
      empty.textContent = "Paste SQL on the left to see findings here.";
      findingsBox.append(empty);
      return;
    }

    if (!review.findings.length) {
      const clean = document.createElement("p");
      clean.className = "sql-clean";
      clean.textContent = "No findings — nothing in the rule set matched this query.";
      findingsBox.append(clean);
      return;
    }

    for (const item of review.findings) {
      const card = document.createElement("article");
      card.className = `sql-finding is-${item.severity}`;

      const head = document.createElement("header");
      const sev = document.createElement("span");
      sev.className = "sql-sev";
      sev.textContent = item.severity;
      const title = document.createElement("strong");
      title.textContent = item.title;
      const line = document.createElement("span");
      line.className = "sql-line";
      line.textContent = `line ${item.line}`;
      head.append(sev, title, line);

      const detail = document.createElement("p");
      detail.textContent = item.detail;

      const fix = document.createElement("p");
      fix.className = "sql-fix";
      fix.textContent = item.fix;

      card.append(head, detail, fix);
      findingsBox.append(card);
    }
  }

  function render() {
    const sql = input.value;
    latest = reviewSql(sql);

    if (latest.empty) {
      scoreValue.textContent = "—";
      scoreGrade.textContent = "no SQL yet";
      scoreBox.dataset.grade = "";
      countsBox.textContent = "";
      statsBox.textContent = "";
    } else {
      scoreValue.textContent = String(latest.score);
      scoreGrade.textContent = `grade ${latest.grade}`;
      scoreBox.dataset.grade = latest.grade;
      countsBox.textContent = [
        `${latest.counts.critical} critical`,
        `${latest.counts.warning} warning`,
        `${latest.counts.info} info`,
      ].join(" · ");
      const lines = sql.split("\n").length;
      statsBox.textContent = `${latest.statements.length} statement${latest.statements.length === 1 ? "" : "s"} · ${lines} line${lines === 1 ? "" : "s"}`;
    }

    renderStructure(latest);
    renderFindings(latest);
  }

  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(render, DEBOUNCE_MS);
  });

  el("#sqlSampleButton")?.addEventListener("click", () => {
    input.value = SAMPLE_SQL;
    render();
  });

  el("#sqlClearButton")?.addEventListener("click", () => {
    input.value = "";
    render();
    input.focus();
  });

  // --- optional Claude assist -------------------------------------------
  const storedKey = readStoredKey(storage);
  if (storedKey && keyInput) {
    keyInput.value = storedKey;
    setKeyState("key loaded from this browser");
  }

  el("#sqlKeySave")?.addEventListener("click", () => {
    const key = keyInput?.value.trim() ?? "";
    if (!key) return setKeyState("nothing to save");
    if (!looksLikeApiKey(key)) return setKeyState("that does not look like an sk-ant- key");
    setKeyState(writeStoredKey(storage, key) ? "saved to this browser" : "could not save");
  });

  el("#sqlKeyForget")?.addEventListener("click", () => {
    writeStoredKey(storage, "");
    if (keyInput) keyInput.value = "";
    setKeyState("key removed");
  });

  assistRun?.addEventListener("click", async () => {
    if (inFlight) {
      inFlight.abort();
      return;
    }

    const key = keyInput?.value.trim() ?? "";
    assistOut.replaceChildren();

    const controller = new AbortController();
    inFlight = controller;
    assistRun.textContent = "Cancel";
    assistRun.classList.add("is-busy");

    const pending = document.createElement("p");
    pending.className = "sql-assist-pending";
    pending.textContent = "Asking Claude…";
    assistOut.append(pending);

    const result = await requestReview({
      apiKey: key,
      sql: input.value,
      localReview: latest,
      question: el("#sqlQuestion")?.value ?? "",
      signal: controller.signal,
    });

    inFlight = null;
    assistRun.textContent = "Ask Claude to review this SQL";
    assistRun.classList.remove("is-busy");
    assistOut.replaceChildren();

    if (!result.ok) {
      const error = document.createElement("p");
      error.className = "sql-assist-error";
      error.textContent = result.error;
      assistOut.append(error);
      return;
    }

    assistOut.append(renderAssistText(result.text));
    const meta = document.createElement("p");
    meta.className = "sql-assist-meta";
    meta.textContent = `${result.model}${
      result.usage
        ? ` · ${result.usage.input_tokens ?? "?"} in / ${result.usage.output_tokens ?? "?"} out`
        : ""
    }`;
    assistOut.append(meta);
  });

  render();

  return { render, current: () => latest, buildPrompt };
}
