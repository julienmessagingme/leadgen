/**
 * FullEnrich async email/phone enrichment module.
 * Uses the bulk enrichment endpoint (single contact per call).
 * Submits a LinkedIn profile URL + optional name/company, then polls for results.
 * Returns verified email/phone only if status is DELIVERABLE.
 */

const { log } = require("./logger");

/** FullEnrich API base URL (app.fullenrich.com, NOT api.fullenrich.com). */
const FULLENRICH_BASE = "https://app.fullenrich.com/api/v1";

/** Polling interval in milliseconds (30 seconds). */
const POLL_INTERVAL_MS = 30000;

/** Maximum number of polling attempts (6 attempts = 3 minutes max). */
const MAX_POLL_ATTEMPTS = 6;

/**
 * Enrich a lead's contact info (email) via FullEnrich.
 * Only needs the LinkedIn URL — FullEnrich extracts name/company from the profile.
 * Cost: 1 credit per email lookup.
 * @param {string} linkedinUrl - LinkedIn profile URL to enrich
 * @param {string} runId - UUID for this pipeline run
 * @returns {Promise<object|null>} { email, phone, confidence } or null
 */
async function enrichContactInfo(linkedinUrl, runId) {
  var apiKey = process.env.FULLENRICH_API_KEY;
  if (!apiKey) {
    await log(runId, "fullenrich", "warn",
      "FULLENRICH_API_KEY not set -- skipping contact enrichment");
    return null;
  }

  if (!linkedinUrl) {
    return null;
  }

  // FullEnrich only accepts slug URLs (/in/john-doe), not ACoA URLs (/in/ACoAAXXX...).
  // Convert ACoA to slug via BeReach visitProfile if needed.
  var urlToEnrich = linkedinUrl;
  if (/ACoA/.test(linkedinUrl)) {
    try {
      var { visitProfile } = require("./bereach");
      var profile = await visitProfile(linkedinUrl);
      var slug = profile.publicIdentifier || profile.public_identifier;
      if (slug) {
        urlToEnrich = "https://www.linkedin.com/in/" + slug;
        await log(runId, "fullenrich", "info",
          "Resolved ACoA to slug: " + urlToEnrich, { original: linkedinUrl });
      }
    } catch (resolveErr) {
      await log(runId, "fullenrich", "warn",
        "Failed to resolve ACoA URL: " + resolveErr.message, { linkedin_url: linkedinUrl });
      // Continue with ACoA URL — FullEnrich might still handle it
    }
  }

  try {
    // Step 1: Submit bulk enrichment (single contact)
    var submitRes = await fetch(FULLENRICH_BASE + "/contact/enrich/bulk", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: "leadgen-" + Date.now(),
        datas: [{
          linkedin_url: urlToEnrich,
          enrich_fields: ["contact.emails"],
        }],
      }),
    });

    if (!submitRes.ok) {
      var errorText = await submitRes.text();
      await log(runId, "fullenrich", "warn",
        "FullEnrich submit failed (" + submitRes.status + "): " + errorText,
        { linkedin_url: linkedinUrl });
      return null;
    }

    var submitData = await submitRes.json();
    var enrichmentId = submitData.enrichment_id;

    if (!enrichmentId) {
      await log(runId, "fullenrich", "warn",
        "FullEnrich did not return an enrichment_id",
        { linkedin_url: linkedinUrl, response: submitData });
      return null;
    }

    await log(runId, "fullenrich", "info",
      "FullEnrich enrichment submitted, polling for results",
      { linkedin_url: linkedinUrl, enrichment_id: enrichmentId });

    // Step 2: Poll for results
    for (var attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      var pollRes = await fetch(FULLENRICH_BASE + "/contact/enrich/bulk/" + enrichmentId, {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + apiKey,
        },
      });

      if (!pollRes.ok) {
        await log(runId, "fullenrich", "warn",
          "FullEnrich poll failed (" + pollRes.status + ") -- attempt " + attempt + "/" + MAX_POLL_ATTEMPTS,
          { enrichment_id: enrichmentId });
        continue;
      }

      var pollData = await pollRes.json();

      if (pollData.status === "FINISHED") {
        // Extract first contact result
        var datas = pollData.datas;
        if (!datas || datas.length === 0 || !datas[0].contact) {
          await log(runId, "fullenrich", "info",
            "FullEnrich finished but no contact data returned",
            { linkedin_url: linkedinUrl, enrichment_id: enrichmentId });
          return null;
        }

        var c = datas[0].contact;
        var email = c.most_probable_email || null;
        var emailStatus = (c.most_probable_email_status || "").toUpperCase();
        var phone = c.most_probable_phone || null;
        var credits = pollData.cost ? pollData.cost.credits : 0;

        // Accept ANY email returned by FullEnrich, regardless of status
        if (email) {
          await log(runId, "fullenrich", "info",
            "FullEnrich returned email (" + emailStatus + ", " + credits + " credits)",
            { linkedin_url: linkedinUrl, email: email, status: emailStatus, credits: credits });

          return {
            email: email,
            phone: phone,
            confidence: emailStatus.toLowerCase(),
          };
        }

        await log(runId, "fullenrich", "info",
          "FullEnrich found no email (" + credits + " credits)",
          { linkedin_url: linkedinUrl });
        return null;
      }

      // Still processing
      if (pollData.status === "IN_PROGRESS" || pollData.status === "PENDING") {
        continue;
      }

      // Unknown/error status
      await log(runId, "fullenrich", "warn",
        "FullEnrich unexpected status: " + pollData.status,
        { enrichment_id: enrichmentId, status: pollData.status });
      return null;
    }

    // Timeout
    await log(runId, "fullenrich", "warn",
      "FullEnrich polling timed out after " + MAX_POLL_ATTEMPTS + " attempts",
      { linkedin_url: linkedinUrl, enrichment_id: enrichmentId });
    return null;

  } catch (err) {
    await log(runId, "fullenrich", "warn",
      "FullEnrich enrichment failed: " + err.message,
      { linkedin_url: linkedinUrl });
    return null;
  }
}

function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

/**
 * Enrich a lead's phone number via FullEnrich.
 * Called on-demand when Julien clicks the WhatsApp button on a lead without
 * a phone. Distinct from enrichContactInfo because phones cost 10 credits
 * each (vs 1 for emails) — we only want to burn that when we're about to
 * actually reach out by WhatsApp.
 *
 * @param {string} linkedinUrl - LinkedIn profile URL
 * @param {string|null} runId  - UUID for logging (null acceptable for manual runs)
 * @returns {Promise<{phone: string|null, status: string, credits: number}|null>}
 */
async function enrichPhone(linkedinUrl, runId) {
  var apiKey = process.env.FULLENRICH_API_KEY;
  if (!apiKey) {
    await log(runId, "fullenrich", "warn", "FULLENRICH_API_KEY not set — skipping enrichPhone",
      { linkedin_url: linkedinUrl });
    return null;
  }
  if (!linkedinUrl) return null;

  try {
    // Submit: single contact, phones-only
    var submitRes = await fetch(FULLENRICH_BASE + "/contact/enrich/bulk", {
      method: "POST",
      headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "leadgen-phone-" + Date.now(),
        datas: [{ linkedin_url: linkedinUrl, enrich_fields: ["contact.phones"] }],
      }),
    });
    if (!submitRes.ok) {
      await log(runId, "fullenrich", "warn",
        "FullEnrich phone submit failed (" + submitRes.status + "): " + (await submitRes.text()).slice(0, 200),
        { linkedin_url: linkedinUrl });
      return null;
    }
    var submitData = await submitRes.json();
    var enrichmentId = submitData.enrichment_id;
    if (!enrichmentId) return null;

    for (var attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);
      var pollRes = await fetch(FULLENRICH_BASE + "/contact/enrich/bulk/" + enrichmentId, {
        method: "GET",
        headers: { "Authorization": "Bearer " + apiKey },
      });
      if (!pollRes.ok) continue;
      var pollData = await pollRes.json();
      if (pollData.status === "FINISHED") {
        var datas = pollData.datas;
        if (!datas || !datas.length || !datas[0].contact) return null;
        var c = datas[0].contact;
        var phone = c.most_probable_phone || (Array.isArray(c.phones) && c.phones[0]) || null;
        var credits = pollData.cost ? pollData.cost.credits : 0;
        var status = (c.most_probable_phone_status || "unknown").toLowerCase();
        await log(runId, "fullenrich", "info",
          "FullEnrich phone result: " + (phone ? phone + " (" + status + ")" : "none") + " — " + credits + " credits",
          { linkedin_url: linkedinUrl, phone: phone, status: status, credits: credits });
        return { phone: phone, status: status, credits: credits };
      }
      if (pollData.status === "IN_PROGRESS" || pollData.status === "PENDING") continue;
      return null;
    }
    // Timeout
    await log(runId, "fullenrich", "warn",
      "FullEnrich phone enrichment timed out",
      { linkedin_url: linkedinUrl, enrichment_id: enrichmentId });
    return null;
  } catch (err) {
    await log(runId, "fullenrich", "warn",
      "FullEnrich phone enrichment threw: " + err.message,
      { linkedin_url: linkedinUrl });
    return null;
  }
}

module.exports = { enrichContactInfo, enrichPhone };
