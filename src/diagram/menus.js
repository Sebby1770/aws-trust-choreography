/**
 * Menus — the menubar (File, Edit, View, Arrange, Insert, Help) and the
 * right-click context menu, built from one declarative item format:
 *
 *   { label, shortcut?, run?, disabled?, checked?, items?: [...] } | "-"
 *
 * Keyboard: arrows move, → opens a submenu, ← closes it, Enter runs,
 * Escape closes. With one menu open, hovering its neighbours switches menus.
 */

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

/** "Mod+Shift+Z" → "⌘⇧Z" on a Mac, "Ctrl+Shift+Z" elsewhere. */
export function formatShortcut(shortcut) {
  if (!shortcut) return "";
  if (!IS_MAC) return shortcut.replace(/Mod/g, "Ctrl").replace(/Alt/g, "Alt");
  return shortcut
    .replace(/Mod\+/g, "⌘")
    .replace(/Shift\+/g, "⇧")
    .replace(/Alt\+/g, "⌥")
    .replace(/Ctrl\+/g, "⌃");
}

let openMenu = null;

function resolve(value) {
  return typeof value === "function" ? value() : value;
}

function buildMenu(items, { onClose, level = 0, labelledBy = null } = {}) {
  const menu = document.createElement("div");
  menu.className = "dg-menu";
  menu.setAttribute("role", "menu");
  if (labelledBy) menu.setAttribute("aria-labelledby", labelledBy);
  menu.dataset.level = String(level);
  let submenu = null;

  const closeSubmenu = () => {
    submenu?.remove();
    submenu = null;
    menu
      .querySelectorAll("[aria-expanded='true']")
      .forEach((node) => node.setAttribute("aria-expanded", "false"));
  };

  const openSubmenu = (button, entry, focusFirst = false) => {
    closeSubmenu();
    submenu = buildMenu(resolve(entry.items), { onClose, level: level + 1 });
    button.setAttribute("aria-expanded", "true");
    document.body.append(submenu);
    const rect = button.getBoundingClientRect();
    const width = submenu.offsetWidth || 220;
    const left =
      rect.right + width > window.innerWidth - 8 ? rect.left - width + 4 : rect.right - 4;
    submenu.style.left = `${Math.max(8, left)}px`;
    submenu.style.top = `${Math.max(8, Math.min(rect.top - 6, window.innerHeight - submenu.offsetHeight - 8))}px`;
    menu.dataset.submenuOpen = "true";
    submenu.addEventListener("keydown", (event) => {
      if (event.key === "ArrowLeft" || (event.key === "Escape" && level + 1 > 0)) {
        event.preventDefault();
        event.stopPropagation();
        closeSubmenu();
        button.focus();
      }
    });
    if (focusFirst)
      submenu.querySelector("[role^='menuitem']:not([aria-disabled='true'])")?.focus();
  };

  for (const entry of resolve(items)) {
    if (entry === "-") {
      const separator = document.createElement("div");
      separator.className = "dg-menu-separator";
      separator.setAttribute("role", "separator");
      menu.append(separator);
      continue;
    }
    if (!entry || entry.hidden) continue;
    const checked = resolve(entry.checked);
    const disabled = resolve(entry.disabled);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "dg-menu-item";
    button.setAttribute("role", checked === undefined ? "menuitem" : "menuitemcheckbox");
    if (checked !== undefined) button.setAttribute("aria-checked", String(Boolean(checked)));
    if (disabled) button.setAttribute("aria-disabled", "true");
    button.tabIndex = -1;
    const check = document.createElement("span");
    check.className = "dg-menu-check";
    check.textContent = checked ? "✓" : "";
    const label = document.createElement("span");
    label.className = "dg-menu-label";
    label.textContent = resolve(entry.label);
    const hint = document.createElement("span");
    hint.className = "dg-menu-shortcut";
    hint.textContent = entry.items ? "›" : formatShortcut(entry.shortcut);
    if (entry.items && disabled) button.addEventListener("mouseenter", () => closeSubmenu());
    button.append(check, label, hint);
    if (entry.items && !disabled) {
      button.setAttribute("aria-haspopup", "menu");
      button.setAttribute("aria-expanded", "false");
      button.addEventListener("mouseenter", () => openSubmenu(button, entry));
      button.addEventListener("click", () => openSubmenu(button, entry, true));
    } else {
      button.addEventListener("mouseenter", () => {
        closeSubmenu();
        button.focus({ preventScroll: true });
      });
      button.addEventListener("click", () => {
        if (disabled) return;
        onClose?.();
        entry.run?.();
      });
    }
    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" && entry.items && !disabled) {
        event.preventDefault();
        openSubmenu(button, entry, true);
      }
    });
    menu.append(button);
  }

  menu.addEventListener("keydown", (event) => {
    const buttons = [...menu.querySelectorAll(":scope > .dg-menu-item")];
    const current = buttons.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      let next = current;
      for (let i = 0; i < buttons.length; i += 1) {
        next = (next + step + buttons.length) % buttons.length;
        if (buttons[next].getAttribute("aria-disabled") !== "true") break;
      }
      buttons[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      (event.key === "Home" ? buttons[0] : buttons[buttons.length - 1])?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose?.({ restoreFocus: true });
    } else if (event.key === "Tab") {
      onClose?.();
    }
  });
  menu.closeSubmenu = closeSubmenu;
  menu.getSubmenu = () => submenu;
  return menu;
}

export function closeMenus({ restoreFocus = false } = {}) {
  if (!openMenu) return;
  const { menu, trigger, onClosed } = openMenu;
  menu.closeSubmenu?.();
  menu.remove();
  trigger?.setAttribute("aria-expanded", "false");
  trigger?.classList.remove("is-open");
  openMenu = null;
  if (restoreFocus) trigger?.focus();
  onClosed?.();
}

function place(menu, x, y) {
  document.body.append(menu);
  const width = menu.offsetWidth || 220;
  const height = menu.offsetHeight || 200;
  menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
}

/** Open a context menu at a viewport position. */
export function openContextMenu(x, y, items, { onClosed } = {}) {
  closeMenus();
  const menu = buildMenu(items, { onClose: (opts) => closeMenus(opts) });
  menu.classList.add("dg-context-menu");
  place(menu, x, y);
  openMenu = { menu, trigger: null, onClosed };
  menu.querySelector(".dg-menu-item:not([aria-disabled='true'])")?.focus({ preventScroll: true });
}

/**
 * Mount a menubar.
 * @param {HTMLElement} container
 * @param {Array<{id: string, label: string, items: Array|Function}>} menus
 */
export function mountMenubar(container, menus) {
  container.setAttribute("role", "menubar");
  container.classList.add("dg-menubar");
  const triggers = menus.map((definition) => {
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "dg-menubar-item";
    trigger.id = `dgMenu-${definition.id}`;
    trigger.textContent = definition.label;
    trigger.setAttribute("role", "menuitem");
    trigger.setAttribute("aria-haspopup", "menu");
    trigger.setAttribute("aria-expanded", "false");
    trigger.tabIndex = -1;
    container.append(trigger);
    return { trigger, definition };
  });
  if (triggers[0]) triggers[0].trigger.tabIndex = 0;

  const open = ({ trigger, definition }, focusFirst = false) => {
    closeMenus();
    const menu = buildMenu(definition.items, {
      onClose: (opts) => closeMenus(opts),
      labelledBy: trigger.id,
    });
    menu.classList.add("dg-dropdown");
    const rect = trigger.getBoundingClientRect();
    place(menu, rect.left, rect.bottom + 4);
    trigger.setAttribute("aria-expanded", "true");
    trigger.classList.add("is-open");
    openMenu = { menu, trigger };
    menu.addEventListener("keydown", (event) => {
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        const focused = document.activeElement;
        if (event.key === "ArrowRight" && focused?.getAttribute("aria-haspopup") === "menu") return;
        event.preventDefault();
        const index = triggers.findIndex((entry) => entry.trigger === trigger);
        const next =
          triggers[
            (index + (event.key === "ArrowRight" ? 1 : -1) + triggers.length) % triggers.length
          ];
        open(next, true);
        next.trigger.focus({ preventScroll: true });
        openMenu?.menu.querySelector(".dg-menu-item")?.focus();
      }
    });
    if (focusFirst) menu.querySelector(".dg-menu-item:not([aria-disabled='true'])")?.focus();
  };

  triggers.forEach((entry, index) => {
    const { trigger } = entry;
    trigger.addEventListener("click", () => {
      if (openMenu?.trigger === trigger) closeMenus();
      else open(entry);
    });
    trigger.addEventListener("mouseenter", () => {
      if (openMenu?.trigger && openMenu.trigger !== trigger && container.contains(openMenu.trigger))
        open(entry);
    });
    trigger.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(entry, true);
      } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        const next =
          triggers[
            (index + (event.key === "ArrowRight" ? 1 : -1) + triggers.length) % triggers.length
          ];
        triggers.forEach((candidate) => (candidate.trigger.tabIndex = -1));
        next.trigger.tabIndex = 0;
        next.trigger.focus();
      }
    });
  });
}

// Close on outside interaction.
if (typeof document !== "undefined") {
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!openMenu) return;
      const target = event.target;
      if (target.closest?.(".dg-menu") || target === openMenu.trigger) return;
      if (target.closest?.(".dg-menubar-item") && openMenu.trigger) return;
      closeMenus();
    },
    true
  );
  window.addEventListener("resize", () => closeMenus());
  window.addEventListener("blur", () => closeMenus());
}
