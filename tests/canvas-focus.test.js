// @vitest-environment jsdom
/* global document, localStorage, window */

import { beforeEach, describe, expect, it } from "vitest";
import {
  buildLabDrawer,
  initCanvasFocus,
  labelForView,
  LABS,
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

      <section class="network-lab">
        <header class="network-lab-head">
          <div class="network-lab-meta"></div>
          <div class="network-toolbar"><button data-network-mode="select"></button></div>
        </header>
        <div class="network-workspace">
          <aside class="network-palette" id="networkPalette"></aside>
          <section class="network-canvas-shell">
            <div class="network-canvas-titlebar"></div>
            <div class="network-canvas"></div>
            <div class="network-packet-bar"></div>
          </section>
          <aside class="network-inspector" id="networkInspector"></aside>
        </div>
        <footer class="network-statusbar"></footer>
      </section>
    </main>`;
}

const networkLab = () => document.querySelector(".network-lab");
const toggle = () => document.getElementById("studioDrawerToggle");
const tab = (panel, scope = ".network-workspace") =>
  document.querySelector(`${scope} [data-drawer-panel="${panel}"]`);

describe("canvas focus helpers", () => {
  it("normalises panel names", () => {
    expect(resolvePanel("insights")).toBe("insights");
    expect(resolvePanel("tools")).toBe("tools");
    expect(resolvePanel("nonsense")).toBe("library");
    expect(resolvePanel(undefined)).toBe("library");
    expect(PANELS).toEqual(["library", "tools", "insights"]);
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
    expect(readCanvasFocusPreferences({ getItem: () => "{not json" })).toEqual({});
  });

  it("round-trips preferences", () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    writeCanvasFocusPreferences(storage, { panel: "tools", open: true });
    expect(readCanvasFocusPreferences(storage)).toEqual({ panel: "tools", open: true });
  });
});

describe("lab drawer construction", () => {
  beforeEach(() => {
    localStorage.clear();
    mount();
  });

  it("moves the elements rather than copying them", () => {
    const toolbar = document.querySelector(".network-toolbar");
    buildLabDrawer(LABS[0], document);
    // Same node, so listeners attached before the move still fire.
    expect(document.getElementById("networkToolsPanel").querySelector(".network-toolbar")).toBe(
      toolbar
    );
    expect(document.querySelectorAll(".network-toolbar")).toHaveLength(1);
    expect(document.querySelector(".network-lab-head .network-toolbar")).toBeNull();
  });

  it("builds one tab strip with all three panels", () => {
    buildLabDrawer(LABS[0], document);
    expect(
      [...document.querySelectorAll(".network-workspace [data-drawer-panel]")].map(
        (b) => b.dataset.drawerPanel
      )
    ).toEqual(["library", "tools", "insights"]);
  });

  it("is idempotent — a second build does not duplicate panels or tabs", () => {
    buildLabDrawer(LABS[0], document);
    buildLabDrawer(LABS[0], document);
    expect(document.querySelectorAll(".lab-tools-panel")).toHaveLength(1);
    expect(document.querySelectorAll(".network-workspace .lab-drawer-tabs")).toHaveLength(1);
    expect(document.querySelectorAll(".network-toolbar")).toHaveLength(1);
  });

  it("leaves the AWS Diagram Studio to its own layout", () => {
    expect(LABS.map((lab) => lab.id)).toEqual(["network"]);
  });

  it("returns null for a lab that is not on the page", () => {
    document.body.innerHTML = `<main class="app-shell"></main>`;
    expect(buildLabDrawer(LABS[0], document)).toBeNull();
  });

  it("relocates every chrome strip into the Tools panel, in order", () => {
    buildLabDrawer(LABS[0], document);
    const tools = document.getElementById("networkToolsPanel");
    expect([...tools.children].map((child) => child.className)).toEqual([
      "network-canvas-titlebar",
      "network-toolbar",
      "network-lab-meta",
      "network-packet-bar",
      "network-statusbar",
    ]);
    expect(networkLab().classList.contains("is-canvas-focus")).toBe(true);
  });
});

describe("canvas focus drawer", () => {
  beforeEach(() => {
    localStorage.clear();
    mount();
  });

  it("starts closed with every panel inert", () => {
    initCanvasFocus();
    expect(networkLab().dataset.drawer).toBeUndefined();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    for (const id of ["networkPalette", "networkInspector", "networkToolsPanel"]) {
      expect(document.getElementById(id).inert).toBe(true);
    }
  });

  it("opens on the library and un-inerts only that panel", () => {
    initCanvasFocus();
    toggle().click();
    expect(networkLab().dataset.drawer).toBe("library");
    expect(document.getElementById("networkPalette").inert).toBe(false);
    expect(document.getElementById("networkToolsPanel").inert).toBe(true);
    expect(document.getElementById("networkInspector").inert).toBe(true);
  });

  it("switches to Tools without closing", () => {
    const api = initCanvasFocus();
    toggle().click();
    tab("tools").click();
    expect(api.currentPanel()).toBe("tools");
    expect(document.getElementById("networkToolsPanel").inert).toBe(false);
    expect(document.getElementById("networkPalette").inert).toBe(true);
  });

  it("closes when the open panel's own tab is clicked again", () => {
    initCanvasFocus();
    toggle().click();
    tab("library").click();
    expect(networkLab().dataset.drawer).toBeUndefined();
  });

  it("closes from the toggle, the close button, and Escape", () => {
    const api = initCanvasFocus();

    toggle().click();
    toggle().click();
    expect(api.isOpen()).toBe(false);

    toggle().click();
    document.querySelector(".network-workspace .lab-drawer-close").click();
    expect(api.isOpen()).toBe(false);

    toggle().click();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(api.isOpen()).toBe(false);
  });

  it("restores the last panel and open state on the next visit", () => {
    initCanvasFocus().setPanel("insights");

    mount();
    const second = initCanvasFocus();
    expect(second.isOpen()).toBe(true);
    expect(second.currentPanel()).toBe("insights");
    expect(networkLab().dataset.drawer).toBe("insights");
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

  it("degrades to a no-op when no lab is present", () => {
    document.body.innerHTML = `<main class="app-shell"></main>`;
    const api = initCanvasFocus();
    expect(api.isOpen()).toBe(false);
    expect(() => api.setPanel("tools")).not.toThrow();
    expect(() => api.closeDrawer()).not.toThrow();
  });
});
