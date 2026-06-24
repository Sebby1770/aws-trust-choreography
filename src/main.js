/**
 * Application entry point.
 *
 * Boots the lightweight incident-command atlas immediately, then lazily
 * initializes the heavier Flow Studio (and its 327 KB icon catalog) off the
 * critical path. The studio loads as soon as it nears the viewport, and an
 * idle-time fallback guarantees it initializes even if the user never scrolls
 * (or IntersectionObserver does not fire). This keeps first paint fast while
 * still loading everything before the user can interact with it.
 */

import { initAtlas } from "./atlas.js";
import { initTheme } from "./theme.js";
import { loadIconCatalog } from "./icon-catalog.js";
import { AI_ICONS } from "./ai-icons.js";
import { initViews } from "./views.js";
import { initConsoleDeck } from "./console-deck.js";

function ready(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

ready(() => {
  const theme = initTheme(document.querySelector("#themeButton"));
  initAtlas({ theme });
  initConsoleDeck();

  const studio = document.querySelector(".flow-studio");
  if (!studio) {
    initViews();
    return;
  }

  let started = false;
  const boot = async () => {
    if (started) return;
    started = true;
    const status = document.querySelector("#flowStatusMessage");
    if (status) status.textContent = "Loading icon library…";
    try {
      const { initFlowStudio } = await import("./flow-studio.js");
      const { catalog, meta } = await loadIconCatalog();
      // AI / LLM building blocks lead the catalog so they are easy to find.
      initFlowStudio([...AI_ICONS, ...catalog], { ...meta, aiCount: AI_ICONS.length });
    } catch (error) {
      if (status) status.textContent = "Flow Studio failed to load. Reload to retry.";
      console.error("Flow Studio failed to initialize:", error);
    }
  };

  // Eager path: load as soon as the studio nears the viewport.
  if (typeof IntersectionObserver === "function") {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          boot();
        }
      },
      { rootMargin: "600px" }
    );
    observer.observe(studio);
  }

  // Fallback: once first paint has settled, load during idle time regardless of
  // scroll position so the studio is always ready. `boot` is idempotent.
  const idleBoot = () => boot();
  if (typeof requestIdleCallback === "function") {
    requestIdleCallback(idleBoot, { timeout: 4000 });
  } else {
    window.addEventListener("load", () => window.setTimeout(idleBoot, 1500), { once: true });
  }

  // When the user opens the Flow Studio screen, make sure it is booted and let
  // its canvas re-measure now that it is visible (it lays out from real sizes).
  window.addEventListener("atlas:viewchange", (event) => {
    if (event.detail?.view !== "studio") return;
    Promise.resolve(boot()).then(() => {
      window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")));
    });
  });

  // Mount the workspace switcher last so its initial event reaches the listener.
  initViews();
});
