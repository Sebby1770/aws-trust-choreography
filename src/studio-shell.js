/**
 * Workspace chrome shared by the full-screen editors (AWS Diagram Studio and
 * Network Lab): the Maximise mode that hides site navigation, per-view body
 * classes for layout, and the studio's keyboard-shortcut dialog.
 *
 * Diagram state belongs to the editors; this only stores presentation
 * preferences.
 */

const STORAGE_KEY = "trust-choreography:studio-ui:v1";

function readPreferences() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function writePreferences(preferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* The editors remain fully usable when storage is unavailable. */
  }
}

export function initStudioShell() {
  const shell = document.querySelector(".app-shell");
  if (!shell || shell.dataset.shellInitialized === "true") return null;

  const siteHeader = document.querySelector("#siteHeader");
  const workspaceChromeToggle = document.querySelector("#workspaceChromeToggle");
  const workspaceChromeRestore = document.querySelector("#workspaceChromeRestore");
  const helpDialog = document.querySelector("#studioHelpDialog");
  const helpClose = document.querySelector("#studioHelpClose");
  const preferences = readPreferences();
  let activeView = shell.dataset.activeView || "home";
  let workspaceMaximised = Boolean(preferences.workspaceMaximised);

  function refreshLayout() {
    window.requestAnimationFrame(() => window.AWSFlowStudio?.refreshLayout?.());
  }

  function syncWorkspaceChrome({ focus = null } = {}) {
    const isEditorView = activeView === "studio" || activeView === "network";
    const isMaximised = workspaceMaximised && isEditorView;
    shell.classList.toggle("is-workspace-maximised", isMaximised);
    document.body.classList.toggle("is-workspace-maximised", isMaximised);
    workspaceChromeToggle?.setAttribute("aria-pressed", String(isMaximised));
    workspaceChromeRestore?.setAttribute("aria-expanded", String(!isMaximised));
    if (siteHeader) {
      if (isMaximised) siteHeader.setAttribute("aria-hidden", "true");
      else siteHeader.removeAttribute("aria-hidden");
    }
    if (workspaceChromeRestore) workspaceChromeRestore.hidden = !isMaximised;

    window.requestAnimationFrame(() => {
      if (focus === "restore") workspaceChromeRestore?.focus();
      if (focus === "toggle") workspaceChromeToggle?.focus();
      refreshLayout();
      window.dispatchEvent(
        new CustomEvent("atlas:workspacechromechange", {
          detail: { maximised: isMaximised, view: activeView },
        })
      );
    });
  }

  function setWorkspaceMaximised(maximised, { save = true, focus = null } = {}) {
    workspaceMaximised = Boolean(maximised);
    if (save) writePreferences({ ...readPreferences(), workspaceMaximised });
    syncWorkspaceChrome({ focus });
  }

  function closeHelp() {
    if (!helpDialog) return;
    if (typeof helpDialog.close === "function") helpDialog.close();
    else helpDialog.removeAttribute("open");
  }

  workspaceChromeToggle?.addEventListener("click", () => {
    setWorkspaceMaximised(true, { focus: "restore" });
  });
  workspaceChromeRestore?.addEventListener("click", () => {
    setWorkspaceMaximised(false, { focus: "toggle" });
  });
  helpClose?.addEventListener("click", closeHelp);
  helpDialog?.addEventListener("click", (event) => {
    if (event.target === helpDialog) closeHelp();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (helpDialog?.open) {
      closeHelp();
      return;
    }
    // Escape inside an editor belongs to the editor (deselect, cancel).
    const target = event.target;
    if (target instanceof Element && target.closest(".diagram-studio")) return;
    if (shell.classList.contains("is-workspace-maximised")) {
      setWorkspaceMaximised(false, { focus: "toggle" });
    }
  });

  window.addEventListener("atlas:viewchange", (event) => {
    const view = event.detail?.view;
    activeView = view || "home";
    document.body.classList.toggle("is-studio-view", view === "studio");
    document.body.classList.toggle("is-network-view", view === "network");
    if (view === "studio" || view === "network") {
      window.scrollTo({ top: 0, left: 0 });
    }
    syncWorkspaceChrome();
  });

  syncWorkspaceChrome();
  shell.dataset.shellInitialized = "true";

  return { setWorkspaceMaximised, refreshLayout };
}
