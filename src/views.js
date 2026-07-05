/**
 * Workspace view switcher.
 *
 * Flow Studio is the main screen; the Command Atlas incident workbench is the
 * second workspace. A header dropdown (plus any legacy tab buttons) switches
 * between them. The choice persists across visits and broadcasts an
 * `atlas:viewchange` event so the entry point can lazily boot Flow Studio and
 * re-flow its canvas when it becomes visible.
 */

const STORAGE_KEY = "aws-command-atlas-view";
const VIEWS = ["studio", "atlas"];
const DEFAULT_VIEW = "studio";

export function initViews() {
  const tabs = [...document.querySelectorAll("[data-view-target]")];
  const select = document.querySelector("#workspaceSelect");
  const views = [...document.querySelectorAll(".view[data-view]")];
  const shell = document.querySelector(".app-shell");
  if (!views.length) return null;

  function setView(name) {
    const view = VIEWS.includes(name) ? name : DEFAULT_VIEW;
    views.forEach((section) =>
      section.classList.toggle("is-active", section.dataset.view === view)
    );
    tabs.forEach((tab) => {
      const on = tab.dataset.viewTarget === view;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
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
    if (stored && VIEWS.includes(stored)) initial = stored;
  } catch {
    /* ignore */
  }
  setView(initial);

  return { setView };
}
