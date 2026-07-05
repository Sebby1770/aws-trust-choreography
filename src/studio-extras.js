/**
 * Studio extras — the "decision layer" bolted onto Flow Studio:
 *
 *  - a live 💰 cost badge (rough monthly estimate that tracks the canvas)
 *  - "TF" — download the architecture as a Terraform main.tf skeleton
 *  - "MMD" — copy the architecture as a Mermaid flowchart for READMEs/PRs
 *
 * Self-contained DOM wiring over the public AWSFlowStudio API, so the large
 * flow-studio.js stays untouched.
 */

import { estimateArchitectureCost, formatUsd } from "./cost-model.js";
import { toTerraform } from "./terraform-export.js";
import { toMermaid } from "./mermaid-export.js";

function download(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function slug(value) {
  return (
    String(value || "architecture")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "architecture"
  );
}

export function initStudioExtras(studio = window.AWSFlowStudio) {
  const toolbar = document.querySelector(".flow-toolbar");
  const meta = document.querySelector(".flow-studio-meta");
  const status = document.querySelector("#flowStatusMessage");
  if (!studio || !toolbar) return null;

  const say = (message) => {
    if (status) status.textContent = message;
  };

  // --- Terraform + Mermaid export buttons --------------------------------

  const tfButton = document.createElement("button");
  tfButton.type = "button";
  tfButton.title = "Export architecture as a Terraform skeleton";
  tfButton.innerHTML = `<span aria-hidden="true">⛏</span>TF`;
  tfButton.addEventListener("click", () => {
    const state = studio.getState();
    download(`${slug(state?.name)}-main.tf`, toTerraform(state));
    say("Terraform skeleton downloaded — review the TODOs before applying");
  });

  const mmdButton = document.createElement("button");
  mmdButton.type = "button";
  mmdButton.title = "Copy architecture as a Mermaid diagram";
  mmdButton.innerHTML = `<span aria-hidden="true">⧉</span>MMD`;
  mmdButton.addEventListener("click", async () => {
    const text = toMermaid(studio.getState());
    try {
      await navigator.clipboard.writeText(text);
      say("Mermaid diagram copied — paste it into a README or PR");
    } catch {
      console.log(text);
      say("Clipboard blocked — Mermaid diagram logged to the console");
    }
  });

  toolbar.append(tfButton, mmdButton);

  // --- Live cost badge ----------------------------------------------------

  let badge = null;
  if (meta) {
    badge = document.createElement("span");
    badge.className = "flow-cost-badge";
    badge.title = "Rough monthly cost estimate (planning figure, not a quote)";
    meta.appendChild(badge);
  }

  function renderCost() {
    if (!badge) return;
    const state = studio.getState();
    const { total, lines } = estimateArchitectureCost(state?.nodes || []);
    badge.innerHTML = `≈ <strong>${formatUsd(total)}</strong>/mo`;
    const top = lines
      .slice(0, 3)
      .map((l) => `${l.name} ${formatUsd(l.usd)} (${l.why})`)
      .join(" · ");
    badge.title = top
      ? `Rough monthly estimate — biggest: ${top}`
      : "Add services to estimate a monthly cost";
  }

  renderCost();
  window.setInterval(renderCost, 4000);

  return { renderCost };
}
