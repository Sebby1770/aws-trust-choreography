/**
 * Personalization profile — lets any visitor tailor the Command Atlas to their
 * own system (rename it, rename services, set their own confidence scores) and
 * keeps it in localStorage so it survives reloads. The atlas controller applies
 * the profile on load and writes back to it from edit mode.
 *
 * Profile shape: { title?, lede?, names?: {nodeKey: string}, scores?: {nodeKey: number} }
 */

const STORAGE_KEY = "aws-command-atlas-profile-v1";

export function emptyProfile() {
  return { title: "", lede: "", names: {}, scores: {} };
}

/** Coerce a value into a valid node score (integer in [12, 99]) or null. */
export function sanitizeScore(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(12, Math.min(99, n));
}

/** Normalize an arbitrary parsed object into a well-formed profile. */
export function normalizeProfile(raw) {
  const profile = emptyProfile();
  if (!raw || typeof raw !== "object") return profile;
  if (typeof raw.title === "string") profile.title = raw.title.slice(0, 80);
  if (typeof raw.lede === "string") profile.lede = raw.lede.slice(0, 240);
  if (raw.names && typeof raw.names === "object") {
    for (const [key, name] of Object.entries(raw.names)) {
      if (typeof name === "string" && name.trim()) profile.names[key] = name.slice(0, 48);
    }
  }
  if (raw.scores && typeof raw.scores === "object") {
    for (const [key, value] of Object.entries(raw.scores)) {
      const score = sanitizeScore(value);
      if (score !== null) profile.scores[key] = score;
    }
  }
  return profile;
}

export function loadProfile() {
  try {
    return normalizeProfile(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeProfile(profile)));
  } catch {
    /* storage unavailable */
  }
}

export function resetProfile() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the profile carries no customization. */
export function isProfileEmpty(profile) {
  const p = normalizeProfile(profile);
  return (
    !p.title && !p.lede && Object.keys(p.names).length === 0 && Object.keys(p.scores).length === 0
  );
}

/** Encode a profile into a compact, URL-safe string (base64url of JSON). */
export function encodeProfile(profile) {
  const json = JSON.stringify(normalizeProfile(profile));
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Decode a base64url profile string; returns an empty profile on any error. */
export function decodeProfile(value) {
  try {
    const b64 = String(value)
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(String(value).length / 4) * 4, "=");
    return normalizeProfile(JSON.parse(decodeURIComponent(escape(atob(b64)))));
  } catch {
    return emptyProfile();
  }
}

/**
 * Read a shared profile from the `p` parameter of a window's location hash.
 * Returns the decoded profile, or null when there is no (non-empty) shared
 * profile to apply.
 */
export function readSharedProfile(win = typeof window !== "undefined" ? window : undefined) {
  if (!win) return null;
  const params = new URLSearchParams(String(win.location.hash).replace(/^#/, ""));
  const encoded = params.get("p");
  if (!encoded) return null;
  const profile = decodeProfile(encoded);
  return isProfileEmpty(profile) ? null : profile;
}
