/**
 * Theme controller: cycles System → Light → Dark and persists the choice.
 *
 * The dark palette is the CSS default. Light tokens live behind
 * `:root[data-theme="light"]` and `@media (prefers-color-scheme: light)`, so in
 * "system" mode we simply remove the attribute and let the OS preference win.
 */

const STORAGE_KEY = "aws-command-atlas-theme";
const MODES = ["system", "light", "dark"];

const LABELS = {
  system: { icon: "◐", text: "Theme: follow system" },
  light: { icon: "☀", text: "Theme: light" },
  dark: { icon: "☾", text: "Theme: dark" },
};

function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(value) ? value : "system";
  } catch {
    return "system";
  }
}

function persist(mode) {
  try {
    if (mode === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, mode);
    }
  } catch {
    /* storage unavailable (private mode) — fall back to in-memory only */
  }
}

function apply(mode) {
  const root = document.documentElement;
  if (mode === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", mode);
  }
}

/**
 * Wire up a theme toggle button. Returns a controller with the current mode.
 * @param {HTMLElement|null} button
 */
export function initTheme(button) {
  let mode = readStored();
  apply(mode);

  function reflect() {
    if (!button) return;
    const label = LABELS[mode];
    button.textContent = label.icon;
    button.setAttribute("aria-label", label.text);
    button.setAttribute("title", label.text);
    button.dataset.themeMode = mode;
  }

  function setMode(next) {
    mode = MODES.includes(next) ? next : "system";
    apply(mode);
    persist(mode);
    reflect();
  }

  reflect();

  if (button) {
    button.addEventListener("click", () => {
      const index = MODES.indexOf(mode);
      setMode(MODES[(index + 1) % MODES.length]);
    });
  }

  return {
    get mode() {
      return mode;
    },
    setMode,
  };
}

/**
 * True when the user has asked the OS to reduce motion.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
