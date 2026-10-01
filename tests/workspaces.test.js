// @vitest-environment jsdom
/* global document, DOMParser, localStorage, window */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initViews } from "../src/views.js";
import { initCanvasFocus, labelForView } from "../src/canvas-focus.js";
import { initCommandPalette, rankCommands } from "../src/command-palette.js";
import { initWorkspaceCommands } from "../src/workspace-commands.js";

// Keep the real palette, but record the command factory it is handed so the
// registered commands can be inspected directly.
vi.mock("../src/command-palette.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, initCommandPalette: vi.fn(actual.initCommandPalette) };
});

const STORAGE_KEY = "aws-command-atlas-view-v2";
const ALL_VIEWS = ["home", "studio", "network", "sql", "iam", "vpc", "review"];
const LABELS = {
  home: "Explore",
  studio: "AWS Studio",
  network: "Network Lab",
  sql: "SQL Review",
  iam: "IAM Review",
  vpc: "VPC Planner",
  review: "Review",
};

const INDEX_HTML = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
const parseIndex = () => new DOMParser().parseFromString(INDEX_HTML, "text/html");

const section = (view) => document.querySelector(`.view[data-view="${view}"]`);
const menuButton = (view) => document.querySelector(`.workspace-nav [data-view-target="${view}"]`);
const activeSections = () =>
  [...document.querySelectorAll(".view.is-active")].map((el) => el.dataset.view);

/** A trimmed-down shell: header menu, toolkit shortcuts outside the nav, and one section per view. */
function mountShell({ withSelect = false, views = ALL_VIEWS } = {}) {
  document.body.innerHTML = `
    <main class="app-shell">
      <header>
        <nav class="workspace-nav">
          <details class="workspace-menu" id="workspaceMenu">
            <summary><span id="workspaceMenuLabel">Explore</span></summary>
            <div class="workspace-menu-list" role="menu">
              ${views
                .map(
                  (view) =>
                    `<button type="button" role="menuitem" data-view-target="${view}" aria-selected="true">${LABELS[view]}</button>`
                )
                .join("")}
            </div>
          </details>
        </nav>
        ${
          withSelect
            ? `<select id="workspaceSelect">${views
                .map((view) => `<option value="${view}">${LABELS[view]}</option>`)
                .join("")}</select>`
            : ""
        }
        <button id="commandButton" type="button">Commands</button>
      </header>
      <div class="toolkit-grid">
        <button type="button" class="toolkit-iam" data-view-target="iam">Open IAM Review</button>
        <button type="button" class="toolkit-vpc" data-view-target="vpc">Open VPC Planner</button>
      </div>
      ${views.map((view) => `<div class="view view-${view}" data-view="${view}"></div>`).join("")}
    </main>`;
}

let listeners = [];
function onViewChange() {
  const spy = vi.fn();
  window.addEventListener("atlas:viewchange", spy);
  listeners.push(spy);
  return spy;
}

beforeEach(() => {
  localStorage.clear();
  // jsdom does not implement scrollIntoView, which the palette calls on render.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  listeners.forEach((spy) => window.removeEventListener("atlas:viewchange", spy));
  listeners = [];
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("views.js — IAM Review and VPC Planner registration", () => {
  beforeEach(() => mountShell());

  it("returns null when the page has no view sections", () => {
    document.body.innerHTML = `<main class="app-shell"><button data-view-target="iam"></button></main>`;
    expect(initViews()).toBeNull();
  });

  it("starts on home when nothing is stored", () => {
    initViews();
    expect(activeSections()).toEqual(["home"]);
    expect(document.querySelector(".app-shell").dataset.activeView).toBe("home");
  });

  for (const view of ["iam", "vpc"]) {
    describe(`setView("${view}")`, () => {
      it("activates only the matching section", () => {
        initViews().setView(view);
        expect(section(view).classList.contains("is-active")).toBe(true);
        expect(activeSections()).toEqual([view]);
      });

      it("records the view on .app-shell[data-active-view]", () => {
        initViews().setView(view);
        expect(document.querySelector(".app-shell").dataset.activeView).toBe(view);
        expect(document.querySelector(`.app-shell[data-active-view="${view}"]`)).not.toBeNull();
      });

      it("persists the view to localStorage", () => {
        initViews().setView(view);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(view);
      });

      it("dispatches atlas:viewchange with the view name", () => {
        const changes = onViewChange();
        initViews().setView(view);
        expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { view } }));
        expect(changes.mock.lastCall[0].type).toBe("atlas:viewchange");
      });

      it("marks the menu item current and clears the others", () => {
        initViews().setView(view);
        expect(menuButton(view).classList.contains("is-active")).toBe(true);
        expect(menuButton(view).getAttribute("aria-current")).toBe("page");
        for (const other of ALL_VIEWS.filter((name) => name !== view)) {
          expect(menuButton(other).classList.contains("is-active")).toBe(false);
          expect(menuButton(other).hasAttribute("aria-current")).toBe(false);
        }
      });

      it("strips stale aria-selected from every navigation button", () => {
        initViews().setView(view);
        for (const button of document.querySelectorAll("[data-view-target]")) {
          expect(button.hasAttribute("aria-selected")).toBe(false);
        }
      });

      it("highlights shortcut buttons outside the nav without aria-current", () => {
        initViews().setView(view);
        const shortcut = document.querySelector(`.toolkit-${view}`);
        expect(shortcut.classList.contains("is-active")).toBe(true);
        expect(shortcut.hasAttribute("aria-current")).toBe(false);
      });

      it("restores the view saved on a previous visit", () => {
        localStorage.setItem(STORAGE_KEY, view);
        const changes = onViewChange();
        initViews();
        expect(activeSections()).toEqual([view]);
        expect(document.querySelector(".app-shell").dataset.activeView).toBe(view);
        expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { view } }));
      });

      it("opens from a click on the workspace menu item", () => {
        const changes = onViewChange();
        initViews();
        menuButton(view).click();
        expect(activeSections()).toEqual([view]);
        expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { view } }));
      });

      it("opens from a click on the launchpad toolkit card", () => {
        initViews();
        document.querySelector(`.toolkit-${view}`).click();
        expect(activeSections()).toEqual([view]);
        expect(menuButton(view).getAttribute("aria-current")).toBe("page");
      });
    });
  }

  it("switches directly between IAM Review and VPC Planner", () => {
    const changes = onViewChange();
    const views = initViews();
    views.setView("iam");
    views.setView("vpc");
    expect(activeSections()).toEqual(["vpc"]);
    expect(section("iam").classList.contains("is-active")).toBe(false);
    expect(menuButton("iam").hasAttribute("aria-current")).toBe(false);
    expect(changes.mock.calls.map(([event]) => event.detail.view)).toEqual(["home", "iam", "vpc"]);
  });

  it("still accepts SQL Review alongside the new workspaces", () => {
    initViews().setView("sql");
    expect(activeSections()).toEqual(["sql"]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("sql");
  });

  it("accepts every registered workspace", () => {
    const views = initViews();
    for (const view of ALL_VIEWS) {
      views.setView(view);
      expect(activeSections()).toEqual([view]);
    }
  });

  describe("unknown views fall back to home", () => {
    for (const bogus of ["bogus", "", "IAM", "vpc ", "atlas-v1", "constructor", "__proto__"]) {
      it(`setView(${JSON.stringify(bogus)}) opens home`, () => {
        const changes = onViewChange();
        const views = initViews();
        views.setView("iam");
        views.setView(bogus);
        expect(activeSections()).toEqual(["home"]);
        expect(document.querySelector(".app-shell").dataset.activeView).toBe("home");
        expect(localStorage.getItem(STORAGE_KEY)).toBe("home");
        expect(changes).toHaveBeenLastCalledWith(
          expect.objectContaining({ detail: { view: "home" } })
        );
      });
    }

    it("treats undefined and null as home", () => {
      const views = initViews();
      views.setView("vpc");
      views.setView(undefined);
      expect(activeSections()).toEqual(["home"]);
      views.setView("vpc");
      views.setView(null);
      expect(activeSections()).toEqual(["home"]);
    });

    it("replaces an unknown stored view with home", () => {
      localStorage.setItem(STORAGE_KEY, "sandbox");
      initViews();
      expect(activeSections()).toEqual(["home"]);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("home");
    });

    it("replaces a stored prototype key with home", () => {
      localStorage.setItem(STORAGE_KEY, "constructor");
      initViews();
      expect(activeSections()).toEqual(["home"]);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("home");
    });

    it("falls back to home when a button names an unregistered view", () => {
      initViews().setView("iam");
      const stray = document.createElement("button");
      stray.dataset.viewTarget = "billing";
      document.querySelector(".toolkit-grid").append(stray);
      // Buttons are collected at init, so re-init to pick this one up.
      initViews();
      stray.click();
      expect(activeSections()).toEqual(["home"]);
    });
  });

  it("still migrates the legacy atlas view to review", () => {
    localStorage.setItem(STORAGE_KEY, "atlas");
    initViews();
    expect(activeSections()).toEqual(["review"]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("review");
  });

  it("maps the legacy atlas name when set programmatically", () => {
    initViews().setView("atlas");
    expect(activeSections()).toEqual(["review"]);
  });

  it("keeps working when localStorage cannot be read or written", () => {
    vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const changes = onViewChange();
    const views = initViews();
    expect(activeSections()).toEqual(["home"]);
    expect(() => views.setView("vpc")).not.toThrow();
    expect(activeSections()).toEqual(["vpc"]);
    expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { view: "vpc" } }));
  });

  describe("with a #workspaceSelect dropdown", () => {
    beforeEach(() => mountShell({ withSelect: true }));

    it("mirrors the active view in the select", () => {
      const views = initViews();
      views.setView("iam");
      expect(document.getElementById("workspaceSelect").value).toBe("iam");
      views.setView("vpc");
      expect(document.getElementById("workspaceSelect").value).toBe("vpc");
    });

    it("switches view when the select changes", () => {
      initViews();
      const select = document.getElementById("workspaceSelect");
      select.value = "vpc";
      select.dispatchEvent(new window.Event("change"));
      expect(activeSections()).toEqual(["vpc"]);
      select.value = "iam";
      select.dispatchEvent(new window.Event("change"));
      expect(activeSections()).toEqual(["iam"]);
      expect(localStorage.getItem(STORAGE_KEY)).toBe("iam");
    });
  });
});

describe("canvas-focus.js — workspace labels", () => {
  function mountMenu(activeView) {
    document.body.innerHTML = `
      <main class="app-shell"${activeView ? ` data-active-view="${activeView}"` : ""}>
        <nav class="workspace-nav">
          <details class="workspace-menu" id="workspaceMenu">
            <summary><span id="workspaceMenuLabel">Explore</span></summary>
            <div class="workspace-menu-list">
              ${ALL_VIEWS.map(
                (view) => `<button data-view-target="${view}">${LABELS[view]}</button>`
              ).join("")}
            </div>
          </details>
        </nav>
        ${ALL_VIEWS.map((view) => `<div class="view" data-view="${view}"></div>`).join("")}
      </main>`;
  }
  const label = () => document.getElementById("workspaceMenuLabel").textContent;

  it("labels the IAM workspace 'IAM Review'", () => {
    expect(labelForView("iam")).toBe("IAM Review");
  });

  it("labels the VPC workspace 'VPC Planner'", () => {
    expect(labelForView("vpc")).toBe("VPC Planner");
  });

  it("labels the SQL workspace 'SQL Review'", () => {
    expect(labelForView("sql")).toBe("SQL Review");
  });

  it("labels every registered workspace distinctly", () => {
    const labels = ALL_VIEWS.map(labelForView);
    expect(labels).toEqual(ALL_VIEWS.map((view) => LABELS[view]));
    expect(new Set(labels).size).toBe(ALL_VIEWS.length);
  });

  it("falls back to Explore for unknown or case-mismatched views", () => {
    expect(labelForView("IAM")).toBe("Explore");
    expect(labelForView("Vpc")).toBe("Explore");
    expect(labelForView("")).toBe("Explore");
    expect(labelForView(null)).toBe("Explore");
  });

  it("uses the active view already on the shell for the initial label", () => {
    mountMenu("vpc");
    initCanvasFocus();
    expect(label()).toBe("VPC Planner");
  });

  it("uses Explore when the shell has no active view yet", () => {
    mountMenu();
    document.getElementById("workspaceMenuLabel").textContent = "stale";
    initCanvasFocus();
    expect(label()).toBe("Explore");
  });

  it("updates the menu label on atlas:viewchange for iam and vpc", () => {
    mountMenu("home");
    initCanvasFocus();
    window.dispatchEvent(new window.CustomEvent("atlas:viewchange", { detail: { view: "iam" } }));
    expect(label()).toBe("IAM Review");
    window.dispatchEvent(new window.CustomEvent("atlas:viewchange", { detail: { view: "vpc" } }));
    expect(label()).toBe("VPC Planner");
  });

  it("closes the open menu when the view changes", () => {
    mountMenu("home");
    initCanvasFocus();
    const menu = document.getElementById("workspaceMenu");
    menu.open = true;
    window.dispatchEvent(new window.CustomEvent("atlas:viewchange", { detail: { view: "iam" } }));
    expect(menu.open).toBe(false);
  });

  it("follows a real menu selection end to end", () => {
    mountMenu("home");
    initCanvasFocus();
    initViews();
    const menu = document.getElementById("workspaceMenu");

    menu.open = true;
    document.querySelector('[data-view-target="iam"]').click();
    expect(label()).toBe("IAM Review");
    expect(menu.open).toBe(false);
    expect(document.querySelector(".app-shell").dataset.activeView).toBe("iam");

    menu.open = true;
    document.querySelector('[data-view-target="vpc"]').click();
    expect(label()).toBe("VPC Planner");
    expect(menu.open).toBe(false);
  });

  it("falls back to Explore when the event carries no detail", () => {
    mountMenu("iam");
    initCanvasFocus();
    expect(label()).toBe("IAM Review");
    window.dispatchEvent(new window.CustomEvent("atlas:viewchange"));
    expect(label()).toBe("Explore");
  });
});

describe("workspace-commands.js — navigation commands", () => {
  function setup(options = {}) {
    mountShell();
    initCommandPalette.mockClear();
    const navigate = vi.fn();
    const palette = initWorkspaceCommands({ navigate, ...options });
    const getCommands = initCommandPalette.mock.lastCall[0];
    return { navigate, palette, getCommands, commands: getCommands() };
  }
  const byId = (commands, id) => commands.find((command) => command.id === id);
  const visibleLabels = () =>
    [...document.querySelectorAll(".cmdk-item-label")].map((el) => el.textContent);
  const typeQuery = (text) => {
    const input = document.querySelector(".cmdk-input");
    input.value = text;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const pressEnter = () =>
    document
      .querySelector(".cmdk-input")
      .dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

  it("hands the palette a live command factory and returns its API", () => {
    const { palette, getCommands } = setup();
    expect(initCommandPalette).toHaveBeenCalledTimes(1);
    expect(typeof getCommands).toBe("function");
    expect(typeof palette.open).toBe("function");
    expect(typeof palette.close).toBe("function");
  });

  it("registers one Navigate command per workspace, in menu order", () => {
    const { commands } = setup();
    const navigation = commands.filter((command) => command.group === "Navigate");
    expect(navigation.map((command) => command.id)).toEqual(ALL_VIEWS.map((v) => `view:${v}`));
    expect(navigation.map((command) => command.label)).toEqual(
      ALL_VIEWS.map((view) => `Open ${LABELS[view]}`)
    );
  });

  for (const [view, label] of [
    ["sql", "Open SQL Review"],
    ["iam", "Open IAM Review"],
    ["vpc", "Open VPC Planner"],
  ]) {
    it(`registers "${label}" which navigates to '${view}'`, () => {
      const { commands, navigate } = setup();
      const command = byId(commands, `view:${view}`);
      expect(command).toMatchObject({ group: "Navigate", label });
      expect(command.keywords).toEqual(expect.any(String));
      expect(command.keywords.length).toBeGreaterThan(0);
      command.run();
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(view);
    });
  }

  it("labels every navigation command with the workspace menu label", () => {
    const { commands } = setup();
    for (const view of ALL_VIEWS) {
      expect(byId(commands, `view:${view}`).label).toBe(`Open ${labelForView(view)}`);
    }
  });

  it("gives every command a unique id", () => {
    const { commands } = setup({ theme: { mode: "dark", setMode: vi.fn() } });
    const ids = commands.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finds IAM Review by its security keywords", () => {
    const { commands } = setup();
    for (const query of ["policy", "least privilege", "permissions", "trust"]) {
      expect(rankCommands(commands, query)[0].id).toBe("view:iam");
    }
  });

  it("finds VPC Planner by its addressing keywords", () => {
    const { commands } = setup();
    for (const query of ["cidr", "subnet", "terraform"]) {
      expect(rankCommands(commands, query)[0].id).toBe("view:vpc");
    }
  });

  it("finds SQL Review by its query keywords", () => {
    const { commands } = setup();
    for (const query of ["ddl", "schema", "lint"]) {
      expect(rankCommands(commands, query)[0].id).toBe("view:sql");
    }
  });

  it("does not throw when navigate is not provided", () => {
    mountShell();
    initCommandPalette.mockClear();
    initWorkspaceCommands();
    const commands = initCommandPalette.mock.lastCall[0]();
    expect(() => byId(commands, "view:iam").run()).not.toThrow();
    expect(() => byId(commands, "view:vpc").run()).not.toThrow();
    expect(() => byId(commands, "review:refresh").run()).not.toThrow();
  });

  it("lists the new workspaces when the palette is opened", () => {
    const { palette } = setup();
    palette.open();
    const labels = visibleLabels();
    expect(labels).toContain("Open SQL Review");
    expect(labels).toContain("Open IAM Review");
    expect(labels).toContain("Open VPC Planner");
  });

  it("opens from the #commandButton header button", () => {
    setup();
    const overlay = document.querySelector(".cmdk");
    expect(overlay.hidden).toBe(true);
    document.getElementById("commandButton").click();
    expect(overlay.hidden).toBe(false);
  });

  it("navigates to IAM Review by typing and pressing Enter", () => {
    const { palette, navigate } = setup();
    palette.open();
    typeQuery("iam");
    expect(visibleLabels()[0]).toBe("Open IAM Review");
    pressEnter();
    expect(navigate).toHaveBeenCalledWith("iam");
    expect(document.querySelector(".cmdk").hidden).toBe(true);
  });

  it("navigates to VPC Planner by typing and pressing Enter", () => {
    const { palette, navigate } = setup();
    palette.open();
    typeQuery("vpc");
    expect(visibleLabels()[0]).toBe("Open VPC Planner");
    pressEnter();
    expect(navigate).toHaveBeenCalledWith("vpc");
  });

  it("navigates to SQL Review by clicking its palette entry", () => {
    const { palette, navigate } = setup();
    palette.open();
    const item = [...document.querySelectorAll(".cmdk-item")].find(
      (el) => el.querySelector(".cmdk-item-label").textContent === "Open SQL Review"
    );
    item.click();
    expect(navigate).toHaveBeenCalledWith("sql");
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("drives the real view switcher when wired like main.js", () => {
    mountShell();
    initCommandPalette.mockClear();
    const views = initViews();
    initWorkspaceCommands({ navigate: (view) => views.setView(view) });
    const commands = initCommandPalette.mock.lastCall[0]();

    byId(commands, "view:iam").run();
    expect(activeSections()).toEqual(["iam"]);
    byId(commands, "view:vpc").run();
    expect(activeSections()).toEqual(["vpc"]);
    byId(commands, "view:sql").run();
    expect(activeSections()).toEqual(["sql"]);
  });

  describe("other command groups", () => {
    it("omits theme commands without a theme controller", () => {
      const { commands } = setup();
      expect(commands.some((command) => command.group === "Appearance")).toBe(false);
    });

    it("adds theme commands and marks the active mode", () => {
      const setMode = vi.fn();
      const { commands } = setup({ theme: { mode: "light", setMode } });
      const themes = commands.filter((command) => command.group === "Appearance");
      expect(themes.map((command) => command.id)).toEqual([
        "theme:system",
        "theme:light",
        "theme:dark",
      ]);
      expect(themes.map((command) => command.hint)).toEqual(["", "active", ""]);
      byId(commands, "theme:dark").run();
      expect(setMode).toHaveBeenCalledWith("dark");
    });

    it("refreshes the review by navigating to review first", () => {
      const refresh = vi.fn();
      const { commands, navigate } = setup({ getReviewCenter: () => ({ refresh }) });
      byId(commands, "review:refresh").run();
      expect(navigate).toHaveBeenCalledWith("review");
      expect(refresh).toHaveBeenCalledWith({ announceUpdate: true });
    });

    it("copies and downloads the review through the review center", () => {
      const copy = vi.fn();
      const downloadMarkdown = vi.fn();
      const { commands } = setup({ getReviewCenter: () => ({ copy, downloadMarkdown }) });
      byId(commands, "review:copy").run();
      byId(commands, "review:download").run();
      expect(copy).toHaveBeenCalledTimes(1);
      expect(downloadMarkdown).toHaveBeenCalledTimes(1);
    });

    it("tolerates a review center that has not booted", () => {
      const { commands } = setup({ getReviewCenter: () => null });
      expect(() => byId(commands, "review:copy").run()).not.toThrow();
      expect(() => byId(commands, "review:download").run()).not.toThrow();
    });

    it("appends studio commands and re-reads them on every open", () => {
      let studio = [];
      const { getCommands } = setup({ getStudioCommands: () => studio });
      expect(getCommands().some((command) => command.id === "studio:x")).toBe(false);
      studio = [{ id: "studio:x", group: "Studio", label: "Studio action", run: vi.fn() }];
      expect(getCommands().at(-1).id).toBe("studio:x");
    });

    it("keeps navigation available when the studio commands throw", () => {
      const { getCommands } = setup({
        getStudioCommands: () => {
          throw new Error("studio not ready");
        },
      });
      const commands = getCommands();
      expect(byId(commands, "view:iam")).toBeDefined();
      expect(byId(commands, "view:vpc")).toBeDefined();
    });

    it("ignores a studio command getter that returns nothing", () => {
      const { commands } = setup({ getStudioCommands: () => undefined });
      expect(commands.filter((command) => command.group === "Navigate")).toHaveLength(7);
    });
  });
});

describe("index.html — workspace markup", () => {
  const doc = parseIndex();
  const sections = [...doc.querySelectorAll(".view[data-view]")];
  const sectionViews = sections.map((el) => el.dataset.view);
  const targets = [...doc.querySelectorAll("[data-view-target]")];
  const menuItems = [...doc.querySelectorAll("#workspaceMenu [data-view-target]")];

  it("has a workspace menu inside the primary navigation", () => {
    expect(doc.querySelector(".workspace-nav #workspaceMenu")).not.toBeNull();
    expect(doc.querySelector("#workspaceMenuLabel")).not.toBeNull();
  });

  for (const view of ["iam", "vpc"]) {
    it(`has a workspace menu button for ${view}`, () => {
      const button = doc.querySelector(`#workspaceMenu [data-view-target="${view}"]`);
      expect(button).not.toBeNull();
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(button.getAttribute("role")).toBe("menuitem");
      expect(button.textContent.trim()).toBe(LABELS[view]);
    });

    it(`has a .view[data-view="${view}"] section`, () => {
      const matches = doc.querySelectorAll(`.view[data-view="${view}"]`);
      expect(matches).toHaveLength(1);
      expect(matches[0].classList.contains(`view-${view}`)).toBe(true);
      expect(matches[0].classList.contains("is-active")).toBe(false);
    });
  }

  it("mounts the IAM and VPC lab roots inside their sections", () => {
    expect(doc.querySelector('.view[data-view="iam"] #iamLab')).not.toBeNull();
    expect(doc.querySelector('.view[data-view="vpc"] #vpcLab')).not.toBeNull();
  });

  it("lists every registered workspace in the menu exactly once, in order", () => {
    expect(menuItems.map((el) => el.dataset.viewTarget)).toEqual(ALL_VIEWS);
  });

  it("labels each menu item with the same text the menu label shows", () => {
    for (const item of menuItems) {
      expect(item.textContent.trim()).toBe(labelForView(item.dataset.viewTarget));
    }
  });

  it("gives every data-view-target a matching .view[data-view] section", () => {
    expect(targets.length).toBeGreaterThan(0);
    const orphans = targets
      .map((el) => el.dataset.viewTarget)
      .filter((view) => !sectionViews.includes(view));
    expect(orphans).toEqual([]);
  });

  it("has one section per registered workspace and no duplicates", () => {
    expect(new Set(sectionViews).size).toBe(sectionViews.length);
    expect([...sectionViews].sort()).toEqual([...ALL_VIEWS].sort());
  });

  it("makes every section reachable from the workspace menu", () => {
    const reachable = new Set(menuItems.map((el) => el.dataset.viewTarget));
    expect(sectionViews.filter((view) => !reachable.has(view))).toEqual([]);
  });

  it("starts with only the home section active", () => {
    expect(
      sections.filter((el) => el.classList.contains("is-active")).map((el) => el.dataset.view)
    ).toEqual(["home"]);
  });

  it("offers launchpad shortcuts into IAM Review and VPC Planner", () => {
    for (const view of ["iam", "vpc"]) {
      const shortcuts = targets.filter(
        (el) => el.dataset.viewTarget === view && !el.closest("#workspaceMenu")
      );
      expect(shortcuts.length).toBeGreaterThan(0);
      expect(shortcuts[0].closest('.view[data-view="home"]')).not.toBeNull();
      expect(shortcuts[0].textContent).toContain(`Open ${LABELS[view]}`);
    }
  });

  it("has the #commandButton the workspace commands attach to", () => {
    expect(doc.querySelector("#commandButton")).not.toBeNull();
  });

  describe("driven by the real view switcher", () => {
    beforeEach(() => {
      document.body.innerHTML = parseIndex().body.innerHTML;
    });

    for (const view of ALL_VIEWS) {
      it(`setView("${view}") activates the real ${view} section`, () => {
        const changes = onViewChange();
        initViews().setView(view);
        expect(activeSections()).toEqual([view]);
        expect(document.querySelector(".app-shell").dataset.activeView).toBe(view);
        expect(localStorage.getItem(STORAGE_KEY)).toBe(view);
        expect(changes).toHaveBeenLastCalledWith(expect.objectContaining({ detail: { view } }));
        expect(
          document
            .querySelector(`#workspaceMenu [data-view-target="${view}"]`)
            .getAttribute("aria-current")
        ).toBe("page");
      });
    }

    it("every data-view-target button opens its own section when clicked", () => {
      initViews();
      for (const button of document.querySelectorAll("[data-view-target]")) {
        button.click();
        expect(activeSections()).toEqual([button.dataset.viewTarget]);
      }
    });

    it("updates the real workspace menu label for iam and vpc", () => {
      initCanvasFocus();
      const views = initViews();
      views.setView("iam");
      expect(document.getElementById("workspaceMenuLabel").textContent).toBe("IAM Review");
      views.setView("vpc");
      expect(document.getElementById("workspaceMenuLabel").textContent).toBe("VPC Planner");
    });
  });
});
