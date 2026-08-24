// @vitest-environment jsdom
/* global document, localStorage, window */

import { beforeEach, describe, expect, it } from "vitest";
import {
  initCanvasFocus,
  labelForView,
  PANELS,
  readCanvasFocusPreferences,
  resolvePanel,
  writeCanvasFocusPreferences,
} from "../src/canvas-focus.js";

function mount() {
  document.body.innerHTML = `
    <main class="app-shell" data-active-view="studio">
      <header>
        <nav class="workspace-nav">
          <details class="workspace-menu" id="workspaceMenu">
            <summary><span id="workspaceMenuLabel">Explore</span></summary>
            <div class="workspace-menu-list">
              <button data-view-target="home">Explore</button>
              <button data-view-target="studio">AWS Studio</button>
            </div>
          </details>
        </nav>
        <button id="studioDrawerToggle" aria-pressed="false" aria-expanded="false"></button>
      </header>
      <div class="flow-studio is-library-collapsed is-inspector-collapsed is-focus-mode">
        <div class="flow-workspace">
          <div class="studio-drawer-tabs">
            <button data-drawer-panel="library" aria-selected="true"></button>
            <button data-drawer-panel="insights" aria-selected="false"></button>
            <button id="studioDrawerClose"></button>
          </div>
          <aside class="flow-library" id="flowLibrary"></aside>
          <aside class="flow-inspector" id="flowInspector"></aside>
        </div>
      </div>
    </main>`;
}

const studio = () => document.querySelector(".flow-studio");
const toggle = () => document.getElementById("studioDrawerToggle");
const tab = (panel) => document.querySelector(`[data-drawer-panel="${panel}"]`);

describe("canvas focus helpers", () => {
  it("normalises panel names", () => {
    expect(resolvePanel("insights")).toBe("insights");
    expect(resolvePanel("library")).toBe("library");
    expect(resolvePanel("nonsense")).toBe("library");
    expect(resolvePanel(undefined)).toBe("library");
    expect(PANELS).toEqual(["library", "insights"]);
  });

  it("labels every workspace and falls back safely", () => {
    expect(labelForView("studio")).toBe("AWS Studio");
    expect(labelForView("network")).toBe("Network Lab");
    expect(labelForView("review")).toBe("Review");
    expect(labelForView(undefined)).toBe("Explore");
    expect(labelForView("bogus")).toBe("Explore");
  });

  it("survives unreadable or corrupt storage", () => {
    const throwing = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    expect(readCanvasFocusPreferences(throwing)).toEqual({});
    expect(() => writeCanvasFocusPreferences(throwing, { open: true })).not.toThrow();

    const corrupt = { getItem: () => "{not json", setItem: () => {} };
    expect(readCanvasFocusPreferences(corrupt)).toEqual({});
  });

  it("round-trips preferences", () => {
    const store = new Map();
    const storage = {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    };
    writeCanvasFocusPreferences(storage, { panel: "insights", open: true });
    expect(readCanvasFocusPreferences(storage)).toEqual({ panel: "insights", open: true });
  });
});

describe("canvas focus drawer", () => {
  beforeEach(() => {
    localStorage.clear();
    mount();
  });

  it("enables the canvas layout and clears superseded panel modes", () => {
    initCanvasFocus();
    expect(studio().classList.contains("is-canvas-focus")).toBe(true);
    // These older modes hide the panels with `display: none`, which would keep
    // the drawer permanently empty.
    expect(studio().classList.contains("is-library-collapsed")).toBe(false);
    expect(studio().classList.contains("is-inspector-collapsed")).toBe(false);
    expect(studio().classList.contains("is-focus-mode")).toBe(false);
  });

  it("starts closed, with both panels inert", () => {
    initCanvasFocus();
    expect(studio().dataset.drawer).toBeUndefined();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("flowLibrary").inert).toBe(true);
    expect(document.getElementById("flowInspector").inert).toBe(true);
  });

  it("opens on the library and only un-inerts the visible panel", () => {
    initCanvasFocus();
    toggle().click();
    expect(studio().dataset.drawer).toBe("library");
    expect(toggle().getAttribute("aria-pressed")).toBe("true");
    expect(document.getElementById("flowLibrary").inert).toBe(false);
    expect(document.getElementById("flowInspector").inert).toBe(true);
    expect(tab("library").getAttribute("aria-selected")).toBe("true");
  });

  it("switches panels without closing", () => {
    const api = initCanvasFocus();
    toggle().click();
    tab("insights").click();
    expect(studio().dataset.drawer).toBe("insights");
    expect(api.currentPanel()).toBe("insights");
    expect(document.getElementById("flowInspector").inert).toBe(false);
    expect(document.getElementById("flowLibrary").inert).toBe(true);
  });

  it("closes when the open panel's own tab is clicked again", () => {
    initCanvasFocus();
    toggle().click();
    expect(studio().dataset.drawer).toBe("library");
    tab("library").click();
    expect(studio().dataset.drawer).toBeUndefined();
  });

  it("closes from the toggle, the close button, and Escape", () => {
    const api = initCanvasFocus();

    toggle().click();
    toggle().click();
    expect(api.isOpen()).toBe(false);

    toggle().click();
    document.getElementById("studioDrawerClose").click();
    expect(api.isOpen()).toBe(false);

    toggle().click();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(api.isOpen()).toBe(false);
  });

  it("restores the last panel and open state on the next visit", () => {
    const first = initCanvasFocus();
    first.setPanel("insights");
    expect(first.isOpen()).toBe(true);

    mount();
    const second = initCanvasFocus();
    expect(second.isOpen()).toBe(true);
    expect(second.currentPanel()).toBe("insights");
    expect(studio().dataset.drawer).toBe("insights");
  });

  it("tracks the active workspace in the dropdown label", () => {
    initCanvasFocus();
    window.dispatchEvent(
      new window.CustomEvent("atlas:viewchange", { detail: { view: "network" } })
    );
    expect(document.getElementById("workspaceMenuLabel").textContent).toBe("Network Lab");
  });

  it("closes the dropdown after a workspace is chosen", () => {
    initCanvasFocus();
    const menu = document.getElementById("workspaceMenu");
    menu.open = true;
    document.querySelector('[data-view-target="studio"]').click();
    expect(menu.open).toBe(false);
  });

  it("degrades to a no-op when the studio is absent", () => {
    document.body.innerHTML = `<main class="app-shell"></main>`;
    const api = initCanvasFocus();
    expect(api.isOpen()).toBe(false);
    expect(() => api.setPanel("library")).not.toThrow();
    expect(() => api.closeDrawer()).not.toThrow();
  });
});
