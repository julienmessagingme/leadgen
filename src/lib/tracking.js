const crypto = require("crypto");

// Must be a non-empty string to avoid crypto.createHmac crashing.
// Falls back to a known-insecure constant with a loud warning so local dev works
// but production deployments are obviously misconfigured.
const SECRET = process.env.TRACKING_SECRET
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || "leadgen-insecure-dev-only-secret-do-not-use-in-prod";
if (SECRET === "leadgen-insecure-dev-only-secret-do-not-use-in-prod") {
  console.warn("WARNING: TRACKING_SECRET is not set. Using insecure fallback — tracking tokens are forgeable.");
}
const PUBLIC_URL = process.env.PUBLIC_TRACKING_URL || "https://leadgen.messagingme.app";
const TRACKING_ENABLED = process.env.EMAIL_TRACKING_ENABLED !== "false";

/**
 * Allowlist of host suffixes that we are willing to 302-redirect to.
 * Prevents open-redirect phishing: an attacker who has any valid tracking token
 * cannot use it to redirect victims to arbitrary sites.
 *
 * Add to TRACKING_ALLOWED_DOMAINS env var (comma-separated suffixes) to extend.
 * Default allowlist covers the only outbound links we currently send in emails.
 */
const DEFAULT_ALLOWED_SUFFIXES = [
  "calendly.com",
  "messagingme.fr",
  "messagingme.app",
  "messagingme.com",
];

const ALLOWED_SUFFIXES = (process.env.TRACKING_ALLOWED_DOMAINS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
  .concat(DEFAULT_ALLOWED_SUFFIXES);

/**
 * Returns true only if the target URL is HTTPS and its hostname matches
 * (or is a subdomain of) one of the allowed suffixes.
 */
function isSafeRedirectTarget(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    // Block our own /track/ path to prevent loops
    if (parsed.pathname.startsWith("/track/")) return false;
    // Match exact hostname or any subdomain of an allowed suffix
    return ALLOWED_SUFFIXES.some((suffix) => {
      return hostname === suffix || hostname.endsWith("." + suffix);
    });
  } catch (e) {
    return false;
  }
}

/**
 * Generate a tracking token for (leadId, emailType).
 * Token is short (16 hex chars) and not reversible without SECRET.
 */
function generateToken(leadId, emailType) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(String(leadId) + ":" + emailType)
    .digest("hex")
    .substring(0, 16);
}

/**
 * Verify a token against (leadId, emailType).
 * Used by tracking endpoints to authenticate the URL without storing tokens.
 */
function verifyToken(token, leadId, emailType) {
  return generateToken(leadId, emailType) === token;
}

/**
 * Build a click-tracking URL that wraps a target URL.
 * Format: https://<PUBLIC_URL>/track/click/<leadId>/<emailType>/<token>?to=<encoded_target>
 */
function buildClickUrl(leadId, emailType, targetUrl) {
  if (!TRACKING_ENABLED) return targetUrl;
  const token = generateToken(leadId, emailType);
  const encoded = encodeURIComponent(targetUrl);
  return `${PUBLIC_URL}/track/click/${leadId}/${emailType}/${token}?to=${encoded}`;
}

/**
 * Build an open-tracking pixel URL.
 * Format: https://<PUBLIC_URL>/track/open/<leadId>/<emailType>/<token>.png
 */
function buildOpenPixelUrl(leadId, emailType) {
  if (!TRACKING_ENABLED) return null;
  const token = generateToken(leadId, emailType);
  return `${PUBLIC_URL}/track/open/${leadId}/${emailType}/${token}.png`;
}

/**
 * Inject click + open tracking into an HTML email body.
 * 1. Rewrites all <a href="https://..."> links to go through /track/click
 * 2. Appends a 1x1 invisible pixel <img> for open tracking
 *
 * @param {string} htmlBody - Original HTML body
 * @param {number} leadId - Lead ID
 * @param {string} emailType - "email_1" or "email_followup"
 * @returns {string} Modified HTML with tracking injected
 */
function injectTracking(htmlBody, leadId, emailType) {
  if (!TRACKING_ENABLED || !htmlBody) return htmlBody;

  // Idempotency guard: if tracking is already injected, return as-is.
  // Prevents double-injection if a wrapper accidentally calls this twice.
  if (htmlBody.indexOf("/track/click/") !== -1) return htmlBody;

  // Rewrite href="..." links — match http(s) URLs only, leave mailto:/tel: alone
  let modified = htmlBody.replace(
    /href=(["'])(https?:\/\/[^"']+)\1/gi,
    function(match, quote, url) {
      const tracked = buildClickUrl(leadId, emailType, url);
      return `href=${quote}${tracked}${quote}`;
    }
  );

  // Append 1x1 open tracking pixel before </body> or at end
  const pixelUrl = buildOpenPixelUrl(leadId, emailType);
  const pixelTag = `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none;border:0" />`;
  if (/<\/body>/i.test(modified)) {
    modified = modified.replace(/<\/body>/i, pixelTag + "</body>");
  } else {
    modified = modified + pixelTag;
  }

  return modified;
}

module.exports = {
  generateToken,
  verifyToken,
  buildClickUrl,
  buildOpenPixelUrl,
  injectTracking,
  isSafeRedirectTarget,
};
