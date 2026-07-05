import { describe, it, expect } from "vitest";
import { createSessionStore, normalizeSessions } from "../src/studio-sessions.js";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

describe("normalizeSessions", () => {
  it("returns a default single session for junk input", () => {
    const doc = normalizeSessions(null);
    expect(doc.sessions).toHaveLength(1);
    expect(doc.activeId).toBe(doc.sessions[0].id);
  });

  it("keeps valid sessions and repairs a bad activeId", () => {
    const doc = normalizeSessions({
      activeId: "missing",
      sessions: [{ id: "s1", name: "One", snapshot: "{}" }],
    });
    expect(doc.activeId).toBe("s1");
    expect(doc.sessions[0].name).toBe("One");
  });
});

describe("createSessionStore", () => {
  it("creates, switches, and preserves per-session snapshots", () => {
    const store = createSessionStore(memoryStorage());
    // save work into the initial session
    store.saveActive('{"name":"First"}');
    // create a second session, carrying over the current snapshot save
    const { created } = store.create("Second", '{"name":"First"}');
    expect(created).not.toBeNull();
    expect(store.list().activeId).toBe(created.id);
    // work in session 2, then switch back to session 1
    const { target } = store.switch("s1", '{"name":"Second work"}');
    expect(target.snapshot).toBe('{"name":"First"}');
    // session 2 kept its own snapshot
    const doc = store.list();
    expect(doc.sessions.find((s) => s.id === created.id).snapshot).toBe('{"name":"Second work"}');
  });

  it("never deletes the last session", () => {
    const store = createSessionStore(memoryStorage());
    const { active } = store.remove("s1");
    expect(active.id).toBe("s1");
    expect(store.list().sessions).toHaveLength(1);
  });

  it("deletes a session and falls back to the first remaining one", () => {
    const store = createSessionStore(memoryStorage());
    const { created } = store.create("Two", "");
    const { active } = store.remove(created.id);
    expect(active.id).toBe("s1");
    expect(store.list().sessions).toHaveLength(1);
  });

  it("renames the active session", () => {
    const store = createSessionStore(memoryStorage());
    store.renameActive("Production payment flow");
    expect(store.list().sessions[0].name).toBe("Production payment flow");
  });

  it("caps the number of sessions", () => {
    const store = createSessionStore(memoryStorage());
    for (let i = 0; i < 15; i += 1) store.create(`S${i}`, "");
    expect(store.list().sessions.length).toBeLessThanOrEqual(12);
  });
});
