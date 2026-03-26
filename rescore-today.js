/**
 * Re-score today's raw_signals without re-collecting from BeReach.
 * Reads from raw_signals table, dedup, enrich, score, insert leads.
 */
require("dotenv").config();
const crypto = require("crypto");
const { supabase } = require("./src/lib/supabase");
const { dedup } = require("./src/lib/dedup");
const { enrichLead } = require("./src/lib/enrichment");
const { gatherNewsEvidence } = require("./src/lib/news-evidence");
const { scoreLead, loadIcpRules } = require("./src/lib/icp-scorer");
const { sleep } = require("./src/lib/bereach");
const { log } = require("./src/lib/logger");

const runId = crypto.randomUUID();

async function rateLimitDelay() {
  await sleep(1000 + Math.floor(Math.random() * 2000));
}

async function main() {
  console.log("Re-scoring runId:", runId);
  console.log("Time:", new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" }));

  // Step 1: Read today's raw_signals
  var { data: rawSignals, error } = await supabase
    .from("raw_signals")
    .select("*")
    .gte("created_at", new Date().toISOString().split("T")[0] + "T00:00:00")
    .order("created_at", { ascending: true });

  if (error) throw new Error("Failed to read raw_signals: " + error.message);
  console.log("Raw signals loaded:", rawSignals.length);

  // Step 2: Dedup
  var uniqueSignals = await dedup(rawSignals, runId);
  console.log("After dedup:", uniqueSignals.length);

  // Step 3: Check daily quota
  var { count: todayCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date().toISOString().split("T")[0] + "T00:00:00");

  todayCount = todayCount || 0;
  var dailyLeadLimit = 50;
  try {
    var { data: limitSetting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "daily_lead_limit")
      .single();
    if (limitSetting && limitSetting.value) dailyLeadLimit = parseInt(limitSetting.value) || 50;
  } catch (e) {}

  var remaining = Math.max(0, dailyLeadLimit - todayCount);
  console.log("Daily quota:", todayCount + "/" + dailyLeadLimit + " used, " + remaining + " remaining");

  if (remaining === 0) {
    console.log("Daily quota reached, exiting");
    return;
  }

  var toProcess = uniqueSignals.slice(0, remaining);
  console.log("Will process:", toProcess.length, "signals");

  // Step 4: Load ICP rules
  var rules = await loadIcpRules();
  console.log("Loaded", rules.length, "ICP rules");

  // Step 5: Enrich + Score + Insert
  var inserted = 0;
  var skippedCold = 0;
  var errors = 0;

  for (var i = 0; i < toProcess.length; i++) {
    var signal = toProcess[i];
    try {
      // Enrich
      var enrichedLead = await enrichLead(signal, runId);
      await rateLimitDelay();

      // News evidence
      var newsEvidence = await gatherNewsEvidence(enrichedLead, runId);

      // Score
      var scoredLead = await scoreLead(enrichedLead, newsEvidence, rules, runId);

      // Filter cold
      if (scoredLead.tier === "cold") {
        console.log("  [" + (i+1) + "/" + toProcess.length + "] COLD skip: " +
          (scoredLead.first_name || "") + " " + (scoredLead.last_name || "") +
          " | " + (scoredLead.company_name || "") + " (score: " + scoredLead.icp_score + ")");
        skippedCold++;
        continue;
      }

      // Insert
      var leadRow = {
        linkedin_url: scoredLead.linkedin_url,
        linkedin_url_canonical: scoredLead.linkedin_url_canonical || null,
        first_name: scoredLead.first_name || null,
        last_name: scoredLead.last_name || null,
        full_name: ((scoredLead.first_name || "") + " " + (scoredLead.last_name || "")).trim() || null,
        headline: scoredLead.headline || null,
        email: scoredLead.email || null,
        phone: scoredLead.phone || null,
        location: scoredLead.location || null,
        company_name: scoredLead.company_name || null,
        company_linkedin_url: scoredLead.company_linkedin_url || null,
        company_size: scoredLead.company_size || null,
        company_sector: scoredLead.company_sector || null,
        company_location: scoredLead.company_location || null,
        signal_type: scoredLead.signal_type || null,
        signal_category: scoredLead.signal_category || null,
        signal_source: scoredLead.signal_source || null,
        signal_detail: scoredLead.signal_source || null,
        signal_date: scoredLead.signal_date || null,
        sequence_id: scoredLead.sequence_id || null,
        icp_score: scoredLead.icp_score,
        tier: scoredLead.tier,
        scoring_metadata: scoredLead.scoring_metadata || null,
        seniority_years: scoredLead.seniority_years || null,
        metadata: Object.assign({}, scoredLead.metadata || {}, {
          source_origin: scoredLead.source_origin || "bereach",
          rescored_from: "raw_signals",
        }),
        status: "new",
      };

      var { error: insertError } = await supabase.from("leads").insert(leadRow);

      if (insertError) {
        console.log("  [" + (i+1) + "/" + toProcess.length + "] INSERT ERROR: " + insertError.message);
        errors++;
        continue;
      }

      inserted++;
      console.log("  [" + (i+1) + "/" + toProcess.length + "] " + scoredLead.tier.toUpperCase() + ": " +
        (scoredLead.first_name || "") + " " + (scoredLead.last_name || "") +
        " | " + (scoredLead.company_name || "") + " | score: " + scoredLead.icp_score);

    } catch (err) {
      console.log("  [" + (i+1) + "/" + toProcess.length + "] ERROR: " + err.message);
      errors++;
    }
  }

  console.log("\n=== DONE ===");
  console.log("Processed: " + toProcess.length);
  console.log("Inserted (hot/warm): " + inserted);
  console.log("Skipped (cold): " + skippedCold);
  console.log("Errors: " + errors);
}

main().catch(function(e) { console.error("FATAL:", e.message, e.stack); });
