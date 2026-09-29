/**
 * Quick insert — the popover that appears when you double-click empty canvas
 * or let go of a connector over nothing. Type to search every shape and AWS
 * service; Enter drops the best match right there (connected, if you were
 * dragging a connector).
 */

import { searchItems } from "./library.js";

const SUGGESTED = [
  "general:rect:0",
  "general:rounded:1",
  "general:ellipse:2",
  "general:text:3",
  "general:note:4",
  "flowchart:diamond:2",
  "group:vpc",
  "group:private-subnet",
];

export function createQuickInsert({ host, library, onPick }) {
  const panel = document.createElement("div");
  panel.className = "dg-quick-insert";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Insert a shape");
  panel.innerHTML = `
    <input type="search" placeholder="Add a shape or AWS service…" aria-label="Search shapes and services" autocomplete="off" spellcheck="false" />
    <div class="dg-quick-results" role="listbox" aria-label="Matches"></div>
    <p class="dg-quick-hint"><kbd>↵</kbd> add · <kbd>↑↓</kbd> choose · <kbd>esc</kbd> close</p>`;
  host.append(panel);
  const input = panel.querySelector("input");
  const results = panel.querySelector(".dg-quick-results");
  let request = null;
  let items = [];
  let active = 0;

  function suggestions() {
    const recent = library.sections.find((section) => section.id === "recent");
    const keys = [...(recent?.items || []).map((item) => item.key), ...SUGGESTED];
    const picked = [];
    const seen = new Set();
    for (const key of keys) {
      const item = library.item(key);
      if (item && !seen.has(key)) {
        seen.add(key);
        picked.push(item);
      }
    }
    const lambda = library.sections
      .flatMap((section) => section.items)
      .find((item) => item.label === "AWS Lambda");
    if (lambda && !seen.has(lambda.key)) picked.push(lambda);
    return picked.slice(0, 12);
  }

  function renderResults() {
    const query = input.value.trim();
    items = query ? searchItems(library.sections, query, 24) : suggestions();
    active = Math.min(active, Math.max(0, items.length - 1));
    results.replaceChildren(
      ...items.map((item, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = `dg-quick-option${index === active ? " is-active" : ""}`;
        option.setAttribute("role", "option");
        option.setAttribute("aria-selected", String(index === active));
        option.dataset.index = String(index);
        if (item.path || item.src) {
          const image = document.createElement("img");
          image.src = item.path || item.src;
          image.alt = "";
          option.append(image);
        } else {
          const glyph = document.createElement("span");
          glyph.className = `dg-quick-glyph is-${item.kind}`;
          option.append(glyph);
        }
        const label = document.createElement("span");
        label.textContent = item.type === "icon" ? item.label : item.title;
        option.append(label);
        return option;
      })
    );
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "dg-quick-empty";
      empty.textContent = "No matches";
      results.append(empty);
    }
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    request = null;
    host.querySelector(".dg-canvas")?.focus({ preventScroll: true });
  }

  function pick(index) {
    const item = items[index];
    if (!item || !request) return;
    const current = request;
    close();
    onPick(item, current);
  }

  function open(next) {
    request = next;
    input.value = "";
    active = 0;
    renderResults();
    panel.hidden = false;
    const bounds = host.getBoundingClientRect();
    const width = panel.offsetWidth || 300;
    const height = panel.offsetHeight || 320;
    panel.style.left = `${Math.max(8, Math.min(next.screen.x, bounds.width - width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(next.screen.y, bounds.height - height - 8))}px`;
    requestAnimationFrame(() => input.focus());
  }

  input.addEventListener("input", () => {
    active = 0;
    renderResults();
  });
  panel.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      active =
        (active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(1, items.length);
      renderResults();
      results.querySelector(".is-active")?.scrollIntoView?.({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      pick(active);
    }
  });
  results.addEventListener("click", (event) => {
    const option = event.target.closest("[data-index]");
    if (option) pick(Number(option.dataset.index));
  });
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!panel.hidden && !panel.contains(event.target)) close();
    },
    true
  );

  return { open, close, isOpen: () => !panel.hidden };
}
