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
 * Enrich a lead's contact info (email/phone) via FullEnrich.
 * @param {string} linkedinUrl - LinkedIn profile URL to enrich
 * @param {string} runId - UUID for this pipeline run
 * @param {object} [extra] - Optional { firstName, lastName, companyName } to improve match rate
 * @returns {Promise<object|null>} { email, phone, confidence } or null
 */
async function enrichContactInfo(linkedinUrl, runId, extra) {
  var apiKey = process.env.FULLENRICH_API_KEY;
  if (!apiKey) {
    await log(runId, "fullenrich", "warn",
      "FULLENRICH_API_KEY not set -- skipping contact enrichment");
    return null;
  }

  if (!linkedinUrl) {
    return null;
  }

  // Build contact object — linkedin_url is the primary input
  var contact = {
    linkedin_url: linkedinUrl,
    enrich_fields: ["contact.emails"],
  };
  if (extra) {
    if (extra.firstName) contact.firstname = extra.firstName;
    if (extra.lastName) contact.lastname = extra.lastName;
    if (extra.companyName) contact.company_name = extra.companyName;
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
        datas: [contact],
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

        // Only return if email is DELIVERABLE
        if (email && emailStatus === "DELIVERABLE") {
          await log(runId, "fullenrich", "info",
            "FullEnrich returned verified email (" + credits + " credits)",
            { linkedin_url: linkedinUrl, email: email, has_phone: !!phone, credits: credits });

          return {
            email: email,
            phone: phone,
            confidence: "high",
          };
        }

        // Email found but not deliverable
        if (email) {
          await log(runId, "fullenrich", "info",
            "FullEnrich email not deliverable: " + emailStatus + " (" + credits + " credits)",
            { linkedin_url: linkedinUrl, email: email, status: emailStatus });
        } else {
          await log(runId, "fullenrich", "info",
            "FullEnrich found no email (" + credits + " credits)",
            { linkedin_url: linkedinUrl });
        }
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

module.exports = { enrichContactInfo };
