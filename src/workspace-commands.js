/** Global command palette for navigation, appearance, and review actions. */

import { initCommandPalette } from "./command-palette.js";

export function initWorkspaceCommands({ navigate, theme, getReviewCenter } = {}) {
  const viewCommands = [
    ["home", "Explore", "projects templates start home"],
    ["studio", "AWS Studio", "cloud architecture build aws"],
    ["network", "Network Lab", "cisco packet topology devices"],
    ["review", "Review", "readiness findings audit evidence report"],
  ];

  function commands() {
    const items = viewCommands.map(([view, label, keywords]) => ({
      id: `view:${view}`,
      group: "Navigate",
      label: `Open ${label}`,
      keywords,
      run: () => navigate?.(view),
    }));

    if (theme?.setMode) {
      ["system", "light", "dark"].forEach((mode) => {
        items.push({
          id: `theme:${mode}`,
          group: "Appearance",
          label: `Theme — ${mode}`,
          hint: theme.mode === mode ? "active" : "",
          keywords: "theme appearance colour color",
          run: () => theme.setMode(mode),
        });
      });
    }

    items.push(
      {
        id: "review:refresh",
        group: "Review",
        label: "Refresh design review",
        keywords: "review recalculate readiness score",
        run: () => {
          navigate?.("review");
          getReviewCenter?.()?.refresh({ announceUpdate: true });
        },
      },
      {
        id: "review:copy",
        group: "Review",
        label: "Copy design review",
        keywords: "report clipboard markdown handoff",
        run: () => getReviewCenter?.()?.copy(),
      },
      {
        id: "review:download",
        group: "Review",
        label: "Download design review (Markdown)",
        keywords: "report export markdown handoff",
        run: () => getReviewCenter?.()?.downloadMarkdown(),
      }
    );
    return items;
  }

  const palette = initCommandPalette(commands);
  document.querySelector("#commandButton")?.addEventListener("click", palette.open);
  return palette;
}
