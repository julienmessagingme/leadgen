/**
 * Combined dedup pipeline.
 * Performs 4-stage deduplication: URL canonicalization, in-batch, Supabase check, HubSpot check.
 *
 * Each signal goes through:
 * 1. Canonicalize LinkedIn URL (skip if null/unparseable)
 * 2. In-batch dedup (skip if already seen in this batch)
 * 3. Supabase dedup (skip if canonical URL already in leads table)
 * 4. HubSpot dedup (skip if name+company found in HubSpot CRM)
 */

const { supabase } = require("./supabase");
const { canonicalizeLinkedInUrl } = require("./url-utils");
const { log } = require("./logger");

/**
 * Deduplicate an array of signals through 4 stages.
 *
 * @param {Array<object>} signals - Raw signals with linkedin_url, first_name, last_name, company_name
 * @param {string} runId - UUID for logging
 * @returns {Promise<Array<object>>} Unique signals with linkedin_url_canonical added
 */
async function dedup(signals, runId) {
  const unique = [];
  const seenUrls = new Set();

  let skippedCanonical = 0;
  let skippedBatch = 0;
  let skippedSupabase = 0;
  let errors = 0;

  for (const signal of signals) {
    try {
      // Stage 1: Canonicalize URL
      const canonical = canonicalizeLinkedInUrl(signal.linkedin_url);
      if (!canonical) {
        skippedCanonical++;
        continue;
      }

      // Stage 2: In-batch dedup
      if (seenUrls.has(canonical)) {
        skippedBatch++;
        continue;
      }
      seenUrls.add(canonical);

      // Stage 3: Supabase dedup (SIG-06)
      // If lead already exists: DON'T skip — update with new signal + bump score
      const { data, error } = await supabase
        .from("leads")
        .select("id, icp_score, signal_type, signal_source, metadata")
        .eq("linkedin_url_canonical", canonical)
        .limit(1);

      if (error) {
        await log(runId, "dedup", "warn", "Supabase dedup query failed: " + error.message, { canonical });
        errors++;
        continue;
      }

      if (data && data.length > 0) {
        // Lead exists — record the new signal as a re-engagement
        var existing = data[0];
        var prevSignals = (existing.metadata && existing.metadata.previous_signals) || [];
        prevSignals.push({
          type: signal.signal_type,
          source: signal.signal_source,
          date: signal.signal_date || new Date().toISOString(),
        });
        var signalCount = prevSignals.length + 1;
        // Bump score: +5 per additional signal (capped at +20)
        var reEngagementBonus = Math.min(signalCount * 5, 20);
        var newScore = Math.min(100, (existing.icp_score || 0) + reEngagementBonus);
        var newTier = newScore >= 70 ? "hot" : (newScore >= 40 ? "warm" : "cold");

        await supabase.from("leads").update({
          icp_score: newScore,
          tier: newTier,
          signal_date: new Date().toISOString(),
          metadata: Object.assign({}, existing.metadata || {}, {
            previous_signals: prevSignals,
            signal_count: signalCount,
            last_re_engagement: new Date().toISOString(),
            re_engagement_bonus: reEngagementBonus,
          }),
        }).eq("id", existing.id);

        await log(runId, "dedup", "info",
          "Re-engagement: " + (signal.first_name || "") + " " + (signal.last_name || "") +
          " (signal #" + signalCount + ", score " + existing.icp_score + " -> " + newScore + " " + newTier + ")",
          { canonical, newSignal: signal.signal_type + " via " + signal.signal_source });

        skippedSupabase++;
        continue;
      }

      // HubSpot check moved to Task A post-scoring (only on top 30 leads)

      // Passed all checks: add canonical URL and keep signal
      unique.push({ ...signal, linkedin_url_canonical: canonical });
    } catch (err) {
      // Error isolation: log and skip individual signal on error
      await log(runId, "dedup", "warn", "Dedup error for signal: " + err.message, {
        url: signal.linkedin_url,
      });
      errors++;
    }
  }

  // Log dedup summary
  await log(runId, "dedup", "info",
    "Dedup complete: " + signals.length + " in -> " + unique.length + " unique" +
    " (canonical:" + skippedCanonical +
    " batch:" + skippedBatch +
    " supabase:" + skippedSupabase +
    " errors:" + errors + ")"
  );

  return unique;
}

/**
 * Check which of the given emails already have a lead with email_sent_at set
 * (= we already sent them an email). Used as a runtime safety net to catch
 * duplicate `leads` rows for the same person that the URL canonicalisation
 * dedup missed (slug vs ACoA pairs — see Bourge/Olfa case 27/04).
 *
 * Fail-open: returns an empty Set on error (better to risk one false-negative
 * duplicate send than to block all Task D sends).
 *
 * @param {string[]} emails - lower-cased emails to check
 * @param {(number|string)[]} [excludeIds] - lead ids to exclude from the lookup
 *        (typically the current candidate's own id, so a lead doesn't dedup
 *        against itself if it's already been sent)
 * @returns {Promise<Set<string>>} set of emails that have at least one
 *          OTHER lead row with email_sent_at NOT NULL
 */
async function findEmailsAlreadySent(emails, excludeIds) {
  if (!emails || emails.length === 0) return new Set();
  // Lower-case + de-duplicate input list
  var normalized = Array.from(new Set(
    emails.filter(function (e) { return e; }).map(function (e) { return String(e).toLowerCase().trim(); })
  ));
  if (normalized.length === 0) return new Set();
  try {
    var query = supabase
      .from("leads")
      .select("id, email")
      .in("email", normalized)
      .not("email_sent_at", "is", null);
    if (excludeIds && excludeIds.length > 0) {
      query = query.not("id", "in", "(" + excludeIds.join(",") + ")");
    }
    var { data, error } = await query;
    if (error) {
      console.warn("findEmailsAlreadySent query failed:", error.message);
      return new Set();
    }
    return new Set((data || []).map(function (r) { return String(r.email || "").toLowerCase(); }));
  } catch (e) {
    console.warn("findEmailsAlreadySent failed:", e.message);
    return new Set();
  }
}

module.exports = { dedup, findEmailsAlreadySent };
