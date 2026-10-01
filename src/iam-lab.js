/**
 * IAM Review workspace controller.
 *
 * Paste a policy on the left; findings, a score and an access map appear on
 * the right as you type. "From diagram" goes the other way, writing
 * least-privilege roles for the arrows drawn in AWS Studio. Rendering builds
 * DOM nodes (never innerHTML) so pasted text can never become markup.
 */

import {
  ACCESS_LEVELS,
  accessMapBlueprint,
  analyzePolicy,
  formatPolicy,
  leastPrivilegeFromDiagram,
  PLACEHOLDER_ACCOUNT,
  SAMPLE_POLICY,
  SAMPLE_TRUST_POLICY,
} from "./iam-policy.js";

const STORAGE_KEY = "trust-choreography:iam-policy:v1";
const DEBOUNCE_MS = 160;

const SEVERITY_LABEL = {
  invalid: "Invalid",
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
  info: "Note",
};

const KIND_LABEL = {
  identity: "Identity policy",
  resource: "Resource policy",
  trust: "Trust policy",
};

const LEVEL_LABEL = {
  list: "List",
  read: "Read",
  tagging: "Tag",
  write: "Write",
  permissions: "Permissions",
  all: "Full",
};

function make(doc, tag, className, text) {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = text;
  return element;
}

/**
 * @param {object} [options]
 * @param {(blueprint: object, message: string) => Promise<unknown>|unknown} [options.openBlueprint]
 *   draw a blueprint in AWS Studio
 * @param {() => Promise<object|null>|object|null} [options.getDiagram] the studio's current page
 */
export function initIamLab({
  root = document,
  storage = globalThis.localStorage,
  openBlueprint,
  getDiagram,
} = {}) {
  const input = root.querySelector("#iamInput");
  if (!input) return null;
  const doc = input.ownerDocument;
  const el = (selector) => root.querySelector(selector);
  const scoreBox = el("#iamScore");
  const scoreValue = el("#iamScoreValue");
  const scoreGrade = el("#iamScoreGrade");
  const countsBox = el("#iamCounts");
  const kindBadge = el("#iamKind");
  const stats = el("#iamStats");
  const mapBox = el("#iamMap");
  const mapBody = el("#iamMapBody");
  const mapTitle = el("#iamMapTitle");
  const mapOpen = el("#iamMapOpen");
  const findingsBox = el("#iamFindings");
  const generated = el("#iamGenerated");
  const generatedBody = el("#iamGeneratedBody");
  const generatedStats = el("#iamGeneratedStats");

  let latest = analyzePolicy("");
  let timer = null;

  function save() {
    try {
      storage?.setItem(STORAGE_KEY, input.value);
    } catch {
      /* storage unavailable */
    }
  }

  /**
   * Vertical offset of a character inside the textarea, measured with a
   * hidden mirror so soft-wrapped long lines (ARNs, action lists) count.
   */
  function offsetOf(position) {
    const style = globalThis.getComputedStyle?.(input);
    if (!style) return 0;
    const mirror = doc.createElement("div");
    for (const prop of [
      "fontFamily",
      "fontSize",
      "fontWeight",
      "lineHeight",
      "letterSpacing",
      "tabSize",
    ]) {
      mirror.style[prop] = style[prop];
    }
    const padding =
      (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
    Object.assign(mirror.style, {
      position: "absolute",
      visibility: "hidden",
      top: "0",
      left: "-9999px",
      width: `${Math.max(0, input.clientWidth - padding)}px`,
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
    });
    mirror.textContent = input.value.slice(0, position);
    const marker = make(doc, "span", "", "\u200b");
    mirror.append(marker);
    doc.body.append(mirror);
    const top = marker.offsetTop;
    mirror.remove();
    return top;
  }

  function jumpToLine(line) {
    if (!line) return;
    const lines = input.value.split("\n");
    const start = lines.slice(0, line - 1).reduce((sum, text) => sum + text.length + 1, 0);
    const end = start + (lines[line - 1]?.length ?? 0);
    input.focus();
    input.setSelectionRange(start, end);
    const lineHeight = Number.parseFloat(globalThis.getComputedStyle?.(input).lineHeight) || 20;
    input.scrollTop = Math.max(0, offsetOf(start) - lineHeight * 2);
  }

  // ------------------------------------------------------------ rendering

  function renderScore(review) {
    if (review.empty) {
      scoreValue.textContent = "—";
      scoreGrade.textContent = "no policy yet";
      scoreBox.removeAttribute("data-grade");
      countsBox.replaceChildren();
      kindBadge.hidden = true;
      return;
    }
    scoreValue.textContent = review.score === null ? "—" : String(review.score);
    scoreGrade.textContent = `grade ${review.grade}`;
    scoreBox.dataset.grade = review.grade;
    kindBadge.hidden = !review.statements.length;
    kindBadge.textContent = KIND_LABEL[review.kind];
    countsBox.replaceChildren();
    for (const severity of ["invalid", "critical", "high", "medium", "low"]) {
      const count = review.counts[severity];
      if (!count) continue;
      const chip = make(
        doc,
        "span",
        `iam-count is-${severity}`,
        `${count} ${SEVERITY_LABEL[severity].toLowerCase()}`
      );
      countsBox.append(chip);
    }
    if (!countsBox.childElementCount && !review.errors.length) {
      countsBox.append(make(doc, "span", "iam-count is-clean", "No findings"));
    }
  }

  function renderStats(review) {
    if (review.empty) {
      stats.textContent = "Analysed in this browser — nothing is sent anywhere.";
      return;
    }
    if (!review.statements.length) {
      const error = review.errors[0];
      stats.textContent = error
        ? `${error.message}${error.line ? ` (line ${error.line})` : ""}`
        : "";
      return;
    }
    const { allow, deny, actions, services } = review.summary;
    const issues = review.findings.filter((finding) => finding.severity !== "info").length;
    // This line is the one live region, so it carries the verdict too.
    stats.textContent = `${KIND_LABEL[review.kind]} · ${allow} allow / ${deny} deny statement${allow + deny === 1 ? "" : "s"} · ${actions} action${actions === 1 ? "" : "s"} across ${services} service${services === 1 ? "" : "s"} · grade ${review.grade}, ${issues} finding${issues === 1 ? "" : "s"}`;
  }

  function levelMeter(service) {
    const meter = make(doc, "span", "iam-meter");
    meter.setAttribute("role", "img");
    meter.setAttribute(
      "aria-label",
      `Access level: ${service.level ? LEVEL_LABEL[service.level] : "denied"}`
    );
    for (const level of ACCESS_LEVELS) {
      const cell = make(
        doc,
        "i",
        `iam-meter-cell${service.levels.includes(level) ? " is-on" : ""}`
      );
      cell.title = LEVEL_LABEL[level];
      meter.append(cell);
    }
    return meter;
  }

  function renderMap(review) {
    mapBody.replaceChildren();
    const trust = review.kind === "trust";
    const rows = trust ? review.principals : review.services;
    mapBox.hidden = review.empty || !rows.length;
    if (mapBox.hidden) return;
    mapTitle.textContent = trust ? "Who can assume this role" : "What this policy can reach";

    if (trust) {
      for (const principal of review.principals) {
        const row = make(doc, "div", "iam-map-row");
        const denied = principal.effect === "Deny";
        // Risk follows the findings raised on this principal's statements.
        const severities = review.findings
          .filter((finding) => principal.statements.includes(finding.statement))
          .map((finding) => finding.severity);
        row.dataset.risk = denied
          ? "none"
          : (["critical", "high", "medium"].find((level) => severities.includes(level)) ?? "low");
        row.append(
          make(doc, "strong", "iam-map-service", principal.label),
          make(doc, "span", "iam-map-level", principal.type),
          make(
            doc,
            "small",
            "iam-map-detail",
            `${denied ? "explicitly denied" : "can assume"} · ${principal.conditional ? "with condition" : "no condition"}`
          )
        );
        mapBody.append(row);
      }
      return;
    }

    const legend = make(doc, "div", "iam-map-legend");
    legend.setAttribute("aria-hidden", "true");
    const letters = make(doc, "span", "iam-meter");
    for (const level of ACCESS_LEVELS) {
      const letter = make(doc, "i", "", LEVEL_LABEL[level][0]);
      letter.title = LEVEL_LABEL[level];
      letters.append(letter);
    }
    legend.append(make(doc, "span", "", "Service"), letters, make(doc, "span", "", "Scope"));
    mapBody.append(legend);
    for (const service of review.services) {
      const row = make(doc, "div", "iam-map-row");
      row.dataset.risk = service.risk;
      const name = make(doc, "strong", "iam-map-service", service.label);
      name.title = service.actions.join("\n") || service.denied.join("\n");
      const detail = make(
        doc,
        "small",
        "iam-map-detail",
        service.allow
          ? `${service.actions.length} action${service.actions.length === 1 ? "" : "s"} · ${service.everywhere ? "all resources" : `${service.resources.length} resource${service.resources.length === 1 ? "" : "s"}`}${service.conditional ? " · conditional" : ""}${service.deny ? " · partly denied" : ""}`
          : `denied: ${service.denied.join(", ")}`
      );
      row.append(name, levelMeter(service), detail);
      mapBody.append(row);
    }
  }

  function renderFindings(review) {
    findingsBox.replaceChildren();
    if (review.empty) {
      findingsBox.append(
        make(
          doc,
          "p",
          "iam-empty",
          "Paste an IAM policy on the left — or try the example — to see findings here."
        )
      );
      return;
    }
    if (!review.findings.length) {
      findingsBox.append(
        make(doc, "p", "iam-clean", "No issues found. This policy is narrowly scoped.")
      );
      return;
    }
    for (const finding of review.findings) {
      const card = make(doc, "article", `iam-finding is-${finding.severity}`);
      const header = make(doc, "header");
      header.append(
        make(doc, "span", "iam-sev", SEVERITY_LABEL[finding.severity]),
        make(doc, "strong", "", finding.title)
      );
      if (finding.line) {
        const jump = make(
          doc,
          "button",
          "iam-line",
          `${finding.sid ? `${finding.sid} · ` : ""}line ${finding.line}`
        );
        jump.type = "button";
        jump.title = "Show this statement in the editor";
        jump.addEventListener("click", () => jumpToLine(finding.line));
        header.append(jump);
      }
      card.append(header, make(doc, "p", "", finding.detail));
      if (finding.fix) card.append(make(doc, "p", "iam-fix", finding.fix));
      findingsBox.append(card);
    }
  }

  function analyse() {
    latest = analyzePolicy(input.value);
    renderScore(latest);
    renderStats(latest);
    renderMap(latest);
    renderFindings(latest);
    return latest;
  }

  function schedule() {
    globalThis.clearTimeout(timer);
    timer = globalThis.setTimeout(() => {
      analyse();
      save();
    }, DEBOUNCE_MS);
  }

  function load(text) {
    input.value = text;
    analyse();
    save();
  }

  // -------------------------------------------------------- from diagram

  function policyCard(title, kind, policy, extra = null) {
    const card = make(doc, "article", "iam-role");
    const head = make(doc, "header");
    const titles = make(doc, "div");
    titles.append(make(doc, "strong", "", title), make(doc, "small", "", kind));
    const actions = make(doc, "div", "iam-role-actions");
    const review = make(doc, "button", "", "Review");
    review.type = "button";
    review.title = "Load this policy into the editor";
    review.addEventListener("click", () => {
      load(formatPolicy(policy));
      jumpToLine(1);
    });
    const copy = make(doc, "button", "", "Copy");
    copy.type = "button";
    copy.addEventListener("click", async () => {
      try {
        await globalThis.navigator.clipboard.writeText(formatPolicy(policy));
        copy.textContent = "Copied";
      } catch {
        copy.textContent = "Copy failed";
      }
      globalThis.setTimeout(() => (copy.textContent = "Copy"), 1400);
    });
    actions.append(review, copy);
    head.append(titles, actions);
    card.append(head);
    const statements = policy.Statement.length;
    const actionCount = new Set(
      policy.Statement.flatMap((statement) => [].concat(statement.Action))
    ).size;
    card.append(
      make(
        doc,
        "p",
        "iam-role-summary",
        `${statements} statement${statements === 1 ? "" : "s"} · ${actionCount} action${actionCount === 1 ? "" : "s"}${extra ? ` · ${extra}` : ""}`
      )
    );
    const details = make(doc, "details", "iam-role-json");
    details.append(
      make(doc, "summary", "", "Show JSON"),
      make(doc, "pre", "", formatPolicy(policy))
    );
    card.append(details);
    return card;
  }

  async function fromDiagram() {
    generated.hidden = false;
    generatedBody.replaceChildren(make(doc, "p", "iam-empty", "Reading the AWS Studio diagram…"));
    generatedStats.textContent = "";
    let diagram = null;
    try {
      diagram = await getDiagram?.();
    } catch {
      diagram = null;
    }
    generatedBody.replaceChildren();
    if (!diagram) {
      generatedBody.append(
        make(doc, "p", "iam-empty", "AWS Studio is not ready yet — open it once, then try again.")
      );
      return null;
    }
    const result = leastPrivilegeFromDiagram(diagram);
    const total = result.roles.length + result.resourcePolicies.length;
    generatedStats.textContent = total
      ? `${result.roles.length} role${result.roles.length === 1 ? "" : "s"} and ${result.resourcePolicies.length} resource polic${result.resourcePolicies.length === 1 ? "y" : "ies"} from “${diagram.name || "this diagram"}”. Replace ${PLACEHOLDER_ACCOUNT} and REPLACE-WITH-… values with your own.`
      : "";
    if (!total) {
      generatedBody.append(
        make(
          doc,
          "p",
          "iam-empty",
          "No IAM relationships found. Draw arrows from compute (Lambda, ECS, EC2, Step Functions…) to the services it calls, then try again."
        )
      );
    }
    for (const role of result.roles) {
      const grade = analyzePolicy(role.policy).grade;
      generatedBody.append(
        policyCard(role.roleName, `${role.kind} for ${role.name}`, role.policy, `grade ${grade}`)
      );
      const trust = policyCard(`${role.roleName} trust`, "Who can assume it", role.trust);
      trust.classList.add("is-trust");
      generatedBody.append(trust);
    }
    for (const policy of result.resourcePolicies) {
      generatedBody.append(policyCard(policy.name, policy.kind, policy.policy));
    }
    if (result.skipped.length) {
      generatedBody.append(
        make(
          doc,
          "p",
          "iam-skipped",
          `No IAM permission needed (network path or managed integration): ${result.skipped.join(", ")}.`
        )
      );
    }
    generated.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    return result;
  }

  async function openMap() {
    if (latest.empty || !latest.statements.length) return null;
    const blueprint = accessMapBlueprint(latest, {
      name: latest.kind === "trust" ? "IAM trust map" : "IAM access map",
    });
    return openBlueprint?.(
      blueprint,
      `Drew the ${latest.kind === "trust" ? "trust" : "access"} map for this policy`
    );
  }

  // ---------------------------------------------------------------- wiring

  input.addEventListener("input", schedule);
  // Tab is left to the browser so keyboard users can move on to the report.
  el("#iamSample")?.addEventListener("click", () => load(SAMPLE_POLICY));
  el("#iamTrustSample")?.addEventListener("click", () => load(SAMPLE_TRUST_POLICY));
  el("#iamClear")?.addEventListener("click", () => {
    load("");
    input.focus();
  });
  el("#iamFormat")?.addEventListener("click", () => {
    try {
      load(formatPolicy(JSON.parse(input.value)));
    } catch {
      analyse();
    }
  });
  el("#iamFromDiagram")?.addEventListener("click", fromDiagram);
  mapOpen?.addEventListener("click", openMap);

  let initial = "";
  try {
    initial = storage?.getItem(STORAGE_KEY) ?? "";
  } catch {
    initial = "";
  }
  input.value = initial || SAMPLE_POLICY;
  analyse();

  return {
    analyse,
    load,
    fromDiagram,
    openMap,
    jumpToLine,
    get review() {
      return latest;
    },
  };
}
