// @vitest-environment jsdom
/* global document, window */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDiagramEditor } from "../src/diagram/editor.js";
import {
  createDocument,
  makeConnection,
  makeServiceNode,
  makeShape,
} from "../src/diagram/model.js";

const LAMBDA = {
  id: "svc:lambda",
  path: "assets/lambda.svg",
  type: "service",
  category: "Compute",
  name: "AWS Lambda",
};

function sampleDoc() {
  const doc = createDocument({ name: "Test" });
  doc.shapes.push(
    makeShape("container", {
      id: "vpc",
      preset: "private-subnet",
      x: 0,
      y: 0,
      w: 400,
      h: 300,
      z: -1,
    }),
    makeShape("rect", { id: "a", label: "Alpha", x: 500, y: 100, w: 100, h: 60, z: 2 }),
    makeShape("rect", { id: "b", label: "Beta", x: 700, y: 100, w: 100, h: 60, z: 3 }),
    makeShape("ellipse", { id: "c", label: "Gamma", x: 900, y: 140, w: 100, h: 60, z: 4 })
  );
  doc.nodes.push(makeServiceNode(LAMBDA, { id: "fn", x: 600, y: 400, zone: "public" }));
  doc.connections.push(makeConnection("a", "b", { id: "ab" }));
  return doc;
}

function pointer(type, target, x, y, extra = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
    ...extra,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
  return event;
}

function key(target, keyName, extra = {}) {
  const event = new window.KeyboardEvent("keydown", {
    key: keyName,
    bubbles: true,
    cancelable: true,
    ...extra,
  });
  target.dispatchEvent(event);
  return event;
}

describe("diagram editor", () => {
  let host;
  let editor;
  let calls;

  beforeEach(() => {
    // Run frames synchronously so each pointer event applies immediately.
    globalThis.requestAnimationFrame = (callback) => {
      callback();
      return 0;
    };
    globalThis.cancelAnimationFrame = () => {};
    window.HTMLCanvasElement.prototype.getContext = () => null;
    host = document.createElement("div");
    document.body.append(host);
    calls = { change: [], selection: [], quick: [], menu: [], created: [] };
    editor = createDiagramEditor({
      root: host,
      resolveIcon: () => LAMBDA,
      connectionDefaults: () => ({ label: "HTTPS" }),
      onChange: (event) => calls.change.push(event),
      onSelectionChange: (ids) => calls.selection.push(ids),
      onQuickInsert: (request) => calls.quick.push(request),
      onContextMenu: (request) => calls.menu.push(request),
      onConnectionCreated: (doc, connection) => calls.created.push(connection.id),
    });
    Object.defineProperty(editor.canvas, "clientWidth", { value: 1000, configurable: true });
    Object.defineProperty(editor.canvas, "clientHeight", { value: 700, configurable: true });
    editor.setDocument(sampleDoc(), { resetHistory: true });
  });

  afterEach(() => {
    host.remove();
  });

  const vertexEl = (id) => editor.canvas.querySelector(`[data-id="${id}"]`);

  it("renders every vertex and connector into layers", () => {
    expect(vertexEl("a")).not.toBeNull();
    expect(vertexEl("vpc").closest(".dg-layer-below")).not.toBeNull();
    expect(vertexEl("fn").closest(".dg-layer-above")).not.toBeNull();
    expect(editor.canvas.querySelector('.dg-edge[data-edge-id="ab"]')).not.toBeNull();
    expect(calls.change.at(-1).type).toBe("load");
  });

  it("fits the diagram into the canvas", () => {
    editor.fit();
    const view = editor.view;
    expect(view.zoom).toBeGreaterThan(0.3);
    expect(view.zoom).toBeLessThanOrEqual(1.1);
    editor.zoomBy(1);
    expect(editor.view.zoom).toBeGreaterThan(view.zoom);
    editor.zoomTo(1);
    expect(editor.view.zoom).toBe(1);
  });

  it("selects, deletes, undoes and redoes", () => {
    editor.setSelection(["a"]);
    expect(vertexEl("a").classList.contains("is-selected")).toBe(true);
    key(editor.canvas, "Delete");
    expect(editor.doc.shapes.some((shape) => shape.id === "a")).toBe(false);
    expect(editor.doc.connections).toHaveLength(0);
    key(editor.canvas, "z", { metaKey: true });
    expect(editor.doc.shapes.some((shape) => shape.id === "a")).toBe(true);
    expect(editor.doc.connections).toHaveLength(1);
    key(editor.canvas, "z", { metaKey: true, shiftKey: true });
    expect(editor.doc.shapes.some((shape) => shape.id === "a")).toBe(false);
  });

  it("nudges with arrow keys and duplicates", () => {
    editor.setSelection(["a"]);
    key(editor.canvas, "ArrowRight");
    key(editor.canvas, "ArrowDown", { shiftKey: true });
    const moved = editor.doc.shapes.find((shape) => shape.id === "a");
    expect(moved.x).toBe(501);
    expect(moved.y).toBe(110);
    key(editor.canvas, "d", { metaKey: true });
    expect(editor.doc.shapes.filter((shape) => shape.label === "Alpha")).toHaveLength(2);
  });

  it("groups and ungroups with the keyboard", () => {
    editor.setSelection(["a", "b"]);
    key(editor.canvas, "g", { metaKey: true });
    const group = editor.doc.shapes.find((shape) => shape.kind === "group");
    expect(group).toBeTruthy();
    expect(editor.selection()).toEqual([group.id]);
    key(editor.canvas, "g", { metaKey: true, shiftKey: true });
    expect(editor.doc.shapes.some((shape) => shape.kind === "group")).toBe(false);
  });

  it("edits a label by typing over a selected shape", () => {
    editor.setSelection(["b"]);
    key(editor.canvas, "Q");
    const textarea = editor.canvas.querySelector(".dg-text-editor");
    expect(textarea.hidden).toBe(false);
    expect(textarea.value).toBe("Q");
    textarea.value = "Queue";
    key(textarea, "Enter");
    expect(editor.doc.shapes.find((shape) => shape.id === "b").label).toBe("Queue");
    expect(editor.history.undoLabel).toBe("Edited label");
  });

  it("cancels a label edit with Escape", () => {
    editor.startTextEdit("a");
    const textarea = editor.canvas.querySelector(".dg-text-editor");
    textarea.value = "Nope";
    key(textarea, "Escape");
    expect(editor.doc.shapes.find((shape) => shape.id === "a").label).toBe("Alpha");
  });

  it("drags a shape, snapping to the grid", () => {
    editor.setView({ x: 0, y: 0, zoom: 1 });
    const target = vertexEl("c").querySelector(".dg-outline");
    // Follow-up events go to the canvas, as pointer capture would route them.
    pointer("pointerdown", target, 950, 170);
    pointer("pointermove", editor.canvas, 1000, 203);
    pointer("pointerup", editor.canvas, 1000, 203);
    const shape = editor.doc.shapes.find((candidate) => candidate.id === "c");
    expect(shape.x % 10).toBe(0);
    expect(shape.x).toBeGreaterThan(900);
    expect(editor.history.undoLabel).toBe("Moved shape");
  });

  it("drops a shape into a container and inherits its trust zone", () => {
    editor.setView({ x: 0, y: 0, zoom: 1 });
    const target = vertexEl("fn").querySelector(".dg-hit");
    pointer("pointerdown", target, 620, 420);
    pointer("pointermove", editor.canvas, 200, 150);
    pointer("pointerup", editor.canvas, 200, 150);
    const node = editor.doc.nodes[0];
    expect(node.parent).toBe("vpc");
    expect(node.zone).toBe("private");
  });

  it("selects with a marquee", () => {
    editor.setView({ x: 0, y: 0, zoom: 1 });
    const surface = editor.canvas.querySelector(".dg-svg");
    pointer("pointerdown", surface, 480, 80);
    pointer("pointermove", editor.canvas, 820, 180);
    pointer("pointerup", editor.canvas, 820, 180);
    expect(editor.selection().sort()).toEqual(["a", "ab", "b"]);
  });

  it("opens quick insert on double-click and a context menu on right-click", () => {
    const surface = editor.canvas.querySelector(".dg-svg");
    surface.dispatchEvent(
      new window.MouseEvent("dblclick", { bubbles: true, clientX: 50, clientY: 600 })
    );
    expect(calls.quick).toHaveLength(1);
    vertexEl("a")
      .querySelector(".dg-outline")
      .dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(calls.menu.at(-1).targetId).toBe("a");
    expect(editor.selection()).toEqual(["a"]);
  });

  it("pans with the wheel and zooms with ctrl+wheel", () => {
    const before = editor.view;
    editor.canvas.dispatchEvent(
      new window.WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true })
    );
    expect(editor.view.y).toBe(before.y - 100);
    editor.canvas.dispatchEvent(
      new window.WheelEvent("wheel", {
        deltaY: -100,
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
    expect(editor.view.zoom).toBeGreaterThan(before.zoom);
  });

  it("aligns, distributes, and restacks", () => {
    editor.setSelection(["a", "b", "c"]);
    editor.align("top");
    expect(
      new Set(editor.doc.shapes.filter((s) => ["a", "b", "c"].includes(s.id)).map((s) => s.y))
    ).toEqual(new Set([100]));
    editor.distribute("horizontal");
    editor.toFront();
    expect(Math.max(...editor.doc.shapes.map((s) => s.z ?? 0))).toBe(
      editor.doc.shapes.find((s) => s.id === "c").z
    );
    editor.toBack();
    expect(editor.doc.shapes.find((s) => s.id === "a").z).toBeLessThan(0);
    editor.toggleLock();
    expect(editor.doc.shapes.find((s) => s.id === "a").locked).toBe(true);
  });

  it("inserts shapes, connected shapes, and pastes copies", () => {
    const shape = editor.insertShape("note", { label: "Remember" }, { edit: false });
    expect(editor.selection()).toEqual([shape.id]);
    const next = editor.insertConnected(() => makeShape("rect", { label: "Next" }), "Added next");
    expect(editor.doc.connections.some((c) => c.from === shape.id && c.to === next.id)).toBe(true);
    expect(calls.created).toHaveLength(1);
    editor.setSelection([next.id]);
    editor.copy();
    editor.paste();
    expect(editor.doc.shapes.filter((s) => s.label === "Next")).toHaveLength(2);
  });

  it("applies a container's zone to the services inside it", () => {
    editor.doc.nodes[0].parent = "vpc";
    editor.applyContainerZone("vpc", "data");
    expect(editor.doc.nodes[0].zone).toBe("data");
  });

  it("updates selected elements as one coalesced step", () => {
    editor.setSelection(["a", "b"]);
    editor.updateSelected("Filled", (element) => void (element.style = { fill: "#ff0000" }), {
      coalesce: "fill",
    });
    editor.updateSelected("Filled", (element) => void (element.style = { fill: "#00ff00" }), {
      coalesce: "fill",
    });
    expect(editor.doc.shapes.find((s) => s.id === "a").style.fill).toBe("#00ff00");
    editor.undo();
    expect(editor.doc.shapes.find((s) => s.id === "a").style.fill).toBeUndefined();
  });

  it("lays the diagram out automatically", () => {
    editor.autoLayout("LR");
    const a = editor.doc.shapes.find((s) => s.id === "a");
    const b = editor.doc.shapes.find((s) => s.id === "b");
    expect(a.x).toBeLessThan(b.x);
    expect(editor.history.undoLabel).toBe("Arranged automatically");
  });

  it("switches tools from the keyboard and reveals elements", () => {
    editor.setSelection([]);
    key(editor.canvas, "h");
    expect(editor.tool).toBe("hand");
    key(editor.canvas, "Escape");
    expect(editor.tool).toBe("select");
    expect(editor.reveal("c")).toBe(true);
    expect(editor.selection()).toEqual(["c"]);
    key(editor.canvas, "Tab");
    expect(editor.selection()).toHaveLength(1);
  });

  it("drags a selected connector's segment into waypoints", () => {
    editor.setView({ x: 0, y: 0, zoom: 1 });
    editor.setSelection(["ab"]);
    const handle = editor.canvas.querySelector('[data-handle^="segment"]');
    expect(handle).not.toBeNull();
    pointer("pointerdown", handle, 650, 130);
    pointer("pointermove", editor.canvas, 650, 200);
    pointer("pointerup", editor.canvas, 650, 200);
    expect(editor.doc.connections[0].waypoints.length).toBeGreaterThan(0);
  });
});
