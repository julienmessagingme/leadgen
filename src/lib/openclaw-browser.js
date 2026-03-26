/**
 * OpenClaw browser automation for Sales Navigator enrichment.
 * Calls the OpenClaw loopback HTTP API (localhost:18791) to navigate
 * Sales Navigator for a given LinkedIn profile.
 *
 * This is a nice-to-have enrichment source. If OpenClaw is not running
 * or returns an error, the function returns null gracefully.
 * The pipeline MUST NOT fail if OpenClaw is unavailable.
 */

const OPENCLAW_BASE = "http://localhost:18791";

/**
 * Enrich a lead from Sales Navigator via OpenClaw browser automation.
 * @param {string} linkedinUrl - LinkedIn profile URL
 * @returns {Promise<object|null>} Enrichment data or null if unavailable
 */
async function enrichFromSalesNav(linkedinUrl) {
  if (!linkedinUrl) return null;

  try {
    // Convert LinkedIn profile URL to Sales Navigator URL pattern
    // e.g., https://www.linkedin.com/in/john-doe -> Sales Nav search
    const res = await fetch(OPENCLAW_BASE + "/api/browse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: linkedinUrl,
        action: "sales_nav_profile",
        timeout: 30000,
      }),
      signal: AbortSignal.timeout(35000),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn("OpenClaw Sales Nav returned " + res.status + ": " + text);
      return null;
    }

    const data = await res.json();

    // Extract seniority and additional data points from Sales Nav
    return {
      seniority_years: data.seniority_years || data.yearsInRole || null,
      sales_nav_alerts: data.alerts || [],
      sales_nav_tags: data.tags || [],
      sales_nav_connections: data.connections || null,
      sales_nav_raw: data,
    };
  } catch (err) {
    // ECONNREFUSED means OpenClaw is not running -- expected scenario
    if (err.code === "ECONNREFUSED" || err.cause?.code === "ECONNREFUSED") {
      console.warn("OpenClaw not running (ECONNREFUSED) -- skipping Sales Nav enrichment");
    } else if (err.name === "TimeoutError" || err.name === "AbortError") {
      console.warn("OpenClaw request timed out -- skipping Sales Nav enrichment");
    } else {
      console.warn("OpenClaw Sales Nav failed: " + err.message + " -- skipping");
    }
    return null;
  }
}

module.exports = { enrichFromSalesNav };
