/**
 * Canvas focus — canvas-first studio layout.
 *
 * Collapses the studio chrome to a single strip and moves the icon library
 * and the insights inspector into one slide-over drawer, opened from the
 * header. The workspace nav becomes a dropdown so the header is one row.
 *
 * Deliberately additive: it toggles classes and a `data-drawer` attribute on
 * the existing markup rather than moving nodes, so every control the studio
 * already wired up keeps working untouched.
 */

const STORAGE_KEY = "aws-command-atlas-canvas-focus-v1";
export const PANELS = ["library", "insights"];

const VIEW_LABELS = {
  home: "Explore",
  studio: "AWS Studio",
  network: "Network Lab",
  review: "Review",
};

export function readCanvasFocusPreferences(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCanvasFocusPreferences(storage, preferences) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* storage unavailable — the layout still works, it just will not persist */
  }
}

/** Normalise a stored or requested panel name. */
export function resolvePanel(requested) {
  return PANELS.includes(requested) ? requested : "library";
}

export function labelForView(view) {
  return VIEW_LABELS[view] || VIEW_LABELS.home;
}

export function initCanvasFocus({ root = document, storage = globalThis.localStorage } = {}) {
  const studio = root.querySelector(".flow-studio");
  const menu = root.querySelector("#workspaceMenu");
  const menuLabel = root.querySelector("#workspaceMenuLabel");
  const toggle = root.querySelector("#studioDrawerToggle");
  const tabs = [...root.querySelectorAll("[data-drawer-panel]")];
  const closeButton = root.querySelector("#studioDrawerClose");

  // The dropdown is useful on its own even if the studio is not on the page.
  if (menu) {
    root.addEventListener("click", (event) => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
    menu.addEventListener("click", (event) => {
      if (event.target.closest("[data-view-target]")) menu.open = false;
    });
  }

  function syncMenuLabel(view) {
    if (menuLabel) menuLabel.textContent = labelForView(view);
  }

  globalThis.addEventListener?.("atlas:viewchange", (event) => {
    syncMenuLabel(event.detail?.view);
    if (menu) menu.open = false;
  });

  const shell = root.querySelector(".app-shell");
  syncMenuLabel(shell?.dataset.activeView);

  if (!studio) {
    return { setPanel: () => {}, closeDrawer: () => {}, isOpen: () => false };
  }

  const preferences = readCanvasFocusPreferences(storage);
  studio.classList.add("is-canvas-focus");

  // The drawer supersedes the older per-panel collapse and focus modes; left
  // set, their `display: none` would keep the drawer permanently empty.
  studio.classList.remove("is-library-collapsed", "is-inspector-collapsed", "is-focus-mode");

  let panel = resolvePanel(preferences.panel);
  let open = preferences.open === true;

  function persist() {
    writeCanvasFocusPreferences(storage, { panel, open });
  }

  function render() {
    if (open) studio.dataset.drawer = panel;
    else delete studio.dataset.drawer;

    if (toggle) {
      toggle.setAttribute("aria-pressed", String(open));
      toggle.setAttribute("aria-expanded", String(open));
    }
    tabs.forEach((tab) => {
      tab.setAttribute("aria-selected", String(open && tab.dataset.drawerPanel === panel));
    });

    // A closed drawer must not leave focusable controls in the tab order.
    const library = root.querySelector("#flowLibrary");
    const inspector = root.querySelector("#flowInspector");
    if (library) library.inert = !(open && panel === "library");
    if (inspector) inspector.inert = !(open && panel === "insights");

    // Connections are drawn against the canvas box, which changes width when
    // the workspace reflows, so let the studio re-measure.
    globalThis.dispatchEvent?.(new Event("resize"));
  }

  function setPanel(requested, { toggleWhenSame = false } = {}) {
    const next = resolvePanel(requested);
    if (open && next === panel && toggleWhenSame) {
      open = false;
    } else {
      panel = next;
      open = true;
    }
    persist();
    render();
  }

  function closeDrawer() {
    open = false;
    persist();
    render();
  }

  toggle?.addEventListener("click", () => {
    if (open) closeDrawer();
    else setPanel(panel);
  });

  tabs.forEach((tab) => {
    tab.addEventListener("click", () =>
      setPanel(tab.dataset.drawerPanel, { toggleWhenSame: true })
    );
  });

  closeButton?.addEventListener("click", closeDrawer);

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) {
      closeDrawer();
      toggle?.focus();
    }
  });

  render();

  return {
    setPanel,
    closeDrawer,
    isOpen: () => open,
    currentPanel: () => panel,
  };
}
