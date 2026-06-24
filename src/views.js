/**
 * Workspace view switcher.
 *
 * Toggles between the full "Command Atlas" workspace and a dedicated, full-screen
 * "Flow Studio" screen. The choice persists across visits and broadcasts an
 * `atlas:viewchange` event so the entry point can lazily boot Flow Studio and
 * re-flow its canvas when it first becomes visible.
 */

const STORAGE_KEY = "aws-command-atlas-view";
const VIEWS = ["atlas", "studio"];

export function initViews() {
  const tabs = [...document.querySelectorAll("[data-view-target]")];
  const views = [...document.querySelectorAll(".view[data-view]")];
  const shell = document.querySelector(".app-shell");
  if (!tabs.length || !views.length) return null;

  function setView(name) {
    const view = VIEWS.includes(name) ? name : "atlas";
    views.forEach((section) =>
      section.classList.toggle("is-active", section.dataset.view === view)
    );
    tabs.forEach((tab) => {
      const on = tab.dataset.viewTarget === view;
      tab.classList.toggle("is-active", on);
      tab.setAttribute("aria-selected", String(on));
    });
    if (shell) shell.dataset.activeView = view;
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch {
      /* storage unavailable */
    }
    window.dispatchEvent(new CustomEvent("atlas:viewchange", { detail: { view } }));
  }

  tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.viewTarget)));

  let initial = "atlas";
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && VIEWS.includes(stored)) initial = stored;
  } catch {
    /* ignore */
  }
  setView(initial);

  return { setView };
}
