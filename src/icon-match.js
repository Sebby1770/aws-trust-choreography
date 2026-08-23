/**
 * Catalog icon matching — the single definition of "which icon is this service?".
 *
 * Flow Studio resolves a service name to a catalog icon when restoring a saved
 * architecture, importing JSON, or importing infrastructure as code. If a name
 * fails to match, the node is silently dropped, so the rule lives here on its
 * own and is covered by a test that walks every service name the IaC importer
 * can emit against the real 862-icon catalog.
 */

/**
 * Resolve a service name to a catalog icon.
 *
 * Exact match on the preferred type wins, then a substring match on that type,
 * then a substring match anywhere in the catalog.
 *
 * @param {Array<{name: string, type: string}>} catalog
 * @param {string} name
 * @param {string} [preferredType]
 * @returns {object|undefined}
 */
export function matchIcon(catalog, name, preferredType = "service") {
  const normalized = String(name || "").toLowerCase();
  if (!normalized) return undefined;
  const icons = Array.isArray(catalog) ? catalog : [];
  return (
    icons.find((icon) => icon.type === preferredType && icon.name.toLowerCase() === normalized) ||
    icons.find(
      (icon) => icon.type === preferredType && icon.name.toLowerCase().includes(normalized)
    ) ||
    icons.find((icon) => icon.name.toLowerCase().includes(normalized))
  );
}
