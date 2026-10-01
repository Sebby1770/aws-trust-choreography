/**
 * AWS Diagram Studio — a draw.io-class diagram editor that understands AWS.
 *
 * The editing engine lives in `src/diagram/`. This module composes it with
 * the parts that make it more than a drawing tool: live architecture
 * intelligence, trust zones that follow containers, Chaos Lab, cost, draw.io
 * interchange, infrastructure-as-code import, pages, and the public
 * `window.AWSFlowStudio` API the rest of the app (Review Center, Launchpad,
 * the IaC importer, the command palette) talks to.
 *
 * Initialized by src/main.js once the icon catalog has been lazily loaded.
 *
 * @param {Array} iconCatalog - AWS + AI icon catalog entries
 * @param {object} iconCatalogMeta - catalog metadata (release, count, ...)
 * @param {{theme?: {mode: string, setMode: Function}}} [hooks] - app services the
 *   studio's own title bar exposes, since the site header is hidden here
 */
import { reviewAwsArchitecture } from "./aws-review-model.js";
import { matchIcon } from "./icon-match.js";
import { classifyCrossing, ZONES, zoneOf } from "./trust-zones.js";
import {
  analyzeResilience,
  blastRadius,
  findEntryPoints,
  findTerminals,
  formatAvailability,
  simulateFailures,
} from "./chaos-engine.js";
import { createSessionStore } from "./studio-sessions.js";
import { estimateArchitectureCost, formatUsd } from "./cost-model.js";
import { toTerraform } from "./terraform-export.js";
import { toMermaid } from "./mermaid-export.js";
import { createDiagramEditor } from "./diagram/editor.js";
import { mountLibrary } from "./diagram/library.js";
import { mountFormatPanel } from "./diagram/format-panel.js";
import { closeMenus, formatShortcut, mountMenubar, openContextMenu } from "./diagram/menus.js";
import { createQuickInsert } from "./diagram/quick-insert.js";
import { createMinimap } from "./diagram/minimap.js";
import {
  analysisView,
  createDocument,
  descendants,
  inheritedZone,
  isContainer,
  isServiceNode,
  makeServiceNode,
  makeShape,
  normalizeDocument,
  rectOf,
  vertices,
} from "./diagram/model.js";
import { unionRects } from "./diagram/geometry.js";
import { documentSvg } from "./diagram/scene.js";
import {
  drawioToArchitecture,
  looksLikeDrawio,
  readDrawioPages,
  toDrawio,
} from "./diagram/drawio.js";
import { buildBlueprint, buildTemplate, TEMPLATES } from "./diagram/templates.js";
import { downloadBlob, downloadText, fileSlug, iconDataUrls, svgToPng } from "./diagram/export.js";
import { CONTAINER_PRESETS } from "./diagram/shapes.js";
import {
  defaultTableColumns,
  documentToSchema,
  ensureForeignKey,
  fitTable,
  isTable,
  schemaToDocument,
} from "./diagram/er.js";
import { DIALECTS, looksLikeSchema, parseSchema, SAMPLE_SCHEMA, toDDL } from "./sql-schema.js";

const STORAGE_KEY = "aws-command-atlas-flow-studio-v3";
const LEGACY_KEYS = ["aws-command-atlas-flow-studio-v2", "aws-command-atlas-flow-studio-v1"];
const PREFS_KEY = "trust-choreography:diagram-studio:v1";
const EXPORT_FORMAT = "trust-choreography-diagram@3";
const REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ca-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-central-1",
  "ap-southeast-1",
  "ap-southeast-2",
  "ap-northeast-1",
  "ap-south-1",
  "sa-east-1",
];

function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

export function initFlowStudio(iconCatalog, iconCatalogMeta, hooks = {}) {
  const global = window;
  const catalog = Array.isArray(iconCatalog) ? iconCatalog : [];
  const catalogMeta = iconCatalogMeta || { count: catalog.length };
  const root = document.querySelector("#diagramStudio");
  if (!root || !catalog.length) return null;

  const $ = (selector) => root.querySelector(selector);
  const elements = {
    libraryHost: $("#dsLibrary"),
    canvasHost: $("#dsCanvasHost"),
    panel: $("#dsPanel"),
    formatHost: $("#dsFormat"),
    menubar: $("#dsMenubar"),
    name: $("#flowArchitectureName"),
    saveState: $("#flowSaveState"),
    status: $("#flowStatusMessage"),
    counts: $("#dsCounts"),
    cost: $("#dsCost"),
    pages: $("#dsPages"),
    zoomLabel: $("#dsZoomLabel"),
    openInput: $("#dsOpenInput"),
    empty: $("#dsEmpty"),
    findbar: $("#dsFindbar"),
    findInput: $("#dsFindInput"),
    findCount: $("#dsFindCount"),
    scoreChip: $("#dsScoreChip"),
    panelTabs: [...root.querySelectorAll("[data-ds-tab]")],
    panelBodies: [...root.querySelectorAll("[data-ds-panel]")],
    // Architecture intelligence (Insights tab)
    checksTitle: $("#flowChecksTitle"),
    checksList: $("#flowChecksList"),
    scoreRing: $("#flowScoreRing"),
    score: $("#flowScore"),
    scoreGrade: $("#flowScoreGrade"),
    scoreSummary: $("#flowScoreSummary"),
    securityScore: $("#flowSecurityScore"),
    reliabilityScore: $("#flowReliabilityScore"),
    observabilityScore: $("#flowObservabilityScore"),
    recoveryScore: $("#flowRecoveryScore"),
    // Chaos tab
    chaosResults: $("#flowChaosResults"),
    chaosRun: $("#flowChaosRun"),
    chaosKill: $("#flowChaosKill"),
    chaosReset: $("#flowChaosReset"),
    runSimulation: $("#flowRunSimulationButton"),
    injectFailure: $("#flowInjectFailureButton"),
    resetSimulation: $("#flowResetSimulationButton"),
    simulationState: $("#flowSimulationState"),
    simulationMessage: $("#flowSimulationMessage"),
    affectedPaths: $("#flowAffectedPaths"),
  };

  const prefs = {
    libraryOpen: true,
    panelOpen: true,
    minimap: true,
    tab: "format",
    overlays: { zones: false, trust: true, criticality: false },
    ...readPrefs(),
  };
  prefs.overlays = { zones: false, trust: true, criticality: false, ...(prefs.overlays || {}) };
  const persistPrefs = () => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  };

  // ---------------------------------------------------------------- catalog

  const iconById = new Map(catalog.map((icon) => [icon.id, icon]));
  const findIcon = (name, type = "service") => matchIcon(catalog, name, type);
  const resolveIcon = (node) =>
    iconById.get(node.iconId) ||
    (node.serviceName && findIcon(node.serviceName)) ||
    (node.name && findIcon(node.name)) ||
    null;
  const resolveService = (name) => {
    const text = String(name || "").trim();
    if (!text) return null;
    return (
      catalog.find((icon) => icon.name.toLowerCase() === text.toLowerCase()) ||
      findIcon(text, "service") ||
      findIcon(text, "resource") ||
      null
    );
  };

  function connectionDefaults(from, to) {
    if (isTable(from) && isTable(to)) {
      return {
        type: "request",
        label: "",
        encrypted: true,
        style: { routing: "orthogonal", stroke: "#3b6fb6", strokeWidth: 1.4 },
      };
    }
    if (!isServiceNode(from) || !isServiceNode(to))
      return { type: "request", label: "", encrypted: true };
    const names = `${from.serviceName || ""} ${to.serviceName || ""}`.toLowerCase();
    if (names.includes("cloudwatch") || names.includes("x ray") || names.includes("x-ray")) {
      return { type: "telemetry", label: "Telemetry", encrypted: true };
    }
    if (
      ["eventbridge", "queue", "sqs", "notification", "kinesis"].some((word) =>
        names.includes(word)
      )
    ) {
      return { type: "event", label: "Events", encrypted: true };
    }
    if (
      ["dynamodb", "rds", "storage service", "aurora", "vector", "elasticache"].some((word) =>
        names.includes(word)
      )
    ) {
      return { type: "data", label: "Query", encrypted: true };
    }
    return { type: "request", label: "HTTPS", encrypted: true };
  }

  // ----------------------------------------------------------------- status

  function say(message, tone = "neutral") {
    if (!elements.status || !message) return;
    elements.status.textContent = message;
    elements.status.dataset.tone = tone;
  }

  // -------------------------------------------------------- analysis state

  let simulating = false;
  let failedNodeId = null;
  let affectedIds = new Set();
  let killedIds = new Set();
  let chaosReport = null;

  function getOverlays() {
    return {
      ...prefs.overlays,
      affected: affectedIds,
      killed: killedIds,
      failed: failedNodeId,
    };
  }

  function resetSimulationState() {
    simulating = false;
    failedNodeId = null;
    affectedIds = new Set();
    root.classList.remove("is-simulating");
  }

  // ------------------------------------------------------------- editor

  let formatPanel = null;
  let initialised = false;
  let minimap = null;
  let quickInsert = null;
  let library = null;
  let insightTimer = 0;
  let saveTimer = 0;

  const editor = createDiagramEditor({
    root: elements.canvasHost,
    resolveIcon: (id) => iconById.get(id) || null,
    connectionDefaults,
    getOverlays,
    isActive: () => studioActive(),
    onChange: handleChange,
    onSelectionChange: () => {
      formatPanel?.render();
      syncToolbar();
      renderSimulation();
    },
    onViewChange: () => {
      minimap?.draw();
      syncZoomLabel();
    },
    onStatus: (message) => say(message),
    onQuickInsert: (request) => quickInsert?.open(request),
    onContextMenu: (request) => openCanvasMenu(request),
    onDropItem: (item, at) => insertItem(item, { at }),
    onDropFile: (file, at) => openFile(file, { at }),
    onPasteText: (text) => {
      if (!looksLikeDrawio(text)) return false;
      importDrawioText(text, { asPaste: true });
      return true;
    },
    onToolChange: syncToolbar,
    // Drawing a line between two tables is drawing a foreign key.
    onConnectionCreated: (draft, connection) => {
      const source = draft.shapes.find((shape) => shape.id === connection.from);
      const target = draft.shapes.find((shape) => shape.id === connection.to);
      if (!isTable(source) || !isTable(target)) return;
      const added = ensureForeignKey(connection, source, target, editor.measure);
      if (added) say(`Added ${source.label}.${added} → ${target.label} foreign key`, "good");
    },
  });

  function studioActive() {
    return Boolean(root.closest(".view")?.classList.contains("is-active"));
  }

  function snapshot() {
    return JSON.stringify(editor.doc);
  }

  function handleChange(event) {
    const doc = editor.doc;
    const ids = new Set(doc.nodes.map((node) => node.id));
    killedIds = new Set([...killedIds].filter((id) => ids.has(id)));
    if (failedNodeId && !ids.has(failedNodeId)) resetSimulationState();
    if (event.type !== "load") scheduleSave();
    syncToolbar();
    syncCounts();
    renderPages();
    if (elements.name && document.activeElement !== elements.name) elements.name.value = doc.name;
    elements.empty.hidden = Boolean(doc.nodes.length || doc.shapes.length);
    formatPanel?.render();
    minimap?.draw();
    clearTimeout(insightTimer);
    insightTimer = setTimeout(renderInsights, event.type === "load" ? 0 : 140);
    global.dispatchEvent(
      new CustomEvent("trust:designchange", {
        detail: { source: "aws", reason: event.label || event.type },
      })
    );
  }

  // ---------------------------------------------------------- persistence

  const pages = createSessionStore(global.localStorage);

  function scheduleSave() {
    if (elements.saveState) {
      elements.saveState.textContent = "Saving…";
      elements.saveState.dataset.state = "saving";
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 450);
  }

  function saveNow() {
    clearTimeout(saveTimer);
    const text = snapshot();
    try {
      global.localStorage.setItem(STORAGE_KEY, text);
      pages.saveActive(text);
      if (elements.saveState) {
        elements.saveState.textContent = "Saved";
        elements.saveState.dataset.state = "saved";
      }
      return true;
    } catch {
      if (elements.saveState) {
        elements.saveState.textContent = "Not saved";
        elements.saveState.dataset.state = "error";
      }
      say("Local save is unavailable in this browser", "danger");
      return false;
    }
  }

  function parseDocument(raw) {
    if (!raw) return null;
    const payload = typeof raw === "string" ? safeParse(raw) : raw;
    if (!payload) return null;
    try {
      return normalizeDocument(payload.architecture || payload, { resolveIcon }).doc;
    } catch {
      return null;
    }
  }

  function loadInitialDocument() {
    const stored = parseDocument(global.localStorage.getItem(STORAGE_KEY));
    if (stored) return stored;
    for (const key of LEGACY_KEYS) {
      const legacy = parseDocument(global.localStorage.getItem(key));
      if (legacy) return legacy;
    }
    const active = pages.list().sessions.find((session) => session.id === pages.list().activeId);
    return parseDocument(active?.snapshot) || null;
  }

  // ------------------------------------------------------------- templates

  function templateDocument(id, environment = "Production") {
    try {
      return buildTemplate(id, { findIcon, connectionDefaults, environment });
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  function applyTemplate(name, { initial = false } = {}) {
    const doc =
      name === "blank"
        ? createDocument({
            name: "Untitled architecture",
            region: editor.doc?.region || "us-east-1",
          })
        : templateDocument(name);
    if (!doc) return;
    if (editor.doc && name !== "blank") doc.region = editor.doc.region;
    resetSimulationState();
    killedIds = new Set();
    editor.setDocument(doc, initial ? { resetHistory: true } : { label: `${doc.name} template` });
    pages.renameActive(doc.name);
    renderPages();
    say(name === "blank" ? "Blank canvas ready" : `${doc.name} template loaded`);
  }

  function createProject(project = {}) {
    const stageEnvironment = {
      production: "Production",
      prototype: "Development",
      migration: "Staging",
      learning: "Development",
    };
    const environment = stageEnvironment[project.stage] || "Production";
    const template = TEMPLATES[project.template] ? project.template : "blank";
    const doc =
      template === "blank"
        ? createDocument()
        : templateDocument(template, environment) || createDocument();
    doc.name =
      typeof project.name === "string" && project.name.trim()
        ? project.name.trim().slice(0, 80)
        : doc.name;
    doc.region = typeof project.region === "string" && project.region ? project.region : doc.region;
    resetSimulationState();
    killedIds = new Set();
    editor.setDocument(doc, { resetHistory: true });
    pages.renameActive(doc.name);
    saveNow();
    renderPages();
    say(`${doc.name} created`);
    global.dispatchEvent(
      new CustomEvent("atlas:projectcreated", {
        detail: {
          name: doc.name,
          template,
          region: doc.region,
          stage: project.stage || "production",
        },
      })
    );
  }

  // --------------------------------------------------------------- insert

  function buildFromItem(item) {
    if (item.type === "icon") {
      const icon = iconById.get(item.id);
      return icon ? { build: () => makeServiceNode(icon, {}), label: `Added ${icon.name}` } : null;
    }
    if (item.type === "shape" && item.kind === "table") {
      return {
        build: () => {
          const columns = item.join
            ? [
                { name: "left_id", type: "bigint", pk: true, nullable: false },
                { name: "right_id", type: "bigint", pk: true, nullable: false },
              ]
            : defaultTableColumns();
          const table = makeShape("table", {
            label: item.join ? "join_table" : nextTableName(),
            columns,
          });
          return fitTable(table, editor.measure);
        },
        label: item.join ? "Added join table" : "Added table",
      };
    }
    if (item.type === "shape") {
      return {
        build: () =>
          makeShape(item.kind, {
            preset: item.preset,
            label: item.label ?? (item.kind === "text" ? "Text" : ""),
            src: item.src,
            w: item.w,
            h: item.h,
          }),
        label: `Added ${item.label || item.kind}`,
      };
    }
    return null;
  }

  function nextTableName() {
    const names = new Set(editor.doc.shapes.filter(isTable).map((table) => table.label));
    let index = 1;
    while (names.has(index === 1 ? "new_table" : `new_table_${index}`)) index += 1;
    return index === 1 ? "new_table" : `new_table_${index}`;
  }

  // -------------------------------------------------------------- SQL ⇄ ER

  /** DDL for the tables on this page (or just `ids`). */
  function schemaSql(dialect = "postgres", ids = null) {
    const schema = documentToSchema(editor.doc, { ids });
    const header = `${editor.doc.name} — generated by Trust Choreography (${DIALECTS[dialect]?.label || dialect})`;
    const notes = schema.notes.map((note) => `NOTE: ${note}`).join("\n");
    return {
      sql: schema.tables.length
        ? toDDL(schema, { dialect, header: notes ? `${header}\n${notes}` : header })
        : "",
      tables: schema.tables.length,
      notes: schema.notes,
    };
  }

  /** Turn SQL into an ER diagram on a new page (or this one when empty). */
  function openSqlSchema(sql, name = null) {
    const parsed = parseSchema(sql);
    if (!parsed.tables.length) {
      say("No CREATE TABLE statements found in that SQL", "warn");
      return { tables: 0, relationships: 0, warnings: parsed.warnings };
    }
    const doc = schemaToDocument(parsed, {
      name: name || "Database schema",
      measure: editor.measure,
    });
    resetSimulationState();
    openAsPage(doc, "Imported SQL schema");
    const relationships = doc.connections.length;
    say(
      `Drew ${parsed.tables.length} table${parsed.tables.length === 1 ? "" : "s"} and ${relationships} relationship${relationships === 1 ? "" : "s"}${parsed.warnings.length ? ` · ${parsed.warnings[0]}` : ""}`,
      parsed.warnings.length ? "warn" : "good"
    );
    return { tables: parsed.tables.length, relationships, warnings: parsed.warnings };
  }

  /**
   * Open a generated diagram (IAM access map, VPC plan…) as a new page, or on
   * this page when it is empty. Returns the document that was opened.
   */
  function openBlueprint(blueprint, message = null) {
    let doc;
    try {
      doc = buildBlueprint(blueprint, { findIcon, connectionDefaults });
    } catch (error) {
      console.error(error);
      say("That diagram could not be drawn", "warn");
      return null;
    }
    // A new page resets the simulation itself; reusing an empty page must too.
    if (currentPageIsEmpty()) resetSimulationState();
    // At the page limit addPage has already explained why nothing opened.
    if (!openAsPage(doc, blueprint.name || "Generated diagram")) return null;
    say(message || `Opened ${doc.name}`, "good");
    return doc;
  }

  async function copyTableSql(ids = null, dialect = "postgres") {
    const { sql, tables, notes } = schemaSql(dialect, ids);
    if (!tables) {
      say("There are no tables on this page yet — add one from Database (ER)", "warn");
      return;
    }
    try {
      await navigator.clipboard.writeText(sql);
      say(
        `Copied ${DIALECTS[dialect].label} DDL for ${tables} table${tables === 1 ? "" : "s"}${notes.length ? ` · ${notes[0]}` : ""}`,
        notes.length ? "warn" : "good"
      );
    } catch {
      downloadText(sql, `${fileSlug(editor.doc.name)}.sql`, "application/sql");
      say("Clipboard blocked — SQL downloaded instead", "warn");
    }
  }

  function exportSql(dialect) {
    const { sql, tables, notes } = schemaSql(dialect);
    if (!tables) {
      say("There are no tables on this page yet — add one from Database (ER)", "warn");
      return;
    }
    downloadText(sql, `${fileSlug(editor.doc.name)}-${dialect}.sql`, "application/sql");
    say(
      `Exported ${DIALECTS[dialect].label} DDL${notes.length ? ` · ${notes[0]}` : ""}`,
      notes.length ? "warn" : "good"
    );
  }

  let sqlDialog = null;

  function openSqlDialog(initial = "") {
    if (!sqlDialog) {
      sqlDialog = document.createElement("dialog");
      sqlDialog.className = "ds-sql-dialog";
      sqlDialog.setAttribute("aria-labelledby", "dsSqlDialogTitle");
      sqlDialog.innerHTML = `
        <form method="dialog" class="ds-sql-form">
          <header>
            <div><span>SQL → DIAGRAM</span><h2 id="dsSqlDialogTitle">Import a SQL schema</h2></div>
            <button type="button" class="ds-sql-close" aria-label="Close">×</button>
          </header>
          <p>Paste <code>CREATE TABLE</code> statements (PostgreSQL, MySQL, SQLite or SQL Server). Tables, keys and foreign keys become an editable ER diagram. Parsed in this browser — nothing is uploaded.</p>
          <label class="visually-hidden" for="dsSqlSource">SQL schema</label>
          <textarea id="dsSqlSource" spellcheck="false" placeholder="CREATE TABLE customers (id bigserial PRIMARY KEY, …);"></textarea>
          <p class="ds-sql-stats" aria-live="polite"></p>
          <footer>
            <button type="button" class="ds-sql-example">Use an example</button>
            <span></span>
            <button type="button" class="ds-sql-cancel">Cancel</button>
            <button type="submit" class="ds-sql-submit" disabled>Create diagram</button>
          </footer>
        </form>`;
      document.body.append(sqlDialog);
      const source = sqlDialog.querySelector("textarea");
      const stats = sqlDialog.querySelector(".ds-sql-stats");
      const submit = sqlDialog.querySelector(".ds-sql-submit");
      const refresh = () => {
        const parsed = parseSchema(source.value);
        const keys = parsed.tables.reduce((sum, table) => sum + table.foreignKeys.length, 0);
        submit.disabled = !parsed.tables.length;
        stats.textContent = source.value.trim()
          ? parsed.tables.length
            ? `${parsed.tables.length} table${parsed.tables.length === 1 ? "" : "s"} · ${keys} foreign key${keys === 1 ? "" : "s"}${parsed.warnings.length ? ` · ${parsed.warnings.length} note${parsed.warnings.length === 1 ? "" : "s"}` : ""}`
            : "No CREATE TABLE statements found yet."
          : "";
      };
      source.addEventListener("input", refresh);
      source.addEventListener("keydown", (event) => event.stopPropagation());
      sqlDialog.querySelector(".ds-sql-example").addEventListener("click", () => {
        source.value = SAMPLE_SCHEMA;
        refresh();
      });
      const close = () => sqlDialog.close();
      sqlDialog.querySelector(".ds-sql-close").addEventListener("click", close);
      sqlDialog.querySelector(".ds-sql-cancel").addEventListener("click", close);
      sqlDialog.querySelector("form").addEventListener("submit", (event) => {
        event.preventDefault();
        openSqlSchema(source.value);
        close();
      });
      sqlDialog.refresh = refresh;
    }
    const source = sqlDialog.querySelector("textarea");
    if (initial) source.value = initial;
    sqlDialog.refresh();
    sqlDialog.showModal?.();
    requestAnimationFrame(() => source.focus());
  }

  /** Wrap the selected shapes in a new container, VPC-style. */
  function wrapSelection(preset) {
    const chosen = editor.selectedElements().filter((element) => "w" in element);
    if (!chosen.length) return false;
    const doc = editor.doc;
    const ids = new Set(chosen.map((element) => element.id));
    const roots = chosen.filter(
      (vertex) =>
        !vertices(doc).some(
          (other) =>
            ids.has(other.id) && descendants(doc, [other.id]).some((d) => d.id === vertex.id)
        )
    );
    const bounds = unionRects(
      roots.map((vertex) =>
        isServiceNode(vertex)
          ? {
              x: vertex.x - 40,
              y: vertex.y,
              w: vertex.w + 80,
              h: vertex.h + editor.labelDepth(vertex),
            }
          : rectOf(vertex)
      )
    );
    let created = null;
    editor.commit(`Wrapped in ${CONTAINER_PRESETS[preset]?.label || "container"}`, (draft) => {
      const sharedParent = roots.every(
        (vertex) => (vertex.parent || null) === (roots[0].parent || null)
      )
        ? roots[0].parent || null
        : null;
      created = makeShape("container", {
        preset,
        x: Math.round(bounds.x - 30),
        y: Math.round(bounds.y - 50),
        w: Math.round(bounds.w + 60),
        h: Math.round(bounds.h + 80),
        parent: sharedParent,
      });
      const lowest = Math.min(...roots.map((vertex) => vertex.z ?? 0), 0);
      created.z = Math.min(-1, lowest - 1);
      draft.shapes.push(created);
      for (const vertex of roots) {
        const live = [...draft.nodes, ...draft.shapes].find(
          (candidate) => candidate.id === vertex.id
        );
        live.parent = created.id;
        if (isServiceNode(live)) {
          const inherited = inheritedZone(draft, live.id);
          if (inherited) live.zone = inherited.zone;
        }
      }
    });
    if (created) editor.setSelection([created.id]);
    return true;
  }

  function insertItem(item, { at = null, event = null, request = null } = {}) {
    if (
      item.type === "shape" &&
      item.kind === "container" &&
      !at &&
      !request &&
      editor.selectedElements().some((element) => "w" in element)
    ) {
      if (wrapSelection(item.preset || "generic")) return;
    }
    const recipe = buildFromItem(item);
    if (!recipe) return;
    if (request) {
      editor.insertVertex(recipe.build, {
        at: request.world,
        connectFrom: request.connectFrom || null,
        label: recipe.label,
      });
    } else if (at) {
      editor.insertVertex(recipe.build, { at, label: recipe.label });
    } else if (
      !event?.shiftKey &&
      editor.selectedElements().length === 1 &&
      "w" in editor.selectedElements()[0] &&
      !(item.type === "shape" && item.kind === "container")
    ) {
      editor.insertConnected(recipe.build, `${recipe.label}, connected`);
    } else {
      editor.insertVertex(recipe.build, { label: recipe.label });
    }
    // On small screens the library is an overlay; get it out of the way.
    if (global.innerWidth <= 1024) setLibraryOpen(false, { save: false });
    editor.focus();
  }

  // ------------------------------------------------------------- insights

  function renderInsights() {
    const view = analysisView(editor.doc);
    const review = reviewAwsArchitecture(view, {
      failed: Boolean(failedNodeId),
      affectedCount: [...affectedIds].filter((id) => view.nodes.some((n) => n.id === id)).length,
    });
    const analysis = review.analysis;
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
        ? "var(--ds-good)"
        : analysis.overall >= 50
          ? "var(--ds-warn)"
          : "var(--ds-bad)";
    if (elements.score) {
      elements.score.textContent = view.nodes.length ? String(analysis.overall) : "—";
      elements.scoreGrade.textContent = view.nodes.length ? grade : "Add services";
      elements.scoreGrade.style.color = color;
      elements.scoreRing.style.setProperty(
        "--score",
        String(view.nodes.length ? analysis.overall : 0)
      );
      elements.scoreRing.style.setProperty("--score-color", color);
      elements.securityScore.textContent = String(analysis.security);
      elements.reliabilityScore.textContent = String(analysis.reliability);
      elements.observabilityScore.textContent = String(analysis.observability);
      elements.recoveryScore.textContent = String(analysis.recovery);
      elements.scoreSummary.textContent = !view.nodes.length
        ? "Add AWS services and connect them to see a live readiness score."
        : failedNodeId
          ? `Failure rehearsal reaches ${affectedIds.size} downstream item${affectedIds.size === 1 ? "" : "s"}.`
          : analysis.overall >= 70
            ? "Balanced. Work through the recommendations to harden it further."
            : "Strengthen identity, telemetry, and recovery before production.";
    }
    if (elements.scoreChip) {
      elements.scoreChip.textContent = view.nodes.length ? String(analysis.overall) : "—";
      elements.scoreChip.dataset.tone = !view.nodes.length
        ? ""
        : analysis.overall >= 70
          ? "good"
          : analysis.overall >= 50
            ? "warn"
            : "bad";
    }
    if (elements.checksList) {
      const checks = review.checks;
      elements.checksTitle.textContent = `${checks.length} check${checks.length === 1 ? "" : "s"}`;
      elements.checksList.replaceChildren(
        ...checks.map((check) => {
          const item = document.createElement(check.target ? "button" : "article");
          if (check.target) {
            item.type = "button";
            item.addEventListener("click", () => revealTarget(check.target));
          }
          item.className = `flow-check-item ${check.tone}`;
          const title = document.createElement("strong");
          title.textContent = check.title;
          const detail = document.createElement("small");
          detail.textContent = check.detail;
          item.append(title, detail);
          return item;
        })
      );
    }
    if (chaosReport) renderChaos();
  }

  function revealTarget(target) {
    if (!target) return;
    const id = target.id || target.nodeId || target.connectionId;
    if (id && editor.reveal(id)) setTab("format");
  }

  // --------------------------------------------------------------- chaos

  function chaosTone(value) {
    if (value >= 0.9999) return "good";
    if (value >= 0.999) return "warn";
    return "bad";
  }

  function chaosSection(title, body) {
    const section = document.createElement("div");
    section.className = "flow-chaos-section";
    const heading = document.createElement("h4");
    heading.textContent = title;
    section.append(heading, body);
    return section;
  }

  function renderChaos() {
    const results = elements.chaosResults;
    if (!results) return;
    results.replaceChildren();
    const view = analysisView(editor.doc);
    const alive = view.nodes.filter((node) => !killedIds.has(node.id));
    const aliveConnections = view.connections.filter(
      (c) => !killedIds.has(c.from) && !killedIds.has(c.to)
    );
    chaosReport = analyzeResilience(alive, aliveConnections, {
      entryIds: findEntryPoints(view.nodes, view.connections).map((node) => node.id),
      terminalIds: findTerminals(view.nodes, view.connections).map((node) => node.id),
    });
    if (chaosReport.empty) {
      const empty = document.createElement("p");
      empty.className = "flow-chaos-placeholder";
      empty.textContent = killedIds.size
        ? "Every service is down — restore the architecture to analyse it."
        : "Add services and connect them, then run the analysis.";
      results.append(empty);
      return;
    }
    if (chaosReport.overall != null) {
      const formatted = formatAvailability(chaosReport.overall);
      const headline = document.createElement("div");
      headline.className = `flow-chaos-headline is-${chaosTone(chaosReport.overall)}`;
      const value = document.createElement("strong");
      value.textContent = formatted.pct;
      const label = document.createElement("span");
      label.textContent = `${formatted.nines} · ~${formatted.downtimeMinutesPerYear} min downtime/year (estimated)`;
      headline.append(value, label);
      results.append(headline);
    }
    if (killedIds.size) {
      const names = view.nodes.filter((node) => killedIds.has(node.id)).map((node) => node.name);
      const simulation = simulateFailures(view.nodes, view.connections, [...killedIds]);
      const banner = document.createElement("div");
      banner.className = `flow-chaos-verdict is-${simulation.verdict}`;
      banner.textContent = `${names.join(", ")} down → ${simulation.verdict.toUpperCase()} · ${simulation.survivingFlows}/${simulation.totalFlows} flows survive`;
      results.append(banner);
    }
    const spofBody = document.createElement("ul");
    spofBody.className = "flow-chaos-list";
    if (!chaosReport.spofs.length) {
      const item = document.createElement("li");
      item.className = "is-good";
      item.textContent = "None — every service has an alternate route around it.";
      spofBody.append(item);
    } else {
      chaosReport.spofs.slice(0, 5).forEach((spof) => {
        const item = document.createElement("li");
        item.className = "is-bad";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "flow-chaos-link";
        button.textContent = spof.name;
        button.addEventListener("click", () => editor.reveal(spof.id));
        const detail = document.createElement("span");
        detail.textContent = ` strands ${spof.stranded} node${spof.stranded === 1 ? "" : "s"} (${spof.criticality})`;
        item.append(button, detail);
        spofBody.append(item);
      });
    }
    results.append(chaosSection("Single points of failure", spofBody));
    if (chaosReport.flows.length) {
      const table = document.createElement("table");
      table.className = "flow-chaos-table";
      table.innerHTML =
        "<thead><tr><th>Flow</th><th>Hops</th><th>Routes</th><th>Availability</th></tr></thead>";
      const body = document.createElement("tbody");
      chaosReport.flows.slice(0, 6).forEach((flow) => {
        const row = document.createElement("tr");
        [
          `${flow.from} → ${flow.to}`,
          String(flow.hops),
          String(flow.redundancy),
          formatAvailability(flow.availability).pct,
        ].forEach((text, index) => {
          const cell = document.createElement("td");
          cell.textContent = text;
          if (index === 3) cell.className = `is-${chaosTone(flow.availability)}`;
          row.append(cell);
        });
        body.append(row);
      });
      table.append(body);
      results.append(chaosSection("Flow availability", table));
    }
    const blastBody = document.createElement("ul");
    blastBody.className = "flow-chaos-list";
    chaosReport.blast.slice(0, 4).forEach((entry) => {
      const item = document.createElement("li");
      item.className = `is-${entry.classification === "systemic" ? "bad" : entry.classification === "significant" ? "warn" : "good"}`;
      const name = document.createElement("strong");
      name.textContent = entry.name;
      const detail = document.createElement("span");
      detail.textContent = ` → ${entry.downstreamCount} downstream (${entry.classification})`;
      item.append(name, detail);
      blastBody.append(item);
    });
    if (blastBody.childElementCount) results.append(chaosSection("Blast radius", blastBody));
    const advice = document.createElement("ul");
    advice.className = "flow-chaos-advice";
    chaosReport.recommendations.forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      advice.append(item);
    });
    results.append(chaosSection("Recommendations", advice));
  }

  function traceFailure(nodeId) {
    const view = analysisView(editor.doc);
    const downstream = new Set();
    const queue = [nodeId];
    while (queue.length) {
      const current = queue.shift();
      for (const connection of view.connections) {
        if (connection.from !== current) continue;
        downstream.add(connection.id);
        if (!downstream.has(connection.to) && connection.to !== nodeId) {
          downstream.add(connection.to);
          queue.push(connection.to);
        }
      }
    }
    affectedIds = downstream;
  }

  function selectedService() {
    const [element] = editor.selectedElements();
    return isServiceNode(element) ? element : null;
  }

  function killNode(id) {
    const node = editor.doc.nodes.find((candidate) => candidate.id === id);
    if (!node) {
      say("Select an AWS service to rehearse its failure", "warn");
      return;
    }
    killedIds.add(id);
    failedNodeId = id;
    traceFailure(id);
    const view = analysisView(editor.doc);
    const impact = blastRadius(view.nodes, view.connections, id);
    say(
      `${node.name} is down — ${impact?.downstreamCount ?? 0} downstream service${impact?.downstreamCount === 1 ? "" : "s"} affected`,
      "danger"
    );
    setTab("chaos");
    editor.render();
    renderChaos();
    renderInsights();
    renderSimulation();
  }

  function restoreAll() {
    killedIds = new Set();
    resetSimulationState();
    editor.render();
    renderChaos();
    renderInsights();
    renderSimulation();
    say("Architecture restored", "good");
  }

  function renderSimulation() {
    root.classList.toggle("is-simulating", simulating);
    if (!elements.runSimulation) return;
    elements.runSimulation.classList.toggle("is-active", simulating);
    elements.runSimulation.innerHTML = simulating
      ? '<span aria-hidden="true">❚❚</span>Pause traffic'
      : '<span aria-hidden="true">▶</span>Run traffic';
    const node = failedNodeId
      ? editor.doc.nodes.find((candidate) => candidate.id === failedNodeId)
      : null;
    if (node) {
      const paths = [...affectedIds].filter((id) =>
        editor.doc.connections.some((c) => c.id === id)
      ).length;
      elements.simulationState.textContent = "Failure active";
      elements.simulationState.dataset.tone = "bad";
      elements.affectedPaths.textContent = String(paths);
      elements.simulationMessage.textContent = `${node.name} failure reaches ${affectedIds.size - paths} downstream service${affectedIds.size - paths === 1 ? "" : "s"}.`;
    } else {
      elements.simulationState.textContent = simulating ? "Traffic running" : "Ready";
      elements.simulationState.dataset.tone = simulating ? "info" : "good";
      elements.affectedPaths.textContent = "0";
      elements.simulationMessage.textContent = selectedService()
        ? "Selected service is ready for failure rehearsal."
        : "Select a service to rehearse its failure.";
    }
  }

  // --------------------------------------------------------------- panels

  function setTab(tab) {
    prefs.tab = ["format", "insights", "chaos"].includes(tab) ? tab : "format";
    persistPrefs();
    elements.panelTabs.forEach((button) => {
      const active = button.dataset.dsTab === prefs.tab;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    elements.panelBodies.forEach((body) => {
      body.hidden = body.dataset.dsPanel !== prefs.tab;
    });
    if (prefs.tab === "chaos") renderChaos();
    if (!panelIsOpen() && initialised) setPanelOpen(true);
  }

  // Narrow screens start with both panels tucked away without forgetting
  // the desktop preference, so `save: false` leaves prefs untouched.
  function setLibraryOpen(open, { save = true } = {}) {
    const value = Boolean(open);
    if (save) {
      prefs.libraryOpen = value;
      persistPrefs();
    }
    root.dataset.libraryOpen = String(value);
    $("#dsLibraryToggle")?.setAttribute("aria-expanded", String(value));
    elements.libraryHost.inert = !value;
  }

  function setPanelOpen(open, { save = true } = {}) {
    const value = Boolean(open);
    if (save) {
      prefs.panelOpen = value;
      persistPrefs();
    }
    root.dataset.panelOpen = String(value);
    $("#dsPanelToggle")?.setAttribute("aria-expanded", String(value));
    elements.panel.inert = !value;
  }

  const libraryIsOpen = () => root.dataset.libraryOpen === "true";
  const panelIsOpen = () => root.dataset.panelOpen === "true";

  function setOverlay(key, value) {
    prefs.overlays = { ...prefs.overlays, [key]: Boolean(value) };
    persistPrefs();
    editor.render();
    formatPanel?.render();
  }

  // ---------------------------------------------------------------- pages

  function renderPages() {
    if (!elements.pages) return;
    const state = pages.list();
    const tabs = state.sessions.map((session) => {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "ds-page-tab";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(session.id === state.activeId));
      tab.dataset.pageId = session.id;
      tab.textContent =
        session.id === state.activeId && editor.doc
          ? editor.doc.name || session.name
          : session.name;
      tab.title = "Double-click to rename · right-click for more";
      return tab;
    });
    const add = document.createElement("button");
    add.type = "button";
    add.className = "ds-page-add";
    add.title = "Add page";
    add.setAttribute("aria-label", "Add page");
    add.textContent = "+";
    add.disabled = state.sessions.length >= pages.maxSessions;
    elements.pages.replaceChildren(...tabs, add);
  }

  function switchPage(id) {
    const state = pages.list();
    if (id === state.activeId) return;
    const { target } = pages.switch(id, snapshot());
    if (!target) return;
    const doc = parseDocument(target.snapshot) || createDocument({ name: target.name });
    resetSimulationState();
    killedIds = new Set();
    editor.setDocument(doc, { resetHistory: true });
    try {
      global.localStorage.setItem(STORAGE_KEY, snapshot());
    } catch {
      /* storage unavailable */
    }
    renderPages();
    say(`Opened page “${target.name}”`);
  }

  function addPage(doc = null, name = null) {
    const count = pages.list().sessions.length + 1;
    const pageName = name || doc?.name || `Page ${count}`;
    const { created } = pages.create(pageName, snapshot(), doc ? JSON.stringify(doc) : "");
    if (!created) {
      say(`You can have up to ${pages.maxSessions} pages`, "warn");
      return false;
    }
    resetSimulationState();
    killedIds = new Set();
    editor.setDocument(
      doc || createDocument({ name: pageName, region: editor.doc?.region || "us-east-1" }),
      { resetHistory: true }
    );
    saveNow();
    renderPages();
    return true;
  }

  function renamePage(id) {
    const tab = elements.pages.querySelector(`[data-page-id="${id}"]`);
    if (!tab) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "ds-page-rename";
    input.value = tab.textContent;
    input.maxLength = 60;
    input.setAttribute("aria-label", "Page name");
    tab.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (save && value) {
        pages.rename(id, value);
        if (id === pages.list().activeId)
          editor.commit("Renamed page", (doc) => void (doc.name = value.slice(0, 80)));
      }
      renderPages();
    };
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  function deletePage(id) {
    const state = pages.list();
    if (state.sessions.length <= 1) {
      say("A diagram always keeps at least one page", "warn");
      return;
    }
    const session = state.sessions.find((candidate) => candidate.id === id);
    if (!global.confirm(`Delete page “${session?.name}”? This cannot be undone.`)) return;
    const wasActive = id === state.activeId;
    const { active } = pages.remove(id);
    if (wasActive && active) {
      const doc = parseDocument(active.snapshot) || createDocument({ name: active.name });
      editor.setDocument(doc, { resetHistory: true });
      saveNow();
    }
    renderPages();
    say("Page deleted");
  }

  function duplicatePage(id) {
    const state = pages.list();
    const session = state.sessions.find((candidate) => candidate.id === id);
    const source = id === state.activeId ? snapshot() : session?.snapshot;
    const doc = parseDocument(source) || createDocument();
    doc.name = `${doc.name} copy`.slice(0, 80);
    addPage(doc, doc.name);
  }

  elements.pages?.addEventListener("click", (event) => {
    if (event.target.closest(".ds-page-add")) {
      addPage();
      return;
    }
    const tab = event.target.closest("[data-page-id]");
    if (tab) switchPage(tab.dataset.pageId);
  });
  elements.pages?.addEventListener("dblclick", (event) => {
    const tab = event.target.closest("[data-page-id]");
    if (tab) renamePage(tab.dataset.pageId);
  });
  elements.pages?.addEventListener("contextmenu", (event) => {
    const tab = event.target.closest("[data-page-id]");
    if (!tab) return;
    event.preventDefault();
    const id = tab.dataset.pageId;
    openContextMenu(event.clientX, event.clientY, [
      { label: "Rename", run: () => renamePage(id) },
      { label: "Duplicate", run: () => duplicatePage(id) },
      "-",
      {
        label: "Delete page",
        run: () => deletePage(id),
        disabled: pages.list().sessions.length <= 1,
      },
    ]);
  });

  // ---------------------------------------------------------- import/export

  function exportContext(icons) {
    return {
      ...editor.sceneContext(),
      iconHref: (element) => icons.get(element.iconPath) || null,
    };
  }

  async function exportImage(kind) {
    const doc = editor.doc;
    if (!doc.nodes.length && !doc.shapes.length) {
      say("Nothing to export yet — add some shapes first", "warn");
      return;
    }
    say(`Preparing ${kind.toUpperCase()}…`);
    const icons = await iconDataUrls(doc);
    const selected = editor.selection();
    const ids = selected.length ? selected : null;
    const drawio =
      kind === "svg" ? toDrawio(doc, { iconDataUrl: (path) => icons.get(path) || null }) : null;
    const { markup, width, height } = documentSvg(doc, exportContext(icons), {
      ids,
      content: drawio,
    });
    const base = fileSlug(doc.name);
    if (kind === "svg") {
      downloadText(
        `<?xml version="1.0" encoding="UTF-8"?>\n${markup}`,
        `${base}.drawio.svg`,
        "image/svg+xml"
      );
      say(
        `Exported ${ids ? "selection" : "diagram"} as SVG — it also opens as an editable diagram in draw.io`,
        "good"
      );
      return;
    }
    try {
      const png = await svgToPng(markup, width, height, { scale: 2 });
      downloadBlob(png, `${base}.png`);
      say(`Exported ${ids ? "selection" : "diagram"} as PNG (2×)`, "good");
    } catch (error) {
      say(error.message || "PNG export failed", "danger");
    }
  }

  async function exportDrawio() {
    const doc = editor.doc;
    const icons = await iconDataUrls(doc);
    const xml = toDrawio(doc, { iconDataUrl: (path) => icons.get(path) || null });
    downloadText(xml, `${fileSlug(doc.name)}.drawio`, "application/vnd.jgraph.mxfile");
    say("Exported a .drawio file — open it in draw.io / diagrams.net", "good");
  }

  function exportJson() {
    const payload = {
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      iconRelease: catalogMeta.release,
      architecture: JSON.parse(snapshot()),
    };
    downloadText(
      JSON.stringify(payload, null, 2),
      `${fileSlug(editor.doc.name)}.json`,
      "application/json"
    );
    say("Exported diagram JSON", "good");
  }

  function exportTerraform() {
    downloadText(toTerraform(analysisView(editor.doc)), `${fileSlug(editor.doc.name)}-main.tf`);
    say("Terraform skeleton downloaded — review the TODOs before applying", "good");
  }

  async function copyMermaid() {
    const text = toMermaid(analysisView(editor.doc));
    try {
      await navigator.clipboard.writeText(text);
      say("Mermaid diagram copied — paste it into a README or PR", "good");
    } catch {
      downloadText(text, `${fileSlug(editor.doc.name)}.mmd`);
      say("Clipboard blocked — Mermaid diagram downloaded instead", "warn");
    }
  }

  /** Replace the page with an architecture from any source (JSON, IaC, draw.io). */
  function adoptArchitecture(imported, label = "Architecture imported") {
    const { doc, skipped } = normalizeDocument(imported, { resolveIcon });
    resetSimulationState();
    killedIds = new Set();
    editor.setDocument(doc, { label });
    pages.renameActive(doc.name);
    renderPages();
    return { imported: doc.nodes.length, skipped, connections: doc.connections.length };
  }

  function currentPageIsEmpty() {
    const doc = editor.doc;
    return !doc.nodes.length && !doc.shapes.length && !doc.connections.length;
  }

  /** Open a document as a new page (or into this one when it is empty). */
  function openAsPage(doc, label) {
    if (currentPageIsEmpty()) {
      editor.setDocument(doc, { label });
      pages.renameActive(doc.name);
      renderPages();
      return true;
    }
    return addPage(doc, doc.name);
  }

  async function importDrawioText(text, { asPaste = false } = {}) {
    try {
      const drawioPages = await readDrawioPages(text);
      const converted = drawioPages.map((page) => {
        const result = drawioToArchitecture(page.model, {
          resolveService,
          resolveIconId: (id) => iconById.get(id) || null,
          name: page.name,
        });
        return { ...result, doc: normalizeDocument(result.architecture, { resolveIcon }).doc };
      });
      if (asPaste) {
        const [first] = converted;
        editor.paste(
          { format: "trust-choreography/diagram-clipboard@1", ...first.doc },
          { at: editor.centerOfView() }
        );
        say(
          `Pasted ${first.stats.services + first.stats.shapes + first.stats.containers} draw.io shapes`,
          "good"
        );
        return;
      }
      let opened = 0;
      for (const page of converted) {
        if (openAsPage(page.doc, "Opened draw.io diagram")) opened += 1;
        else break;
      }
      const first = converted[0];
      const warnings = converted.flatMap((page) => page.warnings);
      say(
        `Opened ${opened} draw.io page${opened === 1 ? "" : "s"} · ${first.stats.services} AWS services, ${first.stats.containers} groups, ${first.stats.connections} connectors${warnings.length ? ` · ${warnings[0]}` : ""}`,
        warnings.length ? "warn" : "good"
      );
    } catch (error) {
      say(error.message || "That draw.io file could not be opened", "danger");
    }
  }

  async function openFile(file, { at = null } = {}) {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (
      /^image\/(png|jpe?g|gif|webp)$/.test(file.type) ||
      (file.type === "image/svg+xml" && !(await file.text()).includes("mxfile"))
    ) {
      const reader = new FileReader();
      reader.onload = () => {
        const src = String(reader.result || "");
        editor.insertVertex(() => makeShape("image", { src, w: 120, h: 90, label: "" }), {
          at: at || editor.centerOfView(),
          label: "Added image",
        });
      };
      reader.readAsDataURL(file);
      return;
    }
    let text = "";
    try {
      text = await file.text();
    } catch {
      say("That file could not be read", "danger");
      return;
    }
    if (looksLikeDrawio(text)) {
      await importDrawioText(text);
      return;
    }
    if (name.endsWith(".sql") || looksLikeSchema(text)) {
      openSqlSchema(text, file.name.replace(/\.[^.]+$/, ""));
      return;
    }
    if (
      name.endsWith(".tf") ||
      /resource\s+"aws_/.test(text) ||
      /"AWSTemplateFormatVersion"|"Resources"\s*:/.test(text)
    ) {
      iacImport?.openWith?.(text);
      return;
    }
    const payload = safeParse(text);
    if (payload) {
      try {
        const { doc, skipped } = normalizeDocument(payload.architecture || payload, {
          resolveIcon,
        });
        if (!doc.name || doc.name === "Imported architecture")
          doc.name = file.name.replace(/\.[^.]+$/, "");
        openAsPage(doc, "Opened diagram");
        say(
          `Opened ${doc.nodes.length} services${skipped.length ? ` · ${skipped.length} without an icon skipped` : ""}`,
          skipped.length ? "warn" : "good"
        );
      } catch (error) {
        say(error.message || "That file is not a diagram", "danger");
      }
      return;
    }
    say(
      "Unsupported file — open a .drawio, .drawio.svg, diagram .json, or Terraform file",
      "danger"
    );
  }

  elements.openInput?.addEventListener("change", () => {
    const [file] = elements.openInput.files || [];
    openFile(file);
    elements.openInput.value = "";
  });

  let iacImport = null;

  // ------------------------------------------------------------- find bar

  let findMatches = [];
  let findIndex = -1;

  function openFind() {
    if (!elements.findbar) return;
    elements.findbar.hidden = false;
    elements.findInput.focus();
    elements.findInput.select();
    runFind();
  }

  function closeFind() {
    if (!elements.findbar || elements.findbar.hidden) return;
    elements.findbar.hidden = true;
    findMatches = [];
    editor.setHighlight([]);
    editor.focus();
  }

  function runFind() {
    const query = elements.findInput.value.trim().toLowerCase();
    findMatches = query
      ? vertices(editor.doc).filter((vertex) =>
          [vertex.name, vertex.label, vertex.serviceName, vertex.notes].some((text) =>
            String(text || "")
              .toLowerCase()
              .includes(query)
          )
        )
      : [];
    findIndex = -1;
    editor.setHighlight(findMatches.map((vertex) => vertex.id));
    elements.findCount.textContent = query
      ? `${findMatches.length} match${findMatches.length === 1 ? "" : "es"}`
      : "";
  }

  function stepFind(direction = 1) {
    if (!findMatches.length) return;
    findIndex = (findIndex + direction + findMatches.length) % findMatches.length;
    editor.reveal(findMatches[findIndex].id);
    elements.findCount.textContent = `${findIndex + 1} of ${findMatches.length}`;
  }

  elements.findInput?.addEventListener("input", runFind);
  elements.findInput?.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      stepFind(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeFind();
    }
  });
  $("#dsFindNext")?.addEventListener("click", () => stepFind(1));
  $("#dsFindPrev")?.addEventListener("click", () => stepFind(-1));
  $("#dsFindClose")?.addEventListener("click", closeFind);

  // ----------------------------------------------------------------- help

  function openHelp() {
    const dialog = document.querySelector("#studioHelpDialog");
    if (!dialog) return;
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  // ----------------------------------------------------------------- menus

  const hasSelection = () => editor.selection().length > 0;
  const selectedVertexCount = () =>
    editor.selectedElements().filter((element) => "w" in element).length;

  const templateItems = () => [
    ...Object.entries(TEMPLATES).map(([id, template]) => ({
      label: `${template.title} — ${template.summary}`,
      run: () => applyTemplate(id),
    })),
    "-",
    {
      label: "Database schema (ER) — commerce example",
      run: () => openSqlSchema(SAMPLE_SCHEMA, "Commerce schema"),
    },
  ];

  const containerMenuItems = () =>
    Object.entries(CONTAINER_PRESETS).map(([preset, definition]) => ({
      label: definition.label + (definition.zone ? ` (${ZONES[definition.zone].label} zone)` : ""),
      run: () => insertItem({ type: "shape", kind: "container", preset, label: definition.label }),
    }));

  const menus = [
    {
      id: "file",
      label: "File",
      items: () => [
        { label: "New page", shortcut: "Alt+N", run: () => addPage() },
        { label: "Start from template", items: templateItems },
        { label: "Clear this page", run: () => applyTemplate("blank") },
        "-",
        {
          label: "Open… (.drawio, .svg, .json, .tf)",
          shortcut: "Mod+O",
          run: () => elements.openInput?.click(),
        },
        { label: "Import Terraform / CloudFormation…", run: () => iacImport?.open() },
        { label: "Import SQL schema…", run: () => openSqlDialog() },
        "-",
        {
          label: "Save to this browser",
          shortcut: "Mod+S",
          run: () => saveNow() && say("Saved to this browser", "good"),
        },
        {
          label: "Export as",
          items: [
            { label: "PNG image (2×)", run: () => exportImage("png") },
            { label: "SVG (editable in draw.io)", run: () => exportImage("svg") },
            { label: "draw.io file (.drawio)", run: () => exportDrawio() },
            "-",
            { label: "Diagram JSON", run: () => exportJson() },
            { label: "Terraform skeleton (main.tf)", run: () => exportTerraform() },
            { label: "Mermaid (copy)", run: () => copyMermaid() },
            "-",
            {
              label: "SQL — PostgreSQL",
              run: () => exportSql("postgres"),
              disabled: !editor.doc.shapes.some(isTable),
            },
            {
              label: "SQL — MySQL",
              run: () => exportSql("mysql"),
              disabled: !editor.doc.shapes.some(isTable),
            },
            {
              label: "SQL — SQLite",
              run: () => exportSql("sqlite"),
              disabled: !editor.doc.shapes.some(isTable),
            },
            {
              label: "Copy SQL",
              run: () => copyTableSql(),
              disabled: !editor.doc.shapes.some(isTable),
            },
          ],
        },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: () => [
        {
          label: editor.history.undoLabel
            ? `Undo ${editor.history.undoLabel.toLowerCase()}`
            : "Undo",
          shortcut: "Mod+Z",
          run: () => editor.undo(),
          disabled: !editor.history.canUndo,
        },
        {
          label: editor.history.redoLabel
            ? `Redo ${editor.history.redoLabel.toLowerCase()}`
            : "Redo",
          shortcut: "Mod+Shift+Z",
          run: () => editor.redo(),
          disabled: !editor.history.canRedo,
        },
        "-",
        { label: "Cut", shortcut: "Mod+X", run: () => editor.cut(), disabled: !hasSelection() },
        { label: "Copy", shortcut: "Mod+C", run: () => editor.copy(), disabled: !hasSelection() },
        {
          label: "Paste",
          shortcut: "Mod+V",
          run: () => editor.paste(),
          disabled: !editor.clipboard,
        },
        {
          label: "Duplicate",
          shortcut: "Mod+D",
          run: () => editor.duplicate(),
          disabled: !hasSelection(),
        },
        {
          label: "Delete",
          shortcut: "Delete",
          run: () => editor.deleteSelection(),
          disabled: !hasSelection(),
        },
        "-",
        { label: "Select all", shortcut: "Mod+A", run: () => editor.selectAll() },
        {
          label: "Select none",
          shortcut: "Esc",
          run: () => editor.setSelection([]),
          disabled: !hasSelection(),
        },
        {
          label: "Edit label",
          shortcut: "Enter",
          run: () => editor.startTextEdit(editor.selection()[0]),
          disabled: editor.selection().length !== 1,
        },
        { label: "Find…", shortcut: "Mod+F", run: openFind },
      ],
    },
    {
      id: "view",
      label: "View",
      items: () => [
        { label: "Zoom in", shortcut: "Mod+=", run: () => editor.zoomBy(1) },
        { label: "Zoom out", shortcut: "Mod+-", run: () => editor.zoomBy(-1) },
        { label: "Actual size", shortcut: "Mod+0", run: () => editor.zoomTo(1) },
        { label: "Fit diagram", shortcut: "Shift+1", run: () => editor.fit() },
        {
          label: "Fit selection",
          shortcut: "Shift+2",
          run: () => editor.fit(editor.selection()),
          disabled: !hasSelection(),
        },
        "-",
        {
          label: "Grid",
          checked: editor.doc.grid !== false,
          run: () => editor.commit("Toggled grid", (doc) => void (doc.grid = doc.grid === false)),
        },
        {
          label: "Snap to grid",
          checked: editor.doc.snap !== false,
          run: () =>
            editor.commit("Toggled snapping", (doc) => void (doc.snap = doc.snap === false)),
        },
        { label: "Minimap", checked: prefs.minimap, run: () => setMinimap(!prefs.minimap) },
        "-",
        {
          label: "Trust-zone badges",
          checked: prefs.overlays.zones,
          run: () => setOverlay("zones", !prefs.overlays.zones),
        },
        {
          label: "Boundary crossings & plaintext",
          checked: prefs.overlays.trust !== false,
          run: () => setOverlay("trust", prefs.overlays.trust === false),
        },
        {
          label: "High-criticality markers",
          checked: prefs.overlays.criticality,
          run: () => setOverlay("criticality", !prefs.overlays.criticality),
        },
        { label: "Animate traffic", checked: simulating, run: toggleTraffic },
        "-",
        {
          label: "Shapes panel",
          checked: libraryIsOpen(),
          run: () => setLibraryOpen(!libraryIsOpen()),
        },
        { label: "Format panel", checked: panelIsOpen(), run: () => setPanelOpen(!panelIsOpen()) },
      ],
    },
    {
      id: "arrange",
      label: "Arrange",
      items: () => [
        {
          label: "Bring to front",
          shortcut: "Mod+Shift+F",
          run: () => editor.toFront(),
          disabled: !selectedVertexCount(),
        },
        {
          label: "Send to back",
          shortcut: "Mod+Shift+B",
          run: () => editor.toBack(),
          disabled: !selectedVertexCount(),
        },
        "-",
        {
          label: "Group",
          shortcut: "Mod+G",
          run: () => editor.group(),
          disabled: selectedVertexCount() < 2,
        },
        {
          label: "Ungroup",
          shortcut: "Mod+Shift+G",
          run: () => editor.ungroup(),
          disabled: !editor.selectedElements().some((element) => element.kind === "group"),
        },
        {
          label: "Wrap selection in",
          items: () =>
            Object.entries(CONTAINER_PRESETS).map(([preset, definition]) => ({
              label: definition.label,
              run: () => wrapSelection(preset),
            })),
          disabled: !selectedVertexCount(),
        },
        {
          label: "Lock / unlock",
          shortcut: "Mod+Shift+L",
          run: () => editor.toggleLock(),
          disabled: !selectedVertexCount(),
        },
        "-",
        {
          label: "Align",
          disabled: selectedVertexCount() < 2,
          items: [
            ["left", "Left"],
            ["center", "Centre"],
            ["right", "Right"],
            ["top", "Top"],
            ["middle", "Middle"],
            ["bottom", "Bottom"],
          ].map(([mode, label]) => ({ label, run: () => editor.align(mode) })),
        },
        {
          label: "Distribute",
          disabled: selectedVertexCount() < 3,
          items: [
            { label: "Horizontally", run: () => editor.distribute("horizontal") },
            { label: "Vertically", run: () => editor.distribute("vertical") },
          ],
        },
        "-",
        { label: "Auto layout — left to right", run: () => editor.autoLayout("LR") },
        { label: "Auto layout — top to bottom", run: () => editor.autoLayout("TB") },
        {
          label: "Reset connector routes",
          run: () =>
            editor.commit("Reset connector routes", (doc) => {
              const chosen = new Set(editor.selection());
              for (const connection of doc.connections) {
                if (chosen.size && !chosen.has(connection.id)) continue;
                connection.waypoints = [];
              }
            }),
        },
      ],
    },
    {
      id: "insert",
      label: "Insert",
      items: () => [
        { label: "Rectangle", shortcut: "R", run: () => editor.insertShape("rect") },
        { label: "Rounded rectangle", run: () => editor.insertShape("rounded") },
        { label: "Ellipse", shortcut: "O", run: () => editor.insertShape("ellipse") },
        { label: "Decision", shortcut: "D", run: () => editor.insertShape("diamond") },
        { label: "Text", shortcut: "T", run: () => editor.insertShape("text", { label: "Text" }) },
        { label: "Note", shortcut: "N", run: () => editor.insertShape("note", { label: "Note" }) },
        { label: "Database cylinder", run: () => editor.insertShape("cylinder") },
        { label: "Database table (ER)", run: () => insertItem({ type: "shape", kind: "table" }) },
        { label: "AWS group / trust zone", items: containerMenuItems },
        "-",
        {
          label: "AWS service…",
          run: () => {
            setLibraryOpen(true);
            library?.focusSearch("");
          },
        },
        { label: "Image…", run: () => elements.openInput?.click() },
      ],
    },
    {
      id: "help",
      label: "Help",
      items: () => [
        { label: "Keyboard shortcuts", shortcut: "?", run: openHelp },
        { label: "Open a draw.io diagram…", run: () => elements.openInput?.click() },
        {
          label: `Official AWS icons (${catalogMeta.release || "latest"})`,
          run: () =>
            global.open("https://aws.amazon.com/architecture/icons/", "_blank", "noopener"),
        },
      ],
    },
  ];

  function openCanvasMenu(request) {
    const selected = editor.selectedElements();
    const service = selected.length === 1 && isServiceNode(selected[0]) ? selected[0] : null;
    const edge = selected.length === 1 && !("w" in selected[0]) ? selected[0] : null;
    const items = selected.length
      ? [
          {
            label: "Edit label",
            shortcut: "Enter",
            run: () => editor.startTextEdit(selected[0].id),
            hidden: selected.length !== 1,
          },
          { label: "Cut", shortcut: "Mod+X", run: () => editor.cut() },
          { label: "Copy", shortcut: "Mod+C", run: () => editor.copy() },
          { label: "Duplicate", shortcut: "Mod+D", run: () => editor.duplicate() },
          { label: "Delete", shortcut: "Delete", run: () => editor.deleteSelection() },
          "-",
          { label: "Bring to front", run: () => editor.toFront(), hidden: !selectedVertexCount() },
          { label: "Send to back", run: () => editor.toBack(), hidden: !selectedVertexCount() },
          {
            label: "Group",
            shortcut: "Mod+G",
            run: () => editor.group(),
            hidden: selectedVertexCount() < 2,
          },
          {
            label: "Ungroup",
            run: () => editor.ungroup(),
            hidden: !selected.some((element) => element.kind === "group"),
          },
          {
            label: "Wrap in",
            items: () =>
              Object.entries(CONTAINER_PRESETS).map(([preset, definition]) => ({
                label: definition.label,
                run: () => wrapSelection(preset),
              })),
            hidden: !selectedVertexCount(),
          },
          {
            label: selected.every((element) => element.locked) ? "Unlock" : "Lock",
            run: () => editor.toggleLock(),
            hidden: !selectedVertexCount(),
          },
          {
            label: "Reset route",
            run: () =>
              editor.updateSelected(
                "Reset connector route",
                (connection) => void (connection.waypoints = [])
              ),
            hidden: !edge,
          },
          "-",
          {
            label: "Rehearse failure (Chaos Lab)",
            run: () => killNode(service.id),
            hidden: !service,
          },
          {
            label: "Fit selection",
            shortcut: "Shift+2",
            run: () => editor.fit(editor.selection()),
          },
          { label: "Format…", run: () => setTab("format") },
        ]
      : [
          {
            label: "Paste",
            shortcut: "Mod+V",
            run: () => editor.paste(editor.clipboard, { at: request.world }),
            disabled: !editor.clipboard,
          },
          {
            label: "Add shape here…",
            run: () =>
              quickInsert.open({
                screen: editor.worldToScreen(request.world),
                world: request.world,
              }),
          },
          { label: "Select all", shortcut: "Mod+A", run: () => editor.selectAll() },
          "-",
          { label: "Fit diagram", shortcut: "Shift+1", run: () => editor.fit() },
          { label: "Auto layout", run: () => editor.autoLayout("LR") },
          {
            label: "Grid",
            checked: editor.doc.grid !== false,
            run: () => editor.commit("Toggled grid", (doc) => void (doc.grid = doc.grid === false)),
          },
        ];
    openContextMenu(request.clientX, request.clientY, items);
  }

  // --------------------------------------------------------------- toolbar

  function syncToolbar() {
    const history = editor.history;
    const undo = $("#dsUndo");
    const redo = $("#dsRedo");
    if (undo) {
      undo.disabled = !history.canUndo;
      undo.title = history.canUndo
        ? `Undo ${history.undoLabel.toLowerCase()} (${formatShortcut("Mod+Z")})`
        : "Nothing to undo";
    }
    if (redo) {
      redo.disabled = !history.canRedo;
      redo.title = history.canRedo
        ? `Redo ${history.redoLabel.toLowerCase()} (${formatShortcut("Mod+Shift+Z")})`
        : "Nothing to redo";
    }
    const any = hasSelection();
    const vertexSelected = selectedVertexCount() > 0;
    for (const [id, enabled] of [
      ["#dsDelete", any],
      ["#dsToFront", vertexSelected],
      ["#dsToBack", vertexSelected],
    ]) {
      const button = $(id);
      if (button) button.disabled = !enabled;
    }
    root.querySelectorAll("[data-ds-tool]").forEach((button) => {
      const active = button.dataset.dsTool === editor.tool;
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function syncZoomLabel() {
    if (elements.zoomLabel)
      elements.zoomLabel.textContent = `${Math.round(editor.view.zoom * 100)}%`;
  }

  function syncCounts() {
    const doc = editor.doc;
    const containers = doc.shapes.filter(isContainer).length;
    const tables = doc.shapes.filter(isTable).length;
    const shapes = doc.shapes.length - containers - tables;
    const parts = [];
    if (doc.nodes.length || !tables)
      parts.push(`${doc.nodes.length} service${doc.nodes.length === 1 ? "" : "s"}`);
    if (tables) parts.push(`${tables} table${tables === 1 ? "" : "s"}`);
    if (containers) parts.push(`${containers} group${containers === 1 ? "" : "s"}`);
    if (shapes) parts.push(`${shapes} shape${shapes === 1 ? "" : "s"}`);
    parts.push(`${doc.connections.length} connector${doc.connections.length === 1 ? "" : "s"}`);
    if (elements.counts) elements.counts.textContent = parts.join(" · ");
    if (elements.cost) {
      const { total, lines } = estimateArchitectureCost(doc.nodes);
      elements.cost.innerHTML = `≈ <strong>${formatUsd(total)}</strong>/mo`;
      const top = lines
        .slice(0, 3)
        .map((line) => `${line.name} ${formatUsd(line.usd)} (${line.why})`)
        .join(" · ");
      elements.cost.title = top
        ? `Rough monthly estimate — biggest: ${top}`
        : "Add services to estimate a monthly cost";
    }
  }

  function toggleTraffic() {
    simulating = !simulating;
    renderSimulation();
    say(simulating ? "Traffic animation running" : "Traffic animation paused");
  }

  function setMinimap(visible) {
    prefs.minimap = Boolean(visible);
    persistPrefs();
    minimap?.setVisible(prefs.minimap);
  }

  const clicks = {
    "#dsLibraryToggle": () => setLibraryOpen(!libraryIsOpen()),
    "#dsPanelToggle": () => setPanelOpen(!panelIsOpen()),
    "#dsUndo": () => editor.undo(),
    "#dsRedo": () => editor.redo(),
    "#dsDelete": () => editor.deleteSelection(),
    "#dsToFront": () => editor.toFront(),
    "#dsToBack": () => editor.toBack(),
    "#dsZoomIn": () => editor.zoomBy(1),
    "#dsZoomOut": () => editor.zoomBy(-1),
    "#dsFit": () => editor.fit(),
    "#dsLayout": () => editor.autoLayout("LR"),
    "#dsFind": openFind,
    "#dsHelp": openHelp,
  };
  for (const [selector, handler] of Object.entries(clicks)) {
    $(selector)?.addEventListener("click", handler);
  }
  root.querySelectorAll("[data-ds-tool]").forEach((button) => {
    button.addEventListener("click", () => editor.setTool(button.dataset.dsTool));
  });
  root.querySelectorAll("[data-ds-insert]").forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.dsInsert;
      editor.insertShape(
        kind,
        kind === "text" ? { label: "Text" } : kind === "note" ? { label: "Note" } : {}
      );
      editor.focus();
    });
  });
  $("#dsInsertGroup")?.addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, containerMenuItems());
  });
  const WORKSPACES = [
    ["home", "Explore"],
    ["studio", "AWS Studio"],
    ["network", "Network Lab"],
    ["sql", "SQL Review"],
    ["iam", "IAM Review"],
    ["vpc", "VPC Planner"],
    ["review", "Review"],
  ];
  const themeItems = () =>
    ["system", "light", "dark"].map((mode) => ({
      label: mode === "system" ? "Match system" : mode[0].toUpperCase() + mode.slice(1),
      checked: (hooks.theme?.mode || "system") === mode,
      run: () => hooks.theme?.setMode(mode),
    }));
  $("#dsBrand")?.addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, [
      ...WORKSPACES.map(([view, label]) => ({
        label,
        checked: view === "studio",
        run: () => document.querySelector(`[data-view-target="${view}"]`)?.click(),
      })),
      "-",
      { label: "Theme", items: themeItems, hidden: !hooks.theme },
      {
        label: "Command palette",
        shortcut: "Mod+K",
        run: () => document.querySelector("#commandButton")?.click(),
      },
      { label: "Keyboard shortcuts", shortcut: "?", run: openHelp },
      "-",
      {
        label: "Source on GitHub",
        run: () =>
          global.open("https://github.com/Sebby1770/aws-trust-choreography", "_blank", "noopener"),
      },
    ]);
  });
  $("#dsTheme")?.addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, themeItems());
  });
  $("#dsCommand")?.addEventListener("click", () =>
    document.querySelector("#commandButton")?.click()
  );
  $("#dsZoomLabel")?.addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(rect.left, rect.bottom + 4, [
      ...[0.25, 0.5, 0.75, 1, 1.5, 2, 3].map((zoom) => ({
        label: `${Math.round(zoom * 100)}%`,
        run: () => editor.zoomTo(zoom),
      })),
      "-",
      { label: "Fit diagram", shortcut: "Shift+1", run: () => editor.fit() },
    ]);
  });
  $("#dsExport")?.addEventListener("click", (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    openContextMenu(
      rect.right - 240,
      rect.bottom + 4,
      menus[0].items().find((item) => item.label === "Export as").items
    );
  });
  elements.name?.addEventListener("input", () => {
    editor.commit("Renamed diagram", (doc) => void (doc.name = elements.name.value.slice(0, 80)), {
      coalesce: "diagram-name",
      silent: true,
    });
  });
  elements.name?.addEventListener("change", () => {
    pages.renameActive(elements.name.value.trim() || "Untitled");
    renderPages();
  });
  elements.panelTabs.forEach((button, index) => {
    button.addEventListener("click", () => setTab(button.dataset.dsTab));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const next =
        elements.panelTabs[
          (index + (event.key === "ArrowRight" ? 1 : -1) + elements.panelTabs.length) %
            elements.panelTabs.length
        ];
      setTab(next.dataset.dsTab);
      next.focus();
    });
  });
  root.querySelectorAll("[data-ds-template]").forEach((button) => {
    button.addEventListener("click", () => applyTemplate(button.dataset.dsTemplate));
  });
  $("#dsEmptyLibrary")?.addEventListener("click", () => {
    setLibraryOpen(true);
    library?.focusSearch("");
  });
  $("#dsEmptyOpen")?.addEventListener("click", () => elements.openInput?.click());

  elements.chaosRun?.addEventListener("click", () => {
    renderChaos();
    say("Resilience analysis complete");
  });
  elements.chaosKill?.addEventListener("click", () => {
    const service = selectedService();
    if (service) killNode(service.id);
    else say("Select an AWS service to rehearse its failure", "warn");
  });
  elements.chaosReset?.addEventListener("click", restoreAll);
  elements.runSimulation?.addEventListener("click", toggleTraffic);
  elements.injectFailure?.addEventListener("click", () => {
    const service = selectedService();
    if (!service) {
      say("Select an AWS service before injecting a failure", "warn");
      return;
    }
    failedNodeId = service.id;
    simulating = true;
    traceFailure(service.id);
    editor.render();
    renderSimulation();
    renderInsights();
    say(`${service.name} failure injected`, "danger");
  });
  elements.resetSimulation?.addEventListener("click", restoreAll);

  // ----------------------------------------------------- global keyboard

  document.addEventListener("keydown", (event) => {
    if (!studioActive() || event.defaultPrevented) return;
    const target = event.target;
    const typing =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && key === "s") {
      event.preventDefault();
      if (saveNow()) say("Saved to this browser", "good");
      return;
    }
    if (mod && key === "o") {
      event.preventDefault();
      elements.openInput?.click();
      return;
    }
    if (mod && key === "f") {
      event.preventDefault();
      openFind();
      return;
    }
    if (typing || target?.closest?.(".dg-menu, dialog")) return;
    if (event.altKey && key === "n") {
      event.preventDefault();
      addPage();
      return;
    }
    if (event.key === "?" && !mod) {
      event.preventDefault();
      openHelp();
      return;
    }
    if (event.key === "/" && !mod) {
      event.preventDefault();
      setLibraryOpen(true);
      library?.focusSearch();
      return;
    }
    // Shortcuts pressed while focus sits elsewhere in the studio (a toolbar
    // button, the page body) still drive the canvas.
    if (!editor.canvas.contains(target) && (root.contains(target) || target === document.body)) {
      if (target.closest?.(".ds-library, .ds-panel") && !mod) return;
      if (editor.handleKey(event)) event.preventDefault();
    }
  });

  // -------------------------------------------------------------- mount

  library = mountLibrary({
    container: elements.libraryHost.querySelector(".ds-library-body") || elements.libraryHost,
    catalog,
    onActivate: (item, event) => insertItem(item, { event }),
  });
  quickInsert = createQuickInsert({
    host: elements.canvasHost,
    library,
    onPick: (item, request) => insertItem(item, { request }),
  });
  minimap = createMinimap({ host: elements.canvasHost, editor });
  formatPanel = mountFormatPanel({
    container: elements.formatHost,
    editor,
    studio: {
      regions: REGIONS,
      getOverlays: () => prefs.overlays,
      setOverlay,
      rename: (value) => {
        editor.commit("Renamed diagram", (doc) => void (doc.name = value.slice(0, 80)), {
          coalesce: "diagram-name",
          silent: true,
        });
        pages.renameActive(value.trim() || "Untitled");
        renderPages();
      },
      setRegion: (value) =>
        editor.commit(`Region set to ${value}`, (doc) => void (doc.region = value)),
      applyZone: (id, zone) => editor.applyContainerZone(id, zone),
      killNode,
      copyTableSql,
      swapIcon: (id) => {
        editor.setSelection([id]);
        setLibraryOpen(true);
        library.focusSearch("");
        say("Pick a service in the library while holding Alt to swap this icon", "info");
        swapTarget = id;
      },
      isInside: (childId, containerId) =>
        descendants(editor.doc, [containerId]).some((vertex) => vertex.id === childId),
      childCount: (containerId) => descendants(editor.doc, [containerId]).length,
      describeCrossing: (from, to) => {
        const crossing = classifyCrossing(zoneOf(from), zoneOf(to));
        return crossing.kind === "internal"
          ? `stays inside ${ZONES[crossing.from].label}`
          : `${ZONES[crossing.from].label} → ${ZONES[crossing.to].label} (${crossing.kind})`;
      },
      describe: (selected) => {
        if (selected.length > 1)
          return { title: `${selected.length} items`, detail: "Multiple selection" };
        const element = selected[0];
        if (isServiceNode(element)) return { title: element.name, detail: element.serviceName };
        if (!("w" in element))
          return {
            title: element.label || "Connector",
            detail: element.type ? `${element.type} connector` : "Connector",
          };
        if (isContainer(element))
          return {
            title: element.label || "Container",
            detail: CONTAINER_PRESETS[element.preset]?.label || "Container",
          };
        if (isTable(element))
          return {
            title: element.label || "table",
            detail: `Table · ${(element.columns || []).length} columns`,
          };
        return {
          title: element.label || element.kind[0].toUpperCase() + element.kind.slice(1),
          detail: element.kind === "group" ? "Group" : "Shape",
        };
      },
    },
  });

  // Alt-clicking a library icon while a service waits for a swap replaces
  // its artwork but keeps its name, zone, notes and connections.
  let swapTarget = null;
  elements.libraryHost.addEventListener(
    "click",
    (event) => {
      if (!swapTarget || !event.altKey) return;
      const tile = event.target.closest(".dg-tile");
      const item = tile && library.item(tile.dataset.key);
      if (!item || item.type !== "icon") return;
      event.stopPropagation();
      const icon = iconById.get(item.id);
      const target = swapTarget;
      swapTarget = null;
      editor.updateSelected(
        `Swapped icon to ${icon.name}`,
        (node) => {
          Object.assign(node, {
            iconId: icon.id,
            iconPath: icon.path,
            iconType: icon.type,
            category: icon.category,
            serviceName: icon.name,
          });
        },
        { ids: [target] }
      );
    },
    true
  );

  mountMenubar(elements.menubar, menus);

  // IaC import dialog (shared with the rest of the app).
  import("./iac-import-ui.js")
    .then(({ initIacImport }) => {
      iacImport = initIacImport(api);
    })
    .catch(() => {
      /* The dialog is optional; File › Open still handles diagrams. */
    });

  function reveal(target = {}) {
    if (target.kind === "library") {
      setLibraryOpen(true);
      library.focusSearch(String(target.query || ""));
      return true;
    }
    if ((target.kind === "connection" || target.kind === "node") && target.id) {
      if (!editor.reveal(target.id)) return false;
      setPanelOpen(true);
      setTab("format");
      if (target.field === "encrypted") {
        requestAnimationFrame(() =>
          elements.formatHost.querySelector(".dg-format-toggle input")?.focus()
        );
      }
      return true;
    }
    if (target.kind === "canvas") {
      editor.setTool("connect");
      editor.focus();
      return true;
    }
    return false;
  }

  function commands() {
    const go = (run) => () => {
      document.querySelector('[data-view-target="studio"]')?.click();
      requestAnimationFrame(run);
    };
    return [
      {
        id: "studio:new-page",
        group: "Diagram",
        label: "New page",
        keywords: "diagram page tab add",
        run: go(() => addPage()),
      },
      {
        id: "studio:open",
        group: "Diagram",
        label: "Open a draw.io or diagram file…",
        keywords: "import drawio diagrams.net svg json open file",
        run: go(() => elements.openInput?.click()),
      },
      {
        id: "studio:export-png",
        group: "Diagram",
        label: "Export diagram as PNG",
        keywords: "image download picture",
        run: go(() => exportImage("png")),
      },
      {
        id: "studio:export-svg",
        group: "Diagram",
        label: "Export diagram as SVG",
        keywords: "vector image download drawio",
        run: go(() => exportImage("svg")),
      },
      {
        id: "studio:export-drawio",
        group: "Diagram",
        label: "Export as a draw.io file",
        keywords: "diagrams.net mxgraph xml",
        run: go(exportDrawio),
      },
      {
        id: "studio:export-tf",
        group: "Diagram",
        label: "Export Terraform skeleton",
        keywords: "terraform iac hcl main.tf",
        run: go(exportTerraform),
      },
      {
        id: "studio:copy-mermaid",
        group: "Diagram",
        label: "Copy as Mermaid",
        keywords: "mermaid markdown readme",
        run: go(copyMermaid),
      },
      {
        id: "studio:layout",
        group: "Diagram",
        label: "Auto layout",
        keywords: "arrange tidy organise",
        run: go(() => editor.autoLayout("LR")),
      },
      {
        id: "studio:sql-import",
        group: "Database",
        label: "Import SQL schema as a diagram",
        keywords: "sql ddl create table erd er schema database",
        run: go(() => openSqlDialog()),
      },
      {
        id: "studio:sql-export",
        group: "Database",
        label: "Copy SQL for this diagram's tables",
        keywords: "sql ddl create table export schema",
        run: go(() => copyTableSql()),
      },
      {
        id: "studio:fit",
        group: "Diagram",
        label: "Fit diagram to screen",
        keywords: "zoom fit view",
        run: go(() => editor.fit()),
      },
      {
        id: "studio:find",
        group: "Diagram",
        label: "Find in diagram",
        keywords: "search shapes services",
        run: go(openFind),
      },
      {
        id: "studio:zones",
        group: "Diagram",
        label: prefs.overlays.zones ? "Hide trust-zone badges" : "Show trust-zone badges",
        keywords: "trust zone overlay security",
        run: go(() => setOverlay("zones", !prefs.overlays.zones)),
      },
      {
        id: "studio:shortcuts",
        group: "Diagram",
        label: "Keyboard shortcuts",
        keywords: "help keys hotkeys",
        run: go(openHelp),
      },
      ...Object.entries(TEMPLATES).map(([id, template]) => ({
        id: `studio:template:${id}`,
        group: "Templates",
        label: `Template — ${template.title}`,
        keywords: `${template.summary} starter blueprint`,
        run: go(() => applyTemplate(id)),
      })),
      ...Object.entries(CONTAINER_PRESETS)
        .filter(([, preset]) => preset.icon || preset.zone)
        .map(([preset, definition]) => ({
          id: `studio:insert:${preset}`,
          group: "Insert",
          label: `Insert ${definition.label}`,
          keywords: "group container aws zone",
          run: go(() =>
            insertItem({ type: "shape", kind: "container", preset, label: definition.label })
          ),
        })),
    ];
  }

  const api = {
    getState: () => {
      const doc = JSON.parse(snapshot());
      return {
        ...doc,
        connections: analysisView(doc).connections,
        allConnections: doc.connections,
      };
    },
    snapshot,
    loadArchitecture: (value) => {
      const doc = parseDocument(value);
      if (!doc) return;
      editor.setDocument(doc, { resetHistory: true });
      say("Page loaded");
    },
    adoptArchitecture,
    applyTemplate,
    createProject,
    save: saveNow,
    reveal,
    refreshLayout: () => {
      editor.render();
      minimap?.draw();
    },
    commands,
    schemaSql,
    openSqlSchema,
    openSqlDialog,
    openBlueprint,
    editor,
    catalogCount: catalog.length,
  };
  global.AWSFlowStudio = api;

  // ------------------------------------------------------------- initial

  const roomy = global.innerWidth > 1024;
  setLibraryOpen(prefs.libraryOpen && roomy, { save: false });
  setPanelOpen(prefs.panelOpen && roomy, { save: false });
  setTab(prefs.tab);
  minimap.setVisible(prefs.minimap);
  initialised = true;
  const initial = loadInitialDocument();
  if (initial) {
    editor.setDocument(initial, { resetHistory: true });
    say("Diagram restored");
  } else {
    applyTemplate("serverless", { initial: true });
  }
  saveNow();
  renderPages();
  syncZoomLabel();
  global.addEventListener("beforeunload", saveNow);
  global.addEventListener("atlas:viewchange", (event) => {
    if (event.detail?.view !== "studio") {
      closeMenus();
      quickInsert?.close();
    }
  });

  return api;
}
