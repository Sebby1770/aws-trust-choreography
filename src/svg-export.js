// SVG diagram export — pure string building, no DOM.
//
// Exported diagrams get pasted into READMEs, docs, and slides, which are
// white. The palette here matches the on-screen paper canvas so a diagram
// looks the same in the studio and in the document it lands in.

export const SVG_PALETTE = {
  paper: "#ffffff",
  grid: "rgba(15,23,42,0.10)",
  ink: "#0f2027",
  inkMuted: "#5b6b76",
  line: "#64798a",
};

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function svgFileName(name) {
  return (
    String(name ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "aws-architecture"
  );
}

/**
 * Build the SVG document for an architecture.
 *
 * @param {object} state - {name, region, nodes, connections}
 * @param {object} options - {width, height, icons: Map|object id->dataUrl,
 *                            criticalityColors}
 */
export function toSvg(state = {}, options = {}) {
  const width = options.width ?? 1600;
  const height = options.height ?? 900;
  const criticalityColors = options.criticalityColors ?? {};
  const rawIcons = options.icons ?? new Map();
  const icons = rawIcons instanceof Map ? rawIcons : new Map(Object.entries(rawIcons));

  const allNodes = Array.isArray(state.nodes) ? state.nodes : [];
  const allConnections = Array.isArray(state.connections) ? state.connections : [];
  const nodeMap = new Map(allNodes.map((node) => [node.id, node]));

  const lines = allConnections
    .map((connection) => {
      const from = nodeMap.get(connection.from);
      const to = nodeMap.get(connection.to);
      if (!from || !to) {
        return "";
      }
      const x1 = from.x * width;
      const y1 = from.y * height;
      const x2 = to.x * width;
      const y2 = to.y * height;
      const bend = Math.max(60, Math.abs(x2 - x1) * 0.42) * (x2 >= x1 ? 1 : -1);
      const dash =
        connection.type === "event" || connection.type === "telemetry"
          ? ' stroke-dasharray="10 8"'
          : "";
      return `<path d="M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}" fill="none" stroke="${SVG_PALETTE.line}" stroke-width="3"${dash} marker-end="url(#arrow)"/><text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 12}" fill="${SVG_PALETTE.inkMuted}" font-size="16" text-anchor="middle">${escapeXml(connection.label || "Path")}</text>`;
    })
    .join("");

  const nodes = allNodes
    .map((node) => {
      const x = node.x * width;
      const y = node.y * height;
      const stroke = criticalityColors[node.criticality] || criticalityColors.medium || "#6b7f8c";
      const icon = icons.get(node.id);
      const image = icon
        ? `<image href="${escapeXml(icon)}" x="31" y="12" width="54" height="54"/>`
        : "";
      return `<g transform="translate(${x - 58} ${y - 58})"><rect width="116" height="116" rx="6" fill="${SVG_PALETTE.paper}" stroke="${stroke}"/>${image}<text x="58" y="88" fill="${SVG_PALETTE.ink}" font-size="15" font-weight="700" text-anchor="middle">${escapeXml(String(node.name ?? "").slice(0, 22))}</text><text x="58" y="106" fill="${SVG_PALETTE.inkMuted}" font-size="11" text-anchor="middle">${escapeXml(node.environment)}</text></g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 32" fill="none" stroke="${SVG_PALETTE.grid}" stroke-width="1"/></pattern><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="${SVG_PALETTE.line}"/></marker></defs><rect width="100%" height="100%" fill="${SVG_PALETTE.paper}"/><rect width="100%" height="100%" fill="url(#grid)"/><text x="38" y="48" fill="${SVG_PALETTE.ink}" font-size="24" font-family="system-ui" font-weight="700">${escapeXml(state.name)}</text><text x="38" y="74" fill="${SVG_PALETTE.inkMuted}" font-size="14" font-family="system-ui">${escapeXml(state.region)} · AWS Flow Studio</text><g font-family="system-ui">${lines}${nodes}</g></svg>`;
}
