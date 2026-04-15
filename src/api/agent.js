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
const { supabase } = require("../lib/supabase");

const router = Router();

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

module.exports = router;
