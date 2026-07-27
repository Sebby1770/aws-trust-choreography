// @vitest-environment jsdom
/* global document, localStorage, window */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initStudioShell } from "../src/studio-shell.js";

describe("progressive Flow Studio shell", () => {
  beforeEach(() => {
    localStorage.clear();
    window.scrollTo = vi.fn();
    window.requestAnimationFrame = vi.fn((callback) => callback());
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    document.body.innerHTML = `
      <main class="app-shell" data-active-view="studio">
        <header id="siteHeader">
          <button id="workspaceChromeToggle" aria-pressed="false"></button>
        </header>
        <button id="workspaceChromeRestore" aria-expanded="false" hidden></button>
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
      </main>
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

  it("maximises either editor, moves focus to the restore control, and persists it", () => {
    initStudioShell();
    document.querySelector("#workspaceChromeToggle").click();

    const shell = document.querySelector(".app-shell");
    const stored = JSON.parse(localStorage.getItem("trust-choreography:studio-ui:v1"));
    expect(shell.classList.contains("is-workspace-maximised")).toBe(true);
    expect(document.querySelector("#siteHeader").getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelector("#workspaceChromeRestore").hidden).toBe(false);
    expect(document.activeElement.id).toBe("workspaceChromeRestore");
    expect(stored.workspaceMaximised).toBe(true);
  });

  it("shows navigation outside the editors and restores maximised mode on return", () => {
    initStudioShell();
    document.querySelector("#workspaceChromeToggle").click();

    window.dispatchEvent(new CustomEvent("atlas:viewchange", { detail: { view: "home" } }));
    expect(document.querySelector(".app-shell").classList.contains("is-workspace-maximised")).toBe(
      false
    );
    expect(document.querySelector("#workspaceChromeRestore").hidden).toBe(true);

    window.dispatchEvent(new CustomEvent("atlas:viewchange", { detail: { view: "network" } }));
    expect(document.querySelector(".app-shell").classList.contains("is-workspace-maximised")).toBe(
      true
    );
  });

  it("restores the workspace bar with Escape when no inner editor panel is open", () => {
    initStudioShell();
    document.querySelector("#workspaceChromeToggle").click();
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector(".app-shell").classList.contains("is-workspace-maximised")).toBe(
      false
    );
    expect(document.querySelector("#workspaceChromeRestore").hidden).toBe(true);
    expect(document.activeElement.id).toBe("workspaceChromeToggle");
  });

  it("restores the workspace bar with Escape from Network Lab", () => {
    initStudioShell();
    document.querySelector("#workspaceChromeToggle").click();
    window.dispatchEvent(new CustomEvent("atlas:viewchange", { detail: { view: "network" } }));
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(document.querySelector(".app-shell").classList.contains("is-workspace-maximised")).toBe(
      false
    );
  });
});
