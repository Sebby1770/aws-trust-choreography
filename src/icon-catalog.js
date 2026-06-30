/**
 * Lazy loader for the 862-icon AWS architecture catalog (~327 KB).
 *
 * The data lives in a separate module that is dynamically imported, so the
 * bundler code-splits it into its own chunk and the browser only downloads it
 * the first time Flow Studio needs it — keeping the initial atlas paint light.
 */

let cached = null;

/**
 * Load the icon catalog once and memoize it.
 * @returns {Promise<{catalog: Array, meta: object}>}
 */
export async function loadIconCatalog() {
  if (cached) return cached;
  const module = await import("../assets/aws-icons/catalog.js");
  cached = {
    catalog: module.AWS_ICON_CATALOG || [],
    meta: module.AWS_ICON_CATALOG_META || { count: 0 },
  };
  return cached;
}
