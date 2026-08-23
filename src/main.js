/**
 * Application entry point.
 *
 * Boots the shared workspace shell and network lab immediately, then lazily
 * initializes Flow Studio and its large icon catalog. Review Center consumes
 * the live state of both builders once they are ready.
 */

import { initTheme } from "./theme.js";
import { loadIconCatalog } from "./icon-catalog.js";
import { AI_ICONS } from "./ai-icons.js";
import { initViews } from "./views.js";
import { initAnimatedContent } from "./animated-content.js";
import { initSpotlight } from "./spotlight.js";
import { initProjectLaunchpad } from "./project-launchpad.js";
import { initNetworkLab } from "./network-lab.js";
import { initStudioShell } from "./studio-shell.js";
import { initReviewCenter } from "./review-center.js";
import { initWorkspaceCommands } from "./workspace-commands.js";

function ready(fn) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
}

ready(() => {
  const theme = initTheme(document.querySelector("#themeButton"));
  initAnimatedContent();
  initSpotlight();
  const studioShell = initStudioShell();
  const networkLab = initNetworkLab();
  let reviewCenter = null;
  let views = null;

  const studio = document.querySelector(".flow-studio");
  if (!studio) {
    initViews();
    return;
  }

  let bootPromise = null;
  const boot = () => {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      const status = document.querySelector("#flowStatusMessage");
      if (status) status.textContent = "Loading icon library…";
      try {
        const { initFlowStudio } = await import("./flow-studio.js");
        const { catalog, meta } = await loadIconCatalog();
        // AI / LLM building blocks lead the catalog so they are easy to find.
        initFlowStudio([...AI_ICONS, ...catalog], { ...meta, aiCount: AI_ICONS.length });
        const { initStudioSessions } = await import("./studio-sessions.js");
        initStudioSessions();
        const { initStudioExtras } = await import("./studio-extras.js");
        initStudioExtras();
        const { initIacImport } = await import("./iac-import-ui.js");
        initIacImport();
        window.dispatchEvent(new CustomEvent("atlas:studioready"));
        return window.AWSFlowStudio;
      } catch (error) {
        if (status) status.textContent = "Flow Studio failed to load. Reload to retry.";
        console.error("Flow Studio failed to initialize:", error);
        return null;
      }
    })();
    return bootPromise;
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

  // Boot or re-measure the relevant workspace when a global view is opened.
  window.addEventListener("atlas:viewchange", (event) => {
    const view = event.detail?.view;
    if (view === "network") {
      window.requestAnimationFrame(() => networkLab?.refreshLayout?.());
      return;
    }
    if (view === "review") {
      Promise.resolve(boot()).then(() => reviewCenter?.refresh());
      return;
    }
    if (view !== "studio") return;
    Promise.resolve(boot()).then((flowStudio) => {
      window.requestAnimationFrame(() => flowStudio?.refreshLayout?.());
    });
  });

  // Mount navigation after the view-change listener so its initial event is observed.
  views = initViews();
  reviewCenter = initReviewCenter({
    getAwsState: () => window.AWSFlowStudio?.getState?.() || null,
    getNetworkState: () => networkLab?.getState?.() || null,
    navigate: (view) => views?.setView(view),
    revealTarget: async (target) => {
      if (target?.view === "studio") {
        const flowStudio = await boot();
        studioShell?.setFocusMode?.(false);
        if (target.kind === "library") studioShell?.setLibraryCollapsed?.(false);
        else studioShell?.setInspectorCollapsed?.(false);
        return new Promise((resolve) => {
          window.requestAnimationFrame(() => resolve(Boolean(flowStudio?.reveal?.(target))));
        });
      }
      if (target?.view === "network") {
        return new Promise((resolve) => {
          window.requestAnimationFrame(() => resolve(Boolean(networkLab?.reveal?.(target))));
        });
      }
      return false;
    },
  });
  initWorkspaceCommands({
    navigate: (view) => views?.setView(view),
    theme,
    getReviewCenter: () => reviewCenter,
  });
  initProjectLaunchpad({
    launch: async (project) => {
      views?.setView("studio");
      window.scrollTo({ top: 0, left: 0 });
      const flowStudio = await boot();
      if (!flowStudio) return;
      flowStudio.createProject(project);
      window.requestAnimationFrame(() => {
        flowStudio.refreshLayout?.();
        document.querySelector("#flowArchitectureName")?.focus();
      });
    },
  });
});
