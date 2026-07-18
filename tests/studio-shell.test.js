// @vitest-environment jsdom
/* global document, localStorage, window */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initStudioShell } from "../src/studio-shell.js";

describe("progressive Flow Studio shell", () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    document.body.innerHTML = `
      <section class="view view-studio is-active">
        <div class="flow-studio" data-studio-experience="guided">
          <button data-studio-experience="guided"></button>
          <button data-studio-experience="pro"></button>
          <button id="flowHelpButton"></button>
          <button id="flowInspectorToggle"></button>
          <button id="flowInspectorToggleCompact"></button>
          <button id="flowFocusButton"></button>
          <button id="flowLibraryToggle"></button>
          <aside class="flow-library"></aside>
          <div id="flowCanvas"><button class="flow-node"></button></div>
          <aside class="flow-inspector"></aside>
        </div>
      </section>
      <dialog id="studioHelpDialog"><button id="studioHelpClose"></button></dialog>`;
  });

  it("starts beginners in Guided mode with the inspector out of the way", () => {
    initStudioShell();
    const studio = document.querySelector(".flow-studio");
    expect(studio.dataset.studioExperience).toBe("guided");
    expect(studio.classList.contains("is-inspector-collapsed")).toBe(true);
  });

  it("opens the inspector contextually when a guided user selects a node", () => {
    initStudioShell();
    document.querySelector(".flow-node").click();
    expect(
      document.querySelector(".flow-studio").classList.contains("is-inspector-collapsed")
    ).toBe(false);
  });

  it("persists the Pro experience separately from architecture data", () => {
    initStudioShell();
    document.querySelector('button[data-studio-experience="pro"]').click();
    const stored = JSON.parse(localStorage.getItem("trust-choreography:studio-ui:v1"));
    expect(document.querySelector(".flow-studio").dataset.studioExperience).toBe("pro");
    expect(stored.experience).toBe("pro");
  });

  it("marks full-screen editor views on the body", () => {
    initStudioShell();
    window.dispatchEvent(new CustomEvent("atlas:viewchange", { detail: { view: "network" } }));
    expect(document.body.classList.contains("is-network-view")).toBe(true);
    expect(document.body.classList.contains("is-studio-view")).toBe(false);
  });
});
