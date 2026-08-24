/**
 * Canvas focus — canvas-only labs.
 *
 * Both labs shipped the same shape: strips of chrome above the drawing
 * surface, a status bar below it, and a fixed library column and inspector
 * column either side. This leaves the canvas alone on screen and moves every
 * one of those controls into a single slide-over drawer, opened from the
 * header, with Library / Tools / Insights tabs.
 *
 * The chrome is *relocated at runtime*, not duplicated and not deleted: the
 * markup in index.html is untouched, so every listener the labs attach by id
 * or attribute keeps working on the very same element after the move.
 */

const STORAGE_KEY = "aws-command-atlas-canvas-focus-v2";
export const PANELS = ["library", "tools", "insights"];

const VIEW_LABELS = {
  home: "Explore",
  studio: "AWS Studio",
  network: "Network Lab",
  sql: "SQL Review",
  review: "Review",
};

/**
 * Per-lab wiring. `chrome` is listed in the order it should appear in the
 * Tools panel; anything missing is skipped, so a lab can drop a control
 * without breaking the drawer.
 */
export const LABS = [
  {
    id: "studio",
    root: ".flow-studio",
    workspace: ".flow-workspace",
    library: "#flowLibrary",
    inspector: "#flowInspector",
    chrome: [
      ".flow-canvas-titlebar",
      ".flow-toolbar",
      ".studio-experience",
      ".flow-studio-meta",
      ".flow-simulation",
      ".flow-statusbar",
    ],
  },
  {
    id: "network",
    root: ".network-lab",
    workspace: ".network-workspace",
    library: "#networkPalette",
    inspector: "#networkInspector",
    chrome: [
      ".network-canvas-titlebar",
      ".network-toolbar",
      ".network-lab-meta",
      ".network-packet-bar",
      ".network-statusbar",
    ],
  },
];

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

/**
 * Build the drawer for one lab: a Tools panel holding the relocated chrome,
 * plus the tab strip that switches between the three panels.
 *
 * Returns null when the lab is not in the document.
 */
export function buildLabDrawer(lab, root) {
  // `root` is usually `document`, whose `ownerDocument` is null — fall back to
  // the node itself so element creation works for both a document and a
  // detached subtree.
  const doc = root.ownerDocument || root;
  const labRoot = root.querySelector(lab.root);
  const workspace = labRoot?.querySelector(lab.workspace);
  if (!labRoot || !workspace) return null;

  labRoot.classList.add("is-canvas-focus");

  // Older per-panel collapse and focus modes hide these with `display: none`,
  // which would keep the drawer permanently empty.
  labRoot.classList.remove("is-library-collapsed", "is-inspector-collapsed", "is-focus-mode");

  let tools = workspace.querySelector(".lab-tools-panel");
  if (!tools) {
    tools = doc.createElement("aside");
    tools.className = "lab-tools-panel";
    tools.id = `${lab.id}ToolsPanel`;
    tools.setAttribute("aria-label", "Canvas tools");
    workspace.append(tools);
  }

  // Relocate rather than clone, so existing listeners come with the element.
  for (const selector of lab.chrome) {
    const node = labRoot.querySelector(selector);
    if (node && !tools.contains(node)) tools.append(node);
  }

  let tabs = workspace.querySelector(".lab-drawer-tabs");
  if (!tabs) {
    tabs = doc.createElement("div");
    tabs.className = "lab-drawer-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.setAttribute("aria-label", "Panel");
    tabs.innerHTML = PANELS.map(
      (panel) =>
        `<button type="button" role="tab" data-drawer-panel="${panel}" aria-selected="false">${
          panel === "library" ? "Library" : panel === "tools" ? "Tools" : "Insights"
        }</button>`
    ).join("");
    const close = doc.createElement("button");
    close.type = "button";
    close.className = "lab-drawer-close";
    close.setAttribute("aria-label", "Close panel");
    close.title = "Close panel";
    close.textContent = "×";
    tabs.append(close);
    workspace.append(tabs);
  }

  return {
    labRoot,
    tabs: [...tabs.querySelectorAll("[data-drawer-panel]")],
    close: tabs.querySelector(".lab-drawer-close"),
    panelFor(panel) {
      if (panel === "tools") return tools;
      return labRoot.querySelector(panel === "library" ? lab.library : lab.inspector);
    },
  };
}

export function initCanvasFocus({ root = document, storage = globalThis.localStorage } = {}) {
  const menu = root.querySelector("#workspaceMenu");
  const menuLabel = root.querySelector("#workspaceMenuLabel");
  const toggle = root.querySelector("#studioDrawerToggle");

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

  const drawers = LABS.map((lab) => buildLabDrawer(lab, root)).filter(Boolean);
  if (!drawers.length) {
    return {
      setPanel: () => {},
      closeDrawer: () => {},
      isOpen: () => false,
      currentPanel: () => null,
    };
  }

  const preferences = readCanvasFocusPreferences(storage);
  let panel = resolvePanel(preferences.panel);
  let open = preferences.open === true;

  function persist() {
    writeCanvasFocusPreferences(storage, { panel, open });
  }

  function render() {
    for (const drawer of drawers) {
      if (open) drawer.labRoot.dataset.drawer = panel;
      else delete drawer.labRoot.dataset.drawer;

      drawer.tabs.forEach((tab) => {
        tab.setAttribute("aria-selected", String(open && tab.dataset.drawerPanel === panel));
      });

      // A closed drawer must not leave focusable controls in the tab order.
      for (const name of PANELS) {
        const element = drawer.panelFor(name);
        if (element) element.inert = !(open && name === panel);
      }
    }

    if (toggle) {
      toggle.setAttribute("aria-pressed", String(open));
      toggle.setAttribute("aria-expanded", String(open));
    }

    // Canvases size themselves against their box, which changes when the
    // workspace reflows, so let each lab re-measure.
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

  for (const drawer of drawers) {
    drawer.tabs.forEach((tab) => {
      tab.addEventListener("click", () =>
        setPanel(tab.dataset.drawerPanel, { toggleWhenSame: true })
      );
    });
    drawer.close?.addEventListener("click", closeDrawer);
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) {
      closeDrawer();
      toggle?.focus();
    }
  });

  render();

  return { setPanel, closeDrawer, isOpen: () => open, currentPanel: () => panel };
}
