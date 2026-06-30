/**
 * Command palette (⌘K / Ctrl-K).
 *
 * A keyboard-first launcher that fuzzy-matches across every action in the atlas
 * — switch scenarios, toggle faults, select nodes, change theme, copy a report.
 * The ranking is a pure function so it can be unit-tested without a DOM.
 */

/**
 * Score how well `query` fuzzy-matches `text` (case-insensitive subsequence).
 * Higher is better; 0 means no match. Exact and prefix matches rank highest.
 * @returns {number}
 */
export function fuzzyScore(query, text) {
  const q = String(query).trim().toLowerCase();
  const t = String(text).toLowerCase();
  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 900 - t.length;
  const idx = t.indexOf(q);
  if (idx !== -1) return 700 - idx - t.length * 0.1;
  // Subsequence match: all query chars appear in order.
  let ti = 0;
  let hits = 0;
  let streak = 0;
  let best = 0;
  for (let qi = 0; qi < q.length; qi += 1) {
    let found = false;
    while (ti < t.length) {
      if (t[ti] === q[qi]) {
        ti += 1;
        hits += 1;
        streak += 1;
        best = Math.max(best, streak);
        found = true;
        break;
      }
      streak = 0;
      ti += 1;
    }
    if (!found) return 0;
  }
  if (hits < q.length) return 0;
  return 300 + best * 5 - t.length * 0.1;
}

/**
 * Rank commands against a query. Matches by label and optional keywords.
 * With an empty query the original order is preserved.
 * @param {Array<{label:string, keywords?:string}>} commands
 * @param {string} query
 * @returns {Array} the matching commands, best first
 */
export function rankCommands(commands, query) {
  const q = String(query || "").trim();
  if (!q) return [...commands];
  return commands
    .map((command, index) => {
      const labelScore = fuzzyScore(q, command.label);
      const kwScore = command.keywords ? fuzzyScore(q, command.keywords) * 0.6 : 0;
      return { command, index, score: Math.max(labelScore, kwScore) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command);
}

/**
 * Mount the command palette and wire global shortcuts.
 * @param {() => Array<{id,label,hint?,group?,keywords?,run:Function}>} getCommands
 *        called each time the palette opens so the list reflects live state
 */
export function initCommandPalette(getCommands) {
  const overlay = document.createElement("div");
  overlay.className = "cmdk";
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="cmdk-backdrop" data-cmdk-close></div>
    <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
      <input class="cmdk-input" type="text" role="combobox" aria-expanded="true"
             aria-controls="cmdkList" aria-autocomplete="list" autocomplete="off"
             spellcheck="false" placeholder="Type a command — scenario, fault, node, theme…" />
      <ul class="cmdk-list" id="cmdkList" role="listbox"></ul>
      <div class="cmdk-foot"><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> run <kbd>esc</kbd> close</div>
    </div>`;
  document.body.appendChild(overlay);

  const input = overlay.querySelector(".cmdk-input");
  const list = overlay.querySelector(".cmdk-list");
  let commands = [];
  let filtered = [];
  let active = 0;
  let lastFocused = null;

  const isOpen = () => !overlay.hidden;

  function render() {
    filtered = rankCommands(commands, input.value);
    if (active >= filtered.length) active = Math.max(0, filtered.length - 1);
    list.innerHTML = filtered
      .map(
        (cmd, i) => `
        <li class="cmdk-item${i === active ? " is-active" : ""}" role="option"
            id="cmdk-opt-${i}" aria-selected="${i === active}" data-index="${i}">
          <span class="cmdk-item-label">${escapeHtml(cmd.label)}</span>
          ${cmd.hint ? `<span class="cmdk-item-hint">${escapeHtml(cmd.hint)}</span>` : ""}
        </li>`
      )
      .join("");
    if (!filtered.length) {
      list.innerHTML = `<li class="cmdk-empty">No matching commands</li>`;
    }
    const activeEl = list.querySelector(".cmdk-item.is-active");
    if (activeEl) activeEl.scrollIntoView({ block: "nearest" });
    input.setAttribute("aria-activedescendant", filtered.length ? `cmdk-opt-${active}` : "");
  }

  function open() {
    if (isOpen()) return;
    lastFocused = document.activeElement;
    commands = getCommands();
    input.value = "";
    active = 0;
    overlay.hidden = false;
    document.body.classList.add("cmdk-open");
    render();
    input.focus();
  }

  function close() {
    if (!isOpen()) return;
    overlay.hidden = true;
    document.body.classList.remove("cmdk-open");
    if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
  }

  function runActive() {
    const cmd = filtered[active];
    if (!cmd) return;
    close();
    cmd.run();
  }

  input.addEventListener("input", () => {
    active = 0;
    render();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target.closest("[data-cmdk-close]")) return close();
    const item = event.target.closest(".cmdk-item");
    if (item) {
      active = Number(item.dataset.index);
      runActive();
    }
  });

  overlay.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      active = filtered.length ? (active + 1) % filtered.length : 0;
      render();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      active = filtered.length ? (active - 1 + filtered.length) % filtered.length : 0;
      render();
    } else if (event.key === "Enter") {
      event.preventDefault();
      runActive();
    }
  });

  window.addEventListener("keydown", (event) => {
    const k = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && k === "k") {
      event.preventDefault();
      isOpen() ? close() : open();
    }
  });

  return { open, close };
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]
  );
}
