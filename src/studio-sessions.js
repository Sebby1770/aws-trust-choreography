/**
 * Studio pages — multiple named architectures, each auto-saved and shown as
 * page tabs along the bottom of the diagram studio (like draw.io pages).
 *
 * The store is storage-agnostic (any object with getItem/setItem) so it can
 * be unit-tested without a browser; the studio wires it to its page tabs.
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
    /**
     * Create a new session (saving `currentSnapshot` into the old one first).
     * `snapshot` seeds the new session, which is how a page is duplicated.
     */
    create(name, currentSnapshot, snapshot = "") {
      const doc = read();
      if (typeof currentSnapshot === "string") {
        const active = doc.sessions.find((s) => s.id === doc.activeId);
        if (active) active.snapshot = currentSnapshot;
      }
      if (doc.sessions.length >= MAX_SESSIONS) return { doc: write(doc), created: null };
      const session = {
        id: makeId(doc.sessions),
        name: (name || `Session ${doc.sessions.length + 1}`).slice(0, 60),
        snapshot: typeof snapshot === "string" ? snapshot : "",
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
      return this.rename(doc.activeId, name);
    },
    /** Rename any session. */
    rename(id, name) {
      const doc = read();
      const session = doc.sessions.find((s) => s.id === id);
      if (session && typeof name === "string" && name.trim())
        session.name = name.trim().slice(0, 60);
      return write(doc);
    },
    /** Move a session to a new position in the tab order. */
    move(id, toIndex) {
      const doc = read();
      const from = doc.sessions.findIndex((s) => s.id === id);
      if (from < 0) return doc;
      const [session] = doc.sessions.splice(from, 1);
      doc.sessions.splice(Math.max(0, Math.min(doc.sessions.length, toIndex)), 0, session);
      return write(doc);
    },
    maxSessions: MAX_SESSIONS,
  };
}
