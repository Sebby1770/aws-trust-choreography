// @vitest-environment jsdom
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  drawioToArchitecture,
  formatStyle,
  fromDrawioDataUri,
  htmlToText,
  looksLikeDrawio,
  parseStyle,
  readDrawioPages,
  toDrawio,
  toDrawioDataUri,
} from "../src/diagram/drawio.js";
import {
  createDocument,
  makeConnection,
  makeServiceNode,
  makeShape,
  normalizeDocument,
} from "../src/diagram/model.js";

const CATALOG = [
  {
    id: "svc:lambda",
    path: "assets/lambda.svg",
    type: "service",
    category: "Compute",
    name: "AWS Lambda",
  },
  {
    id: "svc:s3",
    path: "assets/s3.svg",
    type: "service",
    category: "Storage",
    name: "Amazon Simple Storage Service",
  },
  {
    id: "svc:apigw",
    path: "assets/apigw.svg",
    type: "service",
    category: "Networking",
    name: "Amazon API Gateway",
  },
  {
    id: "res:users",
    path: "assets/users.svg",
    type: "resource",
    category: "General Icons",
    name: "Users 48 Light",
  },
];
const resolveService = (name) => {
  const wanted = String(name).toLowerCase();
  return (
    CATALOG.find((icon) => icon.name.toLowerCase() === wanted) ||
    CATALOG.find((icon) => icon.name.toLowerCase().includes(wanted)) ||
    null
  );
};
const resolveIconId = (id) => CATALOG.find((icon) => icon.id === id) || null;
const inflateRaw = (bytes) => inflateRawSync(Buffer.from(bytes)).toString("utf8");

const HAND_WRITTEN = `<mxfile host="app.diagrams.net"><diagram name="Prod" id="p1"><mxGraphModel grid="1" gridSize="10"><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="vpc" value="Prod VPC" style="points=[];shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_vpc2;strokeColor=#8C4FFF;fillColor=none;container=1;" vertex="1" parent="1"><mxGeometry x="100" y="100" width="500" height="300" as="geometry"/></mxCell>
  <mxCell id="sub" value="Private" style="shape=mxgraph.aws4.group;grIcon=mxgraph.aws4.group_security_group;grStroke=0;strokeColor=#00A4A6;fillColor=#E6F6F7;" vertex="1" parent="vpc"><mxGeometry x="20" y="40" width="260" height="200" as="geometry"/></mxCell>
  <mxCell id="fn" value="Handler&lt;br&gt;v2" style="sketch=0;outlineConnect=0;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.lambda;" vertex="1" parent="sub"><mxGeometry x="40" y="50" width="78" height="78" as="geometry"/></mxCell>
  <mxCell id="bucket" value="" style="shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.s3;" vertex="1" parent="1"><mxGeometry x="800" y="200" width="78" height="78" as="geometry"/></mxCell>
  <mxCell id="users" value="Customers" style="shape=mxgraph.aws4.users;" vertex="1" parent="1"><mxGeometry x="-100" y="200" width="60" height="60" as="geometry"/></mxCell>
  <mxCell id="d" value="Is it cached?" style="rhombus;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;fontStyle=1;" vertex="1" parent="1"><mxGeometry x="700" y="450" width="120" height="80" as="geometry"/></mxCell>
  <mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;dashed=1;endArrow=open;exitX=1;exitY=0.5;" edge="1" parent="1" source="fn" target="bucket"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="700" y="240"/></Array></mxGeometry></mxCell>
  <mxCell id="lbl" value="PutObject" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e1"><mxGeometry x="-0.5" relative="1" as="geometry"/></mxCell>
  <mxCell id="e2" style="endArrow=classic;" edge="1" parent="1" source="users"><mxGeometry relative="1" as="geometry"><mxPoint x="50" y="50" as="targetPoint"/></mxGeometry></mxCell>
  <mxCell id="e3" style="endArrow=classic;" edge="1" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="img" value="" style="shape=image;image=https://example.com/tracker.png;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="10" height="10" as="geometry"/></mxCell>
</root></mxGraphModel></diagram></mxfile>`;

describe("style strings", () => {
  it("round-trips draw.io style strings", () => {
    const parsed = parseStyle("ellipse;whiteSpace=wrap;fillColor=#fff;");
    expect(parsed).toEqual({ ellipse: "1", whiteSpace: "wrap", fillColor: "#fff" });
    expect(formatStyle({ rhombus: true, fillColor: "#000", skip: undefined })).toBe(
      "rhombus;fillColor=#000;"
    );
  });

  it("converts data URIs to and from draw.io's semicolon-free form", () => {
    expect(toDrawioDataUri("data:image/svg+xml;base64,PHN2Zy8+")).toBe(
      "data:image/svg+xml,PHN2Zy8+"
    );
    expect(fromDrawioDataUri("data:image/svg+xml,PHN2Zy8+")).toBe(
      "data:image/svg+xml;base64,PHN2Zy8+"
    );
    expect(fromDrawioDataUri("https://example.com/a.png")).toBeNull();
  });

  it("reduces HTML labels to text", () => {
    expect(htmlToText("<div>Line <b>one</b></div><div>two&nbsp;&amp; three</div>")).toBe(
      "Line one\ntwo & three"
    );
    expect(htmlToText("A&#10;B&#x41;")).toBe("A\nBA");
  });
});

describe("draw.io import", () => {
  it("reads pages from plain and compressed files", async () => {
    const plain = await readDrawioPages(HAND_WRITTEN, { inflateRaw });
    expect(plain.map((page) => page.name)).toEqual(["Prod"]);

    const inner = HAND_WRITTEN.slice(
      HAND_WRITTEN.indexOf("<mxGraphModel"),
      HAND_WRITTEN.indexOf("</diagram>")
    );
    const packed = deflateRawSync(Buffer.from(encodeURIComponent(inner))).toString("base64");
    const compressed = await readDrawioPages(
      `<mxfile><diagram name="Zipped">${packed}</diagram></mxfile>`,
      { inflateRaw }
    );
    expect(compressed[0].name).toBe("Zipped");
    expect(compressed[0].model.nodeName).toBe("mxGraphModel");
  });

  it("turns draw.io AWS shapes into services, groups into containers, and keeps geometry absolute", async () => {
    const [page] = await readDrawioPages(HAND_WRITTEN, { inflateRaw });
    const { architecture, warnings, stats } = drawioToArchitecture(page.model, {
      resolveService,
      resolveIconId,
      name: page.name,
    });
    expect(stats).toMatchObject({ services: 3, containers: 2 });
    const fn = architecture.nodes.find((node) => node.id === "fn");
    expect(fn).toMatchObject({
      iconId: "svc:lambda",
      name: "Handler\nv2",
      x: 160,
      y: 190,
      parent: "sub",
    });
    expect(architecture.nodes.find((node) => node.id === "users").iconId).toBe("res:users");
    const vpc = architecture.shapes.find((shape) => shape.id === "vpc");
    const subnet = architecture.shapes.find((shape) => shape.id === "sub");
    expect(vpc.preset).toBe("vpc");
    expect(subnet).toMatchObject({ preset: "private-subnet", parent: "vpc", x: 120, y: 140 });
    const decision = architecture.shapes.find((shape) => shape.id === "d");
    expect(decision).toMatchObject({ kind: "diamond", label: "Is it cached?" });
    expect(decision.style).toMatchObject({ fill: "#fff2cc", bold: true });
    expect(warnings.join(" ")).toMatch(/1 linked image/);
    expect(warnings.join(" ")).toMatch(/1 connector/);
  });

  it("maps connectors: routing, arrows, ports, waypoints, labels and free ends", async () => {
    const [page] = await readDrawioPages(HAND_WRITTEN, { inflateRaw });
    const { architecture } = drawioToArchitecture(page.model, { resolveService, resolveIconId });
    const e1 = architecture.connections.find((c) => c.id === "e1");
    expect(e1).toMatchObject({
      from: "fn",
      to: "bucket",
      fromPort: "e",
      label: "PutObject",
      waypoints: [{ x: 700, y: 240 }],
    });
    expect(e1.labelT).toBeCloseTo(0.25, 5);
    expect(e1.style).toMatchObject({
      routing: "orthogonal",
      rounded: false,
      dash: "dashed",
      endArrow: "open",
    });
    const e2 = architecture.connections.find((c) => c.id === "e2");
    expect(e2).toMatchObject({ from: "users", to: null, toPoint: { x: 50, y: 50 } });
    expect(e2.style.routing).toBe("straight");
  });

  it("produces a document the editor accepts", async () => {
    const [page] = await readDrawioPages(HAND_WRITTEN, { inflateRaw });
    const { architecture } = drawioToArchitecture(page.model, { resolveService, resolveIconId });
    const { doc, skipped } = normalizeDocument(architecture, {
      resolveIcon: (node) => resolveIconId(node.iconId),
    });
    expect(skipped).toEqual([]);
    expect(doc.nodes).toHaveLength(3);
    expect(doc.connections.length).toBe(2);
  });

  it("reads the diagram embedded in an editable SVG", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${HAND_WRITTEN.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}"></svg>`;
    expect(looksLikeDrawio(svg)).toBe(true);
    const pages = await readDrawioPages(svg, { inflateRaw });
    expect(pages[0].name).toBe("Prod");
  });

  it("rejects files that are not draw.io", async () => {
    await expect(readDrawioPages("<html></html>", { inflateRaw })).rejects.toThrow(/not a draw.io/);
    await expect(readDrawioPages("not xml at all <", { inflateRaw })).rejects.toThrow();
  });
});

describe("draw.io export", () => {
  function sample() {
    const doc = createDocument({ name: "Round trip" });
    const vpc = makeShape("container", {
      id: "vpc",
      preset: "vpc",
      x: 0,
      y: 0,
      w: 500,
      h: 300,
      z: -2,
    });
    const subnet = makeShape("container", {
      id: "pub",
      preset: "public-subnet",
      x: 20,
      y: 40,
      w: 250,
      h: 200,
      z: -1,
      parent: "vpc",
    });
    const note = makeShape("note", {
      id: "note",
      x: 600,
      y: 300,
      label: "Line 1\nLine <2>",
      style: { bold: true },
    });
    const fn = makeServiceNode(CATALOG[0], {
      id: "fn",
      x: 60,
      y: 100,
      parent: "pub",
      criticality: "high",
      zone: "public",
    });
    const s3 = makeServiceNode(CATALOG[1], { id: "s3", x: 700, y: 100 });
    doc.shapes.push(vpc, subnet, note);
    doc.nodes.push(fn, s3);
    doc.connections.push(
      makeConnection("fn", "s3", {
        id: "link",
        type: "data",
        label: "Put",
        encrypted: false,
        fromPort: "e",
        waypoints: [{ x: 400, y: 120 }],
        style: { routing: "orthogonal", endArrow: "open" },
      })
    );
    return doc;
  }

  it("writes native AWS group shapes, relative child geometry and embedded icons", () => {
    const xml = toDrawio(sample(), { iconDataUrl: () => "data:image/svg+xml;base64,PHN2Zy8+" });
    expect(xml).toContain("grIcon=mxgraph.aws4.group_vpc2");
    expect(xml).toContain("image=data:image/svg+xml,PHN2Zy8+");
    expect(xml).toContain('tc_zone="public"');
    // fn sits at (60,100) absolute inside a subnet at (20,40).
    expect(xml).toMatch(/tc_icon="svc:lambda"[^>]*><mxCell[^>]*><mxGeometry x="40" y="60"/);
    expect(xml).toContain("Line 1&lt;br&gt;Line &amp;lt;2&amp;gt;");
  });

  it("round-trips through draw.io without losing architecture detail", async () => {
    const xml = toDrawio(sample(), { iconDataUrl: () => "data:image/svg+xml;base64,PHN2Zy8+" });
    const [page] = await readDrawioPages(xml, { inflateRaw });
    const { architecture } = drawioToArchitecture(page.model, {
      resolveService,
      resolveIconId,
      name: page.name,
    });
    const { doc } = normalizeDocument(architecture, {
      resolveIcon: (node) => resolveIconId(node.iconId),
    });
    expect(page.name).toBe("Round trip");
    const fn = doc.nodes.find((node) => node.serviceName === "AWS Lambda");
    expect(fn).toMatchObject({ x: 60, y: 100, criticality: "high", zone: "public" });
    const pub = doc.shapes.find((shape) => shape.preset === "public-subnet");
    expect(fn.parent).toBe(pub.id);
    expect(doc.shapes.find((shape) => shape.kind === "note").label).toBe("Line 1\nLine <2>");
    const link = doc.connections[0];
    expect(link).toMatchObject({ type: "data", label: "Put", encrypted: false, fromPort: "e" });
    expect(link.waypoints).toEqual([{ x: 400, y: 120 }]);
    expect(link.style.endArrow).toBe("open");
  });
});
