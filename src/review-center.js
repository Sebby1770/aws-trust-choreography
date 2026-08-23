/**
 * Review Center turns the two visual labs into one explainable design review.
 * It consumes live state through injected providers and never inspects a real
 * AWS account or network.
 */

import { reviewAwsArchitecture } from "./aws-review-model.js";
import { estimateArchitectureCost, formatUsd } from "./cost-model.js";
import { scoreNetwork } from "./network-lab.js";

const SEVERITY_ORDER = { must: 0, improve: 1, passed: 2 };
const REVIEW_SCOPES = new Set(["combined", "aws", "network"]);

function average(values) {
  const valid = values.filter(Number.isFinite);
  return valid.length
    ? Math.round(valid.reduce((total, value) => total + value, 0) / valid.length)
    : 0;
}

function scoreTone(score) {
  if (score >= 75) return "strong";
  if (score >= 45) return "attention";
  return "risk";
}

function scoreDescription(score) {
  if (score >= 75) return "Strong evidence is visible in the diagram.";
  if (score >= 45) return "Useful foundations exist, with evidence still missing.";
  return "A material design gap is visible and deserves attention.";
}

function awsFinding(check) {
  return {
    id: `aws:${check.id}`,
    source: "aws",
    sourceLabel: "AWS Studio",
    category: check.category,
    status: check.tone === "fail" ? "must" : check.tone === "warn" ? "improve" : "passed",
    title: check.title,
    detail: check.detail,
    recommendation: check.recommendation || check.detail,
    target: { view: "studio", ...(check.target || {}) },
  };
}

const NETWORK_TARGETS = {
  addressing: { kind: "device", field: "ip" },
  redundancy: { kind: "library", query: "Load balancer" },
  security: { kind: "library", query: "Firewall" },
  services: { kind: "library", query: "DNS server" },
};

function networkFinding(check) {
  return {
    id: `network:${check.id}`,
    source: "network",
    sourceLabel: "Network Lab",
    category: check.id,
    status: check.score < 45 ? "must" : check.score < 75 ? "improve" : "passed",
    title: check.label,
    detail: check.message,
    recommendation: check.recommendation,
    target: { view: "network", ...(NETWORK_TARGETS[check.id] || {}) },
  };
}

function verdict(score) {
  if (score >= 85) return "Strong design evidence";
  if (score >= 70) return "Ready with focused changes";
  if (score >= 50) return "Important gaps remain";
  return "Early design stage";
}

function projectHasNodes(state) {
  return Boolean(state && Array.isArray(state.nodes) && state.nodes.length);
}

/**
 * Build one deterministic snapshot for rendering, copying, and downloading.
 * Blank labs are excluded from a combined score so they cannot dilute real work.
 */
export function createReviewSnapshot({
  awsState = null,
  networkState = null,
  scope = "combined",
} = {}) {
  const selectedScope = REVIEW_SCOPES.has(scope) ? scope : "combined";
  const awsAvailable = Boolean(awsState && Array.isArray(awsState.nodes));
  const networkAvailable = Boolean(networkState && Array.isArray(networkState.nodes));
  const awsHasDesign = projectHasNodes(awsState);
  const networkHasDesign = projectHasNodes(networkState);
  const includeAws =
    selectedScope === "aws" ? awsAvailable : selectedScope === "combined" && awsHasDesign;
  const includeNetwork =
    selectedScope === "network"
      ? networkAvailable
      : selectedScope === "combined" && networkHasDesign;

  const aws = awsAvailable ? reviewAwsArchitecture(awsState) : null;
  const network = networkAvailable ? scoreNetwork(networkState) : null;
  const awsCost = estimateArchitectureCost(awsState?.nodes || []);
  const findings = [];
  if (includeAws && aws) findings.push(...aws.checks.map(awsFinding));
  if (includeNetwork && network) findings.push(...network.checks.map(networkFinding));
  findings.sort(
    (left, right) =>
      SEVERITY_ORDER[left.status] - SEVERITY_ORDER[right.status] ||
      left.source.localeCompare(right.source) ||
      left.title.localeCompare(right.title)
  );

  const scores = [];
  if (includeAws && aws) scores.push({ source: "aws", value: aws.analysis.overall, weight: 0.65 });
  if (includeNetwork && network) {
    scores.push({ source: "network", value: network.score, weight: includeAws ? 0.35 : 1 });
  }
  const totalWeight = scores.reduce((total, item) => total + item.weight, 0);
  const score = totalWeight
    ? Math.round(scores.reduce((total, item) => total + item.value * item.weight, 0) / totalWeight)
    : 0;

  let lenses = [];
  if (includeAws && aws && includeNetwork && network) {
    const networkChecks = Object.fromEntries(network.checks.map((check) => [check.id, check]));
    lenses = [
      {
        id: "security",
        label: "Security",
        score: average([aws.analysis.security, networkChecks.security?.score]),
        detail: "Encryption, identity, edge controls, firewalls, and segmentation.",
      },
      {
        id: "reliability",
        label: "Reliability",
        score: average([aws.analysis.reliability, networkChecks.redundancy?.score]),
        detail: "Connected service paths, alternate routes, and failure tolerance.",
      },
      {
        id: "observability",
        label: "Observability",
        score: aws.analysis.observability,
        detail: "The monitoring and telemetry evidence represented in AWS Studio.",
      },
      {
        id: "recovery",
        label: "Recovery",
        score: aws.analysis.recovery,
        detail: "Durable data, backup intent, queues, and recovery coordination.",
      },
      {
        id: "network",
        label: "Network",
        score: network.score,
        detail: "Addressing, core services, boundaries, and packet-path fundamentals.",
      },
    ];
  } else if (includeAws && aws) {
    lenses = [
      ["security", "Security", aws.analysis.security, "Encryption, identity, and edge controls."],
      [
        "reliability",
        "Reliability",
        aws.analysis.reliability,
        "Service paths and failure tolerance.",
      ],
      [
        "observability",
        "Observability",
        aws.analysis.observability,
        "Monitoring and telemetry evidence.",
      ],
      ["recovery", "Recovery", aws.analysis.recovery, "Durable data and recovery intent."],
    ].map(([id, label, lensScore, detail]) => ({ id, label, score: lensScore, detail }));
  } else if (includeNetwork && network) {
    lenses = network.checks.map((check) => ({
      id: check.id,
      label: check.label,
      score: check.score,
      detail: check.message,
    }));
  }
  lenses = lenses.map((lens) => ({ ...lens, tone: scoreTone(lens.score) }));

  const mustCount = findings.filter((item) => item.status === "must").length;
  const improveCount = findings.filter((item) => item.status === "improve").length;
  const passedCount = findings.filter((item) => item.status === "passed").length;
  const openCount = mustCount + improveCount;
  const hasDesign = includeAws || includeNetwork;
  const summary = !hasDesign
    ? "Create an AWS architecture or network topology to generate a useful design review."
    : mustCount
      ? `${mustCount} must-fix ${mustCount === 1 ? "gap stands" : "gaps stand"} between this diagram and a confident handoff.`
      : improveCount
        ? `${improveCount} focused ${improveCount === 1 ? "improvement remains" : "improvements remain"} before a deeper technical review.`
        : "Every represented check passes. Validate the design against live configuration before production.";

  return {
    scope: selectedScope,
    score,
    tone: scoreTone(score),
    verdict: hasDesign ? verdict(score) : "No design evidence yet",
    summary,
    hasDesign,
    findings,
    lenses,
    mustCount,
    improveCount,
    passedCount,
    openCount,
    topFinding: findings.find((item) => item.status !== "passed") || null,
    aws: {
      available: awsAvailable,
      included: includeAws,
      name: awsState?.name || "Untitled AWS architecture",
      region: awsState?.region || "Region not set",
      nodes: awsState?.nodes?.length || 0,
      paths: awsState?.connections?.length || 0,
      cost: awsCost.total,
      analysis: aws?.analysis || null,
    },
    network: {
      available: networkAvailable,
      included: includeNetwork,
      name: networkState?.name || "Untitled network",
      nodes: networkState?.nodes?.length || 0,
      links: networkState?.links?.length || 0,
      analysis: network,
    },
  };
}

/** Create a portable, plain-English handoff report. */
export function buildReviewMarkdown(review, generatedAt = new Date()) {
  const findings = review?.findings || [];
  const open = findings.filter((item) => item.status !== "passed");
  const passed = findings.filter((item) => item.status === "passed");
  const lines = [
    "# Trust Choreography — Design Review",
    "",
    `Generated: ${generatedAt.toISOString()}`,
    `Scope: ${review?.scope || "combined"}`,
    `Readiness: ${review?.score ?? 0}/100 — ${review?.verdict || "Not reviewed"}`,
    "",
    review?.summary || "",
    "",
    "## Architecture passport",
    "",
    `- AWS: ${review?.aws?.name || "Not available"} (${review?.aws?.nodes || 0} services, ${review?.aws?.paths || 0} paths, ${review?.aws?.region || "region not set"})`,
    `- Network: ${review?.network?.name || "Not available"} (${review?.network?.nodes || 0} devices, ${review?.network?.links || 0} links)`,
    `- Planning estimate: ${formatUsd(review?.aws?.cost || 0)}/month`,
    `- Checks passed: ${review?.passedCount || 0}`,
    `- Open priorities: ${review?.openCount || 0}`,
    "",
    "## Open priorities",
    "",
  ];
  if (!open.length) lines.push("- No open diagram findings.");
  open.forEach((item) => {
    lines.push(
      `### ${item.status === "must" ? "Must fix" : "Improve"}: ${item.title}`,
      "",
      `Source: ${item.sourceLabel}`,
      "",
      item.detail,
      "",
      `Recommended action: ${item.recommendation}`,
      ""
    );
  });
  lines.push("## Passed checks", "");
  if (!passed.length) lines.push("- No checks have passed yet.");
  passed.forEach((item) => lines.push(`- ${item.sourceLabel}: ${item.title}`));
  lines.push(
    "",
    "---",
    "This report reviews evidence represented in the diagrams. It is not a live AWS account audit, penetration test, or certification."
  );
  return lines.join("\n");
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function downloadFile(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Mount the Review Center UI around live architecture providers. */
export function initReviewCenter({ getAwsState, getNetworkState, navigate, revealTarget } = {}) {
  const root = document.querySelector("#reviewCenter");
  if (!root || root.dataset.reviewInitialized === "true") return null;

  const controls = {
    scope: root.querySelector("#reviewScope"),
    modes: [...root.querySelectorAll("[data-review-mode]")],
    filters: [...root.querySelectorAll("[data-review-filter]")],
    scoreRing: root.querySelector("#reviewScoreRing"),
    score: root.querySelector("#reviewScore"),
    verdict: root.querySelector("#reviewVerdictTitle"),
    summary: root.querySelector("#reviewSummary"),
    fixTop: root.querySelector("#reviewFixTopButton"),
    refresh: root.querySelector("#reviewRefreshButton"),
    lenses: root.querySelector("#reviewLenses"),
    findings: root.querySelector("#reviewFindingsList"),
    findingsSummary: root.querySelector("#reviewFindingsSummary"),
    awsProject: root.querySelector("#reviewAwsProject"),
    awsMeta: root.querySelector("#reviewAwsMeta"),
    networkProject: root.querySelector("#reviewNetworkProject"),
    networkMeta: root.querySelector("#reviewNetworkMeta"),
    cost: root.querySelector("#reviewCost"),
    passportScore: root.querySelector("#reviewPassportScore"),
    passportAwsNodes: root.querySelector("#reviewPassportAwsNodes"),
    passportAwsPaths: root.querySelector("#reviewPassportAwsPaths"),
    passportNetworkNodes: root.querySelector("#reviewPassportNetworkNodes"),
    passportNetworkLinks: root.querySelector("#reviewPassportNetworkLinks"),
    passportPassed: root.querySelector("#reviewPassportPassed"),
    passportOpen: root.querySelector("#reviewPassportOpen"),
    copy: root.querySelector("#reviewCopyButton"),
    downloadMarkdown: root.querySelector("#reviewDownloadMarkdownButton"),
    downloadJson: root.querySelector("#reviewDownloadJsonButton"),
    status: root.querySelector("#reviewStatus"),
  };
  let mode = "guided";
  let filter = "all";
  let currentReview = null;

  function announce(message) {
    if (controls.status) controls.status.textContent = message;
  }

  async function openTarget(target) {
    if (!target?.view) return;
    navigate?.(target.view);
    if (await revealTarget?.(target)) return;
    window.requestAnimationFrame(() => {
      const search =
        target.view === "studio"
          ? document.querySelector("#flowIconSearch")
          : document.querySelector("#networkDeviceSearch");
      if (search && target.query) {
        search.value = target.query;
        search.dispatchEvent(new Event("input", { bubbles: true }));
        search.focus();
      }
    });
  }

  function renderLenses() {
    controls.lenses.replaceChildren();
    currentReview.lenses.forEach((lens) => {
      const card = element("article", `review-lens is-${lens.tone}`);
      card.style.setProperty("--lens-score", `${lens.score}%`);
      const top = element("div", "review-lens-top");
      top.append(element("span", "", lens.label), element("strong", "", String(lens.score)));
      const meter = element("span", "review-lens-meter");
      meter.append(element("i"));
      card.append(top, meter, element("p", "", lens.detail || scoreDescription(lens.score)));
      controls.lenses.append(card);
    });
  }

  function visibleFindings() {
    let items = [...currentReview.findings];
    if (filter !== "all") items = items.filter((item) => item.status === filter);
    if (mode === "guided" && filter === "all") {
      const priorities = items.filter((item) => item.status !== "passed");
      items = priorities.length ? priorities.slice(0, 3) : items.slice(0, 3);
    }
    return items;
  }

  function renderFindings() {
    const items = visibleFindings();
    controls.findings.replaceChildren();
    controls.findingsSummary.textContent = currentReview.openCount
      ? `${currentReview.openCount} open priorit${currentReview.openCount === 1 ? "y" : "ies"} · ${currentReview.passedCount} checks passed`
      : `${currentReview.passedCount} represented checks passed`;

    if (!items.length) {
      const empty = element("div", "review-findings-empty");
      empty.append(
        element(
          "strong",
          "",
          filter === "passed" ? "No passed checks yet." : "Nothing in this filter."
        ),
        element("p", "", "Change the filter or add more evidence to the diagrams.")
      );
      controls.findings.append(empty);
      return;
    }

    items.forEach((item, index) => {
      const card = element("details", `review-finding is-${item.status}`);
      if (mode === "guided" && index === 0) card.open = true;
      const summary = element("summary");
      const marker = element("span", "review-finding-marker");
      marker.setAttribute("aria-hidden", "true");
      marker.textContent = item.status === "must" ? "!" : item.status === "improve" ? "↗" : "✓";
      const heading = element("span", "review-finding-heading");
      heading.append(
        element(
          "small",
          "",
          `${item.sourceLabel} · ${item.status === "must" ? "Must fix" : item.status === "improve" ? "Improve" : "Passed"}`
        ),
        element("strong", "", item.title),
        element("span", "", item.detail)
      );
      summary.append(marker, heading, element("i", "review-finding-chevron", "+"));

      const evidence = element("div", "review-finding-evidence");
      const why = element("div");
      why.append(element("span", "", "Evidence"), element("p", "", item.detail));
      const action = element("div");
      action.append(
        element("span", "", item.status === "passed" ? "Keep it strong" : "Recommended action"),
        element("p", "", item.recommendation)
      );
      evidence.append(why, action);
      if (item.status !== "passed") {
        const button = element(
          "button",
          "review-finding-action",
          `Fix in ${item.source === "aws" ? "AWS Studio" : "Network Lab"} ↗`
        );
        button.type = "button";
        button.addEventListener("click", () => openTarget(item.target));
        evidence.append(button);
      }
      card.append(summary, evidence);
      controls.findings.append(card);
    });
  }

  function render() {
    root.dataset.reviewMode = mode;
    root.dataset.reviewTone = currentReview.tone;
    controls.score.textContent = String(currentReview.score);
    controls.scoreRing.style.setProperty("--review-score", `${currentReview.score}%`);
    controls.verdict.textContent = currentReview.verdict;
    controls.summary.textContent = currentReview.summary;
    controls.fixTop.disabled = !currentReview.topFinding;
    controls.fixTop.textContent = currentReview.topFinding
      ? `Fix: ${currentReview.topFinding.title} ↗`
      : "No open priorities";
    controls.awsProject.textContent = currentReview.aws.available
      ? currentReview.aws.name
      : "AWS Studio not loaded";
    controls.awsMeta.textContent = currentReview.aws.available
      ? `${currentReview.aws.region} · ${currentReview.aws.nodes} services · ${currentReview.aws.paths} paths`
      : "Open AWS Studio to create a project";
    controls.networkProject.textContent = currentReview.network.available
      ? currentReview.network.name
      : "Network Lab not loaded";
    controls.networkMeta.textContent = currentReview.network.available
      ? `${currentReview.network.nodes} devices · ${currentReview.network.links} links`
      : "Open Network Lab to create a topology";
    controls.cost.textContent = `${formatUsd(currentReview.aws.cost)}/mo`;
    controls.passportScore.textContent = `${currentReview.score}/100`;
    controls.passportAwsNodes.textContent = String(currentReview.aws.nodes);
    controls.passportAwsPaths.textContent = String(currentReview.aws.paths);
    controls.passportNetworkNodes.textContent = String(currentReview.network.nodes);
    controls.passportNetworkLinks.textContent = String(currentReview.network.links);
    controls.passportPassed.textContent = String(currentReview.passedCount);
    controls.passportOpen.textContent = String(currentReview.openCount);
    renderLenses();
    renderFindings();
  }

  function refresh({ announceUpdate = false } = {}) {
    currentReview = createReviewSnapshot({
      awsState: getAwsState?.() || null,
      networkState: getNetworkState?.() || null,
      scope: controls.scope?.value || "combined",
    });
    render();
    if (announceUpdate) announce("Design review refreshed from both labs.");
    return currentReview;
  }

  controls.scope?.addEventListener("change", () => refresh({ announceUpdate: true }));
  controls.modes.forEach((button) => {
    button.addEventListener("click", () => {
      mode = button.dataset.reviewMode === "evidence" ? "evidence" : "guided";
      controls.modes.forEach((item) => {
        const active = item.dataset.reviewMode === mode;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderFindings();
      root.dataset.reviewMode = mode;
    });
  });
  controls.filters.forEach((button) => {
    button.addEventListener("click", () => {
      filter = button.dataset.reviewFilter || "all";
      controls.filters.forEach((item) => {
        const active = item.dataset.reviewFilter === filter;
        item.classList.toggle("is-active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderFindings();
    });
  });
  controls.refresh?.addEventListener("click", () => refresh({ announceUpdate: true }));
  controls.fixTop?.addEventListener("click", () => openTarget(currentReview?.topFinding?.target));
  root.querySelectorAll("[data-review-open]").forEach((button) => {
    button.addEventListener("click", () => navigate?.(button.dataset.reviewOpen));
  });
  controls.copy?.addEventListener("click", async () => {
    const markdown = buildReviewMarkdown(currentReview);
    try {
      await navigator.clipboard.writeText(markdown);
      announce("Design review copied to the clipboard.");
    } catch {
      console.log(markdown);
      announce("Clipboard access is blocked; the review was written to the browser console.");
    }
  });
  controls.downloadMarkdown?.addEventListener("click", () => {
    downloadFile(
      "trust-choreography-review.md",
      "text/markdown",
      buildReviewMarkdown(currentReview)
    );
    announce("Markdown review downloaded.");
  });
  controls.downloadJson?.addEventListener("click", () => {
    downloadFile(
      "trust-choreography-review.json",
      "application/json",
      JSON.stringify({ generatedAt: new Date().toISOString(), ...currentReview }, null, 2)
    );
    announce("JSON review downloaded.");
  });

  window.addEventListener("atlas:studioready", () => refresh());
  window.addEventListener("trust:designchange", () => refresh());
  window.addEventListener("atlas:viewchange", (event) => {
    if (event.detail?.view === "review") refresh();
  });
  root.dataset.reviewInitialized = "true";
  refresh();

  return {
    refresh,
    getSnapshot: () => currentReview,
    copy: () => controls.copy?.click(),
    downloadMarkdown: () => controls.downloadMarkdown?.click(),
    downloadJson: () => controls.downloadJson?.click(),
  };
}
