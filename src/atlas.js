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
import { encodeState, readStateFromUrl, syncStateToUrl } from "./url-state.js";
import { initCommandPalette } from "./command-palette.js";
import { buildIncidentReport } from "./incident-report.js";
import {
  loadProfile,
  saveProfile,
  resetProfile,
  sanitizeScore,
  encodeProfile,
  readSharedProfile,
} from "./personalize.js";
import { PLAYBACK_SCRIPT, PLAYBACK_LENGTH } from "./playback.js";

export function initAtlas({ theme } = {}) {
  const scenarioButtons = document.querySelectorAll(".scenario");
  const root = document.querySelector(".grid-window");
  const shell = document.querySelector(".app-shell");
  const heroTitle = document.querySelector("h1");
  const heroLede = document.querySelector(".lede");
  const editButton = document.querySelector("#editButton");
  const playButton = document.querySelector("#playButton");
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

  // Personalization: a per-visitor profile and the original (default) labels so
  // a custom name can always fall back to the shipped one.
  const profile = loadProfile();
  let editing = false;
  const originalLabels = new Map();
  serviceNodes.forEach((node) => {
    const label = node.querySelector(".node-label");
    if (label) originalLabels.set(node.dataset.node, label.textContent);
  });

  // Adopt a profile shared via a "my version" link (the visitor opening it keeps
  // their own copy thereafter; the heavy `p` param drops off on the next change).
  const sharedProfile = readSharedProfile();
  let adoptedSharedProfile = false;
  if (sharedProfile) {
    Object.assign(profile, sharedProfile);
    saveProfile(profile);
    adoptedSharedProfile = true;
  }

  /** Display name for a node, honouring the visitor's overrides. */
  function nodeDisplayName(key) {
    return profile.names[key] || originalLabels.get(key) || key;
  }

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
      const label = node.querySelector(".node-label");
      if (label) label.textContent = nodeDisplayName(name);
    });
  }

  function renderComposedState(name) {
    const composed = deriveComposedState(name, activeFailures, profile.scores);
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
    const composed = deriveComposedState(activeScenario, activeFailures, profile.scores);
    selectedNode = name;
    const score =
      composed.scores[name] ||
      document.querySelector(`[data-node="${name}"]`)?.dataset.score ||
      "84";

    serviceNodes.forEach((node) => {
      node.classList.toggle("is-selected", node.dataset.node === name);
    });

    textTargets.nodeName.textContent = nodeDisplayName(name);
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

  function handleNodeActivate(key) {
    if (editing) {
      openNodeEditor(key);
    } else {
      setNode(key);
    }
  }

  serviceNodes.forEach((node) => {
    node.setAttribute("tabindex", "0");
    node.setAttribute("role", "button");
    node.addEventListener("click", () => handleNodeActivate(node.dataset.node));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleNodeActivate(node.dataset.node);
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

  // --- Personalization: edit mode ----------------------------------------

  const defaultTitle = heroTitle ? heroTitle.textContent : "";
  const defaultLede = heroLede ? heroLede.textContent : "";

  function applyProfileIdentity() {
    if (heroTitle) heroTitle.textContent = profile.title || defaultTitle;
    if (heroLede) heroLede.textContent = profile.lede || defaultLede;
  }

  function saveIdentityFromDom() {
    if (heroTitle) {
      const value = heroTitle.textContent.trim();
      profile.title = value && value !== defaultTitle.trim() ? value : "";
    }
    if (heroLede) {
      const value = heroLede.textContent.trim();
      profile.lede = value && value !== defaultLede.trim() ? value : "";
    }
    saveProfile(profile);
  }

  function setEditing(on) {
    editing = Boolean(on);
    if (shell) shell.classList.toggle("is-editing", editing);
    [heroTitle, heroLede].forEach((el) => {
      if (el) el.contentEditable = editing ? "true" : "false";
    });
    if (editButton) {
      editButton.classList.toggle("is-active", editing);
      editButton.setAttribute("aria-pressed", String(editing));
      editButton.setAttribute(
        "aria-label",
        editing ? "Done editing — exit edit mode" : "Edit this atlas to make it your own"
      );
    }
    flashToast(
      editing
        ? "Edit mode on — rename the title and click any service to tailor it"
        : "Saved your changes"
    );
  }

  [heroTitle, heroLede].forEach((el) => {
    if (!el) return;
    el.addEventListener("blur", saveIdentityFromDom);
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        el.blur();
      }
    });
  });

  // Node editor popover (created lazily, reused).
  let nodeEditor = null;
  function openNodeEditor(key) {
    if (!nodeEditor) {
      nodeEditor = document.createElement("div");
      nodeEditor.className = "node-editor";
      nodeEditor.innerHTML = `
        <div class="node-editor-card" role="dialog" aria-modal="true" aria-label="Edit service">
          <h3>Edit service</h3>
          <label>Name<input type="text" maxlength="48" data-field="name" /></label>
          <label>Confidence score (12–99)<input type="number" min="12" max="99" data-field="score" /></label>
          <div class="node-editor-actions">
            <button type="button" data-action="cancel">Cancel</button>
            <button type="button" data-action="save" class="is-primary">Save</button>
          </div>
        </div>`;
      document.body.appendChild(nodeEditor);
      nodeEditor.addEventListener("click", (event) => {
        if (event.target === nodeEditor || event.target.dataset.action === "cancel") {
          nodeEditor.classList.remove("is-open");
        } else if (event.target.dataset.action === "save") {
          commitNodeEditor();
        }
      });
    }
    nodeEditor.dataset.key = key;
    const composed = deriveComposedState(activeScenario, activeFailures, profile.scores);
    nodeEditor.querySelector('[data-field="name"]').value = nodeDisplayName(key);
    nodeEditor.querySelector('[data-field="score"]').value =
      profile.scores[key] ?? composed.scores[key] ?? "";
    nodeEditor.classList.add("is-open");
    nodeEditor.querySelector('[data-field="name"]').focus();
  }

  function commitNodeEditor() {
    const key = nodeEditor.dataset.key;
    const name = nodeEditor.querySelector('[data-field="name"]').value.trim();
    const score = sanitizeScore(nodeEditor.querySelector('[data-field="score"]').value);
    if (name && name !== originalLabels.get(key)) {
      profile.names[key] = name;
    } else {
      delete profile.names[key];
    }
    if (score !== null) profile.scores[key] = score;
    saveProfile(profile);
    nodeEditor.classList.remove("is-open");
    renderComposedState(activeScenario);
    setNode(key, { sync: false });
    flashToast(`Updated ${name || nodeDisplayName(key)}`);
  }

  function resetPersonalization() {
    resetProfile();
    profile.title = "";
    profile.lede = "";
    profile.names = {};
    profile.scores = {};
    applyProfileIdentity();
    renderComposedState(activeScenario);
    setNode(selectedNode, { sync: false });
    flashToast("Restored the original atlas");
  }

  if (editButton) {
    editButton.addEventListener("click", () => setEditing(!editing));
  }

  applyProfileIdentity();

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
    const composed = deriveComposedState(activeScenario, activeFailures, profile.scores);
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

  /** A shareable link that carries the visitor's full personalization. */
  function buildMyVersionUrl() {
    const base = encodeState({
      scenario: activeScenario,
      failures: activeFailures,
      node: selectedNode,
    });
    const encoded = encodeProfile(profile);
    const hash = encoded ? `${base}&p=${encoded}` : base;
    return `${window.location.origin}${window.location.pathname}${hash ? `#${hash}` : ""}`;
  }

  async function copyMyVersionLink() {
    const url = buildMyVersionUrl();
    try {
      await navigator.clipboard.writeText(url);
      flashToast("Link to your version copied — anyone who opens it sees your edits");
    } catch {
      console.log(url);
      flashToast("Clipboard blocked — link logged to console");
    }
  }

  // --- Incident Playback (cinematic auto-walkthrough) --------------------

  let playbackBanner = null;
  let playbackTimer = 0;
  let playbackIndex = 0;
  let playing = false;

  function ensurePlaybackBanner() {
    if (playbackBanner) return playbackBanner;
    playbackBanner = document.createElement("div");
    playbackBanner.className = "playback-banner";
    playbackBanner.setAttribute("role", "status");
    playbackBanner.setAttribute("aria-live", "polite");
    playbackBanner.innerHTML = `
      <div class="playback-dots" aria-hidden="true"></div>
      <div class="playback-copy"><strong></strong><span></span></div>
      <button type="button" class="playback-stop" aria-label="Stop playback">Stop ✕</button>`;
    playbackBanner.querySelector(".playback-stop").addEventListener("click", stopPlayback);
    document.body.appendChild(playbackBanner);
    return playbackBanner;
  }

  function renderPlaybackStep(step, index) {
    const banner = ensurePlaybackBanner();
    banner.querySelector(".playback-copy strong").textContent =
      `${index + 1}/${PLAYBACK_LENGTH} · ${step.title}`;
    banner.querySelector(".playback-copy span").textContent = step.narration;
    banner.querySelector(".playback-dots").innerHTML = PLAYBACK_SCRIPT.map(
      (_, i) => `<i class="${i === index ? "is-on" : ""}"></i>`
    ).join("");
  }

  function applyPlaybackStep(step, index) {
    activeFailures.clear();
    step.faults.forEach((id) => {
      if (failureModes[id]) activeFailures.add(id);
    });
    selectedNode = step.node;
    setScenario(step.scenario, { sync: false });
    setNode(step.node, { sync: false });
    renderPlaybackStep(step, index);
  }

  function advancePlayback() {
    if (playbackIndex >= PLAYBACK_LENGTH) {
      stopPlayback();
      flashToast("Walkthrough complete");
      return;
    }
    const step = PLAYBACK_SCRIPT[playbackIndex];
    applyPlaybackStep(step, playbackIndex);
    const delay = prefersReducedMotion() ? 2000 : step.ms;
    playbackIndex += 1;
    playbackTimer = window.setTimeout(advancePlayback, delay);
  }

  function startPlayback() {
    if (playing) return;
    playing = true;
    playbackIndex = 0;
    if (shell) shell.classList.add("is-playing");
    if (playButton) playButton.setAttribute("aria-pressed", "true");
    advancePlayback();
  }

  function stopPlayback() {
    if (!playing) return;
    playing = false;
    window.clearTimeout(playbackTimer);
    if (shell) shell.classList.remove("is-playing");
    if (playButton) playButton.setAttribute("aria-pressed", "false");
    if (playbackBanner) playbackBanner.classList.remove("is-visible");
  }

  function togglePlayback() {
    if (playing) {
      stopPlayback();
    } else {
      ensurePlaybackBanner().classList.add("is-visible");
      startPlayback();
    }
  }

  if (playButton) playButton.addEventListener("click", togglePlayback);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && playing) stopPlayback();
  });

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
        id: "action:playback",
        group: "Action",
        label: playing ? "Stop incident walkthrough" : "Play incident walkthrough",
        keywords: "play playback walkthrough tour demo cinematic story",
        run: togglePlayback,
      },
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
      },
      {
        id: "action:edit",
        group: "Personalize",
        label: editing ? "Exit edit mode" : "Edit — make this atlas your own",
        keywords: "edit customize personalize rename tailor",
        run: () => setEditing(!editing),
      },
      {
        id: "action:sharemine",
        group: "Personalize",
        label: "Copy a link to my version",
        keywords: "share my version link send edits personalization",
        run: copyMyVersionLink,
      },
      {
        id: "action:reset",
        group: "Personalize",
        label: "Reset personalization to defaults",
        keywords: "reset restore defaults clear personalization",
        run: resetPersonalization,
      }
    );
    return commands;
  }

  const palette = initCommandPalette(buildCommands);
  const commandButton = document.querySelector("#commandButton");
  if (commandButton) commandButton.addEventListener("click", palette.open);

  if (adoptedSharedProfile) {
    flashToast("Loaded a shared, personalized atlas — it's yours to edit now");
  }
}
