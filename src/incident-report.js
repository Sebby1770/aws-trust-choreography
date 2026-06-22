/**
 * Build a shareable Markdown incident report from the live atlas state.
 *
 * Pure and DOM-free so it can be unit-tested; the atlas wires it to the
 * clipboard via a command-palette action.
 */

/**
 * @param {object} input
 * @param {string} input.scenarioName   e.g. "surge"
 * @param {string} input.scenarioTitle  human sentence describing the scenario
 * @param {object} input.composed       output of deriveComposedState(...)
 * @param {string} [input.selectedNode] currently inspected node
 * @param {string} [input.url]          shareable deep link to this view
 * @returns {string} Markdown
 */
export function buildIncidentReport({
  scenarioName,
  scenarioTitle,
  composed,
  selectedNode,
  url,
} = {}) {
  const faults = composed.activeModeObjects || [];
  const faultLine = faults.length ? faults.map((mode) => mode.label).join(" + ") : "None";
  const scenarioLabel = titleCase(scenarioName || "steady");

  const lines = [
    "# AWS Resilience Command Atlas — Incident Report",
    "",
    `**Scenario:** ${scenarioLabel}`,
    scenarioTitle ? `> ${scenarioTitle}` : null,
    "",
    `**Injected faults:** ${faultLine}`,
    selectedNode ? `**Inspecting:** ${selectedNode}` : null,
    "",
    "## Telemetry",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Route health | ${composed.routeHealth}% |`,
    `| Fallback ready | ${composed.fallbackReady}% |`,
    `| Data durability | ${Number(composed.dataDurability).toFixed(2)} |`,
    `| Recovery ETA | ${pad(composed.recoveryMinutes)}m |`,
    `| Blast radius | ${composed.blastRadius} |`,
    `| Weakest node | ${composed.weakestNode} (${composed.weakestScore}%) |`,
    "",
    "## Recommendation",
    "",
    composed.recommendation,
  ];

  if (url) {
    lines.push("", "---", `Shared view: ${url}`);
  }

  return lines.filter((line) => line !== null).join("\n");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function titleCase(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}
