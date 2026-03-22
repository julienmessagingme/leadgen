/**
 * Cold outbound execution pipeline.
 * Orchestrates: scrape Sales Nav -> dedup -> enrich emails -> score ICP -> insert leads.
 *
 * Modeled after task-a-signals.js pipeline pattern:
 * - Error isolation per lead (one failure does not crash batch)
 * - Status updates at each step for real-time polling
 * - Completion email notification
 *
 * CommonJS module.
 */

const { supabase } = require("./supabase");
const { log } = require("./logger");
const { searchSalesNav } = require("./sales-nav-scraper");
const { enrichContactInfo } = require("./fullenrich");
const { scoreLead, loadIcpRules } = require("./icp-scorer");
const { sendEmail } = require("./gmail");
const { canonicalizeLinkedInUrl } = require("./url-utils");
const { humanDelay } = require("./browser");

/**
 * Execute a cold outbound search pipeline.
 *
 * @param {string} searchId - UUID of the cold_searches record
 * @param {object} filters - Search filters { sector, company_size, job_title, geography, max_leads }
 * @param {string} runId - UUID for this pipeline run (for logging)
 */
async function executeColdSearch(searchId, filters, runId) {
  var leadsFound = 0;
  var leadsEnriched = 0;
  var leadsWithEmail = 0;
  var leadsInserted = 0;

  try {
    // ── Step 1: Update search status to 'running' ──────────────────
    await supabase.from("cold_searches").update({ status: "running" }).eq("id", searchId);
    await log(runId, "cold-pipeline", "info", "Cold search started", { searchId, filters });

    // ── Step 2: Scrape Sales Navigator ─────────────────────────────
    await log(runId, "cold-pipeline", "info", "Starting Sales Nav scrape");
    var scrapeResult = await searchSalesNav(filters, runId);
    var profiles = scrapeResult.profiles || [];
    leadsFound = profiles.length;

    await supabase.from("cold_searches").update({ leads_found: leadsFound }).eq("id", searchId);
    await log(runId, "cold-pipeline", "info", "Sales Nav scrape complete: " + leadsFound + " profiles found", {
      pages_consumed: scrapeResult.pages_consumed,
      stopped_reason: scrapeResult.stopped_reason,
    });

    if (leadsFound === 0) {
      await supabase
        .from("cold_searches")
        .update({ status: "completed", leads_found: 0, leads_enriched: 0, completed_at: new Date().toISOString() })
        .eq("id", searchId);
      await sendCompletionEmail(filters, 0, 0, 0, searchId, null);
      return;
    }

    // ── Step 3: Dedup against existing leads ───────────────────────
    var dedupedProfiles = [];
    var dupCount = 0;

    for (var i = 0; i < profiles.length; i++) {
      var profile = profiles[i];
      var canonical = canonicalizeLinkedInUrl(profile.linkedin_url || profile.profileUrl);
      if (!canonical) {
        await log(runId, "cold-pipeline", "warn", "Profile skipped: no valid LinkedIn URL", { profile });
        continue;
      }

      var { data: existing } = await supabase
        .from("leads")
        .select("id")
        .eq("linkedin_url_canonical", canonical)
        .limit(1);

      if (existing && existing.length > 0) {
        dupCount++;
        continue;
      }

      dedupedProfiles.push({ ...profile, linkedin_url: profile.linkedin_url || profile.profileUrl, linkedin_url_canonical: canonical });
    }

    await log(runId, "cold-pipeline", "info",
      "Dedup complete: " + dedupedProfiles.length + " new, " + dupCount + " duplicates skipped");

    if (dedupedProfiles.length === 0) {
      await supabase
        .from("cold_searches")
        .update({ status: "completed", leads_found: leadsFound, leads_enriched: 0, completed_at: new Date().toISOString() })
        .eq("id", searchId);
      await sendCompletionEmail(filters, leadsFound, 0, 0, searchId, null);
      return;
    }

    // ── Step 4: Enrich each lead (email lookup) ────────────────────
    var enrichedLeads = [];

    for (var j = 0; j < dedupedProfiles.length; j++) {
      var lead = dedupedProfiles[j];
      try {
        await log(runId, "cold-pipeline", "info",
          "Enriching lead " + (j + 1) + "/" + dedupedProfiles.length + ": " + (lead.name || lead.first_name || "unknown"));

        // Try FullEnrich for email
        var contactInfo = null;
        if (lead.linkedin_url) {
          contactInfo = await enrichContactInfo(lead.linkedin_url, runId);
        }

        var emailStatus = "no_email";
        var email = null;
        var phone = null;

        if (contactInfo && contactInfo.email) {
          email = contactInfo.email;
          phone = contactInfo.phone || null;
          emailStatus = "found";
          leadsWithEmail++;
        }

        // Parse name if only full name available
        var firstName = lead.first_name || lead.firstName || "";
        var lastName = lead.last_name || lead.lastName || "";
        if (!firstName && lead.name) {
          var nameParts = lead.name.trim().split(/\s+/);
          firstName = nameParts[0] || "";
          lastName = nameParts.slice(1).join(" ") || "";
        }

        enrichedLeads.push({
          linkedin_url: lead.linkedin_url,
          linkedin_url_canonical: lead.linkedin_url_canonical,
          first_name: firstName,
          last_name: lastName,
          headline: lead.headline || lead.title || null,
          company_name: lead.company || lead.company_name || null,
          email: email,
          phone: phone,
          email_status: emailStatus,
          cold_outbound: true,
        });

        leadsEnriched++;
        await supabase.from("cold_searches").update({ leads_enriched: leadsEnriched }).eq("id", searchId);

        // Human delay between enrichment calls
        if (j < dedupedProfiles.length - 1) {
          await humanDelay(2000, 5000);
        }
      } catch (err) {
        await log(runId, "cold-pipeline", "warn",
          "Enrichment failed for lead: " + (lead.name || lead.linkedin_url) + " - " + err.message);
        // Still add lead with no email (per CONTEXT: keep leads without email)
        var fn = lead.first_name || lead.firstName || "";
        var ln = lead.last_name || lead.lastName || "";
        if (!fn && lead.name) {
          var np = lead.name.trim().split(/\s+/);
          fn = np[0] || "";
          ln = np.slice(1).join(" ") || "";
        }
        enrichedLeads.push({
          linkedin_url: lead.linkedin_url,
          linkedin_url_canonical: lead.linkedin_url_canonical,
          first_name: fn,
          last_name: ln,
          headline: lead.headline || lead.title || null,
          company_name: lead.company || lead.company_name || null,
          email: null,
          phone: null,
          email_status: "no_email",
          cold_outbound: true,
        });
        leadsEnriched++;
        await supabase.from("cold_searches").update({ leads_enriched: leadsEnriched }).eq("id", searchId);
      }
    }

    // ── Step 5: Score ICP for cold leads ───────────────────────────
    await log(runId, "cold-pipeline", "info", "Starting ICP scoring for " + enrichedLeads.length + " leads");
    var icpRules = await loadIcpRules();
    var scoredLeads = [];

    for (var k = 0; k < enrichedLeads.length; k++) {
      try {
        var leadToScore = {
          full_name: (enrichedLeads[k].first_name + " " + enrichedLeads[k].last_name).trim(),
          first_name: enrichedLeads[k].first_name,
          last_name: enrichedLeads[k].last_name,
          headline: enrichedLeads[k].headline,
          company_name: enrichedLeads[k].company_name,
          company_size: null,
          company_sector: null,
          location: null,
          signal_category: "cold_outbound",
          signal_date: new Date().toISOString(),
          cold_outbound: true,
        };

        var scored = await scoreLead(leadToScore, [], icpRules, runId);
        scoredLeads.push({
          ...enrichedLeads[k],
          icp_score: scored.icp_score,
          tier: scored.tier,
          scoring_metadata: scored.scoring_metadata,
        });
      } catch (err) {
        await log(runId, "cold-pipeline", "warn",
          "ICP scoring failed for lead: " + enrichedLeads[k].first_name + " - " + err.message);
        scoredLeads.push({
          ...enrichedLeads[k],
          icp_score: 0,
          tier: "cold",
          scoring_metadata: { reasoning: "Scoring error", error: err.message },
        });
      }
    }

    // ── Step 6: Insert leads into pipeline ─────────────────────────
    await log(runId, "cold-pipeline", "info", "Inserting " + scoredLeads.length + " leads into pipeline");

    for (var m = 0; m < scoredLeads.length; m++) {
      var sl = scoredLeads[m];
      try {
        var leadRow = {
          linkedin_url: sl.linkedin_url,
          linkedin_url_canonical: sl.linkedin_url_canonical,
          first_name: sl.first_name || null,
          last_name: sl.last_name || null,
          headline: sl.headline || null,
          company_name: sl.company_name || null,
          email: sl.email || null,
          phone: sl.phone || null,
          icp_score: sl.icp_score || 0,
          tier: sl.tier || "cold",
          status: "new",
          signal_type: "cold_search",
          signal_category: "cold_outbound",
          signal_date: new Date().toISOString(),
          metadata: {
            search_id: searchId,
            source_origin: "sales_nav",
            email_status: sl.email_status || "no_email",
            cold_outbound: true,
            scoring_metadata: sl.scoring_metadata || null,
          },
        };

        // Upsert on linkedin_url_canonical: update score if higher
        var { error: upsertError } = await supabase
          .from("leads")
          .upsert(leadRow, { onConflict: "linkedin_url_canonical" });

        if (upsertError) {
          await log(runId, "cold-pipeline", "warn",
            "Lead upsert failed: " + sl.first_name + " " + sl.last_name + " - " + upsertError.message);
        } else {
          leadsInserted++;
        }
      } catch (err) {
        await log(runId, "cold-pipeline", "warn",
          "Lead insert error: " + (sl.first_name || "") + " - " + err.message);
      }
    }

    // ── Step 7: Finalize search record ─────────────────────────────
    await supabase
      .from("cold_searches")
      .update({
        status: "completed",
        leads_found: leadsFound,
        leads_enriched: leadsEnriched,
        completed_at: new Date().toISOString(),
      })
      .eq("id", searchId);

    await log(runId, "cold-pipeline", "info", "Cold search completed successfully", {
      searchId, leadsFound, leadsEnriched, leadsWithEmail, leadsInserted,
    });

    // ── Step 8: Send completion email ──────────────────────────────
    await sendCompletionEmail(filters, leadsFound, leadsEnriched, leadsWithEmail, searchId, null);

  } catch (err) {
    // Global error handler
    console.error("Cold search pipeline error:", err.message);
    await log(runId, "cold-pipeline", "error", "Cold search pipeline failed: " + err.message);

    await supabase
      .from("cold_searches")
      .update({
        status: "error",
        error_message: err.message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", searchId);

    await sendCompletionEmail(filters, leadsFound, leadsEnriched, leadsWithEmail, searchId, err.message);
  }
}

/**
 * Send completion/error notification email to Julien.
 */
async function sendCompletionEmail(filters, leadsFound, leadsEnriched, leadsWithEmail, searchId, errorMessage) {
  try {
    var to = process.env.GMAIL_USER;
    if (!to) {
      console.warn("GMAIL_USER not set, skipping completion email");
      return;
    }

    var subject;
    var body;

    if (errorMessage) {
      subject = "Recherche cold ERREUR - " + (leadsFound || 0) + " leads trouves";
      body = "<h2>Recherche cold outbound terminee avec erreur</h2>" +
        "<p><strong>Erreur:</strong> " + errorMessage + "</p>" +
        "<p><strong>Filtres:</strong></p><ul>" +
        "<li>Secteur: " + (filters.sector || "N/A") + "</li>" +
        "<li>Titre: " + (filters.job_title || "N/A") + "</li>" +
        "<li>Taille: " + (filters.company_size || "N/A") + "</li>" +
        "<li>Geographie: " + (filters.geography || "N/A") + "</li>" +
        "<li>Max leads: " + (filters.max_leads || "N/A") + "</li>" +
        "</ul>" +
        "<p><strong>Leads trouves avant erreur:</strong> " + leadsFound + "</p>" +
        "<p><strong>Search ID:</strong> " + searchId + "</p>";
    } else {
      subject = "Recherche cold terminee - " + leadsFound + " leads trouves";
      body = "<h2>Recherche cold outbound terminee</h2>" +
        "<p><strong>Filtres:</strong></p><ul>" +
        "<li>Secteur: " + (filters.sector || "N/A") + "</li>" +
        "<li>Titre: " + (filters.job_title || "N/A") + "</li>" +
        "<li>Taille: " + (filters.company_size || "N/A") + "</li>" +
        "<li>Geographie: " + (filters.geography || "N/A") + "</li>" +
        "<li>Max leads: " + (filters.max_leads || "N/A") + "</li>" +
        "</ul>" +
        "<p><strong>Resultats:</strong></p><ul>" +
        "<li>Leads trouves (Sales Nav): " + leadsFound + "</li>" +
        "<li>Leads enrichis: " + leadsEnriched + "</li>" +
        "<li>Leads avec email: " + leadsWithEmail + "</li>" +
        "</ul>" +
        "<p><strong>Search ID:</strong> " + searchId + "</p>";
    }

    await sendEmail(to, subject, body);
  } catch (err) {
    console.error("Failed to send completion email:", err.message);
  }
}

module.exports = { executeColdSearch };
