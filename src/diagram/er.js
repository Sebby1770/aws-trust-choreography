/**
 * Entity–relationship diagrams: SQL schema ⇄ diagram.
 *
 * A table is a vertex of kind `table` whose `label` is the table name and
 * whose `columns` hold the column list. A foreign key is a connector between
 * two tables carrying `relation: {fromColumns, toColumns, onDelete}` and
 * crow's-foot ends. Connectors are the source of truth for foreign keys, so
 * deleting the line deletes the constraint — what you see is the schema.
 */

import { singular } from "../sql-schema.js";
import { layeredLayout } from "./layout.js";
import { createDocument, makeConnection, makeShape } from "./model.js";
import { cleanColumns, cleanRelation, fitTable, isTable } from "./table.js";

export {
  cleanColumns,
  cleanRelation,
  fitTable,
  isTable,
  tableHeight,
  tableWidth,
  TABLE_HEADER,
  TABLE_ROW,
} from "./table.js";

export function defaultTableColumns() {
  return [
    {
      name: "id",
      type: "bigint",
      pk: true,
      nullable: false,
      unique: false,
      default: null,
      autoIncrement: true,
    },
    {
      name: "created_at",
      type: "timestamptz",
      pk: false,
      nullable: false,
      unique: false,
      default: "now()",
      autoIncrement: false,
    },
  ];
}

export const ER_ENDS = {
  "many-to-one": { startArrow: "many", endArrow: "one" },
  "optional-many-to-one": { startArrow: "zeroMany", endArrow: "one" },
  "one-to-one": { startArrow: "one", endArrow: "one" },
  "optional-one-to-one": { startArrow: "zeroOne", endArrow: "one" },
};

/** Crow's-foot ends for a foreign key, from nullability and uniqueness. */
export function relationEnds(table, fromColumns) {
  const columns = (table?.columns || []).filter((column) => fromColumns.includes(column.name));
  const optional = columns.some((column) => column.nullable !== false);
  const unique =
    columns.length === 1 &&
    (columns[0].unique ||
      (columns[0].pk && (table.columns || []).filter((c) => c.pk).length === 1));
  if (unique) return optional ? ER_ENDS["optional-one-to-one"] : ER_ENDS["one-to-one"];
  return optional ? ER_ENDS["optional-many-to-one"] : ER_ENDS["many-to-one"];
}

const ER_STYLE = { routing: "orthogonal", stroke: "#3b6fb6", strokeWidth: 1.4, dash: "solid" };

/**
 * Work out which columns a connector between two tables links: the source
 * column named after the target (`customer_id` → `customers`), pointing at
 * the target's primary key.
 */
export function inferRelation(source, target) {
  const targetName = String(target.label || "").toLowerCase();
  const stem = singular(targetName);
  const candidates = [
    `${stem}_id`,
    `${targetName}_id`,
    `${stem}id`,
    `${targetName}id`,
    `id_${stem}`,
  ];
  const column = (source.columns || []).find((candidate) =>
    candidates.includes(candidate.name.toLowerCase())
  );
  const targetKey = (target.columns || [])
    .filter((candidate) => candidate.pk)
    .map((candidate) => candidate.name);
  return {
    fromColumns: column ? [column.name] : [],
    toColumns: targetKey.length
      ? targetKey
      : (target.columns || []).some((c) => c.name === "id")
        ? ["id"]
        : [],
  };
}

/**
 * Make sure a table-to-table connector has a foreign-key column to stand on,
 * adding `<target>_id` to the source table when there is none — drawing the
 * line creates the key, as in dbdiagram or DrawSQL.
 *
 * @returns {string|null} the name of a column that was added
 */
export function ensureForeignKey(connection, source, target, measure) {
  if (!isTable(source) || !isTable(target)) return null;
  const relation = connection.relation?.fromColumns?.length
    ? connection.relation
    : inferRelation(source, target);
  let added = null;
  if (!relation.fromColumns.length) {
    const key = (target.columns || []).find((column) => column.pk) || (target.columns || [])[0];
    const name = `${singular(String(target.label || "parent").toLowerCase()).replace(/[^a-z0-9_]+/g, "_")}_id`;
    if (!source.columns.some((column) => column.name === name)) {
      source.columns.push({
        name,
        type: /serial/i.test(key?.type || "")
          ? String(key.type)
              .replace(/bigserial/i, "bigint")
              .replace(/serial/i, "integer")
          : key?.type || "bigint",
        pk: false,
        nullable: false,
        unique: false,
        default: null,
        autoIncrement: false,
      });
      added = name;
      if (measure) fitTable(source, measure);
    }
    relation.fromColumns = [name];
    if (!relation.toColumns.length && key) relation.toColumns = [key.name];
  }
  connection.relation = cleanRelation(relation);
  connection.label = connection.label || "";
  connection.style = {
    ...ER_STYLE,
    ...relationEnds(source, connection.relation.fromColumns),
    ...(connection.style || {}),
  };
  return added;
}

/** Map table vertex id → set of its foreign-key column names. */
export function foreignKeyColumns(doc) {
  const tables = new Map(doc.shapes.filter(isTable).map((table) => [table.id, table]));
  const result = new Map();
  for (const connection of doc.connections) {
    if (!tables.has(connection.from) || !tables.has(connection.to)) continue;
    const relation = connection.relation?.fromColumns?.length
      ? connection.relation
      : inferRelation(tables.get(connection.from), tables.get(connection.to));
    if (!result.has(connection.from)) result.set(connection.from, new Set());
    for (const name of relation.fromColumns) result.get(connection.from).add(name);
  }
  return result;
}

// ------------------------------------------------------ schema → diagram

/**
 * Lay a parsed schema out as a diagram document.
 *
 * @param {{tables: Array}} schema from `parseSchema`
 * @param {{name?: string, measure: Function}} options
 */
export function schemaToDocument(
  schema,
  { name = "Database schema", measure, origin = { x: 80, y: 80 } } = {}
) {
  const doc = createDocument({ name });
  const byName = new Map();
  (schema.tables || []).forEach((table, index) => {
    const shape = makeShape("table", {
      label: table.schema ? `${table.schema}.${table.name}` : table.name,
      columns: cleanColumns(table.columns),
      z: index + 1,
    });
    fitTable(shape, measure);
    byName.set(table.name.toLowerCase(), shape);
    doc.shapes.push(shape);
  });
  const links = [];
  for (const table of schema.tables || []) {
    const child = byName.get(table.name.toLowerCase());
    for (const foreignKey of table.foreignKeys || []) {
      const parent = byName.get(String(foreignKey.refTable).toLowerCase());
      if (!parent || !child) continue;
      const relation = cleanRelation({
        fromColumns: foreignKey.columns,
        toColumns: foreignKey.refColumns,
        onDelete: foreignKey.onDelete,
        onUpdate: foreignKey.onUpdate,
      });
      doc.connections.push(
        makeConnection(child.id, parent.id, {
          relation,
          label: "",
          style: { ...ER_STYLE, ...relationEnds(child, relation.fromColumns) },
        })
      );
      if (parent !== child) links.push({ from: parent.id, to: child.id });
    }
  }
  const positions = layeredLayout(
    doc.shapes.map((shape) => ({ id: shape.id, w: shape.w, h: shape.h })),
    links,
    { direction: "LR", layerGap: 120, nodeGap: 48, origin }
  );
  for (const shape of doc.shapes) {
    const position = positions.get(shape.id);
    if (position)
      Object.assign(shape, {
        x: Math.round(position.x / 10) * 10,
        y: Math.round(position.y / 10) * 10,
      });
  }
  return doc;
}

// ------------------------------------------------------ diagram → schema

/**
 * Read the tables (and foreign-key connectors) of a document as a schema,
 * ready for `toDDL`. Connectors with no recorded columns are inferred.
 *
 * @param {object} doc
 * @param {{ids?: string[]}} options limit to these table ids
 * @returns {{tables: Array, notes: string[]}}
 */
export function documentToSchema(doc, { ids = null } = {}) {
  const wanted = ids ? new Set(ids) : null;
  const tables = doc.shapes.filter(isTable).filter((table) => !wanted || wanted.has(table.id));
  const byId = new Map(tables.map((table) => [table.id, table]));
  const notes = [];
  const split = (label) => {
    const text = String(label || "table").trim() || "table";
    const dot = text.lastIndexOf(".");
    return dot > 0
      ? { schema: text.slice(0, dot), name: text.slice(dot + 1) }
      : { schema: null, name: text };
  };
  const model = tables.map((table) => {
    const { schema, name } = split(table.label);
    const columns = cleanColumns(table.columns);
    return {
      id: table.id,
      name,
      schema,
      columns,
      primaryKey: columns.filter((column) => column.pk).map((column) => column.name),
      uniques: [],
      foreignKeys: [],
    };
  });
  const modelById = new Map(model.map((table) => [table.id, table]));
  for (const connection of doc.connections) {
    const source = byId.get(connection.from);
    const target = byId.get(connection.to);
    if (!source || !target) continue;
    const relation = connection.relation?.fromColumns?.length
      ? connection.relation
      : inferRelation(source, target);
    const from = modelById.get(source.id);
    const to = modelById.get(target.id);
    if (!relation.fromColumns.length || !relation.toColumns.length) {
      notes.push(
        `${from.name} → ${to.name} has no foreign-key column; pick one in the Format panel.`
      );
      continue;
    }
    from.foreignKeys.push({
      name: null,
      columns: relation.fromColumns,
      refTable: to.name,
      refSchema: to.schema,
      refColumns: relation.toColumns,
      onDelete: relation.onDelete,
      onUpdate: relation.onUpdate,
    });
  }
  return { tables: model, notes };
}
