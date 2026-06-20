(function initializeFlowStudio(global) {
  "use strict";

  const catalog = Array.isArray(global.AWS_ICON_CATALOG) ? global.AWS_ICON_CATALOG : [];
  const catalogMeta = global.AWS_ICON_CATALOG_META || { count: catalog.length };
  const storageKey = "aws-command-atlas-flow-studio-v1";
  const criticalityColors = {
    high: "#ff635c",
    medium: "#ffb84d",
    low: "#86f7ad"
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
    saveButton: document.getElementById("flowSaveButton"),
    exportButton: document.getElementById("flowExportButton"),
    iconTypeButtons: [...document.querySelectorAll("[data-icon-type]")],
    iconSearch: document.getElementById("flowIconSearch"),
    categoryFilter: document.getElementById("flowCategoryFilter"),
    libraryCount: document.getElementById("flowLibraryCount"),
    iconGrid: document.getElementById("flowIconGrid"),
    architectureName: document.getElementById("flowArchitectureName"),
    canvasHint: document.getElementById("flowCanvasHint"),
    canvas: document.getElementById("flowCanvas"),
    connections: document.getElementById("flowConnections"),
    nodeLayer: document.getElementById("flowNodeLayer"),
    emptyState: document.getElementById("flowEmptyState"),
    templateButtons: [...document.querySelectorAll("[data-flow-template]")],
    inspectorMode: document.getElementById("flowInspectorMode"),
    selectedSummary: document.getElementById("flowSelectedSummary"),
    nodeFields: document.getElementById("flowNodeFields"),
    nodeName: document.getElementById("flowNodeName"),
    nodeEnvironment: document.getElementById("flowNodeEnvironment"),
    nodeCriticality: document.getElementById("flowNodeCriticality"),
    nodeNotes: document.getElementById("flowNodeNotes"),
    checksTitle: document.getElementById("flowChecksTitle"),
    checksList: document.getElementById("flowChecksList"),
    statusMessage: document.getElementById("flowStatusMessage"),
    region: document.getElementById("flowRegion"),
    gridToggle: document.getElementById("flowGridToggle"),
    zoom: document.getElementById("flowZoom")
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
  let history = [];
  let future = [];
  let dragState = null;

  const state = loadState() || {
    name: "My resilient workload",
    region: "us-east-1",
    grid: true,
    zoom: 1,
    nodes: [],
    connections: []
  };

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
      const saved = safeParse(global.localStorage.getItem(storageKey));
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
      connections: state.connections
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
    elements.saveState.textContent = "Unsaved";
    elements.saveState.style.color = "var(--amber)";
    elements.statusMessage.textContent = message || "Architecture changed";
    elements.statusMessage.style.color = "var(--amber)";
  }

  function markSaved(message) {
    elements.saveState.textContent = "Saved locally";
    elements.saveState.style.color = "var(--green)";
    elements.statusMessage.textContent = message || "Saved locally";
    elements.statusMessage.style.color = "var(--green)";
  }

  function findIcon(name, preferredType = "service") {
    const normalized = name.toLowerCase();
    return catalog.find((icon) => icon.type === preferredType && icon.name.toLowerCase() === normalized)
      || catalog.find((icon) => icon.type === preferredType && icon.name.toLowerCase().includes(normalized))
      || catalog.find((icon) => icon.name.toLowerCase().includes(normalized));
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
      notes: overrides.notes || ""
    };
  }

  function addNode(icon) {
    const index = state.nodes.length;
    const x = 0.18 + ((index * 0.19) % 0.64);
    const y = 0.22 + ((Math.floor(index / 4) * 0.24) % 0.54);
    commit(`Added ${icon.name}`, () => {
      const node = makeNode(icon, x, y);
      state.nodes.push(node);
      selectedNodeId = node.id;
      selectedConnectionId = null;
      selectedLibraryIconId = icon.id;
    });
  }

  function addConnection(fromId, toId) {
    if (!fromId || !toId || fromId === toId) {
      elements.statusMessage.textContent = "Choose two different nodes";
      return;
    }
    if (state.connections.some((connection) => connection.from === fromId && connection.to === toId)) {
      elements.statusMessage.textContent = "Those nodes are already connected";
      return;
    }
    commit("Connection added", () => {
      const connection = { id: nextConnectionId(), from: fromId, to: toId };
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
        state.connections = state.connections.filter((connection) => connection.from !== selectedNodeId && connection.to !== selectedNodeId);
        selectedNodeId = null;
        connectSourceId = null;
      });
      return;
    }
    if (selectedConnectionId) {
      commit("Connection deleted", () => {
        state.connections = state.connections.filter((connection) => connection.id !== selectedConnectionId);
        selectedConnectionId = null;
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
    elements.canvasHint.textContent = mode === "connect"
      ? "Select a source node, then a destination"
      : "Select an icon to add it";
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
    const categories = [...new Set(catalog.filter((icon) => icon.type === iconType).map((icon) => icon.category))]
      .sort((a, b) => a.localeCompare(b));
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
    elements.libraryCount.textContent = icons.length > visible.length
      ? `${icons.length} icons · showing ${visible.length}`
      : `${icons.length} icons`;
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
    elements.connections.setAttribute("viewBox", `0 0 ${Math.max(1, rect.width)} ${Math.max(1, rect.height)}`);
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
      visible.setAttribute("class", `flow-connection${selectedConnectionId === connection.id ? " is-selected" : ""}`);
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", pathData);
      hit.setAttribute("class", "flow-connection-hit");
      hit.dataset.connectionId = connection.id;
      elements.connections.append(visible, hit);
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
      button.dataset.nodeId = node.id;
      button.style.left = `${node.x * 100}%`;
      button.style.top = `${node.y * 100}%`;
      button.style.setProperty("--criticality", criticalityColors[node.criticality] || criticalityColors.medium);
      button.setAttribute("aria-label", `${node.name}, ${node.environment}, ${node.criticality} criticality`);
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
  }

  function selectedNode() {
    return state.nodes.find((node) => node.id === selectedNodeId) || null;
  }

  function renderInspector() {
    const node = selectedNode();
    elements.selectedSummary.replaceChildren();
    elements.nodeFields.hidden = !node;
    elements.inspectorMode.textContent = node ? "Node" : selectedConnectionId ? "Connection" : "Diagram";
    if (!node) {
      const placeholder = document.createElement("span");
      placeholder.className = "flow-selected-placeholder";
      placeholder.textContent = selectedConnectionId
        ? "Connection selected. Delete removes this path."
        : "Select a node to inspect it.";
      elements.selectedSummary.append(placeholder);
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
  }

  function architectureChecks() {
    const checks = [];
    const names = state.nodes.map((node) => `${node.name} ${node.serviceName}`.toLowerCase());
    const connectedIds = new Set(state.connections.flatMap((connection) => [connection.from, connection.to]));
    const isolated = state.nodes.filter((node) => !connectedIds.has(node.id));
    const hasMonitoring = names.some((name) => name.includes("cloudwatch"));
    const hasPublicEntry = names.some((name) => name.includes("cloudfront") || name.includes("api gateway"));
    const hasEdgeSecurity = names.some((name) => name.includes("waf") || name.includes("shield"));
    const hasData = names.some((name) => name.includes("dynamodb") || name.includes("rds") || name.includes("aurora") || name.includes("s3"));
    const hasRecovery = names.some((name) => name.includes("backup") || name.includes("s3") || name.includes("glacier"));

    checks.push(state.nodes.length >= 2 && state.connections.length >= 1
      ? { tone: "pass", title: "Flow path established", detail: `${state.connections.length} directional connection${state.connections.length === 1 ? "" : "s"}` }
      : { tone: "warn", title: "Architecture is not connected", detail: "Add at least two nodes and connect them." });
    checks.push(isolated.length
      ? { tone: "warn", title: `${isolated.length} isolated node${isolated.length === 1 ? "" : "s"}`, detail: "Connect every service to make ownership and traffic flow visible." }
      : { tone: "pass", title: "No isolated services", detail: "Every node participates in the architecture flow." });
    checks.push(hasMonitoring
      ? { tone: "pass", title: "Observability present", detail: "CloudWatch is represented in the design." }
      : { tone: "warn", title: "No observability service", detail: "Add CloudWatch or another telemetry destination." });
    if (hasPublicEntry) {
      checks.push(hasEdgeSecurity
        ? { tone: "pass", title: "Public edge is protected", detail: "WAF or Shield is present near the entry path." }
        : { tone: "warn", title: "Public edge needs protection", detail: "Consider AWS WAF or Shield for public traffic." });
    }
    if (hasData) {
      checks.push(hasRecovery
        ? { tone: "pass", title: "Recovery target represented", detail: "The architecture includes a durable recovery service." }
        : { tone: "warn", title: "Data recovery is unclear", detail: "Add AWS Backup, S3, or Glacier to show recovery intent." });
    }
    return checks;
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
    renderCounts();
    renderLibrary();
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
          ["Amazon API Gateway", 0.14, 0.42, "Public API"],
          ["AWS Lambda", 0.38, 0.42, "Request processor"],
          ["Amazon DynamoDB", 0.65, 0.28, "Application state"],
          ["Amazon Simple Storage Service", 0.65, 0.64, "Object archive"],
          ["Amazon CloudWatch", 0.86, 0.42, "Telemetry"]
        ],
        links: [[0, 1], [1, 2], [1, 3], [1, 4]]
      },
      events: {
        title: "Event pipeline",
        nodes: [
          ["Amazon EventBridge", 0.12, 0.42, "Event ingress"],
          ["AWS Step Functions", 0.34, 0.42, "Workflow orchestrator"],
          ["Amazon Simple Queue Service", 0.57, 0.42, "Work queue"],
          ["AWS Lambda", 0.78, 0.42, "Event worker"],
          ["Amazon CloudWatch", 0.78, 0.72, "Pipeline telemetry"]
        ],
        links: [[0, 1], [1, 2], [2, 3], [3, 4]]
      },
      web: {
        title: "Resilient web app",
        nodes: [
          ["Amazon CloudFront", 0.12, 0.38, "Global edge"],
          ["AWS WAF", 0.32, 0.38, "Edge protection"],
          ["Amazon EC2 Auto Scaling", 0.54, 0.38, "Application fleet"],
          ["Amazon RDS", 0.78, 0.27, "Primary database"],
          ["Amazon Simple Storage Service", 0.32, 0.7, "Static assets"],
          ["Amazon CloudWatch", 0.78, 0.68, "Operations telemetry"]
        ],
        links: [[0, 1], [1, 2], [2, 3], [4, 0], [2, 5]]
      }
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
      state.nodes = definition.nodes.map(([service, x, y, nodeName], index) => makeNode(
        iconForTemplate(service),
        x,
        y,
        {
          name: nodeName,
          criticality: index < 3 ? "high" : "medium",
          notes: `Official ${service} component in the ${definition.title} flow.`
        }
      ));
      state.connections = definition.links.map(([from, to]) => ({
        id: nextConnectionId(),
        from: state.nodes[from].id,
        to: state.nodes[to].id
      }));
      selectedNodeId = state.nodes[1]?.id || state.nodes[0]?.id || null;
      selectedConnectionId = null;
      connectSourceId = null;
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
      architecture: safeParse(architectureSnapshot())
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "aws-architecture"}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    elements.statusMessage.textContent = "Architecture exported as JSON";
    elements.statusMessage.style.color = "var(--cyan)";
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
        candidate.setAttribute("aria-selected", String(active));
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
    }
  });

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
    [...elements.nodeLayer.querySelectorAll("[data-node-id]")].forEach((candidate) => {
      candidate.classList.toggle("is-selected", candidate.dataset.nodeId === nodeId);
    });
    renderConnections();
    renderInspector();
    renderCounts();
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
      moved: false
    };
    nodeElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
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
    dragState.moved = dragState.moved || Math.abs(event.clientX - dragState.startX) > 2 || Math.abs(event.clientY - dragState.startY) > 2;
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

  elements.connections.addEventListener("click", (event) => {
    const path = event.target.closest("[data-connection-id]");
    if (!path) {
      return;
    }
    selectedConnectionId = path.dataset.connectionId;
    selectedNodeId = null;
    renderAll();
  });

  elements.canvas.addEventListener("click", (event) => {
    if (event.target === elements.canvas || event.target === elements.nodeLayer || event.target === elements.connections) {
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
  elements.saveButton.addEventListener("click", saveArchitecture);
  elements.exportButton.addEventListener("click", exportArchitecture);

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

  elements.nodeName.addEventListener("input", () => updateSelectedNode("name", elements.nodeName.value));
  elements.nodeEnvironment.addEventListener("change", () => updateSelectedNode("environment", elements.nodeEnvironment.value));
  elements.nodeCriticality.addEventListener("change", () => updateSelectedNode("criticality", elements.nodeCriticality.value));
  elements.nodeNotes.addEventListener("input", () => updateSelectedNode("notes", elements.nodeNotes.value));

  global.addEventListener("resize", () => {
    renderConnections();
  });

  renderCategories();
  syncControls();
  if (!state.nodes.length) {
    applyTemplate("serverless", { initial: true });
  } else {
    renderAll();
    markSaved("Saved architecture restored");
  }

  global.AWSFlowStudio = {
    getState: () => safeParse(architectureSnapshot()),
    applyTemplate,
    save: saveArchitecture,
    catalogCount: catalog.length
  };
})(typeof window !== "undefined" ? window : globalThis);
