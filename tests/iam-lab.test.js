// @vitest-environment jsdom
/* global document, window, DOMParser */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initIamLab } from "../src/iam-lab.js";
import {
  accessMapBlueprint,
  analyzePolicy,
  formatPolicy,
  PLACEHOLDER_ACCOUNT,
  SAMPLE_POLICY,
  SAMPLE_TRUST_POLICY,
} from "../src/iam-policy.js";
import { buildTemplate } from "../src/diagram/templates.js";

// ------------------------------------------------------------------ fixtures

const STORAGE_KEY = "trust-choreography:iam-policy:v1";
const DEBOUNCE_MS = 160;

/** The real page markup, so the tests fail if index.html and the controller drift apart. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const INDEX_HTML = readFileSync(join(ROOT, "index.html"), "utf8");
const PAGE = new DOMParser().parseFromString(INDEX_HTML, "text/html");
const IAM_VIEW = PAGE.querySelector(".view-iam");
const SOURCE = readFileSync(join(ROOT, "src", "iam-lab.js"), "utf8");

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key) => (data.has(key) ? data.get(key) : null)),
    setItem: vi.fn((key, value) => data.set(key, String(value))),
  };
}

const policy = (statements, extra = { Version: "2012-10-17" }) =>
  JSON.stringify({ ...extra, Statement: statements }, null, 2);

const CLEAN_POLICY = policy([
  { Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::bucket/*" },
]);
const ADMIN_POLICY = policy([{ Effect: "Allow", Action: "*", Resource: "*" }]);
const MIXED_POLICY = policy([
  {
    Sid: "Read",
    Effect: "Allow",
    Action: ["s3:GetObject", "s3:ListBucket"],
    Resource: ["arn:aws:s3:::b", "arn:aws:s3:::b/*"],
    Condition: { Bool: { "aws:SecureTransport": "true" } },
  },
  { Effect: "Deny", Action: ["s3:DeleteObject", "iam:CreateUser"], Resource: "*" },
]);
const NO_ACTION_POLICY = policy([{ Effect: "Allow", Resource: "*" }]);
const BROKEN_JSON = '{\n  "Version": "2012-10-17"\n  "Statement": []\n}';
const TRUST_MIX = policy([
  {
    Effect: "Allow",
    Principal: { Service: "lambda.amazonaws.com" },
    Action: "sts:AssumeRole",
    Condition: { StringEquals: { "aws:SourceAccount": "111122223333" } },
  },
  {
    Effect: "Allow",
    Principal: {
      Federated: "arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com",
    },
    Action: "sts:AssumeRoleWithWebIdentity",
    Condition: { StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" } },
  },
  { Effect: "Allow", Principal: "*", Action: "sts:AssumeRole" },
]);

/** A deterministic stand-in icon for any service name (as in diagram-blueprint.test.js). */
const fakeIcon = (name, type = "service") => ({
  id: `icon:${type}:${name}`,
  path: `assets/${name}.svg`,
  type,
  category: "Test",
  name,
});
const templateDoc = (id) => buildTemplate(id, { findIcon: fakeIcon });

// ------------------------------------------------------------------ helpers

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const text = (selector) => $(selector).textContent;
const flush = async () => {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
};

function mount() {
  document.body.replaceChildren(document.importNode(IAM_VIEW, true));
}

function setup(options = {}) {
  mount();
  const storage = "storage" in options ? options.storage : fakeStorage();
  const lab = initIamLab({ ...options, storage });
  return { lab, storage, input: $("#iamInput") };
}

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

function keydown(target, key, init = {}) {
  const event = new window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
}

const chips = () => $$("#iamCounts .iam-count").map((chip) => [chip.className, chip.textContent]);
const mapRows = () => $$("#iamMapBody .iam-map-row");
const cards = () => $$("#iamFindings .iam-finding");
const lineRange = (value, line) => {
  const lines = value.split("\n");
  const start = lines.slice(0, line - 1).reduce((sum, row) => sum + row.length + 1, 0);
  return [start, start + lines[line - 1].length];
};

function stubClipboard(writeText) {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.navigator.clipboard;
  document.body.replaceChildren();
  try {
    window.localStorage.clear();
  } catch {
    /* no storage in this environment */
  }
});

// ------------------------------------------------------------------ tests

describe("markup contract", () => {
  it("finds every element the controller looks up in the real IAM view", () => {
    expect(IAM_VIEW).not.toBeNull();
    const ids = [...new Set([...SOURCE.matchAll(/"#([A-Za-z][\w-]*)"/g)].map((m) => m[1]))];
    expect(ids.length).toBeGreaterThanOrEqual(20);
    const missing = ids.filter((id) => !IAM_VIEW.querySelector(`#${id}`));
    expect(missing).toEqual([]);
  });

  it("starts with the report panels hidden until there is something to show", () => {
    mount();
    expect($("#iamMap").hidden).toBe(true);
    expect($("#iamGenerated").hidden).toBe(true);
    expect($("#iamKind").hidden).toBe(true);
  });

  it("returns null when the IAM markup is missing", () => {
    const storage = fakeStorage();
    expect(initIamLab({ root: document.createElement("div"), storage })).toBeNull();
    // The default root is the document, which has no IAM view here either.
    expect(initIamLab({ storage })).toBeNull();
    expect(storage.getItem).not.toHaveBeenCalled();
  });
});

describe("initial render", () => {
  it("loads and analyses the sample policy when storage is empty", () => {
    const { lab, storage, input } = setup();
    const review = analyzePolicy(SAMPLE_POLICY);

    expect(storage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(input.value).toBe(SAMPLE_POLICY);
    expect(lab.review.score).toBe(review.score);
    expect(text("#iamScoreValue")).toBe(String(review.score));
    expect(text("#iamScoreGrade")).toBe(`grade ${review.grade}`);
    expect($("#iamScore").dataset.grade).toBe(review.grade);
    expect($("#iamKind").hidden).toBe(false);
    expect(text("#iamKind")).toBe("Identity policy");
    expect(text("#iamStats")).toBe(
      "Identity policy · 5 allow / 0 deny statements · 12 actions across 7 services · grade F, 8 findings"
    );
    // Opening the workspace does not rewrite storage.
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("shows one count chip per severity that has findings, most severe first", () => {
    setup();
    const { counts } = analyzePolicy(SAMPLE_POLICY);
    expect(chips()).toEqual([
      ["iam-count is-high", `${counts.high} high`],
      ["iam-count is-medium", `${counts.medium} medium`],
    ]);
  });

  it("restores the last policy from storage", () => {
    const storage = fakeStorage({ [STORAGE_KEY]: SAMPLE_TRUST_POLICY });
    const { input, lab } = setup({ storage });
    expect(input.value).toBe(SAMPLE_TRUST_POLICY);
    expect(lab.review.kind).toBe("trust");
    expect(text("#iamKind")).toBe("Trust policy");
    expect(text("#iamMapTitle")).toBe("Who can assume this role");
  });

  it("falls back to the sample when the stored text is empty", () => {
    const { input } = setup({ storage: fakeStorage({ [STORAGE_KEY]: "" }) });
    expect(input.value).toBe(SAMPLE_POLICY);
  });

  it("uses localStorage by default", () => {
    window.localStorage.setItem(STORAGE_KEY, CLEAN_POLICY);
    mount();
    const lab = initIamLab();
    expect($("#iamInput").value).toBe(CLEAN_POLICY);
    lab.load(ADMIN_POLICY);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(ADMIN_POLICY);
  });

  it("survives storage that throws or is missing", () => {
    const hostile = {
      getItem: vi.fn(() => {
        throw new Error("blocked");
      }),
      setItem: vi.fn(() => {
        throw new Error("blocked");
      }),
    };
    const { input, lab } = setup({ storage: hostile });
    expect(input.value).toBe(SAMPLE_POLICY);
    expect(() => lab.load(CLEAN_POLICY)).not.toThrow();
    expect(text("#iamScoreValue")).toBe("100");

    const { input: other, lab: second } = setup({ storage: null });
    expect(other.value).toBe(SAMPLE_POLICY);
    expect(() => second.load(ADMIN_POLICY)).not.toThrow();
    expect(second.review.grade).toBe("F");
  });
});

describe("live analysis", () => {
  it("re-analyses and saves once typing pauses", () => {
    vi.useFakeTimers();
    const { input, lab, storage } = setup();
    type(input, SAMPLE_TRUST_POLICY);

    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    expect(lab.review.kind).toBe("identity");
    expect(text("#iamKind")).toBe("Identity policy");
    expect(storage.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(lab.review.kind).toBe("trust");
    expect(text("#iamKind")).toBe("Trust policy");
    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, SAMPLE_TRUST_POLICY);
  });

  it("debounces a burst of edits into a single analysis of the final text", () => {
    vi.useFakeTimers();
    const { input, storage } = setup();
    type(input, "{");
    vi.advanceTimersByTime(100);
    type(input, ADMIN_POLICY.slice(0, 20));
    vi.advanceTimersByTime(100);
    type(input, ADMIN_POLICY);
    vi.advanceTimersByTime(DEBOUNCE_MS);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, ADMIN_POLICY);
    expect(text("#iamScoreValue")).toBe("20");
  });
});

describe("score, grade and counts", () => {
  it("shows a clean narrowly scoped policy as an A with no findings", () => {
    const { lab } = setup();
    lab.load(CLEAN_POLICY);
    expect(text("#iamScoreValue")).toBe("100");
    expect(text("#iamScoreGrade")).toBe("grade A");
    expect($("#iamScore").dataset.grade).toBe("A");
    expect(chips()).toEqual([["iam-count is-clean", "No findings"]]);
    expect(cards()).toHaveLength(0);
    expect($("#iamFindings .iam-clean").textContent).toBe(
      "No issues found. This policy is narrowly scoped."
    );
    expect(text("#iamStats")).toBe(
      "Identity policy · 1 allow / 0 deny statement · 1 action across 1 service · grade A, 0 findings"
    );
  });

  it("caps administrator access at an F", () => {
    const { lab } = setup();
    lab.load(ADMIN_POLICY);
    expect(text("#iamScoreValue")).toBe("20");
    expect(text("#iamScoreGrade")).toBe("grade F");
    expect(chips()).toEqual([["iam-count is-critical", "1 critical"]]);
    const [card] = cards();
    expect(card.className).toBe("iam-finding is-critical");
    expect(card.querySelector(".iam-sev").textContent).toBe("Critical");
    expect(card.querySelector("header strong").textContent).toBe("Full administrator access");
  });

  it("does not count informational notes as findings", () => {
    const { lab } = setup();
    lab.load(MIXED_POLICY);
    expect(chips()).toEqual([["iam-count is-clean", "No findings"]]);
    const [card] = cards();
    expect(card.className).toBe("iam-finding is-info");
    expect(card.querySelector(".iam-sev").textContent).toBe("Note");
    // A policy-wide note has no statement line to jump to and no fix.
    expect(card.querySelector(".iam-line")).toBeNull();
    expect(card.querySelector(".iam-fix")).toBeNull();
    expect(text("#iamStats")).toBe(
      "Identity policy · 1 allow / 1 deny statements · 4 actions across 1 service · grade A, 0 findings"
    );
  });

  it("counts a statement-level validation error as invalid", () => {
    const { lab } = setup();
    lab.load(NO_ACTION_POLICY);
    expect(chips()).toEqual([["iam-count is-invalid", "1 invalid"]]);
    expect($("#iamKind").hidden).toBe(false);
    expect($("#iamMap").hidden).toBe(true);
    const [card] = cards();
    expect(card.querySelector(".iam-sev").textContent).toBe("Invalid");
    expect(card.querySelector("header strong").textContent).toBe("Statement #1 has no Action");
    // The statement's opening brace is on line 4 of the pretty-printed document.
    expect(card.querySelector(".iam-line").textContent).toBe("line 4");
  });

  it("reports unparseable JSON with its line, an F and no kind badge", () => {
    const { lab } = setup();
    lab.load(BROKEN_JSON);
    expect(text("#iamScoreValue")).toBe("0");
    expect(text("#iamScoreGrade")).toBe("grade F");
    expect($("#iamKind").hidden).toBe(true);
    expect(text("#iamStats")).toMatch(/^Not valid JSON: .+ \(line 3\)$/);
    expect($("#iamMap").hidden).toBe(true);
    const [card] = cards();
    expect(card.className).toBe("iam-finding is-invalid");
    expect(card.querySelector(".iam-line").textContent).toBe("line 3");
    expect(card.querySelector("p").textContent).toBe(
      "IAM will refuse to save this policy until it is fixed."
    );
    expect(chips()).not.toContainEqual(["iam-count is-clean", "No findings"]);
  });

  it("counts unparseable JSON as one invalid finding, like any other invalid finding", () => {
    // The finding card below says "Invalid"; the count row should agree with it.
    const { lab } = setup();
    lab.load(BROKEN_JSON);
    expect(cards()).toHaveLength(1);
    expect(chips()).toEqual([["iam-count is-invalid", "1 invalid"]]);
  });

  it("explains a document without a Statement", () => {
    const { lab } = setup();
    lab.load('{"foo": 1}');
    expect(text("#iamStats")).toBe("No Statement found — paste an IAM policy document (line 1)");
    expect(cards()[0].querySelector(".iam-line").textContent).toBe("line 1");
  });

  it("omits the line hint when the JSON error has no position", () => {
    const { lab } = setup();
    lab.load('{\n  "Version": \n}');
    if (lab.review.errors[0].line === null) {
      expect(text("#iamStats")).toMatch(/^Not valid JSON: /);
      expect(text("#iamStats")).not.toMatch(/\(line \d+\)$/);
      expect(cards()[0].querySelector(".iam-line")).toBeNull();
    } else {
      expect(text("#iamStats")).toMatch(/\(line \d+\)$/);
    }
  });
});

describe("access map", () => {
  it("draws one row per service with a level meter and scope", () => {
    const { lab } = setup();
    const services = lab.review.services;
    expect($("#iamMap").hidden).toBe(false);
    expect(text("#iamMapTitle")).toBe("What this policy can reach");
    expect(mapRows()).toHaveLength(services.length);
    expect(mapRows().map((row) => row.querySelector(".iam-map-service").textContent)).toEqual(
      services.map((service) => service.label)
    );

    const legend = $("#iamMapBody .iam-map-legend");
    expect(legend.getAttribute("aria-hidden")).toBe("true");
    expect([...legend.querySelectorAll("i")].map((i) => i.textContent).join("")).toBe("LRTWPF");
    expect([...legend.querySelectorAll("i")].map((i) => i.title)).toEqual([
      "List",
      "Read",
      "Tag",
      "Write",
      "Permissions",
      "Full",
    ]);
  });

  it("marks the reached levels and summarises actions and resources", () => {
    setup();
    const [s3] = mapRows();
    expect(s3.dataset.risk).toBe("critical");
    expect(s3.querySelector(".iam-map-service").title).toBe("s3:*");
    const meter = s3.querySelector(".iam-meter");
    expect(meter.getAttribute("aria-label")).toBe("Access level: Full");
    expect([...meter.querySelectorAll(".iam-meter-cell.is-on")].map((cell) => cell.title)).toEqual([
      "Full",
    ]);
    expect(s3.querySelector(".iam-map-detail").textContent).toBe("1 action · all resources");

    const dynamo = mapRows().find((row) => row.textContent.startsWith("DynamoDB"));
    expect(dynamo.dataset.risk).toBe("low");
    expect(dynamo.querySelector(".iam-map-service").title).toBe(
      "dynamodb:GetItem\ndynamodb:PutItem\ndynamodb:Query"
    );
    expect([...dynamo.querySelectorAll(".iam-meter-cell.is-on")].map((cell) => cell.title)).toEqual(
      ["Read", "Write"]
    );
    expect(dynamo.querySelector(".iam-map-detail").textContent).toBe("3 actions · 1 resource");
  });

  it("flags conditional, partly denied and deny-only services", () => {
    const { lab } = setup();
    lab.load(MIXED_POLICY);
    const [s3, iam] = mapRows();
    expect(s3.querySelector(".iam-map-detail").textContent).toBe(
      "2 actions · 2 resources · conditional · partly denied"
    );
    expect(s3.querySelector(".iam-meter").getAttribute("aria-label")).toBe("Access level: Read");

    expect(iam.dataset.risk).toBe("none");
    expect(iam.querySelector(".iam-map-service").title).toBe("iam:CreateUser");
    expect(iam.querySelector(".iam-meter").getAttribute("aria-label")).toBe("Access level: denied");
    expect(iam.querySelectorAll(".iam-meter-cell.is-on")).toHaveLength(0);
    expect(iam.querySelector(".iam-map-detail").textContent).toBe("denied: iam:CreateUser");
  });

  it("shows who can assume the role for a trust policy", () => {
    const { lab } = setup();
    lab.load(SAMPLE_TRUST_POLICY);
    expect(text("#iamMapTitle")).toBe("Who can assume this role");
    expect($("#iamMapBody .iam-map-legend")).toBeNull();
    expect(
      mapRows().map((row) => [
        row.querySelector(".iam-map-service").textContent,
        row.querySelector(".iam-map-level").textContent,
        row.querySelector(".iam-map-detail").textContent,
        row.dataset.risk,
      ])
    ).toEqual([
      ["token.actions.githubusercontent.com", "Federated", "can assume · no condition", "high"],
      ["Account 444455556666", "AWS", "can assume · no condition", "medium"],
    ]);
  });

  it("rates trust principals by how open they are", () => {
    const { lab } = setup();
    lab.load(TRUST_MIX);
    expect(
      mapRows().map((row) => [
        row.querySelector(".iam-map-service").textContent,
        row.querySelector(".iam-map-detail").textContent,
        row.dataset.risk,
      ])
    ).toEqual([
      ["lambda", "can assume · with condition", "low"],
      // An audience check alone doesn't pin which repository's token it is.
      ["token.actions.githubusercontent.com", "can assume · with condition", "high"],
      ["Anyone (public)", "can assume · no condition", "critical"],
    ]);
  });

  it("hides the map when the policy reaches no service", () => {
    const { lab } = setup();
    lab.load(NO_ACTION_POLICY);
    expect($("#iamMap").hidden).toBe(true);
    expect($("#iamMapBody").childElementCount).toBe(0);
  });
});

describe("findings", () => {
  it("renders one card per finding, most severe first", () => {
    const { lab } = setup();
    const { findings } = lab.review;
    expect(cards()).toHaveLength(findings.length);
    expect(cards().map((card) => card.className)).toEqual(
      findings.map((finding) => `iam-finding is-${finding.severity}`)
    );
    const [first] = cards();
    expect(first.querySelector(".iam-sev").textContent).toBe("High");
    expect(first.querySelector("header strong").textContent).toBe(findings[0].title);
    expect(first.querySelector("p:not(.iam-fix)").textContent).toBe(findings[0].detail);
    expect(first.querySelector(".iam-fix").textContent).toBe(findings[0].fix);
  });

  it("labels the jump button with the statement Sid and line", () => {
    setup();
    const button = cards()[0].querySelector(".iam-line");
    expect(button.textContent).toBe("Uploads · line 10");
    expect(button.type).toBe("button");
    expect(button.title).toBe("Show this statement in the editor");
  });

  it("selects the statement's line in the editor when the jump button is clicked", () => {
    const { input } = setup();
    input.blur();
    cards()[0].querySelector(".iam-line").click();
    const [start, end] = lineRange(SAMPLE_POLICY, 10);
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([start, end]);
    expect(input.value.slice(start, end)).toBe(SAMPLE_POLICY.split("\n")[9]);
  });

  it("uses a line label without a Sid for unnamed statements", () => {
    const { lab } = setup();
    lab.load(SAMPLE_TRUST_POLICY);
    expect(cards().map((card) => card.querySelector(".iam-line")?.textContent)).toEqual([
      "line 4",
      "line 9",
    ]);
  });

  it("scrolls the editor so the statement sits a couple of lines from the top", () => {
    const { input, lab } = setup();
    let scrolled = null;
    Object.defineProperty(input, "scrollTop", {
      configurable: true,
      get: () => scrolled,
      set: (value) => {
        scrolled = value;
      },
    });
    // The offset comes from a hidden mirror, so soft-wrapped lines count;
    // jsdom has no layout, so stand in for the measured offset.
    const offsetTop = vi
      .spyOn(window.HTMLElement.prototype, "offsetTop", "get")
      .mockReturnValue(180);
    vi.stubGlobal("getComputedStyle", () => ({ lineHeight: "18px" }));
    lab.jumpToLine(10);
    expect(scrolled).toBe(180 - 2 * 18);

    vi.stubGlobal("getComputedStyle", () => ({ lineHeight: "normal" }));
    lab.jumpToLine(10);
    expect(scrolled).toBe(180 - 2 * 20);

    offsetTop.mockReturnValue(10);
    lab.jumpToLine(2);
    expect(scrolled).toBe(0);
    offsetTop.mockRestore();
    expect($$("body > div").filter((node) => node.style.visibility === "hidden")).toHaveLength(0);

    lab.jumpToLine(1);
    expect(scrolled).toBe(0);
  });

  it("ignores a jump without a line", () => {
    const { input, lab } = setup();
    input.setSelectionRange(3, 5);
    input.blur();
    lab.jumpToLine(null);
    lab.jumpToLine(0);
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 5]);
    expect(document.activeElement).not.toBe(input);
  });

  it("renders pasted text as text, never as markup", () => {
    const { lab } = setup();
    const sid = '<img src="x" onerror="alert(1)">';
    lab.load(
      policy([
        { Sid: sid, Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::a/*" },
        { Sid: sid, Effect: "Allow", Action: "s3:GetObject", Resource: "arn:aws:s3:::b/*" },
      ])
    );
    expect($("#iamFindings img")).toBeNull();
    const card = cards().find((candidate) => candidate.textContent.includes("Duplicate Sid"));
    expect(card.querySelector("header strong").textContent).toBe(`Duplicate Sid “${sid}”`);
    expect(card.querySelector(".iam-line").textContent).toMatch(/^<img .+> · line \d+$/);
  });
});

describe("toolbar buttons", () => {
  it("Example loads the sample identity policy and saves it", () => {
    const { input, lab, storage } = setup();
    lab.load(CLEAN_POLICY);
    storage.setItem.mockClear();
    $("#iamSample").click();
    expect(input.value).toBe(SAMPLE_POLICY);
    expect(lab.review.kind).toBe("identity");
    expect(text("#iamScoreValue")).toBe(String(analyzePolicy(SAMPLE_POLICY).score));
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, SAMPLE_POLICY);
  });

  it("Trust policy loads the sample trust policy immediately", () => {
    const { input, lab, storage } = setup();
    $("#iamTrustSample").click();
    expect(input.value).toBe(SAMPLE_TRUST_POLICY);
    expect(lab.review.kind).toBe("trust");
    expect(text("#iamKind")).toBe("Trust policy");
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, SAMPLE_TRUST_POLICY);
  });

  it("Format pretty-prints valid JSON and saves it", () => {
    const { input, storage } = setup();
    const minified = JSON.stringify(JSON.parse(CLEAN_POLICY));
    input.value = minified;
    $("#iamFormat").click();
    expect(input.value).toBe(CLEAN_POLICY);
    expect(storage.setItem).toHaveBeenLastCalledWith(STORAGE_KEY, CLEAN_POLICY);
  });

  it("Format leaves invalid JSON alone but refreshes the analysis", () => {
    vi.useFakeTimers();
    const { input, storage } = setup();
    type(input, BROKEN_JSON);
    $("#iamFormat").click();
    expect(input.value).toBe(BROKEN_JSON);
    expect(text("#iamScoreValue")).toBe("0");
    expect(text("#iamStats")).toMatch(/^Not valid JSON/);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("Clear empties the editor, resets the report and keeps focus in the editor", () => {
    const { input, lab, storage } = setup();
    input.blur();
    $("#iamClear").click();
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "");
    expect(lab.review.empty).toBe(true);
    expect(text("#iamScoreValue")).toBe("—");
    expect(text("#iamScoreGrade")).toBe("no policy yet");
    expect($("#iamScore").hasAttribute("data-grade")).toBe(false);
    expect($("#iamCounts").childElementCount).toBe(0);
    expect($("#iamKind").hidden).toBe(true);
    expect(text("#iamStats")).toBe("Analysed in this browser — nothing is sent anywhere.");
    expect($("#iamMap").hidden).toBe(true);
    expect($("#iamFindings .iam-empty").textContent).toBe(
      "Paste an IAM policy on the left — or try the example — to see findings here."
    );
  });
});

describe("Tab key", () => {
  // The editor must not trap keyboard focus: Tab moves on to the report.
  it("leaves Tab, Shift+Tab and other keys to the browser", () => {
    vi.useFakeTimers();
    const { input, storage } = setup();
    input.value = "ab";
    input.setSelectionRange(1, 1);
    expect(keydown(input, "Tab").defaultPrevented).toBe(false);
    expect(keydown(input, "Tab", { shiftKey: true }).defaultPrevented).toBe(false);
    expect(keydown(input, "Enter").defaultPrevented).toBe(false);
    expect(input.value).toBe("ab");
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("From diagram", () => {
  const roleCards = () => $$("#iamGeneratedBody .iam-role");
  const cardTitles = () =>
    roleCards().map((card) => [
      card.querySelector("header strong").textContent,
      card.querySelector("header small").textContent,
    ]);

  it("shows a reading state, then least-privilege roles for the drawn arrows", async () => {
    const doc = templateDoc("serverless");
    const getDiagram = vi.fn(async () => doc);
    setup({ getDiagram });
    const generated = $("#iamGenerated");
    generated.scrollIntoView = vi.fn();

    $("#iamFromDiagram").click();
    expect(generated.hidden).toBe(false);
    expect(text("#iamGeneratedBody")).toBe("Reading the AWS Studio diagram…");
    await flush();

    expect(getDiagram).toHaveBeenCalledTimes(1);
    expect(text("#iamGeneratedStats")).toBe(
      `1 role and 1 resource policy from “Serverless API”. Replace ${PLACEHOLDER_ACCOUNT} and REPLACE-WITH-… values with your own.`
    );
    expect(cardTitles()).toEqual([
      ["request-processor-role", "Lambda execution role for Request processor"],
      ["request-processor-role trust", "Who can assume it"],
      ["Request processor", "Lambda resource policy"],
    ]);
    expect(roleCards().map((card) => card.classList.contains("is-trust"))).toEqual([
      false,
      true,
      false,
    ]);
    expect(generated.scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  });

  it("summarises each generated policy and shows its JSON", async () => {
    const { lab } = setup({ getDiagram: () => templateDoc("serverless") });
    const result = await lab.fromDiagram();
    const [role] = result.roles;
    const [resourcePolicy] = result.resourcePolicies;
    const actions = new Set(role.policy.Statement.flatMap((statement) => statement.Action)).size;
    const grade = analyzePolicy(role.policy).grade;
    expect(grade).toBe("A");

    const summaries = roleCards().map(
      (card) => card.querySelector(".iam-role-summary").textContent
    );
    expect(summaries).toEqual([
      `${role.policy.Statement.length} statements · ${actions} actions · grade ${grade}`,
      "1 statement · 1 action",
      "1 statement · 1 action",
    ]);
    const json = roleCards().map((card) => card.querySelector(".iam-role-json pre").textContent);
    expect(json).toEqual([
      formatPolicy(role.policy),
      formatPolicy(role.trust),
      formatPolicy(resourcePolicy.policy),
    ]);
    expect(roleCards()[0].querySelector(".iam-role-json summary").textContent).toBe("Show JSON");
  });

  it("lists the arrows that need no IAM permission", async () => {
    const { lab } = setup({ getDiagram: () => templateDoc("serverless") });
    await lab.fromDiagram();
    expect($("#iamGeneratedBody .iam-skipped").textContent).toBe(
      "No IAM permission needed (network path or managed integration): Global edge → Edge protection, Edge protection → Public API, Customer identity → Public API."
    );
  });

  it("pluralises roles and resource policies", async () => {
    const { lab } = setup({ getDiagram: () => templateDoc("events") });
    const result = await lab.fromDiagram();
    expect(result.roles).toHaveLength(3);
    expect(text("#iamGeneratedStats")).toMatch(
      /^3 roles and 0 resource policies from “Event pipeline”\./
    );
    expect(roleCards()).toHaveLength(6);
  });

  it("names an untitled diagram generically", async () => {
    const { lab } = setup({ getDiagram: () => ({ ...templateDoc("serverless"), name: "" }) });
    await lab.fromDiagram();
    expect(text("#iamGeneratedStats")).toContain("from “this diagram”.");
  });

  it("replaces the previous results when run again", async () => {
    const { lab } = setup({ getDiagram: () => templateDoc("serverless") });
    await lab.fromDiagram();
    await lab.fromDiagram();
    expect(roleCards()).toHaveLength(3);
    expect($$("#iamGeneratedBody .iam-skipped")).toHaveLength(1);
  });

  it("explains when the diagram has no IAM relationships", async () => {
    const { lab } = setup({
      getDiagram: () => ({ name: "Blank", nodes: [], connections: [] }),
    });
    const result = await lab.fromDiagram();
    expect(result.roles).toEqual([]);
    expect(text("#iamGeneratedStats")).toBe("");
    expect($("#iamGeneratedBody .iam-empty").textContent).toMatch(/^No IAM relationships found\./);
    expect(roleCards()).toHaveLength(0);
  });

  it.each([
    ["returns null", () => null],
    ["rejects", async () => Promise.reject(new Error("studio not booted"))],
    [
      "throws",
      () => {
        throw new Error("studio not booted");
      },
    ],
  ])("reports that AWS Studio is not ready when getDiagram %s", async (_label, getDiagram) => {
    const { lab } = setup({ getDiagram });
    const result = await lab.fromDiagram();
    expect(result).toBeNull();
    expect($("#iamGenerated").hidden).toBe(false);
    expect(text("#iamGeneratedStats")).toBe("");
    expect(text("#iamGeneratedBody")).toBe(
      "AWS Studio is not ready yet — open it once, then try again."
    );
  });

  it("reports that AWS Studio is not ready when no getDiagram is wired", async () => {
    const { lab } = setup();
    expect(await lab.fromDiagram()).toBeNull();
    expect(text("#iamGeneratedBody")).toMatch(/^AWS Studio is not ready yet/);
  });

  it("Review loads a generated policy into the editor and selects its first line", async () => {
    const { lab, input, storage } = setup({ getDiagram: () => templateDoc("serverless") });
    const result = await lab.fromDiagram();
    const [roleCard, trustCard] = roleCards();

    roleCard.querySelector(".iam-role-actions button").click();
    expect(input.value).toBe(formatPolicy(result.roles[0].policy));
    expect(storage.setItem).toHaveBeenLastCalledWith(STORAGE_KEY, input.value);
    expect(lab.review.kind).toBe("identity");
    expect(text("#iamScoreGrade")).toBe("grade A");
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 1]);
    expect(document.activeElement).toBe(input);

    trustCard.querySelector(".iam-role-actions button").click();
    expect(input.value).toBe(formatPolicy(result.roles[0].trust));
    expect(lab.review.kind).toBe("trust");
  });

  it("Copy writes the policy to the clipboard and resets its label", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    const { lab } = setup({ getDiagram: () => templateDoc("serverless") });
    const result = await lab.fromDiagram();
    const copy = roleCards()[0].querySelectorAll(".iam-role-actions button")[1];
    expect(copy.textContent).toBe("Copy");

    copy.click();
    await flush();
    expect(writeText).toHaveBeenCalledWith(formatPolicy(result.roles[0].policy));
    expect(copy.textContent).toBe("Copied");
    vi.advanceTimersByTime(1400);
    expect(copy.textContent).toBe("Copy");
  });

  it("Copy says so when the clipboard refuses", async () => {
    vi.useFakeTimers();
    stubClipboard(vi.fn(() => Promise.reject(new Error("denied"))));
    const { lab } = setup({ getDiagram: () => templateDoc("serverless") });
    await lab.fromDiagram();
    const copy = roleCards()[1].querySelectorAll(".iam-role-actions button")[1];
    copy.click();
    await flush();
    expect(copy.textContent).toBe("Copy failed");
    vi.advanceTimersByTime(1400);
    expect(copy.textContent).toBe("Copy");
  });

  it("Copy fails gracefully without a Clipboard API", async () => {
    const { lab } = setup({ getDiagram: () => templateDoc("serverless") });
    await lab.fromDiagram();
    const copy = roleCards()[2].querySelectorAll(".iam-role-actions button")[1];
    copy.click();
    await flush();
    expect(copy.textContent).toBe("Copy failed");
  });
});

describe("open in AWS Studio", () => {
  it("draws the access map of an identity policy", async () => {
    const openBlueprint = vi.fn(() => "opened");
    const { lab } = setup({ openBlueprint });
    $("#iamMapOpen").click();
    expect(openBlueprint).toHaveBeenCalledTimes(1);
    const [blueprint, message] = openBlueprint.mock.calls[0];
    expect(message).toBe("Drew the access map for this policy");
    expect(blueprint).toEqual(accessMapBlueprint(lab.review, { name: "IAM access map" }));
    expect(blueprint.name).toBe("IAM access map");
    expect(blueprint.nodes.map((node) => node.key)).toContain("svc-s3");
    expect(await lab.openMap()).toBe("opened");
  });

  it("draws the trust map of a trust policy", () => {
    const openBlueprint = vi.fn();
    const { lab } = setup({ openBlueprint });
    lab.load(SAMPLE_TRUST_POLICY);
    lab.openMap();
    const [blueprint, message] = openBlueprint.mock.calls[0];
    expect(message).toBe("Drew the trust map for this policy");
    expect(blueprint.name).toBe("IAM trust map");
    expect(blueprint.nodes.map((node) => node.key)).toEqual(["principal-0", "principal-1", "role"]);
  });

  it("does nothing when there is no policy to draw", async () => {
    const openBlueprint = vi.fn();
    const { lab } = setup({ openBlueprint });
    lab.load("");
    expect(await lab.openMap()).toBeNull();
    lab.load(BROKEN_JSON);
    expect(await lab.openMap()).toBeNull();
    expect(openBlueprint).not.toHaveBeenCalled();
  });

  it("is harmless when AWS Studio is not wired", async () => {
    const { lab } = setup();
    await expect(lab.openMap()).resolves.toBeUndefined();
  });
});
