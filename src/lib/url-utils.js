/**
 * LinkedIn URL canonicalization.
 * Normalizes LinkedIn profile URLs to a single canonical form for dedup.
 *
 * Canonical form: https://www.linkedin.com/in/{handle}
 * - Lowercase
 * - No trailing slash
 * - No query params or hash
 * - No locale prefix (/fr/in/name -> /in/name)
 */

function canonicalizeLinkedInUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url);

    // Lowercase the path
    let path = parsed.pathname.toLowerCase();

    // Remove trailing slashes
    path = path.replace(/\/+$/, "");

    // Remove locale prefix (e.g., /fr/in/name -> /in/name, /pt-br/in/name -> /in/name)
    path = path.replace(/^\/[a-z]{2}(-[a-z]{2})?\/in\//, "/in/");

    // Strip query params and hash by reconstructing URL
    return "https://www.linkedin.com" + path;
  } catch (_err) {
    // Fallback: basic string normalization if URL constructor fails
    try {
      let normalized = url.toLowerCase().trim();
      // Remove query params
      normalized = normalized.replace(/\?.*$/, "");
      // Remove hash
      normalized = normalized.replace(/#.*$/, "");
      // Remove trailing slashes
      normalized = normalized.replace(/\/+$/, "");
      return normalized;
    } catch (_e) {
      return null;
    }
  }
}

module.exports = { canonicalizeLinkedInUrl };
