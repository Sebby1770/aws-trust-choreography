/**
 * AWS Flow Studio — a topology-first architecture lab.
 *
 * Initialized by src/main.js once the icon catalog has been lazily loaded. The
 * catalog is passed in (rather than read from a global) so the 327 KB data file
 * can be code-split and fetched only when the studio is first revealed.
 *
 * @param {Array} iconCatalog - the AWS icon catalog entries
 * @param {object} iconCatalogMeta - catalog metadata (release, count, ...)
 */
import { reviewAwsArchitecture } from "./aws-review-model.js";
import { matchIcon } from "./icon-match.js";
import {
  classifyCrossing,
  inferZone,
  normalizeZone,
  ZONE_IDS,
  ZONES,
  zoneOf,
} from "./trust-zones.js";

export function initFlowStudio(iconCatalog, iconCatalogMeta) {
  "use strict";

  const global = typeof window !== "undefined" ? window : globalThis;
  const catalog = Array.isArray(iconCatalog)
    ? iconCatalog
    : Array.isArray(global.AWS_ICON_CATALOG)
      ? global.AWS_ICON_CATALOG
      : [];
  const catalogMeta = iconCatalogMeta || global.AWS_ICON_CATALOG_META || { count: catalog.length };
  const storageKey = "aws-command-atlas-flow-studio-v2";
  const legacyStorageKey = "aws-command-atlas-flow-studio-v1";
  const criticalityColors = {
    high: "#ff635c",
    medium: "#ffb84d",
    low: "#86f7ad",
  };

  const elements = {
    nodeCount: document.getElementById("flowNodeCount"),
    connectionCount: document.getElementById("flowConnectionCount"),
    saveState: document.getElementById("flowSaveState"),
    modeButtons: [...document.querySelectorAll("[data-flow-mode]")],
    deleteButton: document.getElementById("flowDeleteButton"),
    undoButton: document.getElementById("flowUndoButton"),
    redoButton: document.getElementById("flowRedoButton"),
    fitButton: document.getElementById("flowFitButton"),
    autoLayoutButton: document.getElementById("flowAutoLayoutButton"),
    importButton: document.getElementById("flowImportButton"),
    importInput: document.getElementById("flowImportInput"),
    saveButton: document.getElementById("flowSaveButton"),
    exportButton: document.getElementById("flowExportButton"),
    exportSvgButton: document.getElementById("flowExportSvgButton"),
    iconTypeButtons: [...document.querySelectorAll("[data-icon-type]")],
    iconSearch: document.getElementById("flowIconSearch"),
    categoryFilter: document.getElementById("flowCategoryFilter"),
    libraryCount: document.getElementById("flowLibraryCount"),
    iconGrid: document.getElementById("flowIconGrid"),
    recentIcons: document.getElementById("flowRecentIcons"),
    libraryToggle: document.getElementById("flowLibraryToggle"),
    architectureName: document.getElementById("flowArchitectureName"),
    canvasHint: document.getElementById("flowCanvasHint"),
    canvas: document.getElementById("flowCanvas"),
    connections: document.getElementById("flowConnections"),
    nodeLayer: document.getElementById("flowNodeLayer"),
    emptyState: document.getElementById("flowEmptyState"),
    minimap: document.getElementById("flowMinimap"),
    templateButtons: [...document.querySelectorAll("[data-flow-template]")],
    inspectorMode: document.getElementById("flowInspectorMode"),
    selectedSummary: document.getElementById("flowSelectedSummary"),
    nodeFields: document.getElementById("flowNodeFields"),
    nodeName: document.getElementById("flowNodeName"),
    nodeEnvironment: document.getElementById("flowNodeEnvironment"),
    nodeCriticality: document.getElementById("flowNodeCriticality"),
    nodeZone: document.getElementById("flowNodeZone"),
    nodeZoneHint: document.getElementById("flowNodeZoneHint"),
    nodeNotes: document.getElementById("flowNodeNotes"),
    connectionFields: document.getElementById("flowConnectionFields"),
    connectionName: document.getElementById("flowConnectionName"),
    connectionType: document.getElementById("flowConnectionType"),
    connectionEncrypted: document.getElementById("flowConnectionEncrypted"),
    inspectorTabs: [...document.querySelectorAll("[data-inspector-tab]")],
    inspectPanel: document.getElementById("flowInspectPanel"),
    analyzePanel: document.getElementById("flowAnalyzePanel"),
    checksTitle: document.getElementById("flowChecksTitle"),
    checksList: document.getElementById("flowChecksList"),
    scoreRing: document.getElementById("flowScoreRing"),
    score: document.getElementById("flowScore"),
    scoreGrade: document.getElementById("flowScoreGrade"),
    scoreSummary: document.getElementById("flowScoreSummary"),
    securityScore: document.getElementById("flowSecurityScore"),
    reliabilityScore: document.getElementById("flowReliabilityScore"),
    observabilityScore: document.getElementById("flowObservabilityScore"),
    recoveryScore: document.getElementById("flowRecoveryScore"),
    runSimulationButton: document.getElementById("flowRunSimulationButton"),
    injectFailureButton: document.getElementById("flowInjectFailureButton"),
    resetSimulationButton: document.getElementById("flowResetSimulationButton"),
    simulationState: document.getElementById("flowSimulationState"),
    simulationMessage: document.getElementById("flowSimulationMessage"),
    affectedPaths: document.getElementById("flowAffectedPaths"),
    zoomInButton: document.getElementById("flowZoomInButton"),
    zoomOutButton: document.getElementById("flowZoomOutButton"),
    statusMessage: document.getElementById("flowStatusMessage"),
    region: document.getElementById("flowRegion"),
    gridToggle: document.getElementById("flowGridToggle"),
    zoom: document.getElementById("flowZoom"),
  };

  if (!elements.canvas || !catalog.length) {
    return;
  }

  let iconType = "service";
  let selectedLibraryIconId = null;
  let selectedNodeId = null;
  let selectedConnectionId = null;
  let editorMode = "select";
  let connectSourceId = null;
  let nodeSequence = 0;
  let connectionSequence = 0;
  const history = [];
  let future = [];
  let dragState = null;
  let inspectorTab = "inspect";
  let simulationRunning = false;
  let failedNodeId = null;
  let affectedNodeIds = new Set();
  let affectedConnectionIds = new Set();
  let recentIconIds = [];
  let autoSaveTimer = null;

  const state = loadState() || {
    name: "My resilient workload",
    region: "us-east-1",
    grid: true,
    zoom: 1,
    nodes: [],
    connections: [],
  };

  state.connections = state.connections.map((connection) => ({
    type: "request",
    label: "HTTPS",
    encrypted: true,
    ...connection,
  }));

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function safeParse(value) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  function loadState() {
    try {
      const saved =
        safeParse(global.localStorage.getItem(storageKey)) ||
        safeParse(global.localStorage.getItem(legacyStorageKey));
      if (!saved || !Array.isArray(saved.nodes) || !Array.isArray(saved.connections)) {
        return null;
      }
      return saved;
    } catch {
      return null;
    }
  }

  function architectureSnapshot() {
    return JSON.stringify({
      name: state.name,
      region: state.region,
      grid: state.grid,
      zoom: state.zoom,
      nodes: state.nodes,
      connections: state.connections,
    });
  }

  function restoreSnapshot(snapshot) {
    const restored = safeParse(snapshot);
    if (!restored) {
      return;
    }
    Object.assign(state, restored);
    selectedNodeId = null;
    selectedConnectionId = null;
    connectSourceId = null;
    resetSimulationState();
    syncControls();
    renderAll();
  }

  function commit(label, mutation) {
    history.push(architectureSnapshot());
    if (history.length > 80) {
      history.shift();
    }
    future = [];
    mutation();
    markUnsaved(label);
    renderAll();
  }

  function markUnsaved(message) {
    elements.saveState.textContent = "Saving…";
    elements.saveState.style.color = "var(--amber)";
    elements.statusMessage.textContent = message || "Architecture changed";
    elements.statusMessage.style.color = "var(--amber)";
    global.dispatchEvent(
      new CustomEvent("trust:designchange", { detail: { source: "aws", reason: message || "change" } })
    );
    global.clearTimeout(autoSaveTimer);
    autoSaveTimer = global.setTimeout(() => {
      try {
        global.localStorage.setItem(storageKey, architectureSnapshot());
        markSaved("Changes auto-saved");
      } catch {
        elements.saveState.textContent = "Save unavailable";
      }
    }, 500);
  }

  function markSaved(message) {
    elements.saveState.textContent = "Auto-saved";
    elements.saveState.style.color = "var(--green)";
    elements.statusMessage.textContent = message || "Saved locally";
    elements.statusMessage.style.color = "var(--green)";
  }

  function findIcon(name, preferredType = "service") {
    return matchIcon(catalog, name, preferredType);
  }

  function nextNodeId() {
    nodeSequence += 1;
    return `flow-node-${Date.now().toString(36)}-${nodeSequence}`;
  }

  function nextConnectionId() {
    connectionSequence += 1;
    return `flow-link-${Date.now().toString(36)}-${connectionSequence}`;
  }

  function makeNode(icon, x, y, overrides = {}) {
    return {
      id: nextNodeId(),
      iconId: icon.id,
      iconPath: icon.path,
      iconType: icon.type,
      category: icon.category,
      serviceName: icon.name,
      name: overrides.name || icon.name,
      x: clamp(x, 0.06, 0.94),
      y: clamp(y, 0.08, 0.92),
      environment: overrides.environment || "Production",
      criticality: overrides.criticality || "medium",
      // Placement starts from what the service implies, so an existing diagram
      // gains trust zones without anyone re-labelling every node by hand.
      zone: normalizeZone(overrides.zone, inferZone(icon.name, overrides.name)),
      notes: overrides.notes || "",
    };
  }

  function addNode(icon) {
    const slots = [];
    [0.18, 0.38, 0.58, 0.78].forEach((y) => {
      [0.16, 0.33, 0.5, 0.67, 0.84].forEach((x) => slots.push({ x, y }));
    });
    const openSlot = slots.find(
      (slot) =>
        !state.nodes.some(
          (node) => Math.abs(node.x - slot.x) < 0.09 && Math.abs(node.y - slot.y) < 0.12
        )
    );
    const fallbackIndex = state.nodes.length;
    const x = openSlot?.x ?? 0.18 + ((fallbackIndex * 0.19) % 0.64);
    const y = openSlot?.y ?? 0.22 + ((Math.floor(fallbackIndex / 4) * 0.24) % 0.54);
    addNodeAt(icon, x, y);
  }

  function addNodeAt(icon, x, y) {
    commit(`Added ${icon.name}`, () => {
      const node = makeNode(icon, x, y);
      state.nodes.push(node);
      selectedNodeId = node.id;
      selectedConnectionId = null;
      selectedLibraryIconId = icon.id;
      rememberRecentIcon(icon.id);
    });
  }

  function rememberRecentIcon(iconId) {
    recentIconIds = [iconId, ...recentIconIds.filter((id) => id !== iconId)].slice(0, 4);
  }

  function connectionDefaults(fromId, toId) {
    const from = state.nodes.find((node) => node.id === fromId);
    const to = state.nodes.find((node) => node.id === toId);
    const names = `${from?.serviceName || ""} ${to?.serviceName || ""}`.toLowerCase();
    if (names.includes("cloudwatch") || names.includes("x-ray")) {
      return { type: "telemetry", label: "Telemetry", encrypted: true };
    }
    if (
      names.includes("eventbridge") ||
      names.includes("queue") ||
      names.includes("sqs") ||
      names.includes("sns")
    ) {
      return { type: "event", label: "Events", encrypted: true };
    }
    if (
      names.includes("dynamodb") ||
      names.includes("rds") ||
      names.includes("s3") ||
      names.includes("aurora")
    ) {
      return { type: "data", label: "Query", encrypted: true };
    }
    return { type: "request", label: "HTTPS", encrypted: true };
  }

  function addConnection(fromId, toId) {
    if (!fromId || !toId || fromId === toId) {
      elements.statusMessage.textContent = "Choose two different nodes";
      return;
    }
    if (
      state.connections.some((connection) => connection.from === fromId && connection.to === toId)
    ) {
      elements.statusMessage.textContent = "Those nodes are already connected";
      return;
    }
    commit("Connection added", () => {
      const connection = {
        id: nextConnectionId(),
        from: fromId,
        to: toId,
        ...connectionDefaults(fromId, toId),
      };
      state.connections.push(connection);
      selectedConnectionId = connection.id;
      selectedNodeId = null;
      connectSourceId = null;
    });
  }

  function removeSelection() {
    if (selectedNodeId) {
      const node = state.nodes.find((item) => item.id === selectedNodeId);
      commit(`Deleted ${node?.name || "node"}`, () => {
        state.nodes = state.nodes.filter((item) => item.id !== selectedNodeId);
        state.connections = state.connections.filter(
          (connection) => connection.from !== selectedNodeId && connection.to !== selectedNodeId
        );
        selectedNodeId = null;
        connectSourceId = null;
        resetSimulationState();
      });
      return;
    }
    if (selectedConnectionId) {
      commit("Connection deleted", () => {
        state.connections = state.connections.filter(
          (connection) => connection.id !== selectedConnectionId
        );
        selectedConnectionId = null;
        resetSimulationState();
      });
    }
  }

  function setMode(mode) {
    editorMode = mode;
    connectSourceId = null;
    elements.modeButtons.forEach((button) => {
      const active = button.dataset.flowMode === mode;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    elements.canvasHint.textContent =
      mode === "connect" ? "Select a source node, then a destination" : "Select an icon to add it";
    renderNodes();
  }

  function filteredIcons() {
    const query = elements.iconSearch.value.trim().toLowerCase();
    const category = elements.categoryFilter.value;
    return catalog.filter((icon) => {
      if (icon.type !== iconType) {
        return false;
      }
      if (category !== "all" && icon.category !== category) {
        return false;
      }
      return !query || icon.search.includes(query);
    });
  }

  function renderCategories() {
    const current = elements.categoryFilter.value;
    const categories = [
      ...new Set(catalog.filter((icon) => icon.type === iconType).map((icon) => icon.category)),
    ].sort((a, b) => a.localeCompare(b));
    elements.categoryFilter.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All categories";
    elements.categoryFilter.append(allOption);
    categories.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      elements.categoryFilter.append(option);
    });
    elements.categoryFilter.value = categories.includes(current) ? current : "all";
  }

  function renderLibrary() {
    const icons = filteredIcons();
    const visible = icons.slice(0, 180);
    elements.iconGrid.replaceChildren();
    visible.forEach((icon) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "flow-icon-tile";
      button.classList.toggle("is-selected", selectedLibraryIconId === icon.id);
      button.dataset.iconId = icon.id;
      button.draggable = true;
      button.title = `${icon.name} · ${icon.category}`;
      const image = document.createElement("img");
      image.src = icon.path;
      image.alt = "";
      image.loading = "lazy";
      const label = document.createElement("span");
      label.textContent = icon.name;
      button.append(image, label);
      elements.iconGrid.append(button);
    });
    if (!visible.length) {
      const empty = document.createElement("p");
      empty.className = "flow-no-icons";
      empty.textContent = "No AWS icons match this filter.";
      elements.iconGrid.append(empty);
    }
    elements.libraryCount.textContent =
      icons.length > visible.length
        ? `${icons.length} icons · showing ${visible.length}`
        : `${icons.length} icons`;
    renderRecentIcons();
  }

  function renderRecentIcons() {
    elements.recentIcons.replaceChildren();
    const recent = recentIconIds
      .map((id) => catalog.find((icon) => icon.id === id))
      .filter(Boolean);
    if (!recent.length) {
      ["AWS Lambda", "Amazon Simple Storage Service", "Amazon DynamoDB", "Amazon API Gateway"]
        .map((name) => findIcon(name))
        .filter(Boolean)
        .forEach((icon) => recent.push(icon));
    }
    recent.slice(0, 4).forEach((icon) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "flow-recent-icon";
      button.dataset.iconId = icon.id;
      button.draggable = true;
      button.title = `Add ${icon.name}`;
      const image = document.createElement("img");
      image.src = icon.path;
      image.alt = "";
      const label = document.createElement("span");
      label.textContent = icon.name.replace(/^Amazon |^AWS /, "");
      button.append(image, label);
      elements.recentIcons.append(button);
    });
  }

  function connectionPath(from, to) {
    const rect = elements.canvas.getBoundingClientRect();
    const x1 = from.x * rect.width;
    const y1 = from.y * rect.height;
    const x2 = to.x * rect.width;
    const y2 = to.y * rect.height;
    const bend = Math.max(54, Math.abs(x2 - x1) * 0.44);
    const direction = x2 >= x1 ? 1 : -1;
    return `M ${x1} ${y1} C ${x1 + bend * direction} ${y1}, ${x2 - bend * direction} ${y2}, ${x2} ${y2}`;
  }

  function renderConnections() {
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node]));
    const rect = elements.canvas.getBoundingClientRect();
    elements.connections.setAttribute(
      "viewBox",
      `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`
    );
    elements.connections.replaceChildren();

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "flowArrow");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "8");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "7");
    marker.setAttribute("markerHeight", "7");
    marker.setAttribute("orient", "auto-start-reverse");
    const arrow = document.createElementNS("http://www.w3.org/2000/svg", "path");
    arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    arrow.setAttribute("fill", "#b8c7cd");
    marker.append(arrow);
    defs.append(marker);
    elements.connections.append(defs);

    state.connections.forEach((connection) => {
      const from = nodeMap.get(connection.from);
      const to = nodeMap.get(connection.to);
      if (!from || !to) {
        return;
      }
      const pathData = connectionPath(from, to);
      const visible = document.createElementNS("http://www.w3.org/2000/svg", "path");
      visible.setAttribute("d", pathData);
      visible.setAttribute(
        "class",
        [
          "flow-connection",
          `is-${connection.type || "request"}`,
          selectedConnectionId === connection.id ? "is-selected" : "",
          affectedConnectionIds.has(connection.id) ? "is-affected" : "",
          // Encryption was stored but never drawn. A path that changes trust
          // zone, and one that carries plaintext across it, are both worth
          // seeing at a glance rather than only in the inspector.
          connection.encrypted === false ? "is-unencrypted" : "",
          `is-crossing-${classifyCrossing(zoneOf(from), zoneOf(to)).kind}`,
        ]
          .filter(Boolean)
          .join(" ")
      );
      visible.setAttribute("aria-hidden", "true");
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", pathData);
      hit.setAttribute("class", "flow-connection-hit");
      hit.setAttribute("aria-hidden", "true");
      hit.dataset.connectionId = connection.id;
      const focusTarget = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      focusTarget.setAttribute("class", "flow-connection-keyboard");
      focusTarget.setAttribute("cx", String(((from.x + to.x) / 2) * rect.width));
      focusTarget.setAttribute("cy", String(((from.y + to.y) / 2) * rect.height));
      focusTarget.setAttribute("r", "9");
      focusTarget.setAttribute("role", "button");
      focusTarget.setAttribute("tabindex", "0");
      focusTarget.setAttribute("aria-label", `${from.name} to ${to.name}`);
      focusTarget.setAttribute("aria-pressed", String(selectedConnectionId === connection.id));
      focusTarget.dataset.connectionId = connection.id;
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "flow-connection-label");
      label.setAttribute("aria-hidden", "true");
      label.setAttribute("x", String(((from.x + to.x) / 2) * rect.width));
      label.setAttribute("y", String(((from.y + to.y) / 2) * rect.height - 8));
      label.textContent =
        connection.label || connectionDefaults(connection.from, connection.to).label;
      elements.connections.append(visible, label, hit, focusTarget);
    });
  }

  function renderNodes() {
    elements.nodeLayer.replaceChildren();
    elements.canvas.style.setProperty("--flow-zoom", String(state.zoom));
    state.nodes.forEach((node) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "flow-node";
      button.classList.toggle("is-selected", selectedNodeId === node.id);
      button.classList.toggle("is-connect-source", connectSourceId === node.id);
      button.classList.toggle("is-failed", failedNodeId === node.id);
      button.classList.toggle("is-affected", affectedNodeIds.has(node.id));
      button.dataset.nodeId = node.id;
      button.style.left = `${node.x * 100}%`;
      button.style.top = `${node.y * 100}%`;
      button.style.setProperty(
        "--criticality",
        criticalityColors[node.criticality] || criticalityColors.medium
      );
      button.setAttribute(
        "aria-label",
        `${node.name}, ${node.environment}, ${node.criticality} criticality`
      );
      button.setAttribute("aria-pressed", String(selectedNodeId === node.id));
      const image = document.createElement("img");
      image.src = node.iconPath;
      image.alt = "";
      image.draggable = false;
      const label = document.createElement("strong");
      label.textContent = node.name;
      button.append(image, label);
      elements.nodeLayer.append(button);
    });
    elements.emptyState.hidden = state.nodes.length > 0;
    renderMinimap();
  }

  function renderMinimap() {
    if (!elements.minimap) {
      return;
    }
    elements.minimap.replaceChildren();
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node]));
    state.connections.forEach((connection) => {
      const from = nodeMap.get(connection.from);
      const to = nodeMap.get(connection.to);
      if (!from || !to) {
        return;
      }
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(from.x * 160));
      line.setAttribute("y1", String(from.y * 92));
      line.setAttribute("x2", String(to.x * 160));
      line.setAttribute("y2", String(to.y * 92));
      line.setAttribute("class", "flow-minimap-line");
      elements.minimap.append(line);
    });
    state.nodes.forEach((node) => {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(node.x * 160));
      dot.setAttribute("cy", String(node.y * 92));
      dot.setAttribute("r", failedNodeId === node.id ? "4" : "3");
      dot.setAttribute("class", "flow-minimap-node");
      if (failedNodeId === node.id) {
        dot.setAttribute("fill", criticalityColors.high);
      }
      elements.minimap.append(dot);
    });
  }

  function selectedNode() {
    return state.nodes.find((node) => node.id === selectedNodeId) || null;
  }

  function selectedConnection() {
    return state.connections.find((connection) => connection.id === selectedConnectionId) || null;
  }

  function renderInspector() {
    const node = selectedNode();
    const connection = selectedConnection();
    elements.selectedSummary.replaceChildren();
    elements.nodeFields.hidden = !node;
    elements.connectionFields.hidden = !connection;
    elements.inspectorMode.textContent = node
      ? "Node"
      : selectedConnectionId
        ? "Connection"
        : "Diagram";
    if (!node) {
      if (connection) {
        const from = state.nodes.find((item) => item.id === connection.from);
        const to = state.nodes.find((item) => item.id === connection.to);
        const summary = document.createElement("div");
        summary.className = "flow-selected-node";
        const pathMark = document.createElement("strong");
        pathMark.textContent = "→";
        pathMark.style.fontSize = "2rem";
        pathMark.style.color = "var(--cyan)";
        const copy = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = connection.label || "Architecture path";
        const meta = document.createElement("small");
        meta.textContent = `${from?.name || "Source"} → ${to?.name || "Destination"}`;
        copy.append(title, meta);
        summary.append(pathMark, copy);
        elements.selectedSummary.append(summary);
        elements.connectionName.value = connection.label || "";
        elements.connectionType.value = connection.type || "request";
        elements.connectionEncrypted.checked = connection.encrypted !== false;
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "flow-selected-placeholder";
        placeholder.textContent = "Select a node or path to inspect it.";
        elements.selectedSummary.append(placeholder);
      }
      return;
    }

    const summary = document.createElement("div");
    summary.className = "flow-selected-node";
    const image = document.createElement("img");
    image.src = node.iconPath;
    image.alt = "";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = node.name;
    const meta = document.createElement("small");
    meta.textContent = `${node.category} · ${node.iconType}`;
    copy.append(title, meta);
    summary.append(image, copy);
    elements.selectedSummary.append(summary);

    elements.nodeName.value = node.name;
    elements.nodeEnvironment.value = node.environment;
    elements.nodeCriticality.value = node.criticality;
    elements.nodeNotes.value = node.notes;
    if (elements.nodeZone) {
      const zone = zoneOf(node);
      elements.nodeZone.value = zone;
      if (elements.nodeZoneHint) elements.nodeZoneHint.textContent = ZONES[zone].hint;
    }
  }

  function architectureChecks() {
    return reviewAwsArchitecture(state).checks;
  }

  function architectureAnalysis() {
    return reviewAwsArchitecture(state, {
      failed: Boolean(failedNodeId),
      affectedCount: affectedNodeIds.size,
    }).analysis;
  }
  function renderScore() {
    const analysis = architectureAnalysis();
    const grade =
      analysis.overall >= 85
        ? "Excellent"
        : analysis.overall >= 70
          ? "Good"
          : analysis.overall >= 50
            ? "Developing"
            : "At risk";
    const color =
      analysis.overall >= 70
        ? "var(--green)"
        : analysis.overall >= 50
          ? "var(--amber)"
          : "var(--danger)";
    elements.score.textContent = String(analysis.overall);
    elements.scoreGrade.textContent = grade;
    elements.scoreGrade.style.color = color;
    elements.scoreRing.style.setProperty("--score", String(analysis.overall));
    elements.scoreRing.style.setProperty("--score-color", color);
    elements.securityScore.textContent = String(analysis.security);
    elements.reliabilityScore.textContent = String(analysis.reliability);
    elements.observabilityScore.textContent = String(analysis.observability);
    elements.recoveryScore.textContent = String(analysis.recovery);
    elements.scoreSummary.textContent = failedNodeId
      ? `Failure rehearsal exposes ${affectedNodeIds.size} downstream service${affectedNodeIds.size === 1 ? "" : "s"}.`
      : analysis.overall >= 70
        ? "The architecture is balanced. Resolve the prioritized recommendations to improve resilience."
        : "Strengthen identity, telemetry, and recovery intent before production.";
  }

  function traceFailure(nodeId) {
    const downstream = new Set();
    const paths = new Set();
    const queue = [nodeId];
    while (queue.length) {
      const current = queue.shift();
      state.connections
        .filter((connection) => connection.from === current)
        .forEach((connection) => {
          paths.add(connection.id);
          if (!downstream.has(connection.to) && connection.to !== nodeId) {
            downstream.add(connection.to);
            queue.push(connection.to);
          }
        });
    }
    affectedNodeIds = downstream;
    affectedConnectionIds = paths;
  }

  function renderSimulation() {
    const studio = elements.canvas.closest(".flow-studio");
    studio.classList.toggle("is-simulating", simulationRunning);
    elements.runSimulationButton.classList.toggle("is-active", simulationRunning);
    elements.runSimulationButton.innerHTML = simulationRunning
      ? '<span aria-hidden="true">&#10074;&#10074;</span>Pause traffic'
      : '<span aria-hidden="true">&#9654;</span>Run traffic';
    if (failedNodeId) {
      const failedNode = state.nodes.find((node) => node.id === failedNodeId);
      elements.simulationState.textContent = "Failure active";
      elements.simulationState.style.color = "var(--danger)";
      elements.affectedPaths.textContent = String(affectedConnectionIds.size);
      elements.affectedPaths.style.color = affectedConnectionIds.size
        ? "var(--danger)"
        : "var(--green)";
      elements.simulationMessage.textContent = `${failedNode?.name || "Selected service"} failure reaches ${affectedNodeIds.size} downstream node${affectedNodeIds.size === 1 ? "" : "s"}.`;
    } else {
      elements.simulationState.textContent = simulationRunning ? "Traffic running" : "Ready";
      elements.simulationState.style.color = simulationRunning
        ? "var(--flow-cyan)"
        : "var(--green)";
      elements.affectedPaths.textContent = "0";
      elements.affectedPaths.style.color = "var(--green)";
      elements.simulationMessage.textContent = selectedNodeId
        ? "Selected node is ready for failure rehearsal."
        : "Select a node to rehearse failure.";
    }
  }

  function toggleTrafficSimulation() {
    simulationRunning = !simulationRunning;
    elements.statusMessage.textContent = simulationRunning
      ? "Live traffic simulation started"
      : "Traffic simulation paused";
    elements.statusMessage.style.color = simulationRunning ? "var(--cyan)" : "var(--muted)";
    renderSimulation();
    renderConnections();
  }

  function injectFailure() {
    if (!selectedNodeId) {
      elements.statusMessage.textContent = "Select a node before injecting a failure";
      elements.statusMessage.style.color = "var(--amber)";
      return;
    }
    failedNodeId = selectedNodeId;
    simulationRunning = true;
    traceFailure(failedNodeId);
    renderAll();
    const node = state.nodes.find((item) => item.id === failedNodeId);
    elements.statusMessage.textContent = `${node?.name || "Service"} failure injected`;
    elements.statusMessage.style.color = "var(--danger)";
  }

  function resetSimulation() {
    simulationRunning = false;
    failedNodeId = null;
    affectedNodeIds = new Set();
    affectedConnectionIds = new Set();
    renderAll();
    elements.statusMessage.textContent = "Simulation reset";
    elements.statusMessage.style.color = "var(--green)";
  }

  function renderChecks() {
    const checks = architectureChecks();
    elements.checksTitle.textContent = `${checks.length} checks`;
    elements.checksList.replaceChildren();
    checks.forEach((check) => {
      const item = document.createElement("article");
      item.className = `flow-check-item ${check.tone}`;
      const title = document.createElement("strong");
      title.textContent = check.title;
      const detail = document.createElement("small");
      detail.textContent = check.detail;
      item.append(title, detail);
      elements.checksList.append(item);
    });
  }

  function renderCounts() {
    elements.nodeCount.textContent = String(state.nodes.length);
    elements.connectionCount.textContent = String(state.connections.length);
    elements.undoButton.disabled = history.length === 0;
    elements.redoButton.disabled = future.length === 0;
    elements.deleteButton.disabled = !selectedNodeId && !selectedConnectionId;
  }

  function renderAll() {
    renderNodes();
    renderConnections();
    renderInspector();
    renderChecks();
    renderScore();
    renderSimulation();
    renderCounts();
    renderLibrary();
  }

  function refreshLayout() {
    renderConnections();
    renderMinimap();
  }

  function syncControls() {
    elements.architectureName.value = state.name;
    elements.region.value = state.region;
    elements.gridToggle.checked = state.grid;
    elements.zoom.value = String(state.zoom);
    elements.canvas.classList.toggle("is-gridless", !state.grid);
  }

  function iconForTemplate(name) {
    const icon = findIcon(name, "service");
    if (!icon) {
      throw new Error(`Missing AWS icon: ${name}`);
    }
    return icon;
  }

  function templateDefinition(name) {
    const definitions = {
      serverless: {
        title: "Serverless API",
        nodes: [
          ["Amazon CloudFront", 0.09, 0.2, "Global edge"],
          ["AWS WAF", 0.23, 0.2, "Edge protection"],
          ["Amazon API Gateway", 0.38, 0.2, "Public API"],
          ["AWS Lambda", 0.55, 0.2, "Request processor"],
          ["Amazon DynamoDB", 0.75, 0.42, "Application state"],
          ["Amazon Simple Storage Service", 0.55, 0.48, "Object archive"],
          ["Amazon CloudWatch", 0.75, 0.78, "Service telemetry"],
          ["Amazon Cognito", 0.23, 0.78, "Customer identity"],
        ],
        links: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [3, 5],
          [3, 6],
          [7, 2],
        ],
      },
      events: {
        title: "Event pipeline",
        nodes: [
          ["Amazon EventBridge", 0.09, 0.2, "Event ingress"],
          ["AWS Step Functions", 0.29, 0.2, "Workflow orchestrator"],
          ["Amazon Simple Queue Service", 0.49, 0.2, "Durable work queue"],
          ["AWS Lambda", 0.7, 0.2, "Event worker"],
          ["Amazon DynamoDB", 0.8, 0.47, "Processing state"],
          ["Amazon Simple Storage Service", 0.55, 0.47, "Result archive"],
          ["Amazon CloudWatch", 0.7, 0.78, "Pipeline telemetry"],
          ["AWS Identity and Access Management", 0.29, 0.78, "Execution roles"],
        ],
        links: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [3, 5],
          [3, 6],
          [7, 1],
        ],
      },
      web: {
        title: "Resilient web app",
        nodes: [
          ["Amazon Route 53", 0.07, 0.2, "Global DNS"],
          ["Amazon CloudFront", 0.2, 0.2, "Global edge"],
          ["AWS WAF", 0.34, 0.2, "Edge protection"],
          ["Elastic Load Balancing", 0.49, 0.2, "Application load balancer"],
          ["Amazon EC2 Auto Scaling", 0.67, 0.2, "Application fleet"],
          ["Amazon RDS", 0.82, 0.44, "Primary database"],
          ["Amazon Simple Storage Service", 0.49, 0.47, "Static assets"],
          ["Amazon CloudWatch", 0.67, 0.78, "Operations telemetry"],
          ["AWS Backup", 0.82, 0.78, "Recovery vault"],
        ],
        links: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [4, 5],
          [6, 1],
          [4, 7],
          [5, 8],
        ],
      },
      "claude-rag": {
        title: "Claude RAG assistant",
        nodes: [
          ["Amazon API Gateway", 0.1, 0.2, "Chat API"],
          ["AWS Lambda", 0.27, 0.2, "Orchestrator"],
          ["Claude", 0.46, 0.2, "Claude — reasoning"],
          ["AI Guardrails", 0.64, 0.2, "Safety filter"],
          ["Embeddings Model", 0.27, 0.48, "Embeddings"],
          ["Vector Database", 0.46, 0.48, "Knowledge index"],
          ["Amazon Simple Storage Service", 0.64, 0.48, "Source documents"],
          ["Amazon CloudWatch", 0.46, 0.8, "Token & latency telemetry"],
        ],
        links: [
          [0, 1],
          [1, 2],
          [2, 3],
          [1, 4],
          [4, 5],
          [5, 6],
          [1, 7],
        ],
      },
      "ai-agent": {
        title: "AI agent platform",
        nodes: [
          ["Amazon API Gateway", 0.1, 0.2, "Agent API"],
          ["AI Agent", 0.28, 0.2, "Planner / orchestrator"],
          ["Foundation Model", 0.47, 0.2, "Reasoning model"],
          ["AI Guardrails", 0.65, 0.2, "Policy guardrails"],
          ["AWS Lambda", 0.28, 0.48, "Tool functions"],
          ["Amazon DynamoDB", 0.47, 0.48, "Agent memory"],
          ["Vector Database", 0.65, 0.48, "Retrieval"],
          ["Amazon CloudWatch", 0.47, 0.8, "Traces & evals"],
        ],
        links: [
          [0, 1],
          [1, 2],
          [2, 3],
          [1, 4],
          [1, 5],
          [1, 6],
          [1, 7],
        ],
      },
      chatbot: {
        title: "GenAI chatbot",
        nodes: [
          ["Amazon CloudFront", 0.08, 0.2, "Edge"],
          ["Amazon API Gateway", 0.25, 0.2, "Chat API"],
          ["AWS Lambda", 0.42, 0.2, "Backend"],
          ["ChatGPT", 0.6, 0.2, "ChatGPT"],
          ["AI Guardrails", 0.78, 0.2, "Moderation"],
          ["Amazon Cognito", 0.25, 0.48, "Customer auth"],
          ["Amazon DynamoDB", 0.6, 0.48, "Conversation history"],
          ["Amazon CloudWatch", 0.6, 0.8, "Telemetry"],
        ],
        links: [
          [0, 1],
          [1, 2],
          [2, 3],
          [3, 4],
          [5, 1],
          [2, 6],
          [2, 7],
        ],
      },
    };
    return definitions[name];
  }

  function applyTemplate(name, options = {}) {
    if (name === "blank") {
      const clear = () => {
        state.name = "Untitled architecture";
        state.nodes = [];
        state.connections = [];
        selectedNodeId = null;
        selectedConnectionId = null;
        connectSourceId = null;
        resetSimulationState();
      };
      if (options.initial) {
        clear();
        renderAll();
      } else {
        commit("Blank canvas ready", clear);
      }
      elements.architectureName.value = state.name;
      return;
    }
    const definition = templateDefinition(name);
    if (!definition) {
      return;
    }
    const build = () => {
      state.name = definition.title;
      state.nodes = definition.nodes.map(([service, x, y, nodeName], index) =>
        makeNode(iconForTemplate(service), x, y, {
          name: nodeName,
          criticality: index < 3 ? "high" : "medium",
          notes: `Official ${service} component in the ${definition.title} flow.`,
        })
      );
      state.connections = definition.links.map(([from, to]) => ({
        id: nextConnectionId(),
        from: state.nodes[from].id,
        to: state.nodes[to].id,
        ...connectionDefaults(state.nodes[from].id, state.nodes[to].id),
      }));
      recentIconIds = state.nodes.slice(0, 4).map((node) => node.iconId);
      selectedNodeId = state.nodes[1]?.id || state.nodes[0]?.id || null;
      selectedConnectionId = null;
      connectSourceId = null;
      resetSimulationState();
    };
    if (options.initial) {
      build();
      syncControls();
      renderAll();
      markSaved("Template ready");
    } else {
      commit(`${definition.title} template loaded`, build);
      elements.architectureName.value = state.name;
    }
  }

  function createProject(project = {}) {
    const template = templateDefinition(project.template) ? project.template : "blank";
    applyTemplate(template, { initial: true });

    const stageEnvironment = {
      production: "Production",
      prototype: "Development",
      migration: "Staging",
      learning: "Development",
    };
    const environment = stageEnvironment[project.stage] || "Production";

    state.name =
      typeof project.name === "string" && project.name.trim()
        ? project.name.trim().slice(0, 80)
        : state.name;
    state.region =
      typeof project.region === "string" && project.region ? project.region : state.region;
    state.nodes.forEach((node) => {
      node.environment = environment;
    });

    history.length = 0;
    future = [];
    selectedConnectionId = null;
    resetSimulationState();
    syncControls();
    renderAll();
    markUnsaved(`${state.name} created`);
    elements.architectureName.dispatchEvent(new Event("change", { bubbles: true }));
    global.dispatchEvent(
      new CustomEvent("atlas:projectcreated", {
        detail: {
          name: state.name,
          template,
          region: state.region,
          stage: project.stage || "production",
        },
      })
    );
  }

  function updateSelectedNode(field, value) {
    const node = selectedNode();
    if (!node) {
      return;
    }
    node[field] = value;
    markUnsaved(`${node.name} updated`);
    renderNodes();
    renderInspector();
    renderChecks();
    renderScore();
  }

  function updateSelectedConnection(field, value) {
    const connection = selectedConnection();
    if (!connection) {
      return;
    }
    connection[field] = value;
    markUnsaved("Architecture path updated");
    renderConnections();
    renderInspector();
    renderChecks();
    renderScore();
  }

  function setInspectorTab(tab) {
    inspectorTab = tab;
    elements.inspectorTabs.forEach((button) => {
      const active = button.dataset.inspectorTab === tab;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    elements.inspectPanel.hidden = tab !== "inspect";
    elements.analyzePanel.hidden = tab !== "analyze";
  }

  function adjustZoom(direction) {
    const levels = [0.75, 0.9, 1, 1.15, 1.3];
    const currentIndex = levels.reduce(
      (closest, level, index) =>
        Math.abs(level - state.zoom) < Math.abs(levels[closest] - state.zoom) ? index : closest,
      0
    );
    const nextIndex = clamp(currentIndex + direction, 0, levels.length - 1);
    state.zoom = levels[nextIndex];
    elements.zoom.value = String(state.zoom);
    markUnsaved(`Zoom set to ${Math.round(state.zoom * 100)}%`);
    renderNodes();
  }

  function fitArchitecture() {
    if (!state.nodes.length) {
      return;
    }
    commit("Architecture fitted to canvas", () => {
      const xs = state.nodes.map((node) => node.x);
      const ys = state.nodes.map((node) => node.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const spanX = Math.max(0.08, maxX - minX);
      const spanY = Math.max(0.08, maxY - minY);
      state.nodes.forEach((node) => {
        node.x = 0.12 + ((node.x - minX) / spanX) * 0.76;
        node.y = 0.16 + ((node.y - minY) / spanY) * 0.68;
      });
    });
  }

  function autoLayoutArchitecture() {
    if (!state.nodes.length) {
      return;
    }
    commit("Architecture arranged", () => {
      const indegree = new Map(state.nodes.map((node) => [node.id, 0]));
      const outgoing = new Map(state.nodes.map((node) => [node.id, []]));
      state.connections.forEach((connection) => {
        if (indegree.has(connection.to) && outgoing.has(connection.from)) {
          indegree.set(connection.to, indegree.get(connection.to) + 1);
          outgoing.get(connection.from).push(connection.to);
        }
      });
      const depth = new Map();
      const queue = state.nodes
        .filter((node) => indegree.get(node.id) === 0)
        .map((node) => node.id);
      if (!queue.length) {
        queue.push(state.nodes[0].id);
      }
      queue.forEach((id) => depth.set(id, 0));
      while (queue.length) {
        const id = queue.shift();
        outgoing.get(id)?.forEach((next) => {
          depth.set(next, Math.max(depth.get(next) || 0, (depth.get(id) || 0) + 1));
          indegree.set(next, indegree.get(next) - 1);
          if (indegree.get(next) <= 0) {
            queue.push(next);
          }
        });
      }
      state.nodes.forEach((node, index) => {
        if (!depth.has(node.id)) {
          depth.set(node.id, index % 4);
        }
      });
      const maxDepth = Math.max(1, ...depth.values());
      const layers = new Map();
      state.nodes.forEach((node) => {
        const layer = depth.get(node.id);
        layers.set(layer, [...(layers.get(layer) || []), node]);
      });
      layers.forEach((nodes, layer) => {
        nodes.forEach((node, index) => {
          node.x = 0.1 + (layer / maxDepth) * 0.78;
          node.y = nodes.length === 1 ? 0.48 : 0.16 + (index / (nodes.length - 1)) * 0.66;
        });
      });
      failedNodeId = null;
      affectedNodeIds = new Set();
      affectedConnectionIds = new Set();
    });
  }

  function saveArchitecture() {
    try {
      global.localStorage.setItem(storageKey, architectureSnapshot());
      markSaved("Architecture saved locally");
    } catch {
      elements.statusMessage.textContent = "Local save is unavailable";
      elements.statusMessage.style.color = "var(--danger)";
    }
  }

  function exportArchitecture() {
    const payload = {
      format: "aws-command-atlas-flow-v1",
      exportedAt: new Date().toISOString(),
      iconRelease: catalogMeta.release,
      architecture: safeParse(architectureSnapshot()),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${
      state.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "aws-architecture"
    }.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    elements.statusMessage.textContent = "Architecture exported as JSON";
    elements.statusMessage.style.color = "var(--cyan)";
  }

  function escapeXml(value) {
    return String(value).replace(
      /[<>&"']/g,
      (character) =>
        ({
          "<": "&lt;",
          ">": "&gt;",
          "&": "&amp;",
          '"': "&quot;",
          "'": "&apos;",
        })[character]
    );
  }

  async function iconAsDataUrl(path) {
    try {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error("Icon unavailable");
      }
      const blob = await response.blob();
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      return path;
    }
  }

  async function exportSvgArchitecture() {
    const width = 1600;
    const height = 900;
    const iconEntries = await Promise.all(
      state.nodes.map(async (node) => [node.id, await iconAsDataUrl(node.iconPath)])
    );
    const iconMap = new Map(iconEntries);
    const nodeMap = new Map(state.nodes.map((node) => [node.id, node]));
    const lines = state.connections
      .map((connection) => {
        const from = nodeMap.get(connection.from);
        const to = nodeMap.get(connection.to);
        if (!from || !to) {
          return "";
        }
        const x1 = from.x * width;
        const y1 = from.y * height;
        const x2 = to.x * width;
        const y2 = to.y * height;
        const bend = Math.max(60, Math.abs(x2 - x1) * 0.42) * (x2 >= x1 ? 1 : -1);
        const dash =
          connection.type === "event" || connection.type === "telemetry"
            ? ' stroke-dasharray="10 8"'
            : "";
        return `<path d="M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}" fill="none" stroke="#9db7c3" stroke-width="3"${dash} marker-end="url(#arrow)"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 12}" fill="#bfd0d7" font-size="16" text-anchor="middle">${escapeXml(connection.label || "Path")}</text>`;
      })
      .join("");
    const nodes = state.nodes
      .map((node) => {
        const x = node.x * width;
        const y = node.y * height;
        return `<g transform="translate(${x - 58} ${y - 58})"><rect width="116" height="116" rx="6" fill="#07141d" stroke="${criticalityColors[node.criticality] || criticalityColors.medium}"/><image href="${escapeXml(iconMap.get(node.id))}" x="31" y="12" width="54" height="54"/><text x="58" y="88" fill="#f5fafc" font-size="15" font-weight="700" text-anchor="middle">${escapeXml(node.name.slice(0, 22))}</text><text x="58" y="106" fill="#8fa3ad" font-size="11" text-anchor="middle">${escapeXml(node.environment)}</text></g>`;
      })
      .join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="#16303c" stroke-width="1"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#9db7c3"/></marker></defs><rect width="100%" height="100%" fill="#06131d"/><rect width="100%" height="100%" fill="url(#grid)"/><text x="38" y="48" fill="#ffffff" font-size="24" font-family="system-ui" font-weight="700">${escapeXml(state.name)}</text><text x="38" y="74" fill="#8fa3ad" font-size="14" font-family="system-ui">${escapeXml(state.region)} · AWS Flow Studio</text><g font-family="system-ui">${lines}${nodes}</g></svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${
      state.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || "aws-architecture"
    }.svg`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    elements.statusMessage.textContent = "Architecture exported as SVG";
    elements.statusMessage.style.color = "var(--cyan)";
  }

  /**
   * Validate an architecture-shaped object and make it the live canvas.
   *
   * Shared by the JSON file importer and by generated sources such as the IaC
   * importer, so every entry point resolves icons, clamps coordinates, and
   * normalises enums the same way. Nodes whose service cannot be matched to a
   * catalog icon are dropped and reported back rather than failing the import.
   *
   * @returns {{imported: number, skipped: string[], connections: number}}
   */
  function adoptArchitecture(imported, label = "Architecture imported") {
    if (!imported || !Array.isArray(imported.nodes) || !Array.isArray(imported.connections)) {
      throw new Error("This file does not contain an AWS Flow Studio architecture.");
    }
    const skipped = [];
    const validNodes = imported.nodes
      .map((node) => {
        const icon =
          catalog.find((item) => item.id === node.iconId) ||
          findIcon(node.serviceName || node.name || "");
        if (!icon) {
          skipped.push(String(node.name || node.serviceName || "Unknown service"));
          return null;
        }
        return {
          ...makeNode(
            icon,
            Number.isFinite(Number(node.x)) ? Number(node.x) : 0.5,
            Number.isFinite(Number(node.y)) ? Number(node.y) : 0.5
          ),
          id: String(node.id || nextNodeId()),
          name: String(node.name || icon.name).slice(0, 60),
          environment: ["Production", "Staging", "Development", "Shared"].includes(node.environment)
            ? node.environment
            : "Production",
          criticality: ["high", "medium", "low"].includes(node.criticality)
            ? node.criticality
            : "medium",
          zone: ZONE_IDS.includes(node.zone) ? node.zone : inferZone(icon.name, node.name),
          notes: String(node.notes || "").slice(0, 280),
        };
      })
      .filter(Boolean);
    const nodeIds = new Set(validNodes.map((node) => node.id));
    const validConnections = imported.connections
      .filter(
        (connection) => nodeIds.has(String(connection.from)) && nodeIds.has(String(connection.to))
      )
      .map((connection) => ({
        id: String(connection.id || nextConnectionId()),
        from: String(connection.from),
        to: String(connection.to),
        type: ["request", "event", "data", "telemetry", "replication"].includes(connection.type)
          ? connection.type
          : "request",
        label: String(connection.label || "HTTPS").slice(0, 32),
        encrypted: connection.encrypted !== false,
      }));
    commit(label, () => {
      state.name = String(imported.name || "Imported architecture").slice(0, 80);
      state.region = String(imported.region || "us-east-1");
      state.grid = imported.grid !== false;
      state.zoom = clamp(Number(imported.zoom) || 1, 0.75, 1.3);
      state.nodes = validNodes;
      state.connections = validConnections;
      selectedNodeId = validNodes[0]?.id || null;
      selectedConnectionId = null;
      resetSimulationState();
    });
    syncControls();
    return { imported: validNodes.length, skipped, connections: validConnections.length };
  }

  async function importArchitecture(file) {
    try {
      const payload = safeParse(await file.text());
      const result = adoptArchitecture(payload?.architecture || payload);
      elements.statusMessage.textContent = `${result.imported} nodes imported`;
      elements.statusMessage.style.color = "var(--green)";
    } catch (error) {
      elements.statusMessage.textContent = error.message || "Architecture import failed";
      elements.statusMessage.style.color = "var(--danger)";
    } finally {
      elements.importInput.value = "";
    }
  }

  function resetSimulationState() {
    simulationRunning = false;
    failedNodeId = null;
    affectedNodeIds = new Set();
    affectedConnectionIds = new Set();
  }

  function undo() {
    if (!history.length) {
      return;
    }
    future.push(architectureSnapshot());
    restoreSnapshot(history.pop());
    markUnsaved("Undid last architecture change");
  }

  function redo() {
    if (!future.length) {
      return;
    }
    history.push(architectureSnapshot());
    restoreSnapshot(future.pop());
    markUnsaved("Restored architecture change");
  }

  function handleNodeActivation(nodeId) {
    if (editorMode === "connect") {
      if (!connectSourceId) {
        connectSourceId = nodeId;
        selectedNodeId = nodeId;
        selectedConnectionId = null;
        elements.canvasHint.textContent = "Now choose the destination node";
        renderNodes();
        renderInspector();
        return;
      }
      addConnection(connectSourceId, nodeId);
      elements.canvasHint.textContent = "Select a source node, then a destination";
      return;
    }
    selectedNodeId = nodeId;
    selectedConnectionId = null;
    renderAll();
  }

  elements.modeButtons.forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.flowMode));
  });

  elements.iconTypeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      iconType = button.dataset.iconType;
      elements.iconTypeButtons.forEach((candidate) => {
        const active = candidate === button;
        candidate.classList.toggle("is-active", active);
        candidate.setAttribute("aria-pressed", String(active));
      });
      renderCategories();
      renderLibrary();
    });
  });

  elements.iconSearch.addEventListener("input", renderLibrary);
  elements.categoryFilter.addEventListener("change", renderLibrary);
  elements.iconGrid.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-icon-id]");
    if (!tile) {
      return;
    }
    const icon = catalog.find((item) => item.id === tile.dataset.iconId);
    if (icon) {
      addNode(icon);
      if (event.detail === 0) {
        global.requestAnimationFrame(() => {
          elements.nodeLayer.querySelector(`[data-node-id="${selectedNodeId}"]`)?.focus();
        });
      }
    }
  });
  elements.recentIcons.addEventListener("click", (event) => {
    const tile = event.target.closest("[data-icon-id]");
    if (!tile) {
      return;
    }
    const icon = catalog.find((item) => item.id === tile.dataset.iconId);
    if (icon) {
      addNode(icon);
      if (event.detail === 0) {
        global.requestAnimationFrame(() => {
          elements.nodeLayer.querySelector(`[data-node-id="${selectedNodeId}"]`)?.focus();
        });
      }
    }
  });
  [elements.iconGrid, elements.recentIcons].forEach((library) => {
    library.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const tile = event.target.closest("[data-icon-id]");
      if (!tile) return;
      event.preventDefault();
      tile.click();
    });
    library.addEventListener("dragstart", (event) => {
      const tile = event.target.closest("[data-icon-id]");
      if (!tile || !event.dataTransfer) return;
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData("text/aws-icon-id", tile.dataset.iconId);
      event.dataTransfer.setData("text/plain", tile.dataset.iconId);
    });
  });
  elements.canvas.addEventListener("dragover", (event) => {
    if (!event.dataTransfer) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    elements.canvas.classList.add("is-drag-target");
  });
  elements.canvas.addEventListener("dragleave", (event) => {
    if (!elements.canvas.contains(event.relatedTarget)) {
      elements.canvas.classList.remove("is-drag-target");
    }
  });
  elements.canvas.addEventListener("drop", (event) => {
    event.preventDefault();
    elements.canvas.classList.remove("is-drag-target");
    const iconId =
      event.dataTransfer?.getData("text/aws-icon-id") ||
      event.dataTransfer?.getData("text/plain");
    const icon = catalog.find((item) => item.id === iconId);
    if (!icon) return;
    const rect = elements.canvas.getBoundingClientRect();
    addNodeAt(
      icon,
      (event.clientX - rect.left) / rect.width,
      (event.clientY - rect.top) / rect.height
    );
  });
  document.addEventListener("dragend", () => elements.canvas.classList.remove("is-drag-target"));

  elements.nodeLayer.addEventListener("pointerdown", (event) => {
    const nodeElement = event.target.closest("[data-node-id]");
    if (!nodeElement) {
      return;
    }
    const nodeId = nodeElement.dataset.nodeId;
    if (editorMode === "connect") {
      handleNodeActivation(nodeId);
      return;
    }
    selectedNodeId = nodeId;
    selectedConnectionId = null;
    setInspectorTab("inspect");
    [...elements.nodeLayer.querySelectorAll("[data-node-id]")].forEach((candidate) => {
      candidate.classList.toggle("is-selected", candidate.dataset.nodeId === nodeId);
    });
    renderConnections();
    renderInspector();
    renderCounts();
    renderSimulation();
    const node = state.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }
    dragState = {
      node,
      startX: event.clientX,
      startY: event.clientY,
      originalX: node.x,
      originalY: node.y,
      snapshot: architectureSnapshot(),
      moved: false,
    };
    nodeElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  elements.nodeLayer.addEventListener("click", (event) => {
    if (event.detail !== 0) return;
    const nodeElement = event.target.closest("[data-node-id]");
    if (!nodeElement) return;
    const nodeId = nodeElement.dataset.nodeId;
    handleNodeActivation(nodeId);
    global.requestAnimationFrame(() => {
      elements.nodeLayer.querySelector(`[data-node-id="${nodeId}"]`)?.focus();
    });
  });

  elements.nodeLayer.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const nodeElement = event.target.closest("[data-node-id]");
    if (!nodeElement) return;
    event.preventDefault();
    nodeElement.click();
  });

  elements.nodeLayer.addEventListener("pointermove", (event) => {
    if (!dragState) {
      return;
    }
    const rect = elements.canvas.getBoundingClientRect();
    const dx = (event.clientX - dragState.startX) / Math.max(1, rect.width);
    const dy = (event.clientY - dragState.startY) / Math.max(1, rect.height);
    dragState.node.x = clamp(dragState.originalX + dx, 0.06, 0.94);
    dragState.node.y = clamp(dragState.originalY + dy, 0.08, 0.92);
    dragState.moved =
      dragState.moved ||
      Math.abs(event.clientX - dragState.startX) > 2 ||
      Math.abs(event.clientY - dragState.startY) > 2;
    const nodeElement = elements.nodeLayer.querySelector(`[data-node-id="${dragState.node.id}"]`);
    if (nodeElement) {
      nodeElement.style.left = `${dragState.node.x * 100}%`;
      nodeElement.style.top = `${dragState.node.y * 100}%`;
    }
    renderConnections();
  });

  function endDrag() {
    if (!dragState) {
      return;
    }
    if (dragState.moved) {
      history.push(dragState.snapshot);
      future = [];
      markUnsaved(`${dragState.node.name} moved`);
      renderCounts();
    }
    dragState = null;
  }

  elements.nodeLayer.addEventListener("pointerup", endDrag);
  elements.nodeLayer.addEventListener("pointercancel", endDrag);

  function selectConnection(connectionId, { restoreFocus = false } = {}) {
    if (!state.connections.some((connection) => connection.id === connectionId)) return;
    selectedConnectionId = connectionId;
    selectedNodeId = null;
    setInspectorTab("inspect");
    renderAll();
    if (restoreFocus) {
      global.requestAnimationFrame(() => {
        elements.connections
          .querySelector(`[data-connection-id="${connectionId}"][tabindex]`)
          ?.focus();
      });
    }
  }

  elements.connections.addEventListener("click", (event) => {
    const path = event.target.closest("[data-connection-id]");
    if (!path) return;
    selectConnection(path.dataset.connectionId);
  });

  elements.connections.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const path = event.target.closest("[data-connection-id]");
    if (!path) return;
    event.preventDefault();
    selectConnection(path.dataset.connectionId, { restoreFocus: true });
  });

  elements.canvas.addEventListener("click", (event) => {
    if (
      event.target === elements.canvas ||
      event.target === elements.nodeLayer ||
      event.target === elements.connections
    ) {
      selectedNodeId = null;
      selectedConnectionId = null;
      connectSourceId = null;
      renderAll();
    }
  });

  elements.canvas.addEventListener("keydown", (event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelection();
    }
  });

  elements.deleteButton.addEventListener("click", removeSelection);
  elements.undoButton.addEventListener("click", undo);
  elements.redoButton.addEventListener("click", redo);
  elements.fitButton.addEventListener("click", fitArchitecture);
  elements.autoLayoutButton.addEventListener("click", autoLayoutArchitecture);
  elements.importButton.addEventListener("click", () => elements.importInput.click());
  elements.importInput.addEventListener("change", () => {
    const [file] = elements.importInput.files;
    if (file) {
      importArchitecture(file);
    }
  });
  elements.saveButton.addEventListener("click", saveArchitecture);
  elements.exportButton.addEventListener("click", exportArchitecture);
  elements.exportSvgButton.addEventListener("click", exportSvgArchitecture);
  elements.runSimulationButton.addEventListener("click", toggleTrafficSimulation);
  elements.injectFailureButton.addEventListener("click", injectFailure);
  elements.resetSimulationButton.addEventListener("click", resetSimulation);
  elements.zoomInButton.addEventListener("click", () => adjustZoom(1));
  elements.zoomOutButton.addEventListener("click", () => adjustZoom(-1));
  elements.libraryToggle.addEventListener("click", () => {
    const studio = elements.canvas.closest(".flow-studio");
    const collapsed = studio.classList.toggle("is-library-collapsed");
    elements.libraryToggle.setAttribute("aria-expanded", String(!collapsed));
    global.setTimeout(refreshLayout, 170);
  });

  elements.inspectorTabs.forEach((button) => {
    button.addEventListener("click", () => setInspectorTab(button.dataset.inspectorTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const currentIndex = elements.inspectorTabs.indexOf(button);
      const nextIndex =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? elements.inspectorTabs.length - 1
            : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + elements.inspectorTabs.length) %
              elements.inspectorTabs.length;
      const next = elements.inspectorTabs[nextIndex];
      setInspectorTab(next.dataset.inspectorTab);
      next.focus();
    });
  });

  elements.templateButtons.forEach((button) => {
    button.addEventListener("click", () => applyTemplate(button.dataset.flowTemplate));
  });

  elements.architectureName.addEventListener("input", () => {
    state.name = elements.architectureName.value;
    markUnsaved("Architecture renamed");
  });
  elements.region.addEventListener("change", () => {
    state.region = elements.region.value;
    markUnsaved(`Region changed to ${state.region}`);
  });
  elements.gridToggle.addEventListener("change", () => {
    state.grid = elements.gridToggle.checked;
    elements.canvas.classList.toggle("is-gridless", !state.grid);
    markUnsaved(state.grid ? "Grid enabled" : "Grid hidden");
  });
  elements.zoom.addEventListener("change", () => {
    state.zoom = Number(elements.zoom.value);
    markUnsaved(`Zoom set to ${Math.round(state.zoom * 100)}%`);
    renderNodes();
  });

  elements.nodeName.addEventListener("input", () =>
    updateSelectedNode("name", elements.nodeName.value)
  );
  elements.nodeEnvironment.addEventListener("change", () =>
    updateSelectedNode("environment", elements.nodeEnvironment.value)
  );
  elements.nodeZone?.addEventListener("change", () => {
    const zone = normalizeZone(elements.nodeZone.value);
    if (elements.nodeZoneHint) elements.nodeZoneHint.textContent = ZONES[zone].hint;
    updateSelectedNode("zone", zone);
  });
  elements.nodeCriticality.addEventListener("change", () =>
    updateSelectedNode("criticality", elements.nodeCriticality.value)
  );
  elements.nodeNotes.addEventListener("input", () =>
    updateSelectedNode("notes", elements.nodeNotes.value)
  );
  elements.connectionName.addEventListener("input", () =>
    updateSelectedConnection("label", elements.connectionName.value)
  );
  elements.connectionType.addEventListener("change", () =>
    updateSelectedConnection("type", elements.connectionType.value)
  );
  elements.connectionEncrypted.addEventListener("change", () =>
    updateSelectedConnection("encrypted", elements.connectionEncrypted.checked)
  );

  global.addEventListener("keydown", (event) => {
    const studioView = elements.canvas.closest(".view-studio");
    if (!studioView?.classList.contains("is-active")) {
      return;
    }
    const target = event.target;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement;
    if (typing) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo() : undo();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      saveArchitecture();
    }
  });

  global.addEventListener("resize", refreshLayout);
  if (typeof global.ResizeObserver === "function") {
    const canvasObserver = new global.ResizeObserver(refreshLayout);
    canvasObserver.observe(elements.canvas);
  }

  renderCategories();
  syncControls();
  setInspectorTab(inspectorTab);
  if (!state.nodes.length) {
    applyTemplate("serverless", { initial: true });
  } else {
    renderAll();
    markSaved("Saved architecture restored");
  }

  function reveal(target = {}) {
    if (target.kind === "library") {
      const query = String(target.query || "").trim();
      const match = query
        ? catalog.find((icon) => icon.search?.includes(query.toLowerCase()))
        : null;
      iconType = match?.type || "service";
      elements.iconTypeButtons.forEach((button) => {
        const active = button.dataset.iconType === iconType;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      renderCategories();
      elements.categoryFilter.value = "all";
      elements.iconSearch.value = query;
      renderLibrary();
      global.requestAnimationFrame(() => elements.iconSearch.focus());
      return true;
    }

    if (target.kind === "connection" && target.id) {
      if (!state.connections.some((connection) => connection.id === target.id)) return false;
      setMode("select");
      selectConnection(target.id);
      global.requestAnimationFrame(() => {
        if (target.field === "encrypted") elements.connectionEncrypted.focus();
        else {
          elements.connections
            .querySelector(`[data-connection-id="${target.id}"][tabindex]`)
            ?.focus();
        }
      });
      return true;
    }

    if (target.kind === "node" && target.id) {
      if (!state.nodes.some((node) => node.id === target.id)) return false;
      setMode("select");
      selectedNodeId = target.id;
      selectedConnectionId = null;
      setInspectorTab("inspect");
      renderAll();
      global.requestAnimationFrame(() => {
        elements.nodeLayer.querySelector(`[data-node-id="${target.id}"]`)?.focus();
      });
      return true;
    }

    if (target.kind === "canvas") {
      setMode("connect");
      elements.canvas.focus();
      return true;
    }

    return false;
  }

  global.AWSFlowStudio = {
    getState: () => safeParse(architectureSnapshot()),
    snapshot: architectureSnapshot,
    loadArchitecture: (snapshot) => {
      restoreSnapshot(typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot));
      markSaved("Session loaded");
    },
    adoptArchitecture,
    applyTemplate,
    createProject,
    save: saveArchitecture,
    reveal,
    refreshLayout,
    catalogCount: catalog.length,
  };

  return global.AWSFlowStudio;
}
