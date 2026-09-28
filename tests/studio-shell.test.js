// @vitest-environment jsdom
/* global document, localStorage, window */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initStudioShell } from "../src/studio-shell.js";

describe("editor workspace shell", () => {
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
          <section class="diagram-studio" id="diagramStudio">
            <div class="dg-canvas" tabindex="0"></div>
          </section>
        </section>
      </main>
      <dialog id="studioHelpDialog"><button id="studioHelpClose"></button></dialog>`;
  });

  it("closes the shortcuts dialog from its close button and the backdrop", () => {
    initStudioShell();
    const dialog = document.querySelector("#studioHelpDialog");
    dialog.setAttribute("open", "");
    document.querySelector("#studioHelpClose").click();
    expect(dialog.hasAttribute("open")).toBe(false);
  });

  it("leaves Escape inside the diagram editor to the editor", () => {
    initStudioShell();
    document.querySelector("#workspaceChromeToggle").click();
    document
      .querySelector(".dg-canvas")
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.querySelector(".app-shell").classList.contains("is-workspace-maximised")).toBe(
      true
    );
  });

  it("initialises once", () => {
    expect(initStudioShell()).not.toBeNull();
    expect(initStudioShell()).toBeNull();
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
