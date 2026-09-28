// @vitest-environment jsdom
/* global document, window, localStorage */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHistory } from "../src/diagram/history.js";
import {
  fitView,
  revealRect,
  screenToWorld,
  steppedZoom,
  worldToScreen,
  zoomAt,
} from "../src/diagram/viewport.js";
import { buildOverlay } from "../src/diagram/overlay.js";
import { toMarkup } from "../src/diagram/vdom.js";
import { buildTemplate, TEMPLATE_IDS, TEMPLATES } from "../src/diagram/templates.js";
import { librarySections, mountLibrary, searchItems } from "../src/diagram/library.js";
import { closeMenus, formatShortcut, mountMenubar, openContextMenu } from "../src/diagram/menus.js";
import { createQuickInsert } from "../src/diagram/quick-insert.js";
import { mountFormatPanel } from "../src/diagram/format-panel.js";
import { createDiagramEditor } from "../src/diagram/editor.js";
import {
  createDocument,
  makeConnection,
  makeServiceNode,
  makeShape,
} from "../src/diagram/model.js";
import { SAMPLE_SCHEMA } from "../src/sql-schema.js";
import { renderSchemaPreview } from "../src/sql-schema-preview.js";

const CATALOG = [
  {
    id: "svc:lambda",
    path: "assets/lambda.svg",
    type: "service",
    category: "Compute",
    name: "AWS Lambda",
    search: "aws lambda compute",
  },
  {
    id: "svc:sqs",
    path: "assets/sqs.svg",
    type: "service",
    category: "Application Integration",
    name: "Amazon Simple Queue Service",
    search: "amazon simple queue service",
  },
  {
    id: "res:users",
    path: "assets/users.svg",
    type: "resource",
    category: "General Icons",
    name: "Users 48 Light",
    search: "users",
  },
  {
    id: "ai:claude",
    path: "assets/claude.svg",
    type: "ai",
    category: "AI & LLM",
    name: "Claude",
    search: "claude anthropic",
  },
];

beforeEach(() => {
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 0;
  };
  window.HTMLCanvasElement.prototype.getContext = () => null;
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("history", () => {
  it("records, undoes, redoes, and coalesces bursts", () => {
    const history = createHistory({ limit: 3 });
    history.record("a", "First", { now: 0 });
    history.record("b", "Typing", { coalesce: "name", now: 10 });
    history.record("c", "Typing", { coalesce: "name", now: 20 });
    expect(history.undoLabel).toBe("Typing");
    expect(history.undo("current").snapshot).toBe("b");
    expect(history.canRedo).toBe(true);
    expect(history.redo("b").snapshot).toBe("current");
    history.record("d", "Other", { now: 5000 });
    history.record("e", "More", { now: 6000 });
    history.record("f", "Even more", { now: 7000 });
    expect(history.undo("x").label).toBe("Even more");
    history.clear();
    expect(history.canUndo).toBe(false);
  });
});

describe("viewport", () => {
  it("converts between screen and world and zooms around a point", () => {
    const view = { x: 100, y: 50, zoom: 2 };
    expect(screenToWorld(view, worldToScreen(view, { x: 7, y: 9 }))).toEqual({ x: 7, y: 9 });
    const zoomed = zoomAt(view, { x: 300, y: 300 }, 4);
    expect(screenToWorld(zoomed, { x: 300, y: 300 })).toEqual(
      screenToWorld(view, { x: 300, y: 300 })
    );
    expect(steppedZoom(1, 1)).toBe(1.25);
    expect(steppedZoom(1, -1)).toBe(0.9);
  });

  it("fits bounds and scrolls just enough to reveal a rect", () => {
    const fitted = fitView(
      { x: 0, y: 0, w: 1000, h: 500 },
      { width: 600, height: 400 },
      { padding: 50 }
    );
    expect(fitted.zoom).toBeCloseTo(0.5, 5);
    const view = { x: 0, y: 0, zoom: 1 };
    expect(
      revealRect(view, { width: 500, height: 500 }, { x: 600, y: 10, w: 50, h: 50 }).x
    ).toBeLessThan(0);
  });
});

describe("overlay", () => {
  it("draws handles, guides, marquee and a connect preview", () => {
    const shape = makeShape("rect", { id: "r", x: 0, y: 0, w: 100, h: 50 });
    const service = makeServiceNode(CATALOG[0], { id: "s", x: 200, y: 0 });
    const connection = makeConnection("r", "s", { id: "c" });
    const route = {
      points: [
        { x: 100, y: 25 },
        { x: 150, y: 25 },
        { x: 150, y: 60 },
        { x: 180, y: 60 },
        { x: 200, y: 24 },
      ],
    };
    const markup = buildOverlay({
      view: { x: 0, y: 0, zoom: 1 },
      selectedVertices: [shape],
      selectedEdges: [connection],
      routes: new Map([["c", route]]),
      guides: [{ axis: "x", at: 0, from: 0, to: 100 }],
      marquee: { x: 0, y: 0, w: 10, h: 10 },
      hover: service,
      labelDepth: () => 20,
    })
      .map(toMarkup)
      .join("");
    expect(markup).toContain('data-handle="end:source"');
    expect(markup).toContain('data-handle="arrow:e"');
    expect(markup).toContain("dg-guide");
    expect(markup).toContain("dg-marquee");
    const locked = buildOverlay({
      view: { x: 0, y: 0, zoom: 1 },
      selectedVertices: [{ ...shape, locked: true }],
      connect: { from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, target: service, port: "n" },
    })
      .map(toMarkup)
      .join("");
    expect(locked).toContain("dg-lock-badge");
    expect(locked).toContain("dg-connect-preview");
  });
});

describe("templates", () => {
  const findIcon = (name) => ({
    id: `icon:${name}`,
    path: `${name}.svg`,
    type: "service",
    category: "x",
    name,
  });

  it("builds every template with containers, zones and connectors", () => {
    for (const id of TEMPLATE_IDS) {
      const doc = buildTemplate(id, { findIcon });
      expect(doc.nodes).toHaveLength(TEMPLATES[id].nodes.length);
      expect(doc.connections).toHaveLength(TEMPLATES[id].links.length);
    }
    const web = buildTemplate("web", { findIcon });
    expect(web.nodes.find((node) => node.name === "Application load balancer").zone).toBe("public");
    expect(web.nodes.find((node) => node.name === "Primary database").zone).toBe("data");
    expect(buildTemplate("nope", { findIcon })).toBeNull();
  });
});

describe("library", () => {
  it("groups the catalog into sections and ranks searches", () => {
    const sections = librarySections(CATALOG);
    expect(sections.map((section) => section.id)).toEqual(
      expect.arrayContaining([
        "general",
        "aws-groups",
        "database",
        "ai",
        "network",
        "service:Compute",
      ])
    );
    expect(searchItems(sections, "sqs")[0].label).toBe("Amazon Simple Queue Service");
    expect(searchItems(sections, "vpc")[0].title).toMatch(/VPC/);
    expect(searchItems(sections, "")).toEqual([]);
  });

  it("mounts, filters, opens sections, and activates tiles", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const activated = [];
    const library = mountLibrary({
      container,
      catalog: CATALOG,
      onActivate: (item) => activated.push(item),
    });
    const general = container.querySelector('[data-section="general"]');
    expect(general.open).toBe(true);
    general.querySelector(".dg-tile").click();
    expect(activated[0].type).toBe("shape");
    library.focusSearch("lambda");
    const result = container.querySelector(".dg-library-results .dg-tile");
    expect(result.getAttribute("aria-label")).toMatch(/Lambda/);
    result.click();
    expect(activated.at(-1).id).toBe("svc:lambda");
    const recent = container.querySelector('[data-section="recent"]');
    expect(recent.querySelectorAll(".dg-tile").length).toBeGreaterThan(0);
    const network = container.querySelector('[data-section="network"]');
    network.open = true;
    network.dispatchEvent(new window.Event("toggle"));
    expect(network.querySelectorAll(".dg-tile").length).toBe(20);
  });
});

describe("menus", () => {
  it("formats shortcuts and runs menubar items with the keyboard", () => {
    expect(formatShortcut("Mod+Shift+Z")).toMatch(/Z$/);
    const bar = document.createElement("nav");
    document.body.append(bar);
    const run = vi.fn();
    mountMenubar(bar, [
      {
        id: "file",
        label: "File",
        items: () => [
          { label: "Save", shortcut: "Mod+S", run },
          "-",
          { label: "Disabled", disabled: true, run },
        ],
      },
      { id: "edit", label: "Edit", items: [{ label: "More", items: [{ label: "Nested", run }] }] },
    ]);
    const trigger = bar.querySelector("#dgMenu-file");
    trigger.click();
    const menu = document.querySelector(".dg-menu");
    expect(menu).not.toBeNull();
    menu.querySelector(".dg-menu-item").click();
    expect(run).toHaveBeenCalledTimes(1);
    trigger.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    const open = document.querySelector(".dg-menu");
    open.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    open.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.querySelector("#dgMenu-edit").getAttribute("aria-expanded")).toBe("true");
    document.querySelector(".dg-menu .dg-menu-item").click();
    expect(document.querySelectorAll(".dg-menu").length).toBeGreaterThan(0);
    closeMenus();
    expect(document.querySelector(".dg-menu")).toBeNull();
  });

  it("opens a context menu that closes on Escape", () => {
    const run = vi.fn();
    openContextMenu(10, 10, [
      { label: "Copy", run },
      { label: "Hidden", hidden: true },
      { label: "Check", checked: true, run },
    ]);
    const menu = document.querySelector(".dg-context-menu");
    expect(menu.querySelectorAll(".dg-menu-item")).toHaveLength(2);
    expect(menu.querySelector('[role="menuitemcheckbox"]').getAttribute("aria-checked")).toBe(
      "true"
    );
    menu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".dg-context-menu")).toBeNull();
  });
});

describe("quick insert", () => {
  it("searches and picks with the keyboard", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const library = mountLibrary({
      container: document.createElement("div"),
      catalog: CATALOG,
      onActivate: () => {},
    });
    const picked = [];
    const quick = createQuickInsert({
      host,
      library,
      onPick: (item, request) => picked.push({ item, request }),
    });
    quick.open({ screen: { x: 10, y: 10 }, world: { x: 100, y: 100 } });
    expect(quick.isOpen()).toBe(true);
    const input = host.querySelector(".dg-quick-insert input");
    input.value = "claude";
    input.dispatchEvent(new window.Event("input"));
    host
      .querySelector(".dg-quick-insert")
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    host
      .querySelector(".dg-quick-insert")
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(picked[0].item.id).toBe("ai:claude");
    expect(picked[0].request.world).toEqual({ x: 100, y: 100 });
    expect(quick.isOpen()).toBe(false);
  });
});

describe("format panel", () => {
  function setup() {
    const host = document.createElement("div");
    const panel = document.createElement("div");
    document.body.append(host, panel);
    const editor = createDiagramEditor({ root: host, resolveIcon: () => CATALOG[0] });
    const doc = createDocument({ name: "Panel" });
    doc.shapes.push(
      makeShape("container", { id: "vpc", preset: "vpc", x: 0, y: 0, w: 300, h: 200, z: -1 }),
      makeShape("rect", { id: "r", label: "Box", x: 400, y: 0 }),
      makeShape("table", {
        id: "t1",
        label: "teams",
        columns: [{ name: "id", type: "bigint", pk: true }],
      }),
      makeShape("table", {
        id: "t2",
        label: "players",
        columns: [
          { name: "id", type: "bigint", pk: true },
          { name: "team_id", type: "bigint" },
        ],
      })
    );
    doc.nodes.push(
      makeServiceNode(CATALOG[0], { id: "fn", x: 50, y: 50, parent: "vpc" }),
      makeServiceNode(CATALOG[1], { id: "q", x: 600, y: 50 })
    );
    doc.connections.push(
      makeConnection("fn", "q", { id: "c", type: "event" }),
      makeConnection("t2", "t1", { id: "rel" })
    );
    editor.setDocument(doc, { resetHistory: true });
    const studio = {
      regions: ["us-east-1", "eu-west-1"],
      getOverlays: () => ({ zones: false, trust: true }),
      setOverlay: vi.fn(),
      rename: vi.fn(),
      setRegion: vi.fn(),
      applyZone: vi.fn(),
      killNode: vi.fn(),
      swapIcon: vi.fn(),
      copyTableSql: vi.fn(),
      isInside: () => false,
      childCount: () => 1,
      describeCrossing: () => "private → data",
      describe: (selected) => ({
        title: selected[0].label || selected[0].name || "Connector",
        detail: "x",
      }),
    };
    const format = mountFormatPanel({ container: panel, editor, studio });
    return { editor, panel, format, studio };
  }

  const headings = (panel) =>
    [...panel.querySelectorAll(".dg-format-section h3")].map((h) => h.textContent);

  it("shows diagram settings with nothing selected", () => {
    const { panel, format, studio } = setup();
    format.render();
    expect(headings(panel)).toEqual(["Diagram", "Trust overlays", "Get started"]);
    const toggle = [...panel.querySelectorAll(".dg-format-toggle input")].at(-1);
    toggle.click();
    expect(studio.setOverlay).toHaveBeenCalled();
  });

  it("edits a service's architecture fields", () => {
    const { editor, panel, format } = setup();
    editor.setSelection(["fn"]);
    format.render();
    expect(headings(panel)).toEqual(["Architecture", "Style", "Text", "Arrange"]);
    const name = panel.querySelector(".dg-format-row input[type=text]");
    name.value = "Worker";
    name.dispatchEvent(new window.Event("input"));
    expect(editor.doc.nodes[0].name).toBe("Worker");
    const selects = panel.querySelectorAll("select");
    selects[1].value = "high";
    selects[1].dispatchEvent(new window.Event("change"));
    expect(editor.doc.nodes[0].criticality).toBe("high");
  });

  it("styles shapes and arranges multiple selections", () => {
    const { editor, panel, format } = setup();
    editor.setSelection(["r"]);
    format.render();
    const swatch = panel.querySelector(".dg-swatch-button");
    swatch.click();
    panel.querySelector(".dg-palette-chip").click();
    expect(editor.doc.shapes.find((s) => s.id === "r").style.fill).toBe("#ffffff");
    const bold = panel.querySelector('[aria-label="Bold"]');
    bold.click();
    expect(editor.doc.shapes.find((s) => s.id === "r").style.bold).toBe(true);
    editor.setSelection(["r", "q", "fn"]);
    format.render();
    expect(headings(panel)).toContain("Arrange");
    panel.querySelector('[aria-label="Align left"]').click();
    expect(editor.history.undoLabel).toBe("Aligned left");
  });

  it("edits containers, connectors and tables", () => {
    const { editor, panel, format, studio } = setup();
    editor.setSelection(["vpc"]);
    format.render();
    expect(headings(panel)).toContain("Container");
    const zone = [...panel.querySelectorAll("select")][1];
    zone.value = "data";
    zone.dispatchEvent(new window.Event("change"));
    expect(studio.applyZone).toHaveBeenCalledWith("vpc", "data");

    editor.setSelection(["c"]);
    format.render();
    expect(headings(panel)).toEqual(["Connection", "Line"]);
    panel.querySelector('[title="Curved"]').click();
    expect(editor.doc.connections[0].style.routing).toBe("curved");
    [...panel.querySelectorAll("button")].find((b) => b.textContent === "Reverse").click();
    expect(editor.doc.connections[0].from).toBe("q");

    editor.setSelection(["rel"]);
    format.render();
    expect(headings(panel)[0]).toBe("Relationship");
    const fk = panel.querySelector("select");
    fk.value = "team_id";
    fk.dispatchEvent(new window.Event("change"));
    expect(editor.doc.connections[1].relation.fromColumns).toEqual(["team_id"]);

    editor.setSelection(["t2"]);
    format.render();
    expect(headings(panel)).toContain("Table");
    [...panel.querySelectorAll("button")].find((b) => b.textContent === "+ Add column").click();
    const table = editor.doc.shapes.find((s) => s.id === "t2");
    expect(table.columns).toHaveLength(3);
    expect(table.h).toBe(32 + 3 * 24 + 6);
    format.render();
    panel.querySelectorAll(".dg-col-remove")[2].click();
    expect(editor.doc.shapes.find((s) => s.id === "t2").columns).toHaveLength(2);
    format.render();
    [...panel.querySelectorAll("button")].find((b) => b.textContent === "Copy SQL").click();
    expect(studio.copyTableSql).toHaveBeenCalledWith(["t2"]);
  });
});

describe("SQL Review schema preview", () => {
  it("renders a live ER diagram as DOM without parsing markup", () => {
    const container = document.createElement("div");
    const result = renderSchemaPreview(container, SAMPLE_SCHEMA);
    expect(result).toMatchObject({ tables: 4, relationships: 3 });
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("order_items");
    expect(renderSchemaPreview(container, "select 1").tables).toBe(0);
    expect(container.children).toHaveLength(0);
  });
});
