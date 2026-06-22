/**
 * Atlas DOM controller.
 *
 * Binds the pure resilience model (scenarios, faults, composition) to the
 * incident-command UI: scenario tabs, the service topology, the failure
 * composer, telemetry, runbooks, posture, and doctrine. Also keeps the view
 * shareable via the URL hash and respects the user's reduced-motion preference.
 */

import {
  scenarios,
  runbooks,
  postures,
  doctrines,
  failureModes,
  nodeHints,
  nodeLinks,
  deriveComposedState,
} from "./resilience-model.js";
import { prefersReducedMotion } from "./theme.js";
import { readStateFromUrl, syncStateToUrl } from "./url-state.js";
import { initCommandPalette } from "./command-palette.js";
import { buildIncidentReport } from "./incident-report.js";

export function initAtlas({ theme } = {}) {
  const scenarioButtons = document.querySelectorAll(".scenario");
  const root = document.querySelector(".grid-window");
  const replayButton = document.querySelector("#replayButton");
  const incidentButton = document.querySelector("#incidentButton");
  const shareButton = document.querySelector("#shareButton");
  const serviceNodes = document.querySelectorAll(".service-node");
  const mapSvg = document.querySelector("svg.map");

  if (!root || !scenarioButtons.length) return;

  const textTargets = {
    scenarioTitle: document.querySelector("#scenarioTitle"),
    scenarioMeta: document.querySelector("#scenarioMeta"),
    routeHealth: document.querySelector("#routeHealth"),
    fallbackReady: document.querySelector("#fallbackReady"),
    dataDurability: document.querySelector("#dataDurability"),
    recoveryEta: document.querySelector("#recoveryEta"),
    nodeName: document.querySelector("#nodeName"),
    nodeScore: document.querySelector("#nodeScore"),
    nodeCopy: document.querySelector("#nodeCopy"),
    nodeLink: document.querySelector("#nodeLink"),
    runbookTitle: document.querySelector("#runbookTitle"),
    runbookSteps: document.querySelector("#runbookSteps"),
    postureTitle: document.querySelector("#postureTitle"),
    postureGrid: document.querySelector("#postureGrid"),
    doctrineTitle: document.querySelector("#doctrineTitle"),
    doctrineGrid: document.querySelector("#doctrineGrid"),
    failureComposerSummary: document.querySelector("#failureComposerSummary"),
    failureControls: document.querySelector("#failureControls"),
    blastRadius: document.querySelector("#blastRadius"),
    weakestNode: document.querySelector("#weakestNode"),
    composedRecovery: document.querySelector("#composedRecovery"),
    failureRecommendation: document.querySelector("#failureRecommendation"),
    clearFailuresButton: document.querySelector("#clearFailuresButton"),
  };

  let activeScenario = "steady";
  let selectedNode = "Step Functions core";
  const activeFailures = new Set();

  function persistToUrl() {
    syncStateToUrl({ scenario: activeScenario, failures: activeFailures, node: selectedNode });
  }

  function updateScoreLabels(scores, impactedNodes) {
    serviceNodes.forEach((node) => {
      const name = node.dataset.node;
      const score = scores[name] || node.dataset.score;
      node.dataset.score = score;
      node.classList.toggle("is-impacted", impactedNodes.has(name));
      const scoreLabel = node.querySelector(".score");
      if (scoreLabel) {
        scoreLabel.textContent = `${score}%`;
      }
    });
  }

  function renderComposedState(name) {
    const composed = deriveComposedState(name, activeFailures);
    textTargets.routeHealth.textContent = `${composed.routeHealth}%`;
    textTargets.fallbackReady.textContent = `${composed.fallbackReady}%`;
    textTargets.dataDurability.textContent = composed.dataDurability.toFixed(2);
    textTargets.recoveryEta.textContent = `${String(composed.recoveryMinutes).padStart(2, "0")}m`;
    textTargets.failureComposerSummary.textContent = composed.summary;
    textTargets.blastRadius.textContent = composed.blastRadius;
    textTargets.weakestNode.textContent = `${composed.weakestNode} (${composed.weakestScore}%)`;
    textTargets.composedRecovery.textContent = `${String(composed.recoveryMinutes).padStart(2, "0")}m`;
    textTargets.failureRecommendation.textContent = composed.recommendation;
    textTargets.clearFailuresButton.disabled = activeFailures.size === 0;
    root.classList.toggle("has-injected-failures", activeFailures.size > 0);
    textTargets.failureControls.querySelectorAll("[data-failure-mode]").forEach((button) => {
      const isActive = activeFailures.has(button.dataset.failureMode);
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });
    updateScoreLabels(composed.scores, composed.impactedNodes);
    return composed;
  }

  function renderRunbook(name) {
    const runbook = runbooks[name] || runbooks.steady;
    textTargets.runbookTitle.textContent = runbook.title;
    textTargets.runbookSteps.innerHTML = runbook.steps
      .map(
        (step, index) => `
      <article class="runbook-step ${step.state}">
        <span>${String(index + 1).padStart(2, "0")}</span>
        <strong>${step.label}</strong>
        <p>${step.detail}</p>
      </article>
    `
      )
      .join("");
  }

  function renderPosture(name) {
    const posture = postures[name] || postures.steady;
    textTargets.postureTitle.textContent = posture.title;
    textTargets.postureGrid.innerHTML = posture.lenses
      .map((lens) => {
        const tone = lens.score >= 85 ? "strong" : lens.score >= 72 ? "watch" : "strained";
        return `
      <article class="posture-card ${tone}" style="--score:${lens.score}%">
        <div>
          <span>${lens.name}</span>
          <strong>${lens.score}%</strong>
        </div>
        <p>${lens.detail}</p>
        <small>Lever: ${lens.lever}</small>
        <span class="posture-bar"><span></span></span>
      </article>
    `;
      })
      .join("");
  }

  function renderDoctrine(name) {
    const doctrine = doctrines[name] || doctrines.steady;
    textTargets.doctrineTitle.textContent = doctrine.title;
    textTargets.doctrineGrid.innerHTML = doctrine.cards
      .map(
        (card) => `
      <article class="doctrine-card">
        <span>${card.label}</span>
        <strong>${card.value}</strong>
        <p>${card.detail}</p>
      </article>
    `
      )
      .join("");
  }

  function setNode(name, { sync = true } = {}) {
    const composed = deriveComposedState(activeScenario, activeFailures);
    selectedNode = name;
    const score =
      composed.scores[name] ||
      document.querySelector(`[data-node="${name}"]`)?.dataset.score ||
      "84";

    serviceNodes.forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.node === name);
    });

    textTargets.nodeName.textContent = name;
    textTargets.nodeScore.textContent = `${score}%`;
    textTargets.nodeCopy.textContent =
      nodeHints[name] || "Signal is moving cleanly through this trust path.";

    const link = nodeLinks[name] || { href: "https://aws.amazon.com/", label: "AWS" };
    textTargets.nodeLink.href = link.href;
    textTargets.nodeLink.textContent = link.label;
    if (sync) persistToUrl();
  }

  function setScenario(name, { sync = true } = {}) {
    const scenario = scenarios[name];
    if (!scenario) return;
    activeScenario = name;

    scenarioButtons.forEach((button) => {
      const isActive = button.dataset.scenario === name;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    });

    textTargets.scenarioTitle.textContent = scenario.title;
    textTargets.scenarioMeta.textContent = scenario.meta;
    renderRunbook(name);
    renderPosture(name);
    renderDoctrine(name);
    renderComposedState(name);
    setNode(selectedNode, { sync: false });
    if (sync) persistToUrl();
  }

  // --- Event wiring -------------------------------------------------------

  scenarioButtons.forEach((button) => {
    button.addEventListener("click", () => setScenario(button.dataset.scenario));
  });

  function toggleFailure(modeId) {
    if (!failureModes[modeId]) return;
    if (activeFailures.has(modeId)) {
      activeFailures.delete(modeId);
    } else {
      activeFailures.add(modeId);
    }
    renderComposedState(activeScenario);
    setNode(selectedNode, { sync: false });
    persistToUrl();
  }

  function clearFailures() {
    activeFailures.clear();
    renderComposedState(activeScenario);
    setNode(selectedNode, { sync: false });
    persistToUrl();
  }

  textTargets.failureControls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-failure-mode]");
    if (button) toggleFailure(button.dataset.failureMode);
  });

  textTargets.clearFailuresButton.addEventListener("click", clearFailures);

  serviceNodes.forEach((node) => {
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.addEventListener("click", () => setNode(node.dataset.node));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setNode(node.dataset.node);
      }
    });
  });

  if (replayButton) {
    replayButton.addEventListener("click", () => {
      if (prefersReducedMotion()) {
        // Honour reduced motion: flash the live region instead of animating.
        root.classList.add("is-replay-static");
        window.setTimeout(() => root.classList.remove("is-replay-static"), 600);
        return;
      }
      root.classList.remove("is-replaying");
      window.requestAnimationFrame(() => root.classList.add("is-replaying"));
    });
  }

  if (incidentButton) {
    incidentButton.addEventListener("click", () => {
      root.classList.toggle("is-incident");
      setScenario(root.classList.contains("is-incident") ? "identity" : "steady");
    });
  }

  if (shareButton) {
    shareButton.addEventListener("click", async () => {
      persistToUrl();
      const original =
        shareButton.dataset.label || shareButton.getAttribute("aria-label") || "Copy link";
      shareButton.dataset.label = original;
      try {
        await navigator.clipboard.writeText(window.location.href);
        shareButton.classList.add("is-copied");
        shareButton.setAttribute("aria-label", "Link copied");
        shareButton.setAttribute("title", "Link copied");
        window.setTimeout(() => {
          shareButton.classList.remove("is-copied");
          shareButton.setAttribute("aria-label", original);
          shareButton.setAttribute("title", original);
        }, 1600);
      } catch {
        // Clipboard blocked (insecure context) — the hash is still updated so
        // the user can copy the address bar manually.
        shareButton.setAttribute("title", "Copy the URL from the address bar");
      }
    });
  }

  window.addEventListener("animationend", (event) => {
    if (event.animationName === "nodePing") {
      root.classList.remove("is-replaying");
    }
  });

  // Reduced motion: freeze the SVG choreography (SMIL animations can't be
  // paused with CSS, so use the SVG animation API).
  function applyMotionPreference() {
    if (!mapSvg || typeof mapSvg.pauseAnimations !== "function") return;
    if (prefersReducedMotion()) {
      mapSvg.pauseAnimations();
      root.classList.add("reduced-motion");
    } else {
      mapSvg.unpauseAnimations();
      root.classList.remove("reduced-motion");
    }
  }
  applyMotionPreference();
  if (typeof window.matchMedia === "function") {
    window
      .matchMedia("(prefers-reduced-motion: reduce)")
      .addEventListener("change", applyMotionPreference);
  }

  // --- Boot from URL or defaults -----------------------------------------

  const initial = readStateFromUrl();
  if (initial.failures.length) {
    initial.failures.forEach((id) => {
      if (failureModes[id]) activeFailures.add(id);
    });
  }
  if (initial.node && nodeHints[initial.node]) {
    selectedNode = initial.node;
  }
  setScenario(initial.scenario || activeScenario, { sync: false });
  // Reflect the resolved (sanitised) state back into the URL.
  persistToUrl();

  // --- Lightweight toast for transient confirmations ---------------------

  let toastEl = null;
  let toastTimer = 0;
  function flashToast(message) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "atlas-toast";
      toastEl.setAttribute("role", "status");
      toastEl.setAttribute("aria-live", "polite");
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = message;
    toastEl.classList.add("is-visible");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toastEl.classList.remove("is-visible"), 2200);
  }

  async function copyIncidentReport() {
    const composed = deriveComposedState(activeScenario, activeFailures);
    const markdown = buildIncidentReport({
      scenarioName: activeScenario,
      scenarioTitle: scenarios[activeScenario]?.title,
      composed,
      selectedNode,
      url: window.location.href,
    });
    try {
      await navigator.clipboard.writeText(markdown);
      flashToast("Incident report copied to clipboard");
    } catch {
      console.log(markdown);
      flashToast("Clipboard blocked — report logged to console");
    }
  }

  // --- Command palette (⌘K) ----------------------------------------------

  function buildCommands() {
    const commands = [];
    scenarioButtons.forEach((button) => {
      const id = button.dataset.scenario;
      commands.push({
        id: `scenario:${id}`,
        group: "Scenario",
        label: `Scenario — ${button.textContent.trim()}`,
        hint: activeScenario === id ? "active" : "",
        keywords: "scenario incident mode switch",
        run: () => setScenario(id),
      });
    });
    Object.values(failureModes).forEach((mode) => {
      const on = activeFailures.has(mode.id);
      commands.push({
        id: `fault:${mode.id}`,
        group: "Fault",
        label: `${on ? "Clear" : "Inject"} fault — ${mode.label}`,
        hint: on ? "injected" : "",
        keywords: `fault failure inject ${mode.summary}`,
        run: () => toggleFailure(mode.id),
      });
    });
    commands.push({
      id: "fault:clear",
      group: "Fault",
      label: "Clear all injected faults",
      keywords: "reset faults clear",
      run: clearFailures,
    });
    Object.keys(nodeHints).forEach((node) => {
      commands.push({
        id: `node:${node}`,
        group: "Inspect",
        label: `Inspect — ${node}`,
        keywords: "node service select inspect",
        run: () => setNode(node),
      });
    });
    if (theme && typeof theme.setMode === "function") {
      ["system", "light", "dark"].forEach((mode) => {
        commands.push({
          id: `theme:${mode}`,
          group: "Theme",
          label: `Theme — ${mode}`,
          hint: theme.mode === mode ? "active" : "",
          keywords: "theme appearance dark light system",
          run: () => theme.setMode(mode),
        });
      });
    }
    commands.push(
      {
        id: "action:replay",
        group: "Action",
        label: "Replay signal choreography",
        keywords: "replay animate",
        run: () => replayButton?.click(),
      },
      {
        id: "action:incident",
        group: "Action",
        label: "Escalate incident mode",
        keywords: "escalate panic",
        run: () => incidentButton?.click(),
      },
      {
        id: "action:share",
        group: "Action",
        label: "Copy shareable link",
        keywords: "share url deep link",
        run: () => shareButton?.click(),
      },
      {
        id: "action:report",
        group: "Action",
        label: "Copy incident report (Markdown)",
        keywords: "export report summary markdown",
        run: copyIncidentReport,
      }
    );
    return commands;
  }

  const palette = initCommandPalette(buildCommands);
  const commandButton = document.querySelector("#commandButton");
  if (commandButton) commandButton.addEventListener("click", palette.open);
}
