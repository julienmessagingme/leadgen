const crypto = require("crypto");
const { Router } = require("express");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");
const { executeColdSearch } = require("../lib/cold-outbound-pipeline");

const router = Router();
router.use(authMiddleware);

// ────────────────────────────────────────────────────────────
// POST /search -- Create a new cold outbound search & trigger async execution
// ────────────────────────────────────────────────────────────

router.post("/search", async (req, res) => {
  try {
    const { sector, company_size, job_title, geography, max_leads } = req.body;

    // Validation
    if (!sector || typeof sector !== "string" || !sector.trim()) {
      return res.status(400).json({ error: "sector is required (non-empty string)" });
    }
    if (!job_title || typeof job_title !== "string" || !job_title.trim()) {
      return res.status(400).json({ error: "job_title is required (non-empty string)" });
    }

    const parsedMaxLeads = parseInt(max_leads, 10);
    if (!parsedMaxLeads || parsedMaxLeads < 1 || parsedMaxLeads > 50) {
      return res.status(400).json({ error: "max_leads must be between 1 and 50" });
    }

    // Stop safeguard: only one cold search can run at a time (single browser instance)
    const { data: running } = await supabase
      .from("cold_searches")
      .select("id")
      .eq("status", "running")
      .limit(1);

    if (running && running.length > 0) {
      return res.status(409).json({ error: "A cold search is already running. Please wait for it to complete." });
    }

    const filters = {
      sector: sector.trim(),
      company_size: company_size || null,
      job_title: job_title.trim(),
      geography: geography ? geography.trim() : null,
      max_leads: parsedMaxLeads,
    };

    const { data, error } = await supabase
      .from("cold_searches")
      .insert({ filters, status: "pending" })
      .select()
      .single();

    if (error) {
      console.error("Cold outbound POST /search error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    // Cold search execution delegated to local PC watcher (Playwright).
    // The local watcher.js polls for pending searches and executes via Playwright.
    // OLD: Fire-and-forget server-side execution (disabled - needs browser on VPS)
    const runId = crypto.randomUUID();
    // executeColdSearch disabled - cold search via bookmarklet
    // executeColdSearch(data.id, filters, runId)
    //   .catch(err => console.error("Cold search execution error:", err.message));

    res.status(201).json(data);
  } catch (err) {
    console.error("Cold outbound POST /search error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// GET /searches -- List all cold searches (history)
// ────────────────────────────────────────────────────────────

router.get("/searches", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("cold_searches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Cold outbound GET /searches error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    res.json({ searches: data });
  } catch (err) {
    console.error("Cold outbound GET /searches error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// GET /searches/:id -- Single search with its leads
// ────────────────────────────────────────────────────────────

router.get("/searches/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data: search, error: searchError } = await supabase
      .from("cold_searches")
      .select("*")
      .eq("id", id)
      .single();

    if (searchError) {
      console.error("Cold outbound GET /searches/:id error:", searchError.message);
      return res.status(404).json({ error: "Search not found" });
    }

    // Get leads associated with this search via metadata
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("*")
      .eq("metadata->>search_id", id);

    if (leadsError) {
      console.error("Cold outbound leads query error:", leadsError.message);
    }

    res.json({ ...search, leads: leads || [] });
  } catch (err) {
    console.error("Cold outbound GET /searches/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// GET /searches/:id/status -- Lightweight polling endpoint
// ────────────────────────────────────────────────────────────

router.get("/searches/:id/status", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("cold_searches")
      .select("id, status, leads_found, leads_enriched, error_message, filters")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Cold outbound GET /searches/:id/status error:", error.message);
      return res.status(404).json({ error: "Search not found" });
    }

    // Include max_leads from filters for frontend progress bar
    res.json({
      id: data.id,
      status: data.status,
      leads_found: data.leads_found,
      leads_enriched: data.leads_enriched,
      max_leads: data.filters ? data.filters.max_leads : null,
      error_message: data.error_message,
      filters: data.filters,
    });
  } catch (err) {
    console.error("Cold outbound GET /searches/:id/status error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
