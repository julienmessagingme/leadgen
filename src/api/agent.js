/**
 * Agent API — read-only endpoints for autonomous agents (OpenClaw / BeReach).
 *
 * Protected by a static bearer token (OPENCLAW_AGENT_TOKEN) rather than the
 * JWT used for the human dashboard: agents don't do interactive login.
 *
 * Scope: READ ONLY. No mutation endpoints here, ever — if we need writes from
 * an agent later, give it its own router with stricter auth.
 */

const { Router } = require("express");
const express = require("express");
const { supabase } = require("../lib/supabase");
const { canonicalizeLinkedInUrl } = require("../lib/url-utils");

const router = Router();

// Agent payloads can easily exceed the global 50kb JSON limit — enriched leads
// carry icp_fit_reasoning (2000 chars) + angle_of_approach (2000 chars) +
// enrichment (up to ~10kb JSON per lead). Allow up to 500kb here specifically
// so a 10-50 lead run goes through cleanly. JWT dashboard routes keep the
// global 50kb cap.
router.use(express.json({ limit: "500kb" }));

const MAX_LEADS_PER_RUN = 50; // hard cap — Troudebal targets 10, this is guard-rail
const MAX_PAYLOAD_LEADS = 200; // even if malformed request arrives, refuse pathological payloads

function agentAuth(req, res, next) {
  const expected = process.env.OPENCLAW_AGENT_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: "Agent API not configured" });
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token !== expected) {
    return res.status(401).json({ error: "Invalid or missing agent token" });
  }
  next();
}

/**
 * GET /api/agent/known-leads
 *
 * Returns every lead already in our pipeline (LinkedIn URL canonical + email).
 * The OpenClaw cold-outreach agent reads this at the start of its run and
 * excludes any contact whose canonical LinkedIn URL or email appears here,
 * so we never re-prospect someone leadgen already sollicited (including
 * `hubspot_existing` leads — those are also in this table).
 *
 * Response: { count, linkedin_urls: string[], emails: string[], updated_at }
 */
router.get("/known-leads", agentAuth, async (_req, res) => {
  try {
    const pageSize = 1000;
    const linkedinUrls = new Set();
    const emails = new Set();
    let offset = 0;

    // Paginate to defeat Supabase's default row cap
    while (true) {
      const { data, error } = await supabase
        .from("leads")
        .select("linkedin_url_canonical, email")
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data) {
        if (row.linkedin_url_canonical) linkedinUrls.add(row.linkedin_url_canonical);
        if (row.email) emails.add(row.email.toLowerCase());
      }

      if (data.length < pageSize) break;
      offset += pageSize;
    }

    res.json({
      count: linkedinUrls.size,
      linkedin_urls: [...linkedinUrls],
      emails: [...emails],
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[agent/known-leads] error:", err.message);
    res.status(500).json({ error: "Failed to fetch known leads" });
  }
});

/**
 * POST /api/agent/cold-runs
 *
 * Endpoint consumed by the autonomous cold-outreach agent (Troudebal on OpenClaw).
 * At the end of a daily session, the agent posts the leads it has found +
 * enriched, and we:
 *   1. insert a header row in `cold_outreach_runs` for the run,
 *   2. for each lead: canonicalise the LinkedIn URL, skip duplicates against
 *      the live `leads` table (defense in depth — the agent should already have
 *      deduped client-side via known_leads.json, but network races happen), and
 *      insert accepted leads into `leads` linked back to the run via
 *      metadata.cold_run_id.
 *
 * Payload:
 *   {
 *     run_date: "YYYY-MM-DD",
 *     credits_used: number,
 *     agent_name?: string,          // defaults to "troudebal"
 *     run_notes?: string,           // free-form, stored in run metadata
 *     leads: [{
 *       full_name, title, company, company_size?, company_sector?,
 *       company_location?, linkedin_url, email?,
 *       icp_fit_reasoning, angle_of_approach, enrichment?: object
 *     }]
 *   }
 *
 * Response: { run_id, inserted: N, duplicates: N, canonical_skipped: N }
 *
 * Read-write but write scope is tightly constrained to this feature.
 */
router.post("/cold-runs", agentAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const runDate = typeof body.run_date === "string" ? body.run_date : null;
    const creditsUsed = Number.isFinite(body.credits_used) ? body.credits_used : 0;
    const agentName = typeof body.agent_name === "string" && body.agent_name.trim()
      ? body.agent_name.trim().slice(0, 50)
      : "troudebal";
    const leads = Array.isArray(body.leads) ? body.leads : null;

    if (!runDate || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) {
      return res.status(400).json({ error: "run_date must be YYYY-MM-DD" });
    }
    if (!leads) {
      return res.status(400).json({ error: "leads must be an array" });
    }
    if (leads.length > MAX_PAYLOAD_LEADS) {
      return res.status(413).json({ error: `Too many leads (max ${MAX_PAYLOAD_LEADS})` });
    }
    const acceptedLeads = leads.slice(0, MAX_LEADS_PER_RUN);

    // 1. Refuse duplicate same-day runs for the same agent. Agents WILL retry on
    // network timeout; without this guard we would end up with orphan runs
    // (leads_count=0) and a second run holding the retried leads. DB has a
    // UNIQUE (run_date, agent_name) constraint as a last line of defense.
    const { data: existingRun } = await supabase
      .from("cold_outreach_runs")
      .select("id, leads_count, created_at")
      .eq("run_date", runDate)
      .eq("agent_name", agentName)
      .maybeSingle();
    if (existingRun) {
      return res.status(409).json({
        error: "A run already exists for this date + agent",
        run_id: existingRun.id,
        leads_count: existingRun.leads_count,
        created_at: existingRun.created_at,
      });
    }

    // 2. Insert run header
    const { data: runRow, error: runErr } = await supabase
      .from("cold_outreach_runs")
      .insert({
        run_date: runDate,
        agent_name: agentName,
        credits_used: creditsUsed,
        leads_count: 0, // updated after inserts
        metadata: { run_notes: typeof body.run_notes === "string" ? body.run_notes.slice(0, 2000) : null },
      })
      .select()
      .single();

    if (runErr) {
      // Unique-constraint race (another concurrent POST won the insert) → surface
      // the same 409 contract instead of a generic 500.
      if (runErr.code === "23505") {
        return res.status(409).json({ error: "A run already exists for this date + agent (race)" });
      }
      console.error("[agent/cold-runs] run insert error:", runErr.message);
      return res.status(500).json({ error: "Failed to create run" });
    }

    // 3. Canonicalise + dedup + insert leads
    // Two-pass approach:
    //   (a) canonicalise + in-payload dedup (pure JS, O(N))
    //   (b) ONE batch SELECT on Supabase to filter out already-known URLs (O(1) query vs N)
    // This scales: 50 leads = 1 Supabase round-trip, not 50.
    let canonicalSkipped = 0;
    let duplicates = 0;
    const seenCanonical = new Set();
    const candidates = []; // { raw, canonical }

    for (const raw of acceptedLeads) {
      if (!raw || typeof raw !== "object") continue;
      const canonical = canonicalizeLinkedInUrl(raw.linkedin_url);
      if (!canonical) {
        canonicalSkipped++;
        continue;
      }
      if (seenCanonical.has(canonical)) {
        duplicates++;
        continue;
      }
      seenCanonical.add(canonical);
      candidates.push({ raw, canonical });
    }

    // Batch Supabase dedup (single query)
    let existingSet = new Set();
    if (candidates.length > 0) {
      const canonicalList = candidates.map((c) => c.canonical);
      const { data: existing, error: dupErr } = await supabase
        .from("leads")
        .select("linkedin_url_canonical")
        .in("linkedin_url_canonical", canonicalList);
      if (dupErr) {
        // Dedup is safety-critical — if we can't check, abort and clean up the run
        console.error("[agent/cold-runs] batch dup check failed:", dupErr.message);
        await supabase.from("cold_outreach_runs").delete().eq("id", runRow.id);
        return res.status(500).json({ error: "Dedup check failed, run rolled back" });
      }
      existingSet = new Set((existing || []).map((r) => r.linkedin_url_canonical));
    }

    const toInsert = [];
    for (const { raw, canonical } of candidates) {
      if (existingSet.has(canonical)) {
        duplicates++;
        continue;
      }

      // Split full_name into first/last (best effort)
      const fullName = String(raw.full_name || "").trim();
      const parts = fullName.split(/\s+/);
      const firstName = parts[0] || null;
      const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;

      toInsert.push({
        linkedin_url: String(raw.linkedin_url).slice(0, 500),
        linkedin_url_canonical: canonical,
        full_name: fullName || null,
        first_name: firstName,
        last_name: lastName,
        headline: raw.title ? String(raw.title).slice(0, 300) : null,
        email: raw.email ? String(raw.email).toLowerCase().slice(0, 200) : null,
        company_name: raw.company ? String(raw.company).slice(0, 200) : null,
        company_size: raw.company_size ? String(raw.company_size).slice(0, 50) : null,
        company_sector: raw.company_sector ? String(raw.company_sector).slice(0, 100) : null,
        company_location: raw.company_location ? String(raw.company_location).slice(0, 200) : null,
        status: "scored",
        signal_type: "cold_search",
        signal_category: "cold_outbound",
        signal_source: "cold_outreach_ai",
        signal_date: new Date().toISOString(),
        metadata: {
          cold_run_id: runRow.id,
          cold_outbound: true,
          agent_name: agentName,
          icp_fit_reasoning: raw.icp_fit_reasoning ? String(raw.icp_fit_reasoning).slice(0, 2000) : null,
          angle_of_approach: raw.angle_of_approach ? String(raw.angle_of_approach).slice(0, 2000) : null,
          enrichment: raw.enrichment && typeof raw.enrichment === "object" ? raw.enrichment : null,
        },
      });
    }

    let inserted = 0;
    if (toInsert.length > 0) {
      const { error: insErr } = await supabase.from("leads").insert(toInsert);
      if (insErr) {
        // Rollback the run header to avoid leaving an orphan with leads_count=0.
        // The client can retry the whole operation cleanly.
        console.error("[agent/cold-runs] leads insert error, rolling back run:", insErr.message);
        await supabase.from("cold_outreach_runs").delete().eq("id", runRow.id);
        return res.status(500).json({ error: "Failed to insert leads, run rolled back" });
      }
      inserted = toInsert.length;
    }

    // 4. Update run header with final counts
    await supabase
      .from("cold_outreach_runs")
      .update({ leads_count: inserted })
      .eq("id", runRow.id);

    res.json({
      run_id: runRow.id,
      run_date: runDate,
      agent_name: agentName,
      inserted,
      duplicates,
      canonical_skipped: canonicalSkipped,
    });
  } catch (err) {
    console.error("[agent/cold-runs] error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
