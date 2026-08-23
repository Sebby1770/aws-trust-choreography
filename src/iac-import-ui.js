/**
 * Import dialog for infrastructure as code.
 *
 * Wires the `#iacDialog` markup over the public `AWSFlowStudio` API, the same
 * way `studio-extras.js` does, so the large `flow-studio.js` stays untouched.
 * Parsing happens as you type: the preview shows exactly what will be drawn —
 * services, paths, hidden plumbing, and anything the parser could not resolve —
 * before the canvas is replaced.
 */

import { detectIacFormat, importInfrastructure } from "./iac-import.js";

const FORMAT_LABELS = {
  terraform: "Terraform",
  "cloudformation-json": "CloudFormation JSON",
  "cloudformation-yaml": "CloudFormation YAML",
};

const PARSE_DEBOUNCE_MS = 220;

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]
  );
}

/**
 * Render the parse result (or failure) into the preview panel.
 * Exported for tests — takes plain data, touches nothing else.
 */
export function renderPreview(container, state) {
  if (!container) return;
  if (state?.error) {
    container.innerHTML = `<p class="iac-error" role="alert">${escapeHtml(state.error)}</p>`;
    return;
  }
  const result = state?.result;
  if (!result) {
    container.innerHTML = `<p class="iac-empty">Paste or drop a file to see what will be drawn.</p>`;
    return;
  }

  const { stats } = result;
  const unencrypted = result.connections.filter((connection) => !connection.encrypted).length;
  const services = result.nodes
    .map(
      (node) =>
        `<li><strong>${escapeHtml(node.name)}</strong><span>${escapeHtml(node.serviceName)}</span></li>`
    )
    .join("");
  const warnings = result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");

  container.innerHTML = `
    <div class="iac-stats">
      <div><strong>${stats.services}</strong><span>service${stats.services === 1 ? "" : "s"}</span></div>
      <div><strong>${stats.connections}</strong><span>path${stats.connections === 1 ? "" : "s"}</span></div>
      <div><strong>${stats.plumbing}</strong><span>plumbing hidden</span></div>
      ${
        unencrypted
          ? `<div class="is-alert"><strong>${unencrypted}</strong><span>unencrypted</span></div>`
          : ""
      }
    </div>
    <p class="iac-meta">
      <strong>${escapeHtml(result.name)}</strong> · ${escapeHtml(result.region)} ·
      read from ${stats.resources} resource${stats.resources === 1 ? "" : "s"}
    </p>
    <ul class="iac-services">${services}</ul>
    ${warnings ? `<div class="iac-warnings"><h4>Worth knowing</h4><ul>${warnings}</ul></div>` : ""}
  `;
}

/**
 * Mount the IaC import dialog.
 * @param {object} [studio] the AWSFlowStudio API (defaults to the global)
 * @returns {{open: () => void, parse: (text: string) => void}|null}
 */
export function initIacImport(studio = window.AWSFlowStudio) {
  const dialog = document.querySelector("#iacDialog");
  const openButton = document.querySelector("#flowIacImportButton");
  if (!dialog || !openButton || !studio) return null;

  const source = dialog.querySelector("#iacSource");
  const preview = dialog.querySelector("#iacPreview");
  const formatBadge = dialog.querySelector("#iacFormat");
  const submit = dialog.querySelector("#iacDialogSubmit");
  const closeButton = dialog.querySelector("#iacDialogClose");
  const fileButton = dialog.querySelector("#iacFileButton");
  const fileInput = dialog.querySelector("#iacFileInput");
  const status = document.querySelector("#flowStatusMessage");

  let parsed = null;
  let parseTimer = 0;

  const say = (message, tone = "var(--green)") => {
    if (!status) return;
    status.textContent = message;
    status.style.color = tone;
  };

  function parse(text) {
    const trimmed = String(text || "").trim();
    const format = detectIacFormat(trimmed);
    if (formatBadge) {
      formatBadge.textContent = trimmed ? FORMAT_LABELS[format] || "Unrecognised format" : "";
      formatBadge.dataset.known = String(Boolean(format));
    }

    if (!trimmed) {
      parsed = null;
      renderPreview(preview, null);
      if (submit) submit.disabled = true;
      return;
    }

    try {
      parsed = importInfrastructure(trimmed);
      renderPreview(preview, { result: parsed });
      if (submit) submit.disabled = parsed.nodes.length === 0;
    } catch (error) {
      parsed = null;
      renderPreview(preview, { error: error.message || "That input could not be parsed." });
      if (submit) submit.disabled = true;
    }
  }

  function scheduleParse() {
    window.clearTimeout(parseTimer);
    parseTimer = window.setTimeout(() => parse(source?.value), PARSE_DEBOUNCE_MS);
  }

  function open() {
    if (typeof dialog.showModal === "function" && !dialog.open) dialog.showModal();
    else dialog.setAttribute("open", "");
    window.requestAnimationFrame(() => source?.focus());
  }

  function close() {
    if (typeof dialog.close === "function" && dialog.open) dialog.close();
    else dialog.removeAttribute("open");
  }

  async function readFile(file) {
    if (!file) return;
    try {
      const text = await file.text();
      if (source) source.value = text;
      parse(text);
    } catch {
      renderPreview(preview, { error: "That file could not be read." });
    }
  }

  openButton.addEventListener("click", open);
  closeButton?.addEventListener("click", close);
  source?.addEventListener("input", scheduleParse);
  fileButton?.addEventListener("click", () => fileInput?.click());
  fileInput?.addEventListener("change", () => {
    readFile(fileInput.files?.[0]);
    fileInput.value = "";
  });

  // Drag a .tf file straight onto the dialog.
  dialog.addEventListener("dragover", (event) => {
    event.preventDefault();
    dialog.classList.add("is-dropping");
  });
  dialog.addEventListener("dragleave", () => dialog.classList.remove("is-dropping"));
  dialog.addEventListener("drop", (event) => {
    event.preventDefault();
    dialog.classList.remove("is-dropping");
    readFile(event.dataTransfer?.files?.[0]);
  });

  submit?.addEventListener("click", () => {
    if (!parsed) return;
    try {
      const outcome = studio.adoptArchitecture(parsed, "Infrastructure imported");
      const parts = [
        `${outcome.imported} service${outcome.imported === 1 ? "" : "s"} imported`,
        `${outcome.connections} path${outcome.connections === 1 ? "" : "s"}`,
      ];
      if (outcome.skipped.length) {
        parts.push(`${outcome.skipped.length} without an icon skipped`);
      }
      say(parts.join(" · "));
      close();
      studio.refreshLayout?.();
    } catch (error) {
      renderPreview(preview, { error: error.message || "That architecture could not be applied." });
    }
  });

  return { open, close, parse };
}
