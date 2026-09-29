import { describe, expect, it } from "vitest";
import { buildLayers, computeRoutes, documentSvg, vertexNode } from "../src/diagram/scene.js";
import {
  createDocument,
  makeConnection,
  makeServiceNode,
  makeShape,
} from "../src/diagram/model.js";
import { estimateWidth, layoutLabel, wrapText } from "../src/diagram/text.js";
import { toMarkup } from "../src/diagram/vdom.js";
import { layeredLayout } from "../src/diagram/layout.js";

const measure = (text, size = 12, bold = false) => estimateWidth(text, size, bold);
const LAMBDA = {
  id: "svc:lambda",
  path: "assets/lambda.svg",
  type: "service",
  category: "Compute",
  name: "AWS Lambda",
};

function ctx(extra = {}) {
  return { measure, iconHref: (el) => el.iconPath || null, routeCache: new Map(), ...extra };
}

function sampleDoc() {
  const doc = createDocument({ name: "Scene" });
  doc.shapes.push(
    makeShape("container", { id: "vpc", preset: "vpc", x: 0, y: 0, w: 400, h: 300, z: -1 }),
    makeShape("rect", { id: "box", label: "Payment <service> & co", x: 500, y: 40, z: 3 })
  );
  doc.nodes.push(makeServiceNode(LAMBDA, { id: "fn", x: 60, y: 60, name: "Order handler" }));
  doc.connections.push(makeConnection("fn", "box", { id: "c1", label: "HTTPS" }));
  return doc;
}

describe("text layout", () => {
  it("wraps on words, keeps explicit newlines, and breaks long words", () => {
    const narrow = (value) => value.length * 10;
    expect(wrapText("one two three", 75, narrow)).toEqual(["one two", "three"]);
    expect(wrapText("a\nb", 100, narrow)).toEqual(["a", "b"]);
    expect(wrapText("abcdefghij", 40, narrow)).toEqual(["abcd", "efgh", "ij"]);
  });

  it("anchors and positions a label by alignment", () => {
    const layout = layoutLabel(
      "Hi",
      { x: 0, y: 0, w: 100, h: 40 },
      { fontSize: 12, align: "left", valign: "top" },
      measure
    );
    expect(layout.anchor).toBe("start");
    expect(layout.x).toBe(6);
    expect(layout.y).toBeLessThan(20);
  });
});

describe("scene", () => {
  it("renders containers below connectors and services above", () => {
    const layers = buildLayers(sampleDoc(), ctx({ interactive: true }));
    expect(layers.below).toHaveLength(1);
    expect(layers.above).toHaveLength(2);
    expect(layers.edges).toHaveLength(1);
    const markup = toMarkup(layers.edges[0]);
    expect(markup).toContain('data-edge-id="c1"');
    expect(markup).toContain("HTTPS");
  });

  it("escapes labels", () => {
    const node = vertexNode(sampleDoc().shapes[1], ctx());
    const markup = toMarkup(node);
    expect(markup).toContain("Payment &lt;service&gt; &amp;");
    expect(markup).not.toContain("<service>");
  });

  it("marks selection only in interactive mode", () => {
    const doc = sampleDoc();
    const live = toMarkup(
      vertexNode(doc.nodes[0], ctx({ interactive: true, selected: new Set(["fn"]) }))
    );
    const exported = toMarkup(vertexNode(doc.nodes[0], ctx({ selected: new Set(["fn"]) })));
    expect(live).toContain("is-selected");
    expect(exported).not.toContain("is-selected");
    expect(exported).not.toContain("data-id");
  });

  it("caches routes between renders", () => {
    const doc = sampleDoc();
    const context = ctx();
    const first = computeRoutes(doc, context).get("c1");
    const second = computeRoutes(doc, context).get("c1");
    expect(second).toBe(first);
    doc.shapes[1].x += 50;
    expect(computeRoutes(doc, context).get("c1")).not.toBe(first);
  });

  it("exports a cropped, standalone SVG with an embedded draw.io payload", () => {
    const { markup, width, height } = documentSvg(sampleDoc(), ctx(), { content: "<mxfile/>" });
    expect(markup.startsWith("<svg")).toBe(true);
    expect(markup).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(markup).toContain('content="&lt;mxfile/&gt;"');
    expect(markup).toContain("xlink:href");
    expect(width).toBeGreaterThan(600);
    expect(height).toBeGreaterThan(300);
  });

  it("exports a subset of the diagram", () => {
    const { markup } = documentSvg(sampleDoc(), ctx(), { ids: ["box"] });
    expect(markup).toContain("Payment");
    expect(markup).not.toContain("Order handler");
  });
});

describe("layered layout", () => {
  it("places sources left of their targets and avoids overlaps", () => {
    const items = ["a", "b", "c", "d"].map((id) => ({ id, w: 50, h: 50 }));
    const positions = layeredLayout(items, [
      { from: "a", to: "b" },
      { from: "a", to: "c" },
      { from: "b", to: "d" },
      { from: "c", to: "d" },
    ]);
    expect(positions.get("a").x).toBeLessThan(positions.get("b").x);
    expect(positions.get("b").x).toBeLessThan(positions.get("d").x);
    expect(positions.get("b").x).toBe(positions.get("c").x);
    expect(Math.abs(positions.get("b").y - positions.get("c").y)).toBeGreaterThanOrEqual(50);
  });

  it("survives cycles and supports top-to-bottom", () => {
    const items = ["a", "b"].map((id) => ({ id, w: 40, h: 20 }));
    const positions = layeredLayout(
      items,
      [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
      { direction: "TB" }
    );
    expect(positions.get("a").y).not.toBe(positions.get("b").y);
  });
});

describe("SVG export fidelity", () => {
  it("draws on white paper and keeps ink legible on it", () => {
    const { markup } = documentSvg(sampleDoc(), ctx());
    expect(markup).toContain('fill="#ffffff"');
    expect(markup).not.toContain("#06131d");
  });

  it("dashes asynchronous traffic and leaves requests solid", () => {
    const doc = sampleDoc();
    doc.connections = [{ ...doc.connections[0], id: "a", type: "event" }];
    const dashed = documentSvg(doc, ctx()).markup;
    expect(dashed).toContain("stroke-dasharray");
    doc.connections[0].type = "request";
    expect(documentSvg(doc, ctx()).markup).not.toContain("stroke-dasharray");
  });

  it("escapes XML metacharacters in names", () => {
    const doc = sampleDoc();
    doc.nodes[0].name = '<script>"x" & y';
    const { markup } = documentSvg(doc, ctx());
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });

  it("handles an empty diagram", () => {
    const { markup } = documentSvg(createDocument(), ctx());
    expect(markup).toContain("</svg>");
  });
});
