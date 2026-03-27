/**
 * Task A: Signal Detection Pipeline.
 * Full pipeline: check limits -> check daily cap -> collect signals ->
 * dedup -> limit quota -> load ICP rules -> enrich + news + score each lead ->
 * filter cold -> insert hot/warm into Supabase.
 *
 * Runs at 07h30 Mon-Fri via scheduler.
 * Receives runId from registerTask wrapper.
 *
 * SIG-01 to SIG-04: Signal collection from 4 sources
 * SIG-08: Maximum 50 new leads inserted per day
 */

const { supabase } = require("../lib/supabase");
const { collectSignals } = require("../lib/signal-collector");
const { collectAllBrowserSignals } = require("../lib/browser-signal-collector");
const { dedup } = require("../lib/dedup");
const { enrichLead } = require("../lib/enrichment");
const { gatherNewsEvidence } = require("../lib/news-evidence");
const { scoreLead, loadIcpRules } = require("../lib/icp-scorer");
const { checkLimits, sleep } = require("../lib/bereach");
const { log } = require("../lib/logger");

/**
 * Get today's start timestamp in Europe/Paris timezone as ISO string.
 * @returns {string} ISO 8601 timestamp for today 00:00 Europe/Paris
 */
function getTodayStartParis() {
  var now = new Date();
  // Format in Europe/Paris timezone to get the local date
  var parisDate = now.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
  // parisDate is in YYYY-MM-DD format
  // Create a date at midnight Paris time by parsing as UTC and adjusting
  // Simpler: use the date string directly with T00:00:00 in Paris time
  // For Supabase query, we need an ISO timestamp
  var parts = parisDate.split("-");
  var year = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10) - 1;
  var day = parseInt(parts[2], 10);

  // Create midnight in Paris: approximate with UTC offset
  // Paris is UTC+1 (winter) or UTC+2 (summer)
  // Use Intl to get exact offset
  var midnight = new Date(parisDate + "T00:00:00");
  var formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Paris",
    hour: "numeric",
    hour12: false,
    timeZoneName: "shortOffset",
  });
  var formatted = formatter.format(midnight);
  // Extract offset like "GMT+1" or "GMT+2"
  var offsetMatch = formatted.match(/GMT([+-]\d+)/);
  var offsetHours = offsetMatch ? parseInt(offsetMatch[1], 10) : 1;

  // Midnight Paris = midnight UTC minus offset
  var midnightUtc = new Date(Date.UTC(year, month, day, -offsetHours, 0, 0));
  return midnightUtc.toISOString();
}

/**
 * Random delay between 1-3 seconds for rate limiting.
 */
async function rateLimitDelay() {
  var ms = 1000 + Math.floor(Math.random() * 2000);
  await sleep(ms);
}

/**
 * Task A: Full signal detection pipeline.
 * @param {string} runId - UUID from registerTask wrapper
 */
module.exports = async function taskASignals(runId) {
  // Get today's date in Paris timezone for the lock
  var todayParis = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
  var lockAcquired = false;

  try {
    await log(runId, "task-a-signals", "info", "Pipeline started");

    // ---------------------------------------------------------------
    // Step 0: Acquire daily lock (prevent duplicate runs)
    // ---------------------------------------------------------------
    var { data: existingLock, error: lockCheckErr } = await supabase
      .from("task_locks")
      .select("started_at, completed_at, run_id")
      .eq("task_name", "task-a")
      .eq("run_date", todayParis)
      .single();

    if (existingLock && !lockCheckErr) {
      // Lock exists — check if it's a completed run or a stale crash
      if (existingLock.completed_at) {
        await log(runId, "task-a-signals", "info",
          "Task A already completed today (run " + existingLock.run_id + "). Skipping.");
        return;
      }
      // Check if lock is stale (>2 hours old = crashed)
      var lockAge = Date.now() - new Date(existingLock.started_at).getTime();
      if (lockAge < 2 * 60 * 60 * 1000) {
        await log(runId, "task-a-signals", "info",
          "Task A already running (run " + existingLock.run_id + ", started " +
          Math.round(lockAge / 60000) + "min ago). Skipping.");
        return;
      }
      // Stale lock — delete it and re-acquire
      await log(runId, "task-a-signals", "warn",
        "Stale lock found (run " + existingLock.run_id + ", " +
        Math.round(lockAge / 3600000) + "h old). Removing and re-acquiring.");
      await supabase.from("task_locks").delete()
        .eq("task_name", "task-a").eq("run_date", todayParis);
    }

    // Try to acquire lock
    var { error: lockErr } = await supabase.from("task_locks").insert({
      task_name: "task-a",
      run_date: todayParis,
      run_id: runId,
    });
    if (lockErr) {
      // Another process grabbed the lock between our check and insert (race condition)
      await log(runId, "task-a-signals", "info",
        "Lock already taken by another process. Skipping.");
      return;
    }
    lockAcquired = true;
    await log(runId, "task-a-signals", "info", "Daily lock acquired");

    // ---------------------------------------------------------------
    // Step 1: Check BeReach limits
    // ---------------------------------------------------------------
    try {
      var limits = await checkLimits();
      await log(runId, "task-a-signals", "info",
        "BeReach limits checked", { limits: limits });

      // Warn if critically low but continue (operator decides)
      if (limits && limits.remaining !== undefined && limits.remaining < 50) {
        await log(runId, "task-a-signals", "warn",
          "BeReach quota critically low: " + limits.remaining + " remaining");
      }
    } catch (err) {
      await log(runId, "task-a-signals", "warn",
        "Failed to check BeReach limits: " + err.message + " -- continuing anyway");
    }

    // ---------------------------------------------------------------
    // Step 2: Check daily lead count (SIG-08)
    // ---------------------------------------------------------------
    var todayStart = getTodayStartParis();
    var { count: todayCount, error: countError } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", todayStart);

    if (countError) {
      await log(runId, "task-a-signals", "warn",
        "Failed to count today leads: " + countError.message + " -- assuming 0");
      todayCount = 0;
    }

    todayCount = todayCount || 0;

    // Load daily lead limit from settings table (fallback: 50)
    var dailyLeadLimit = 50;
    try {
      var { data: limitSetting } = await supabase
        .from("settings")
        .select("value")
        .eq("key", "daily_lead_limit")
        .single();
      if (limitSetting && limitSetting.value) dailyLeadLimit = parseInt(limitSetting.value) || 50;
    } catch (e) {
      // Fallback to default
      dailyLeadLimit = 50;
    }

    if (todayCount >= dailyLeadLimit) {
      await log(runId, "task-a-signals", "info",
        "Daily lead limit reached (" + dailyLeadLimit + "), skipping pipeline. Today count: " + todayCount);
      return;
    }

    var remaining = dailyLeadLimit - todayCount;
    await log(runId, "task-a-signals", "info",
      "Daily quota: " + todayCount + "/" + dailyLeadLimit + " used, " + remaining + " remaining");

    // ---------------------------------------------------------------
    // Step 3: Collect Bereach signals
    // ---------------------------------------------------------------
    var rawSignals = await collectSignals(runId);
    await log(runId, "task-a-signals", "info",
      "Bereach collected " + rawSignals.length + " raw signals");

    // ---------------------------------------------------------------
    // Step 3b: Browser signals — DISABLED (cookies expired, BeReach suffices)
    // See CLAUDE.md: NE PAS reactiver sans instruction explicite de Julien
    // ---------------------------------------------------------------

    await log(runId, "task-a-signals", "info",
      "Total raw signals (Bereach): " + rawSignals.length);

    if (rawSignals.length === 0) {
      await log(runId, "task-a-signals", "info",
        "No signals collected -- pipeline complete");
      return;
    }

    // ---------------------------------------------------------------
    // Step 3c: Persist raw signals (for re-scoring without BeReach)
    // ---------------------------------------------------------------
    try {
      var rawRows = rawSignals.map(function(s) {
        // Sanitize text fields: remove lone surrogates that break JSON/Postgres
        function clean(v, maxLen) {
          if (!v) return null;
          var t = String(v)
            .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
            .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
            .replace(/\0/g, "");
          return maxLen ? t.slice(0, maxLen) : t;
        }
        return {
          run_id: runId,
          linkedin_url: clean(s.linkedin_url) || null,
          first_name: clean(s.first_name, 200) || null,
          last_name: clean(s.last_name, 200) || null,
          headline: clean(s.headline, 500) || null,
          company_name: clean(s.company_name, 300) || null,
          signal_type: clean(s.signal_type, 50) || null,
          signal_category: clean(s.signal_category, 50) || null,
          signal_source: clean(s.signal_source, 200) || null,
          signal_date: s.signal_date && !isNaN(new Date(s.signal_date).getTime()) ? new Date(s.signal_date).toISOString() : null,
          sequence_id: s.sequence_id ? Number(s.sequence_id) || null : null,
          source_origin: s.source_origin || "bereach",
          post_text: clean(s.post_text, 5000) || null,
          post_url: clean(s.post_url) || null,
          comment_text: clean(s.comment_text, 2000) || null,
          post_author_name: clean(s.post_author_name, 200) || null,
          post_author_headline: clean(s.post_author_headline, 500) || null,
        };
      });
      var { error: rawError } = await supabase.from("raw_signals").insert(rawRows);
      if (rawError) {
        await log(runId, "task-a-signals", "warn",
          "Failed to persist raw_signals: " + rawError.message);
      } else {
        await log(runId, "task-a-signals", "info",
          "Persisted " + rawRows.length + " raw signals for re-scoring");
      }
    } catch (rawErr) {
      await log(runId, "task-a-signals", "warn",
        "raw_signals persistence error: " + rawErr.message);
    }

    // ---------------------------------------------------------------
    // Step 4: Dedup
    // ---------------------------------------------------------------
    var uniqueSignals = await dedup(rawSignals, runId);
    await log(runId, "task-a-signals", "info",
      "After dedup: " + uniqueSignals.length + " unique signals (from " + rawSignals.length + " raw)");

    if (uniqueSignals.length === 0) {
      await log(runId, "task-a-signals", "info",
        "All signals were duplicates -- pipeline complete");
      return;
    }

    // ---------------------------------------------------------------
    // Step 5: Limit to remaining daily quota
    // ---------------------------------------------------------------
    var toProcess = uniqueSignals.slice(0, remaining);
    if (toProcess.length < uniqueSignals.length) {
      await log(runId, "task-a-signals", "info",
        "Limiting to " + toProcess.length + " signals (daily quota: " + remaining + " remaining)");
    }

    // ---------------------------------------------------------------
    // Step 6: Load ICP rules once for the batch
    // ---------------------------------------------------------------
    var rules = await loadIcpRules();
    await log(runId, "task-a-signals", "info",
      "Loaded " + rules.length + " ICP rules");

    // ---------------------------------------------------------------
    // Step 7: Process each signal (sequential with rate limiting)
    // ---------------------------------------------------------------
    var inserted = 0;
    var skippedCold = 0;
    var errors = 0;

    for (var i = 0; i < toProcess.length; i++) {
      var signal = toProcess[i];
      try {
        // 7a. Enrich lead (profile + company + Sales Nav)
        var enrichedLead = await enrichLead(signal, runId);
        await rateLimitDelay();

        // 7b. Gather news evidence
        var newsEvidence = await gatherNewsEvidence(enrichedLead, runId);

        // Store news titles in metadata for Sonnet prompt
        if (newsEvidence && newsEvidence.length > 0) {
          enrichedLead.metadata = enrichedLead.metadata || {};
          enrichedLead.metadata.news_titles = newsEvidence
            .filter(function(n) { return n.source_title; })
            .map(function(n) { return n.source_title; })
            .slice(0, 5);
        }

        // 7c. Score lead via ICP scoring
        var scoredLead = await scoreLead(enrichedLead, newsEvidence, rules, runId);

        // 7d. Filter cold leads
        if (scoredLead.tier === "cold") {
          await log(runId, "task-a-signals", "info",
            "Skipping cold lead: " + (scoredLead.first_name || "") + " " + (scoredLead.last_name || "") +
            " (score: " + scoredLead.icp_score + ")");
          skippedCold++;
          continue;
        }

        // 7e. Insert hot/warm lead into Supabase
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
          signal_detail: scoredLead.signal_type && scoredLead.signal_source
            ? scoredLead.signal_type + " — " + scoredLead.signal_source + (scoredLead.post_author_name ? " (" + scoredLead.post_author_name + ")" : "")
            : scoredLead.signal_source || null,
          signal_date: scoredLead.signal_date || null,
          sequence_id: scoredLead.sequence_id || null,
          icp_score: scoredLead.icp_score,
          tier: scoredLead.tier,
          scoring_metadata: scoredLead.scoring_metadata || null,
          seniority_years: scoredLead.seniority_years || null,
          connections_count: scoredLead.connections_count || null,
          metadata: Object.assign({}, scoredLead.metadata || {}, {
            source_origin: scoredLead.source_origin || "bereach",
            post_text: scoredLead.post_text || null,
            post_url: scoredLead.post_url || null,
            comment_text: scoredLead.comment_text || null,
            post_author_name: scoredLead.post_author_name || null,
            post_author_headline: scoredLead.post_author_headline || null,
          }),
          status: "new",
        };

        var { error: insertError } = await supabase
          .from("leads")
          .insert(leadRow);

        if (insertError) {
          await log(runId, "task-a-signals", "warn",
            "Failed to insert lead: " + insertError.message,
            { linkedin_url: scoredLead.linkedin_url });
          errors++;
          continue;
        }

        inserted++;
        await log(runId, "task-a-signals", "info",
          "Inserted " + scoredLead.tier + " lead: " +
          (scoredLead.first_name || "") + " " + (scoredLead.last_name || "") +
          " (score: " + scoredLead.icp_score + ")",
          { tier: scoredLead.tier, company: scoredLead.company_name });

      } catch (err) {
        // Error isolation: one lead failing does not crash the batch
        await log(runId, "task-a-signals", "error",
          "Lead processing failed: " + err.message,
          { linkedin_url: signal.linkedin_url, index: i });
        errors++;
      }
    }

    // ---------------------------------------------------------------
    // Step 8: Summary log
    // ---------------------------------------------------------------
    var summaryMeta = {
      raw_signals: rawSignals.length,
      unique_signals: uniqueSignals.length,
      processed: toProcess.length,
      inserted: inserted,
      skipped_cold: skippedCold,
      errors: errors,
    };

    var browserSummary = "";
    if (browserStats) {
      summaryMeta.browser_stats = browserStats;
      browserSummary = " Browser: " +
        (browserStats.competitor_page || 0) + " competitor, " +
        (browserStats.influencer || 0) + " influencer, " +
        (browserStats.keyword || 0) + " keyword, " +
        (browserStats.job_keyword || 0) + " job, " +
        (browserStats.pages_consumed || 0) + " pages.";
      if (browserStats.error) {
        browserSummary += " (" + browserStats.error + ")";
      }
    }

    await log(runId, "task-a-signals", "info",
      "Pipeline complete. " +
      "Collected: " + rawSignals.length + ", " +
      "After dedup: " + uniqueSignals.length + ", " +
      "Processed: " + toProcess.length + ", " +
      "Inserted (hot/warm): " + inserted + ", " +
      "Skipped (cold): " + skippedCold + ", " +
      "Errors: " + errors + "." +
      browserSummary, summaryMeta);

  } catch (err) {
    // Top-level catch for unexpected pipeline errors
    await log(runId, "task-a-signals", "error",
      "Pipeline failed with unexpected error: " + err.message,
      { stack: err.stack });
    throw err; // Re-throw so registerTask wrapper also catches it
  } finally {
    // Release lock: mark as completed (even if crashed — so we know it ran)
    if (lockAcquired) {
      await supabase.from("task_locks")
        .update({ completed_at: new Date().toISOString() })
        .eq("task_name", "task-a")
        .eq("run_date", todayParis);
    }
  }
};
