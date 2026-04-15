/**
 * Cold Outreach API — dashboard-side endpoints (JWT protected).
 *
 * Three endpoints:
 *   GET  /api/cold-outreach/runs                 — list runs (newest first)
 *   GET  /api/cold-outreach/runs/:id             — run detail + its leads
 *   POST /api/cold-outreach/leads/:id/generate-email — generate a draft cold email
 *                                                     via Sonnet using the angle /
 *                                                     enrichment Troudebal stored
 *                                                     in metadata. Sets the lead
 *                                                     to email_pending so it shows
 *                                                     up in the existing /messages-draft
 *                                                     email tab for approval.
 */

const { Router } = require("express");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");
const { generateColdEmail } = require("../lib/message-generator");

const router = Router();
router.use(authMiddleware);

/**
 * GET /api/cold-outreach/runs
 * Returns the last 90 days of runs, newest first.
 */
router.get("/runs", async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("cold_outreach_runs")
      .select("id, run_date, agent_name, credits_used, leads_count, metadata, created_at")
      .order("run_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;
    res.json({ runs: data || [] });
  } catch (err) {
    console.error("[cold-outreach/runs] list error:", err.message);
    res.status(500).json({ error: "Failed to list runs" });
  }
});

/**
 * GET /api/cold-outreach/runs/:id
 * Returns the run header + every lead linked via metadata.cold_run_id.
 */
router.get("/runs/:id", async (req, res) => {
  try {
    const runId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(runId)) return res.status(400).json({ error: "Invalid run id" });

    const { data: run, error: runErr } = await supabase
      .from("cold_outreach_runs")
      .select("*")
      .eq("id", runId)
      .single();
    if (runErr || !run) return res.status(404).json({ error: "Run not found" });

    // Pull leads whose metadata.cold_run_id matches. Use JSON filter via the
    // Supabase query builder (contains).
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("id, full_name, first_name, last_name, headline, company_name, company_sector, company_size, company_location, email, linkedin_url, linkedin_url_canonical, status, email_sent_at, metadata, created_at")
      .contains("metadata", { cold_run_id: runId })
      .order("created_at", { ascending: true });

    if (leadsErr) {
      console.error("[cold-outreach/runs/:id] leads fetch error:", leadsErr.message);
      return res.status(500).json({ error: "Failed to fetch leads for run" });
    }

    res.json({ run, leads: leads || [] });
  } catch (err) {
    console.error("[cold-outreach/runs/:id] error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/cold-outreach/leads/:id/generate-email
 *
 * Generates a cold email draft via Sonnet using the angle + enrichment context
 * Troudebal already stored in metadata. Persists:
 *   metadata.draft_email_subject, metadata.draft_email_body, metadata.draft_email_to,
 *   metadata.draft_email_generated_at
 * and flips status to `email_pending` so the draft surfaces in the existing
 * /messages-draft email tab for human review (same approve/reject flow).
 *
 * Idempotent-ish: if a draft already exists, it gets overwritten (human can
 * re-generate if they don't like the first version).
 */
router.post("/leads/:id/generate-email", async (req, res) => {
  try {
    const leadId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(leadId)) return res.status(400).json({ error: "Invalid lead id" });

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();
    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });

    if (!lead.email) {
      return res.status(400).json({ error: "Lead has no email — enrichment missing" });
    }

    const md = lead.metadata || {};
    if (md.cold_run_id == null) {
      // Don't let the dashboard call this on non-cold leads — use the existing
      // Task D flow for warm leads. Fail loudly.
      return res.status(400).json({ error: "Lead is not a cold-outreach lead (no cold_run_id)" });
    }

    const email = await generateColdEmail(lead);
    if (!email || !email.subject || !email.body) {
      return res.status(502).json({ error: "Email generation failed (Sonnet returned empty)" });
    }

    const updatedMetadata = Object.assign({}, md, {
      draft_email_subject: email.subject,
      draft_email_body: email.body,
      draft_email_to: lead.email,
      draft_email_generated_at: new Date().toISOString(),
      draft_email_source: "cold_outreach_ai",
    });

    const { error: updErr } = await supabase
      .from("leads")
      .update({
        status: "email_pending",
        metadata: updatedMetadata,
      })
      .eq("id", leadId);

    if (updErr) {
      console.error("[cold-outreach/generate-email] update error:", updErr.message);
      return res.status(500).json({ error: "Failed to persist draft" });
    }

    res.json({
      ok: true,
      lead_id: leadId,
      subject: email.subject,
      body: email.body,
      to: lead.email,
    });
  } catch (err) {
    console.error("[cold-outreach/generate-email] error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
