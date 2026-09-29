/**
 * Live schema diagram for the SQL review workspace.
 *
 * Loaded on demand the first time the SQL contains a CREATE TABLE, so the
 * diagram engine never weighs on the workspace's first paint. The preview is
 * built as DOM nodes from the same scene the diagram studio renders — no
 * markup parsing, so pasted SQL can never become markup.
 */

import { parseSchema } from "./sql-schema.js";
import { schemaToDocument } from "./diagram/er.js";
import { documentSvgTree } from "./diagram/scene.js";
import { createMeasurer } from "./diagram/text.js";
import { toDom } from "./diagram/vdom.js";

const measure = createMeasurer();

/**
 * Render the tables in `sql` into `container`.
 * @returns {{tables: number, relationships: number, warnings: string[]}}
 */
export function renderSchemaPreview(container, sql) {
  const parsed = parseSchema(sql);
  if (!parsed.tables.length) {
    container.replaceChildren();
    return { tables: 0, relationships: 0, warnings: parsed.warnings };
  }
  const doc = schemaToDocument(parsed, { measure });
  const { tree, view } = documentSvgTree(doc, { measure, iconHref: () => null }, { padding: 16 });
  const svg = toDom(tree);
  svg.setAttribute("width", "100%");
  svg.removeAttribute("height");
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
  svg.style.maxHeight = `${Math.min(520, view.h)}px`;
  container.replaceChildren(svg);
  return {
    tables: parsed.tables.length,
    relationships: doc.connections.length,
    warnings: parsed.warnings,
  };
}
