/**
 * Snapshot undo history.
 *
 * Each entry is a serialised document plus a label, so the Edit menu can say
 * "Undo Move 3 shapes". `coalesce` lets a burst of edits from one control (a
 * slider being dragged, a name being typed) collapse into a single step.
 */
export function createHistory({ limit = 120 } = {}) {
  let past = [];
  let future = [];
  let lastKey = null;
  let lastTime = 0;

  return {
    /**
     * Record the state *before* a change.
     * @param {string} snapshot serialised document before the change
     * @param {string} label
     * @param {{coalesce?: string, now?: number}} options edits sharing a
     *   coalesce key within 1.2s of each other become one undo step
     */
    record(snapshot, label, { coalesce = null, now = Date.now() } = {}) {
      if (coalesce && coalesce === lastKey && now - lastTime < 1200 && past.length) {
        lastTime = now;
        future = [];
        return;
      }
      past.push({ snapshot, label });
      if (past.length > limit) past = past.slice(past.length - limit);
      future = [];
      lastKey = coalesce;
      lastTime = now;
    },
    undo(current) {
      const entry = past.pop();
      if (!entry) return null;
      future.push({ snapshot: current, label: entry.label });
      lastKey = null;
      return entry;
    },
    redo(current) {
      const entry = future.pop();
      if (!entry) return null;
      past.push({ snapshot: current, label: entry.label });
      lastKey = null;
      return entry;
    },
    clear() {
      past = [];
      future = [];
      lastKey = null;
    },
    /** Stop the current coalescing run, so the next edit is its own step. */
    seal() {
      lastKey = null;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    get undoLabel() {
      return past[past.length - 1]?.label || "";
    },
    get redoLabel() {
      return future[future.length - 1]?.label || "";
    },
  };
}
