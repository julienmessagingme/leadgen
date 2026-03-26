/**
 * FullEnrich async email/phone enrichment module.
 * Submits a LinkedIn profile URL for enrichment, then polls for results.
 * Returns verified email/phone only if confidence is high or medium.
 *
 * ENR-06: Enrichissement email/phone via FullEnrich
 *
 * FullEnrich is async: submit request, then poll until complete.
 * Webhook is not used -- polling is simpler for this use case.
 *
 * This module is created now (Phase 2) for the enrichment pipeline,
 * but is actively used before email outreach (Phase 3).
 */

const { log } = require("./logger");

/** FullEnrich API base URL. */
const FULLENRICH_BASE = "https://api.fullenrich.com/api/v1";

/** Polling interval in milliseconds (30 seconds). */
const POLL_INTERVAL_MS = 30000;

/** Maximum number of polling attempts (10 attempts = 5 minutes max). */
const MAX_POLL_ATTEMPTS = 10;

/** Accepted confidence levels for returning results. */
const ACCEPTED_CONFIDENCE = ["high", "medium"];

/**
 * Enrich a lead's contact info (email/phone) via FullEnrich.
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

  try {
    // Step 1: Submit enrichment request
    var submitRes = await fetch(FULLENRICH_BASE + "/enrich", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        linkedin_url: linkedinUrl,
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
    var enrichmentId = submitData.id || submitData.enrichment_id;

    if (!enrichmentId) {
      await log(runId, "fullenrich", "warn",
        "FullEnrich did not return an enrichment ID",
        { linkedin_url: linkedinUrl, response: submitData });
      return null;
    }

    await log(runId, "fullenrich", "info",
      "FullEnrich enrichment submitted, polling for results",
      { linkedin_url: linkedinUrl, enrichment_id: enrichmentId });

    // Step 2: Poll for results
    for (var attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      var pollRes = await fetch(FULLENRICH_BASE + "/enrich/" + enrichmentId, {
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

      // Check if enrichment is complete
      if (pollData.status === "completed" || pollData.status === "done") {
        var confidence = (pollData.confidence || pollData.email_confidence || "").toLowerCase();

        // Only return if confidence is high or medium
        if (ACCEPTED_CONFIDENCE.includes(confidence)) {
          await log(runId, "fullenrich", "info",
            "FullEnrich returned verified contact info",
            { linkedin_url: linkedinUrl, confidence: confidence, has_email: !!pollData.email, has_phone: !!pollData.phone });

          return {
            email: pollData.email || null,
            phone: pollData.phone || pollData.mobile_phone || null,
            confidence: confidence,
          };
        } else {
          await log(runId, "fullenrich", "info",
            "FullEnrich result confidence too low: " + confidence,
            { linkedin_url: linkedinUrl, confidence: confidence });
          return null;
        }
      }

      // Still processing
      if (pollData.status === "pending" || pollData.status === "processing") {
        continue;
      }

      // Unknown status -- likely an error
      await log(runId, "fullenrich", "warn",
        "FullEnrich unexpected status: " + pollData.status,
        { enrichment_id: enrichmentId, status: pollData.status });
      return null;
    }

    // Timeout: exhausted all poll attempts
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

/**
 * Sleep helper for polling delay.
 * @param {number} ms - Milliseconds to wait
 */
function sleep(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
}

module.exports = { enrichContactInfo };
