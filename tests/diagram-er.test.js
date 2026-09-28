// @vitest-environment jsdom
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseSchema, SAMPLE_SCHEMA, toDDL } from "../src/sql-schema.js";
import {
  documentToSchema,
  ensureForeignKey,
  foreignKeyColumns,
  inferRelation,
  relationEnds,
  schemaToDocument,
} from "../src/diagram/er.js";
import { makeConnection, makeShape, normalizeDocument } from "../src/diagram/model.js";
import { documentSvg } from "../src/diagram/scene.js";
import { estimateWidth } from "../src/diagram/text.js";
import {
  drawioToArchitecture,
  parseColumnLabel,
  readDrawioPages,
  toDrawio,
} from "../src/diagram/drawio.js";
import { arrowhead } from "../src/diagram/router.js";

const measure = (text, size = 12, bold = false) => estimateWidth(text, size, bold);
const inflateRaw = (bytes) => inflateRawSync(Buffer.from(bytes)).toString("utf8");

describe("SQL → diagram", () => {
  const doc = schemaToDocument(parseSchema(SAMPLE_SCHEMA), { measure });

  it("draws one table per CREATE TABLE and one connector per foreign key", () => {
    expect(doc.shapes.map((shape) => shape.label)).toEqual([
      "customers",
      "products",
      "orders",
      "order_items",
    ]);
    expect(doc.connections).toHaveLength(3);
    const orders = doc.shapes.find((shape) => shape.label === "orders");
    expect(orders.columns.map((column) => column.name)).toEqual([
      "id",
      "customer_id",
      "status",
      "placed_at",
    ]);
    expect(orders.h).toBe(32 + 4 * 24 + 6);
  });

  it("lays parents out before their children", () => {
    const x = (label) => doc.shapes.find((shape) => shape.label === label).x;
    expect(x("customers")).toBeLessThan(x("orders"));
    expect(x("orders")).toBeLessThan(x("order_items"));
  });

  it("uses crow's-foot ends that follow nullability and uniqueness", () => {
    const link = doc.connections.find(
      (connection) => connection.relation.fromColumns[0] === "customer_id"
    );
    expect(link.style).toMatchObject({ startArrow: "many", endArrow: "one" });
    const optional = makeShape("table", { label: "t", columns: [{ name: "x_id", type: "int" }] });
    expect(relationEnds(optional, ["x_id"]).startArrow).toBe("zeroMany");
    const unique = makeShape("table", {
      label: "t",
      columns: [{ name: "x_id", type: "int", unique: true, nullable: false }],
    });
    expect(relationEnds(unique, ["x_id"]).startArrow).toBe("one");
  });

  it("marks foreign-key columns for the renderer", () => {
    const orders = doc.shapes.find((shape) => shape.label === "orders");
    expect([...foreignKeyColumns(doc).get(orders.id)]).toEqual(["customer_id"]);
    const { markup } = documentSvg(doc, { measure, iconHref: () => null });
    expect(markup).toContain(">FK<");
    expect(markup).toContain(">PK<");
    expect(markup).toContain("customer_id");
  });
});

describe("diagram → SQL", () => {
  it("round-trips a schema through the diagram", () => {
    const doc = schemaToDocument(parseSchema(SAMPLE_SCHEMA), { measure });
    const ddl = toDDL(documentToSchema(doc));
    const again = parseSchema(ddl);
    expect(again.tables.find((table) => table.name === "order_items").foreignKeys).toHaveLength(2);
    expect(again.tables.find((table) => table.name === "orders").foreignKeys[0].onDelete).toBe(
      "CASCADE"
    );
  });

  it("infers the key column from the table name", () => {
    const customers = makeShape("table", {
      label: "customers",
      columns: [{ name: "id", type: "bigint", pk: true }],
    });
    const orders = makeShape("table", {
      label: "orders",
      columns: [
        { name: "id", type: "bigint", pk: true },
        { name: "customer_id", type: "bigint" },
      ],
    });
    expect(inferRelation(orders, customers)).toEqual({
      fromColumns: ["customer_id"],
      toColumns: ["id"],
    });
  });

  it("adds a foreign-key column when a relationship is drawn between tables", () => {
    const teams = makeShape("table", {
      label: "teams",
      columns: [{ name: "id", type: "bigserial", pk: true }],
    });
    const people = makeShape("table", {
      label: "people",
      columns: [{ name: "id", type: "bigint", pk: true }],
    });
    const connection = makeConnection(people.id, teams.id);
    const added = ensureForeignKey(connection, people, teams, measure);
    expect(added).toBe("team_id");
    expect(people.columns.at(-1)).toMatchObject({
      name: "team_id",
      type: "bigint",
      nullable: false,
    });
    expect(connection.relation).toEqual({ fromColumns: ["team_id"], toColumns: ["id"] });
    expect(connection.style.startArrow).toBe("many");
  });

  it("reports connectors it cannot turn into keys", () => {
    const a = makeShape("table", { label: "a", columns: [] });
    const b = makeShape("table", { label: "b", columns: [] });
    const { notes } = documentToSchema({
      shapes: [a, b],
      nodes: [],
      connections: [makeConnection(a.id, b.id)],
    });
    expect(notes[0]).toMatch(/no foreign-key column/);
  });

  it("keeps table data through document validation", () => {
    const doc = schemaToDocument(parseSchema(SAMPLE_SCHEMA), { measure });
    const { doc: clean } = normalizeDocument(JSON.parse(JSON.stringify(doc)), {
      resolveIcon: () => null,
    });
    expect(clean.shapes.find((shape) => shape.label === "orders").columns).toHaveLength(4);
    expect(clean.connections[0].relation.fromColumns.length).toBeGreaterThan(0);
  });
});

describe("ER in draw.io", () => {
  it("round-trips tables and relationships", async () => {
    const doc = schemaToDocument(parseSchema(SAMPLE_SCHEMA), { measure });
    const xml = toDrawio(doc);
    expect(xml).toContain("childLayout=stackLayout");
    expect(xml).toContain("endArrow=ERmandOne");
    const [page] = await readDrawioPages(xml, { inflateRaw });
    const { architecture } = drawioToArchitecture(page.model, { resolveService: () => null });
    const orders = architecture.shapes.find((shape) => shape.label === "orders");
    expect(orders.kind).toBe("table");
    expect(orders.columns.map((column) => column.name)).toEqual([
      "id",
      "customer_id",
      "status",
      "placed_at",
    ]);
    expect(architecture.shapes.filter((shape) => shape.kind === "table")).toHaveLength(4);
    expect(architecture.connections[0].relation.fromColumns.length).toBe(1);
    expect(architecture.connections[0].style.startArrow).toBe("many");
  });

  it("reads draw.io's own entity lists, including row-anchored connectors", async () => {
    const xml = `<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>
      <mxCell id="t1" value="users" style="swimlane;childLayout=stackLayout;startSize=30;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="160" height="90" as="geometry"/></mxCell>
      <mxCell id="r1" value="PK id: int" style="text;" vertex="1" parent="t1"><mxGeometry y="30" width="160" height="30" as="geometry"/></mxCell>
      <mxCell id="r2" value="email: varchar(255)" style="text;" vertex="1" parent="t1"><mxGeometry y="60" width="160" height="30" as="geometry"/></mxCell>
      <mxCell id="t2" value="posts" style="swimlane;childLayout=stackLayout;startSize=30;" vertex="1" parent="1"><mxGeometry x="300" y="0" width="160" height="60" as="geometry"/></mxCell>
      <mxCell id="r3" value="user_id int" style="text;" vertex="1" parent="t2"><mxGeometry y="30" width="160" height="30" as="geometry"/></mxCell>
      <mxCell id="e" style="endArrow=ERmandOne;startArrow=ERmany;" edge="1" parent="1" source="r3" target="r1"><mxGeometry relative="1" as="geometry"/></mxCell>
    </root></mxGraphModel>`;
    const [page] = await readDrawioPages(xml, { inflateRaw });
    const { architecture } = drawioToArchitecture(page.model, { resolveService: () => null });
    const users = architecture.shapes.find((shape) => shape.label === "users");
    expect(users.columns).toEqual([
      expect.objectContaining({ name: "id", type: "int", pk: true }),
      expect.objectContaining({ name: "email", type: "varchar(255)" }),
    ]);
    expect(architecture.connections[0]).toMatchObject({
      from: "t2",
      to: "t1",
      relation: { fromColumns: ["user_id"], toColumns: ["id"] },
    });
  });

  it("parses column labels in the common styles", () => {
    expect(parseColumnLabel("PK id: bigint")).toMatchObject({
      name: "id",
      type: "bigint",
      pk: true,
    });
    expect(parseColumnLabel("+ email varchar(255) NOT NULL")).toMatchObject({
      name: "email",
      type: "varchar(255)",
      nullable: false,
    });
    expect(parseColumnLabel("note: text?")).toMatchObject({ name: "note", nullable: true });
    expect(parseColumnLabel("")).toBeNull();
  });

  it("draws crow's-foot ends", () => {
    const many = arrowhead("many", { x: 100, y: 0 }, 0, 1.4);
    expect(many.d.match(/M /g)).toHaveLength(3);
    expect(arrowhead("zeroMany", { x: 100, y: 0 }, 0, 1.4).circle).toMatch(/^M /);
    expect(arrowhead("one", { x: 100, y: 0 }, 0, 1.4).inset).toBe(0);
  });
});
