const { Router } = require("express");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");

const router = Router();
router.use(authMiddleware);

// ────────────────────────────────────────────────────────────
// POST /search -- Create a new cold outbound search
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
      .select("id, status, leads_found, leads_enriched, error_message")
      .eq("id", id)
      .single();

    if (error) {
      console.error("Cold outbound GET /searches/:id/status error:", error.message);
      return res.status(404).json({ error: "Search not found" });
    }

    res.json(data);
  } catch (err) {
    console.error("Cold outbound GET /searches/:id/status error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
