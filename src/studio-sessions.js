/**
 * Flow Studio sessions — multiple named architectures, each auto-saved and
 * switchable from the studio titlebar.
 *
 * The store core is storage-agnostic (any object with getItem/setItem) so it
 * can be unit-tested without a browser; `initStudioSessions` wires it to the
 * live Flow Studio API (window.AWSFlowStudio) and the titlebar controls.
 */

const STORAGE_KEY = "aws-atlas-studio-sessions-v1";
const MAX_SESSIONS = 12;

function makeId(existing = []) {
  let i = 1;
  while (existing.some((s) => s.id === `s${i}`)) i += 1;
  return `s${i}`;
}

/** Normalize a raw parsed value into a well-formed sessions document. */
export function normalizeSessions(raw) {
  const doc = { activeId: null, sessions: [] };
  if (raw && typeof raw === "object" && Array.isArray(raw.sessions)) {
    for (const s of raw.sessions.slice(0, MAX_SESSIONS)) {
      if (!s || typeof s !== "object" || typeof s.id !== "string") continue;
      doc.sessions.push({
        id: s.id,
        name: typeof s.name === "string" && s.name.trim() ? s.name.slice(0, 60) : "Untitled",
        snapshot: typeof s.snapshot === "string" ? s.snapshot : "",
      });
    }
    if (typeof raw.activeId === "string" && doc.sessions.some((s) => s.id === raw.activeId)) {
      doc.activeId = raw.activeId;
    }
  }
  if (!doc.sessions.length) {
    doc.sessions.push({ id: "s1", name: "Session 1", snapshot: "" });
  }
  if (!doc.activeId) doc.activeId = doc.sessions[0].id;
  return doc;
}

/** Create a session store over any getItem/setItem storage. */
export function createSessionStore(storage) {
  const read = () => {
    try {
      return normalizeSessions(JSON.parse(storage.getItem(STORAGE_KEY)));
    } catch {
      return normalizeSessions(null);
    }
  };
  const write = (doc) => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(doc));
    } catch {
      /* storage unavailable */
    }
    return doc;
  };

  return {
    list: () => read(),
    /** Persist the current architecture snapshot into the active session. */
    saveActive(snapshot) {
      const doc = read();
      const active = doc.sessions.find((s) => s.id === doc.activeId);
      if (active && typeof snapshot === "string") active.snapshot = snapshot;
      return write(doc);
    },
    /** Create a new session (saving `currentSnapshot` into the old one first). */
    create(name, currentSnapshot) {
      let doc = read();
      if (typeof currentSnapshot === "string") {
        const active = doc.sessions.find((s) => s.id === doc.activeId);
        if (active) active.snapshot = currentSnapshot;
      }
      if (doc.sessions.length >= MAX_SESSIONS) return { doc: write(doc), created: null };
      const session = {
        id: makeId(doc.sessions),
        name: (name || `Session ${doc.sessions.length + 1}`).slice(0, 60),
        snapshot: "",
      };
      doc.sessions.push(session);
      doc.activeId = session.id;
      return { doc: write(doc), created: session };
    },
    /** Switch sessions, saving the outgoing snapshot; returns the incoming one. */
    switch(id, currentSnapshot) {
      const doc = read();
      const target = doc.sessions.find((s) => s.id === id);
      if (!target) return { doc, target: null };
      if (typeof currentSnapshot === "string") {
        const active = doc.sessions.find((s) => s.id === doc.activeId);
        if (active && active.id !== id) active.snapshot = currentSnapshot;
      }
      doc.activeId = id;
      return { doc: write(doc), target };
    },
    /** Delete a session (never the last one); returns the new active session. */
    remove(id) {
      const doc = read();
      if (doc.sessions.length <= 1) return { doc, active: doc.sessions[0] };
      doc.sessions = doc.sessions.filter((s) => s.id !== id);
      if (doc.activeId === id) doc.activeId = doc.sessions[0].id;
      const active = doc.sessions.find((s) => s.id === doc.activeId);
      return { doc: write(doc), active };
    },
    /** Rename the active session. */
    renameActive(name) {
      const doc = read();
      const active = doc.sessions.find((s) => s.id === doc.activeId);
      if (active && typeof name === "string" && name.trim()) active.name = name.slice(0, 60);
      return write(doc);
    },
  };
}

/** Wire the store to the live studio UI. Call after Flow Studio has booted. */
export function initStudioSessions(studio = window.AWSFlowStudio) {
  const select = document.querySelector("#studioSessionSelect");
  const newButton = document.querySelector("#studioSessionNew");
  const deleteButton = document.querySelector("#studioSessionDelete");
  const nameInput = document.querySelector("#flowArchitectureName");
  if (!select || !studio) return null;

  const store = createSessionStore(window.localStorage);

  function render() {
    const doc = store.list();
    select.replaceChildren(
      ...doc.sessions.map((s) => {
        const option = document.createElement("option");
        option.value = s.id;
        option.textContent = s.name;
        option.selected = s.id === doc.activeId;
        return option;
      })
    );
    if (deleteButton) deleteButton.disabled = doc.sessions.length <= 1;
  }

  select.addEventListener("change", () => {
    const { target } = store.switch(select.value, studio.snapshot());
    if (target) {
      if (target.snapshot) {
        studio.loadArchitecture(target.snapshot);
      } else {
        studio.applyTemplate("blank");
      }
    }
    render();
  });

  if (newButton) {
    newButton.addEventListener("click", () => {
      const name = window.prompt("Name the new session", "New architecture");
      if (name === null) return;
      const { created } = store.create(name.trim() || undefined, studio.snapshot());
      if (created) studio.applyTemplate("blank");
      render();
    });
  }

  if (deleteButton) {
    deleteButton.addEventListener("click", () => {
      const doc = store.list();
      const active = doc.sessions.find((s) => s.id === doc.activeId);
      if (!active || doc.sessions.length <= 1) return;
      if (!window.confirm(`Delete session "${active.name}"?`)) return;
      const { active: next } = store.remove(active.id);
      if (next) {
        if (next.snapshot) studio.loadArchitecture(next.snapshot);
        else studio.applyTemplate("blank");
      }
      render();
    });
  }

  // Keep the session name in sync with the architecture name field.
  if (nameInput) {
    nameInput.addEventListener("change", () => {
      store.renameActive(nameInput.value.trim());
      render();
    });
  }

  // Autosave the active session periodically and when leaving.
  const persist = () => store.saveActive(studio.snapshot());
  window.setInterval(persist, 10000);
  window.addEventListener("beforeunload", persist);

  // First run: adopt the current architecture into the active session.
  persist();
  render();
  return store;
}
