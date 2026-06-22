/**
 * Shareable deep-link state for the Command Atlas.
 *
 * Encodes the active scenario, injected faults, and selected node into the URL
 * hash so an operator can copy a link that reopens the exact same view. Kept
 * DOM-free for unit testing; `syncStateToUrl` / `readStateFromUrl` adapt it to
 * `window.location` at the call site.
 */

const SCENARIO_KEYS = new Set(["steady", "surge", "identity", "recovery"]);

/**
 * Serialize atlas state into a URL hash fragment (without the leading `#`).
 * @param {{scenario?: string, failures?: Iterable<string>, node?: string}} state
 * @returns {string}
 */
export function encodeState({ scenario, failures, node } = {}) {
  const params = new URLSearchParams();
  if (scenario) params.set("scenario", scenario);
  const faultList = failures ? Array.from(failures).filter(Boolean) : [];
  if (faultList.length) params.set("faults", faultList.join(","));
  if (node) params.set("node", node);
  return params.toString();
}

/**
 * Parse a URL hash fragment back into atlas state. Unknown scenarios are
 * dropped so callers can fall back to their default.
 * @param {string} hash - may include a leading `#`
 * @returns {{scenario: string|null, failures: string[], node: string|null}}
 */
export function decodeState(hash = "") {
  const raw = String(hash).replace(/^#/, "");
  const params = new URLSearchParams(raw);
  const scenario = params.get("scenario");
  const faults = params.get("faults");
  return {
    scenario: scenario && SCENARIO_KEYS.has(scenario) ? scenario : null,
    failures: faults
      ? faults
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : [],
    node: params.get("node") || null,
  };
}

/**
 * Push state into `window.location.hash` without creating history entries.
 * @param {{scenario?: string, failures?: Iterable<string>, node?: string}} state
 * @param {Window} [win]
 */
export function syncStateToUrl(state, win = typeof window !== "undefined" ? window : undefined) {
  if (!win) return;
  const encoded = encodeState(state);
  const next = `${win.location.pathname}${win.location.search}${encoded ? `#${encoded}` : ""}`;
  win.history.replaceState(null, "", next);
}

/**
 * Read atlas state from `window.location.hash`.
 * @param {Window} [win]
 */
export function readStateFromUrl(win = typeof window !== "undefined" ? window : undefined) {
  if (!win) return { scenario: null, failures: [], node: null };
  return decodeState(win.location.hash);
}
