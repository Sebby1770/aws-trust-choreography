/**
 * Workspace view switcher.
 *
 * The project launchpad is the front door, with Flow Studio and the Command
 * Atlas as focused workspaces. Header buttons switch between them. The choice
 * persists across visits and broadcasts an `atlas:viewchange` event so the
 * entry point can lazily boot Flow Studio and re-flow its canvas when visible.
 */

const STORAGE_KEY = "aws-command-atlas-view-v2";
const VIEWS = ["home", "studio", "network", "sql", "review"];
const LEGACY_VIEWS = { atlas: "review" };
const DEFAULT_VIEW = "home";

export function initViews() {
  const tabs = [...document.querySelectorAll("[data-view-target]")];
  const select = document.querySelector("#workspaceSelect");
  const views = [...document.querySelectorAll(".view[data-view]")];
  const shell = document.querySelector(".app-shell");
  if (!views.length) return null;

  function setView(name) {
    const requested = LEGACY_VIEWS[name] || name;
    const view = VIEWS.includes(requested) ? requested : DEFAULT_VIEW;
    views.forEach((section) =>
      section.classList.toggle("is-active", section.dataset.view === view)
    );
    tabs.forEach((tab) => {
      const on = tab.dataset.viewTarget === view;
      tab.classList.toggle("is-active", on);
      tab.removeAttribute("aria-selected");
      if (tab.closest(".workspace-nav")) {
        if (on) tab.setAttribute("aria-current", "page");
        else tab.removeAttribute("aria-current");
      }
    });
    if (select && select.value !== view) select.value = view;
    if (shell) shell.dataset.activeView = view;
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new CustomEvent("atlas:viewchange", { detail: { view } }));
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.viewTarget)));
  if (select) select.addEventListener("change", () => setView(select.value));

  let initial = DEFAULT_VIEW;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) initial = LEGACY_VIEWS[stored] || stored;
  } catch {
    /* ignore */
  }
  setView(initial);

  return { setView };
}
