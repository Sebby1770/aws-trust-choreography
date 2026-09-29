import { describe, expect, it } from "vitest";
import {
  analysisView,
  bringToFront,
  containerAt,
  copySelection,
  createDocument,
  deleteElements,
  descendants,
  documentBounds,
  groupElements,
  inheritedZone,
  isLegacyArchitecture,
  LEGACY_SURFACE,
  makeConnection,
  makeServiceNode,
  makeShape,
  moveElements,
  normalizeDocument,
  pastePayload,
  renderOrder,
  reparent,
  sendToBack,
  ungroup,
  zForNew,
} from "../src/diagram/model.js";

const LAMBDA = {
  id: "svc:lambda",
  path: "assets/lambda.svg",
  type: "service",
  category: "Compute",
  name: "AWS Lambda",
};
const DDB = {
  id: "svc:ddb",
  path: "assets/ddb.svg",
  type: "service",
  category: "Databases",
  name: "Amazon DynamoDB",
};
const ICONS = [LAMBDA, DDB];
const resolveIcon = (node) =>
  ICONS.find((icon) => icon.id === node.iconId) ||
  ICONS.find(
    (icon) => icon.name.toLowerCase() === String(node.serviceName || node.name).toLowerCase()
  ) ||
  null;

function sampleDoc() {
  const doc = createDocument();
  const vpc = makeShape("container", {
    id: "vpc",
    preset: "vpc",
    x: 0,
    y: 0,
    w: 600,
    h: 400,
    z: -2,
  });
  const subnet = makeShape("container", {
    id: "subnet",
    preset: "private-subnet",
    x: 40,
    y: 60,
    w: 300,
    h: 200,
    z: -1,
    parent: "vpc",
  });
  const fn = makeServiceNode(LAMBDA, { id: "fn", x: 100, y: 120, parent: "subnet", z: 1 });
  const table = makeServiceNode(DDB, { id: "table", x: 800, y: 120, z: 2 });
  const note = makeShape("note", { id: "note", x: 900, y: 400, label: "Hello", z: 3 });
  doc.shapes.push(vpc, subnet, note);
  doc.nodes.push(fn, table);
  doc.connections.push(
    makeConnection("fn", "table", { id: "c1" }),
    makeConnection("note", "table", { id: "c2" })
  );
  return doc;
}

describe("legacy migration", () => {
  it("recognises v2 normalised architectures", () => {
    expect(isLegacyArchitecture({ nodes: [{ x: 0.2, y: 0.4 }], connections: [] })).toBe(true);
    expect(isLegacyArchitecture({ version: 3, nodes: [], connections: [] })).toBe(false);
    expect(isLegacyArchitecture({ nodes: [{ x: 200, y: 400, w: 48 }], connections: [] })).toBe(
      false
    );
  });

  it("maps v2 centres onto the legacy surface and keeps domain fields", () => {
    const { doc, skipped } = normalizeDocument(
      {
        name: "Old",
        nodes: [
          {
            id: "a",
            iconId: "svc:lambda",
            name: "Worker",
            x: 0.5,
            y: 0.5,
            criticality: "high",
            zone: "private",
          },
          { id: "b", serviceName: "Unknown thing", x: 0.2, y: 0.2 },
        ],
        connections: [{ id: "l", from: "a", to: "missing" }],
      },
      { resolveIcon }
    );
    expect(skipped).toEqual(["Unknown thing"]);
    expect(doc.nodes).toHaveLength(1);
    expect(doc.nodes[0]).toMatchObject({
      name: "Worker",
      criticality: "high",
      zone: "private",
      x: LEGACY_SURFACE.width / 2 - 24,
      y: LEGACY_SURFACE.height / 2 - 24,
      w: 48,
    });
    expect(doc.connections).toHaveLength(0);
  });

  it("validates v3 shapes, parents, styles and free connector ends", () => {
    const { doc } = normalizeDocument(
      {
        version: 3,
        nodes: [{ id: "n", iconId: "svc:lambda", x: 10, y: 10, w: 48, h: 48, parent: "box" }],
        shapes: [
          { id: "box", kind: "container", preset: "vpc", x: 0, y: 0, w: 300, h: 200 },
          {
            id: "weird",
            kind: "not-a-kind",
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            style: { fill: "javascript:alert(1)", fontSize: 999 },
          },
        ],
        connections: [
          { id: "free", from: "n", toPoint: { x: 400, y: 50 } },
          { id: "bad", from: "n" },
        ],
      },
      { resolveIcon }
    );
    expect(doc.nodes[0].parent).toBe("box");
    const weird = doc.shapes.find((shape) => shape.id === "weird");
    expect(weird.kind).toBe("rect");
    expect(weird.style.fill).toBeUndefined();
    expect(weird.style.fontSize).toBe(96);
    expect(doc.connections.map((c) => c.id)).toEqual(["free"]);
    expect(doc.connections[0].toPoint).toEqual({ x: 400, y: 50 });
  });

  it("breaks parent cycles", () => {
    const { doc } = normalizeDocument(
      {
        version: 3,
        nodes: [],
        shapes: [
          { id: "a", kind: "container", x: 0, y: 0, w: 100, h: 100, parent: "b" },
          { id: "b", kind: "container", x: 0, y: 0, w: 100, h: 100, parent: "a" },
        ],
        connections: [],
      },
      { resolveIcon }
    );
    expect(doc.shapes.some((shape) => shape.parent === null)).toBe(true);
  });

  it("rejects things that are not architectures", () => {
    expect(() => normalizeDocument({ hello: 1 }, { resolveIcon })).toThrow(/does not contain/);
  });
});

describe("containment", () => {
  it("finds descendants and the innermost container", () => {
    const doc = sampleDoc();
    expect(
      descendants(doc, ["vpc"])
        .map((v) => v.id)
        .sort()
    ).toEqual(["fn", "subnet"]);
    expect(containerAt(doc, { x: 120, y: 130, w: 48, h: 48 })?.id).toBe("subnet");
    expect(containerAt(doc, { x: 450, y: 300, w: 48, h: 48 })?.id).toBe("vpc");
    expect(containerAt(doc, { x: 1450, y: 300, w: 48, h: 48 })).toBeNull();
  });

  it("reparents moved vertices and reports the change", () => {
    const doc = sampleDoc();
    const table = doc.nodes.find((node) => node.id === "table");
    table.x = 150;
    table.y = 150;
    expect(reparent(doc, ["table"])).toEqual([{ id: "table", from: null, to: "subnet" }]);
    expect(inheritedZone(doc, "table")).toMatchObject({ zone: "private" });
  });

  it("keeps a child with its container when both move", () => {
    const doc = sampleDoc();
    moveElements(doc, ["vpc"], 1000, 0);
    expect(doc.nodes.find((node) => node.id === "fn").x).toBe(1100);
    expect(reparent(doc, ["vpc", "subnet", "fn"])).toEqual([]);
  });
});

describe("paint order", () => {
  it("puts containers under connectors and parents before children", () => {
    const doc = sampleDoc();
    const { below, above } = renderOrder(doc);
    expect(below.map((v) => v.id)).toEqual(["vpc", "subnet"]);
    expect(above.map((v) => v.id)).toEqual(["fn", "table", "note"]);
  });

  it("moves elements to the front and back", () => {
    const doc = sampleDoc();
    bringToFront(doc, ["fn"]);
    expect(renderOrder(doc).above.at(-1).id).toBe("fn");
    sendToBack(doc, ["note"]);
    expect(renderOrder(doc).below[0].id).toBe("note");
  });

  it("stacks new containers below and new shapes above", () => {
    const doc = sampleDoc();
    expect(zForNew(doc, makeShape("container"))).toBeLessThan(0);
    expect(zForNew(doc, makeShape("rect"))).toBeGreaterThan(3);
  });
});

describe("editing operations", () => {
  it("deletes containers with their contents and attached connectors", () => {
    const doc = sampleDoc();
    const removed = deleteElements(doc, ["vpc"]);
    expect([...removed].sort()).toEqual(["c1", "fn", "subnet", "vpc"]);
    expect(doc.connections.map((c) => c.id)).toEqual(["c2"]);
  });

  it("moves waypoints with a sub-diagram and free ends with a selected connector", () => {
    const doc = sampleDoc();
    doc.connections[0].waypoints = [{ x: 500, y: 150 }];
    moveElements(doc, ["fn", "table"], 10, 20);
    expect(doc.connections[0].waypoints).toEqual([{ x: 510, y: 170 }]);
    doc.connections.push(makeConnection("table", null, { id: "free", toPoint: { x: 0, y: 0 } }));
    moveElements(doc, ["free"], 5, 5);
    expect(doc.connections.at(-1).toPoint).toEqual({ x: 5, y: 5 });
  });

  it("groups and ungroups", () => {
    const doc = sampleDoc();
    const group = groupElements(doc, ["table", "note"]);
    expect(group.kind).toBe("group");
    expect(doc.nodes.find((node) => node.id === "table").parent).toBe(group.id);
    ungroup(doc, [group.id]);
    expect(doc.shapes.some((shape) => shape.id === group.id)).toBe(false);
    expect(doc.nodes.find((node) => node.id === "table").parent).toBeNull();
  });

  it("copies and pastes with fresh ids, remapped parents and connectors", () => {
    const doc = sampleDoc();
    const payload = copySelection(doc, ["subnet", "table"]);
    expect(payload.nodes.map((n) => n.id).sort()).toEqual(["fn", "table"]);
    expect(payload.connections.map((c) => c.id)).toEqual(["c1"]);
    const before = doc.connections.length;
    const selected = pastePayload(doc, payload, 30, 30);
    expect(doc.connections.length).toBe(before + 1);
    const pastedSubnet = doc.shapes.find((shape) => selected.includes(shape.id));
    expect(pastedSubnet.preset).toBe("private-subnet");
    const pastedFn = doc.nodes.find((node) => node.parent === pastedSubnet.id);
    expect(pastedFn.x).toBe(130);
    const pastedLink = doc.connections.at(-1);
    expect(pastedLink.from).toBe(pastedFn.id);
    expect(pastedLink.to).not.toBe("table");
  });
});

describe("analysis view and bounds", () => {
  it("only hands service-to-service connectors to the analysis modules", () => {
    const view = analysisView(sampleDoc());
    expect(view.nodes.map((n) => n.id)).toEqual(["fn", "table"]);
    expect(view.connections.map((c) => c.id)).toEqual(["c1"]);
  });

  it("includes service labels in the content bounds", () => {
    const doc = createDocument();
    doc.nodes.push(makeServiceNode(LAMBDA, { x: 0, y: 0 }));
    const bounds = documentBounds(doc);
    expect(bounds.h).toBeGreaterThan(48);
  });
});
