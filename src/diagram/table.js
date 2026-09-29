/**
 * Database table vertices — the column model and how big a table draws.
 * Shared by the document model, the scene, and the ER conversions.
 */

export const TABLE_HEADER = 32;
export const TABLE_ROW = 24;
export const TABLE_PADDING = 6;
export const TABLE_MIN_WIDTH = 200;

export function cleanColumn(column) {
  if (!column || typeof column !== "object") return null;
  const name = String(column.name ?? "")
    .trim()
    .slice(0, 64);
  if (!name) return null;
  return {
    name,
    type: String(column.type ?? "")
      .trim()
      .slice(0, 64),
    pk: column.pk === true,
    nullable: column.pk === true ? false : column.nullable !== false,
    unique: column.unique === true && column.pk !== true,
    default:
      column.default === null || column.default === undefined || column.default === ""
        ? null
        : String(column.default).slice(0, 120),
    autoIncrement: column.autoIncrement === true,
    ...(column.comment ? { comment: String(column.comment).slice(0, 200) } : {}),
  };
}

export function cleanColumns(columns) {
  const seen = new Set();
  return (Array.isArray(columns) ? columns : [])
    .map(cleanColumn)
    .filter((column) => {
      if (!column || seen.has(column.name.toLowerCase())) return false;
      seen.add(column.name.toLowerCase());
      return true;
    })
    .slice(0, 200);
}

export function cleanRelation(relation) {
  if (!relation || typeof relation !== "object") return null;
  const list = (value) =>
    (Array.isArray(value) ? value : [])
      .map((item) => String(item).slice(0, 64))
      .filter(Boolean)
      .slice(0, 16);
  const clean = { fromColumns: list(relation.fromColumns), toColumns: list(relation.toColumns) };
  const actions = ["CASCADE", "RESTRICT", "SET NULL", "SET DEFAULT", "NO ACTION"];
  if (actions.includes(relation.onDelete)) clean.onDelete = relation.onDelete;
  if (actions.includes(relation.onUpdate)) clean.onUpdate = relation.onUpdate;
  return clean;
}

export function isTable(element) {
  return Boolean(element && element.kind === "table");
}

/** Height a table needs for its columns. */
export function tableHeight(columns = []) {
  return TABLE_HEADER + Math.max(1, columns.length) * TABLE_ROW + TABLE_PADDING;
}

/** Width a table needs so no name or type is clipped. */
export function tableWidth(table, measure) {
  const title = measure(table.label || "table", 13, true) + 40;
  const rows = (table.columns || []).map(
    (column) =>
      34 + measure(column.name, 12, column.pk) + 18 + measure(column.type || "", 11, false) + 14
  );
  return Math.ceil(Math.max(TABLE_MIN_WIDTH, title, ...rows) / 10) * 10;
}

/** Size a table to its content, never narrower than it already is. */
export function fitTable(table, measure, { shrink = false } = {}) {
  const width = tableWidth(table, measure);
  table.w = shrink ? width : Math.max(table.w || 0, width);
  table.h = tableHeight(table.columns);
  return table;
}
