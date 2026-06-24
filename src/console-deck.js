/**
 * Operations console module switcher.
 *
 * The right-hand console hosts several modules — Incident inspector, Telemetry,
 * Active runbook, Control posture, Operating doctrine — and a dropdown chooses
 * which one is visible. The atlas controller keeps populating every module by id
 * regardless of which is shown, so this only toggles visibility.
 */

export function initConsoleDeck() {
  const select = document.querySelector("#consoleModule");
  const title = document.querySelector("#consoleModuleTitle");
  const modules = [...document.querySelectorAll(".console-module[data-module]")];
  if (!select || !modules.length) return;

  function show(name) {
    modules.forEach((module) => {
      module.hidden = module.dataset.module !== name;
    });
    const option = select.querySelector(`option[value="${name}"]`);
    if (title && option) title.textContent = option.textContent.trim();
  }

  select.addEventListener("change", () => show(select.value));
  show(select.value);
}
