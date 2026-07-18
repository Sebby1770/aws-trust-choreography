/**
 * Progressive editor shell shared by the full-screen AWS and network views.
 *
 * The architecture data remains owned by Flow Studio. This module only stores
 * presentation preferences such as Guided/Pro and panel visibility.
 */

const STORAGE_KEY = "trust-choreography:studio-ui:v1";

function readPreferences() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "null");
    return stored && typeof stored === "object" ? stored : null;
  } catch {
    return null;
  }
}

function writePreferences(preferences) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* The editor remains fully usable when storage is unavailable. */
  }
}

export function initStudioShell() {
  const studio = document.querySelector(".flow-studio");
  if (!studio || studio.dataset.shellInitialized === "true") return null;

  const library = document.querySelector(".flow-library");
  const inspector = document.querySelector(".flow-inspector");
  const canvas = document.querySelector("#flowCanvas");
  const libraryToggle = document.querySelector("#flowLibraryToggle");
  const libraryClose = document.querySelector("#flowLibraryClose");
  const inspectorToggles = [
    document.querySelector("#flowInspectorToggle"),
    document.querySelector("#flowInspectorToggleCompact"),
  ].filter(Boolean);
  const focusButton = document.querySelector("#flowFocusButton");
  const experienceButtons = [...document.querySelectorAll("button[data-studio-experience]")];
  const helpButton = document.querySelector("#flowHelpButton");
  const helpDialog = document.querySelector("#studioHelpDialog");
  const helpClose = document.querySelector("#studioHelpClose");
  const mobileLibraryMedia = window.matchMedia("(max-width: 760px)");
  const compactInspectorMedia = window.matchMedia("(max-width: 1050px)");
  const preferences = readPreferences() || {
    experience: "guided",
    inspectorCollapsed: true,
  };

  function refreshLayout() {
    window.requestAnimationFrame(() => window.AWSFlowStudio?.refreshLayout?.());
  }

  function persist() {
    writePreferences({
      experience: studio.dataset.studioExperience,
      inspectorCollapsed: studio.classList.contains("is-inspector-collapsed"),
    });
  }

  function syncInspectorControls(collapsed) {
    const visuallyCollapsed = collapsed || studio.classList.contains("is-focus-mode");
    inspectorToggles.forEach((button) => {
      button.setAttribute("aria-expanded", String(!visuallyCollapsed));
      button.setAttribute("aria-pressed", String(!visuallyCollapsed));
    });
  }

  function setInspectorCollapsed(collapsed, { save = true } = {}) {
    const focusWasInside = collapsed && inspector?.contains(document.activeElement);
    studio.classList.toggle("is-inspector-collapsed", collapsed);
    syncInspectorControls(collapsed);
    if (save) persist();
    refreshLayout();
    if (focusWasInside) {
      window.requestAnimationFrame(() => {
        inspectorToggles.find((button) => button.offsetParent !== null)?.focus();
        if (!document.activeElement?.matches?.("[aria-controls='flowInspector']")) {
          inspectorToggles[0]?.focus();
        }
      });
    }
  }

  function setLibraryCollapsed(collapsed, { restoreFocus = false } = {}) {
    studio.classList.toggle("is-library-collapsed", collapsed);
    libraryToggle?.setAttribute(
      "aria-expanded",
      String(!collapsed && !studio.classList.contains("is-focus-mode"))
    );
    refreshLayout();
    if (restoreFocus) window.requestAnimationFrame(() => libraryToggle?.focus());
  }

  function setExperience(requested, { save = true } = {}) {
    const experience = requested === "pro" ? "pro" : "guided";
    studio.dataset.studioExperience = experience;
    experienceButtons.forEach((button) => {
      const active = button.dataset.studioExperience === experience;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (save) persist();
    refreshLayout();
  }

  function setFocusMode(active) {
    studio.classList.toggle("is-focus-mode", active);
    focusButton?.setAttribute("aria-pressed", String(active));
    syncInspectorControls(studio.classList.contains("is-inspector-collapsed"));
    libraryToggle?.setAttribute(
      "aria-expanded",
      String(!active && !studio.classList.contains("is-library-collapsed"))
    );
    refreshLayout();
  }

  experienceButtons.forEach((button) => {
    button.addEventListener("click", () => setExperience(button.dataset.studioExperience));
  });
  inspectorToggles.forEach((button) => {
    button.addEventListener("click", () => {
      setInspectorCollapsed(!studio.classList.contains("is-inspector-collapsed"));
    });
  });
  focusButton?.addEventListener("click", () => {
    setFocusMode(!studio.classList.contains("is-focus-mode"));
  });
  libraryToggle?.addEventListener("click", () => {
    window.requestAnimationFrame(() => {
      const collapsed = studio.classList.contains("is-library-collapsed");
      libraryToggle.setAttribute("aria-expanded", String(!collapsed));
      refreshLayout();
    });
  });
  libraryClose?.addEventListener("click", () => {
    setLibraryCollapsed(true, { restoreFocus: true });
  });

  studio.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (
      studio.dataset.studioExperience === "guided" &&
      target.closest(".flow-node, [data-connection-id]")
    ) {
      setInspectorCollapsed(false);
    }
    if (target.closest("[data-flow-template]")) {
      target.closest(".flow-template-menu")?.removeAttribute("open");
    }
    if (target.closest(".flow-export-actions button")) {
      target.closest(".flow-export-menu")?.removeAttribute("open");
    }
  });

  function openHelp() {
    if (!helpDialog) return;
    if (typeof helpDialog.showModal === "function") helpDialog.showModal();
    else helpDialog.setAttribute("open", "");
  }

  function closeHelp() {
    if (!helpDialog) return;
    if (typeof helpDialog.close === "function") helpDialog.close();
    else helpDialog.removeAttribute("open");
  }

  helpButton?.addEventListener("click", openHelp);
  helpClose?.addEventListener("click", closeHelp);
  helpDialog?.addEventListener("click", (event) => {
    if (event.target === helpDialog) closeHelp();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (helpDialog?.open) {
      closeHelp();
      return;
    }
    const studioView = studio.closest(".view");
    if (!studioView?.classList.contains("is-active")) return;
    if (studio.classList.contains("is-focus-mode")) {
      setFocusMode(false);
    } else if (
      studio.dataset.studioExperience === "guided" ||
      window.matchMedia("(max-width: 1050px)").matches
    ) {
      setInspectorCollapsed(true);
    }
  });

  window.addEventListener("atlas:viewchange", (event) => {
    const view = event.detail?.view;
    document.body.classList.toggle("is-studio-view", view === "studio");
    document.body.classList.toggle("is-network-view", view === "network");
    if (view === "studio" || view === "network") {
      window.scrollTo({ top: 0, left: 0 });
    }
    refreshLayout();
  });

  if (typeof ResizeObserver === "function" && canvas) {
    const observer = new ResizeObserver(refreshLayout);
    observer.observe(canvas);
  }

  if (library) library.id ||= "flowLibrary";
  if (inspector) inspector.id ||= "flowInspector";
  libraryToggle?.setAttribute("aria-expanded", "true");
  setExperience(preferences.experience, { save: false });
  setInspectorCollapsed(Boolean(preferences.inspectorCollapsed), { save: false });
  if (mobileLibraryMedia.matches) setLibraryCollapsed(true);
  if (compactInspectorMedia.matches) setInspectorCollapsed(true, { save: false });
  mobileLibraryMedia.addEventListener?.("change", (event) => {
    if (event.matches) setLibraryCollapsed(true);
  });
  compactInspectorMedia.addEventListener?.("change", (event) => {
    if (event.matches) setInspectorCollapsed(true, { save: false });
  });
  studio.dataset.shellInitialized = "true";

  return { setExperience, setInspectorCollapsed, setFocusMode, refreshLayout };
}
