// @vitest-environment jsdom
/* global document, localStorage, window */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { initViews } from "../src/views.js";

describe("workspace views", () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = `
      <main class="app-shell">
        <nav class="workspace-nav">
          <button data-view-target="home">Explore</button>
          <button data-view-target="studio">AWS Studio</button>
          <button data-view-target="network">Network Lab</button>
          <button data-view-target="review">Review</button>
        </nav>
        <section class="view" data-view="home"></section>
        <section class="view" data-view="studio"></section>
        <section class="view" data-view="network"></section>
        <section class="view" data-view="review"></section>
      </main>`;
  });

  it("opens Network Lab from the primary navigation", () => {
    const changes = vi.fn();
    window.addEventListener("atlas:viewchange", changes);
    const views = initViews();

    views.setView("network");

    expect(document.querySelector('[data-view="network"]').classList.contains("is-active")).toBe(
      true
    );
    expect(document.querySelector(".app-shell").dataset.activeView).toBe("network");
    expect(
      document.querySelector('[data-view-target="network"]').getAttribute("aria-current")
    ).toBe("page");
    expect(changes).toHaveBeenLastCalledWith(
      expect.objectContaining({ detail: { view: "network" } })
    );
  });

  it("restores Network Lab as a valid saved view", () => {
    localStorage.setItem("aws-command-atlas-view-v2", "network");
    initViews();
    expect(document.querySelector('[data-view="network"]').classList.contains("is-active")).toBe(
      true
    );
  });

  it("migrates the former Rehearse view to Review", () => {
    localStorage.setItem("aws-command-atlas-view-v2", "atlas");
    initViews();
    expect(document.querySelector('[data-view="review"]').classList.contains("is-active")).toBe(
      true
    );
    expect(localStorage.getItem("aws-command-atlas-view-v2")).toBe("review");
  });
});
