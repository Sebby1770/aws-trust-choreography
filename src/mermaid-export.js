/**
 * Mermaid export — render a Flow Studio architecture as a Mermaid flowchart
 * that pastes straight into GitHub READMEs, PRs, and docs.
 */

const EDGE_STYLE = {
  request: "-->",
  event: "-.->",
  data: "-->",
  telemetry: "-.->",
  replication: "==>",
};

/** Mermaid-safe node id. */
export function mermaidId(value, index) {
  const base = String(value || "n")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 24);
  return base ? `${base}${index}` : `n${index}`;
}

function escapeLabel(value) {
  return String(value || "")
    .replace(/["\\]/g, "'")
    .replace(/[\n\r]+/g, " ");
}

/**
 * Render a Flow Studio state as a Mermaid flowchart (LR).
 * @returns {string}
 */
export function toMermaid(state = {}) {
  const nodes = state.nodes || [];
  const connections = state.connections || [];
  const ids = new Map();
  const out = [];

  out.push("```mermaid");
  out.push(`flowchart LR`);
  if (state.name) out.push(`  %% ${escapeLabel(state.name)}`);

  nodes.forEach((node, i) => {
    const id = mermaidId(node.serviceName || node.name, i);
    ids.set(node.id, id);
    const label = escapeLabel(node.name || node.serviceName || `Service ${i + 1}`);
    const critical = node.criticality === "high";
    out.push(critical ? `  ${id}["${label}"]:::critical` : `  ${id}["${label}"]`);
  });

  connections.forEach((c) => {
    const from = ids.get(c.from);
    const to = ids.get(c.to);
    if (!from || !to) return;
    const arrow = EDGE_STYLE[c.type] || "-->";
    const label = c.label ? `|${escapeLabel(c.label)}|` : "";
    out.push(`  ${from} ${arrow}${label} ${to}`);
  });

  if (nodes.some((n) => n.criticality === "high")) {
    out.push(`  classDef critical stroke:#ff635c,stroke-width:3px;`);
  }
  out.push("```");
  return out.join("\n");
}
