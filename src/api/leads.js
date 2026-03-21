const { Router } = require("express");
const crypto = require("crypto");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");

const router = Router();
router.use(authMiddleware);

const VALID_SORTS = ["icp_score", "created_at", "signal_date", "status"];

/**
 * Sanitize search term: remove PostgREST operators (periods, commas).
 */
function sanitizeSearch(term) {
  return term.replace(/[.,]/g, "").trim();
}

/**
 * GET / -- List leads with filtering, sorting, pagination
 */
router.get("/", async (req, res) => {
  try {
    const {
      status,
      tier,
      source,
      search,
      sort = "icp_score",
      order = "desc",
      limit: limitStr = "200",
      offset: offsetStr = "0",
      paused,
    } = req.query;

    const limit = Math.min(Math.max(parseInt(limitStr, 10) || 200, 1), 500);
    const offset = Math.max(parseInt(offsetStr, 10) || 0, 0);

    if (!VALID_SORTS.includes(sort)) {
      return res.status(400).json({ error: `Invalid sort field. Allowed: ${VALID_SORTS.join(", ")}` });
    }

    let query = supabase
      .from("leads")
      .select("*", { count: "exact" });

    // Status filter
    if (status) {
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
      query = query.in("status", statuses);
    } else {
      // Exclude disqualified by default
      query = query.neq("status", "disqualified");
    }

    // Tier filter
    if (tier) {
      query = query.eq("tier", tier);
    }

    // Source filter (signal_category)
    if (source) {
      query = query.eq("signal_category", source);
    }

    // Search filter (table has first_name + last_name, not full_name)
    if (search) {
      const term = sanitizeSearch(search);
      if (term) {
        query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,company_name.ilike.%${term}%`);
      }
    }

    // Paused filter (metadata->is_paused)
    if (paused === "true") {
      query = query.eq("metadata->>is_paused", "true");
    } else if (paused === "false") {
      query = query.or("metadata->>is_paused.is.null,metadata->>is_paused.neq.true");
    }

    // Sort and paginate
    query = query.order(sort, { ascending: order === "asc" });
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.json({ leads: data, total: count });
  } catch (err) {
    console.error("Leads GET / error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /:id -- Single lead detail
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Lead not found" });
      }
      return res.status(500).json({ error: error.message });
    }

    res.json(data);
  } catch (err) {
    console.error("Leads GET /:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /:id/action -- Individual lead action (pause/resume/exclude)
 */
router.patch("/:id/action", async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!["pause", "resume", "exclude"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Allowed: pause, resume, exclude" });
    }

    // Fetch current lead
    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr) {
      if (fetchErr.code === "PGRST116") {
        return res.status(404).json({ error: "Lead not found" });
      }
      return res.status(500).json({ error: fetchErr.message });
    }

    const metadata = lead.metadata || {};

    if (action === "pause") {
      metadata.is_paused = true;
      metadata.paused_at = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ metadata })
        .eq("id", id);

      if (updateErr) return res.status(500).json({ error: updateErr.message });
      return res.json({ ok: true, action: "paused" });
    }

    if (action === "resume") {
      delete metadata.is_paused;
      delete metadata.paused_at;

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ metadata })
        .eq("id", id);

      if (updateErr) return res.status(500).json({ error: updateErr.message });
      return res.json({ ok: true, action: "resumed" });
    }

    if (action === "exclude") {
      metadata.excluded_at = new Date().toISOString();
      metadata.excluded_reason = "manual_rgpd";

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ status: "disqualified", metadata })
        .eq("id", id);

      if (updateErr) return res.status(500).json({ error: updateErr.message });

      // Insert suppression hashes
      const hashes = [];
      if (lead.email) {
        hashes.push({
          hashed_value: crypto.createHash("sha256").update(lead.email.toLowerCase()).digest("hex"),
          source: "email",
        });
      }
      if (lead.linkedin_url) {
        hashes.push({
          hashed_value: crypto.createHash("sha256").update(lead.linkedin_url.toLowerCase()).digest("hex"),
          source: "linkedin",
        });
      }

      if (hashes.length > 0) {
        await supabase
          .from("suppression_list")
          .upsert(hashes, { onConflict: "hashed_value" });
      }

      return res.json({ ok: true, action: "excluded" });
    }
  } catch (err) {
    console.error("Leads PATCH /:id/action error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /bulk-action -- Bulk lead actions
 */
router.post("/bulk-action", async (req, res) => {
  try {
    const { ids, action } = req.body;

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
      return res.status(400).json({ error: "ids must be an array of 1-100 elements" });
    }

    if (!["pause", "resume", "exclude"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Allowed: pause, resume, exclude" });
    }

    // Fetch all leads by IDs
    const { data: leads, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .in("id", ids);

    if (fetchErr) return res.status(500).json({ error: fetchErr.message });

    let processed = 0;

    for (const lead of leads) {
      const metadata = lead.metadata || {};

      if (action === "pause") {
        metadata.is_paused = true;
        metadata.paused_at = new Date().toISOString();
        const { error } = await supabase
          .from("leads")
          .update({ metadata })
          .eq("id", lead.id);
        if (!error) processed++;
      } else if (action === "resume") {
        delete metadata.is_paused;
        delete metadata.paused_at;
        const { error } = await supabase
          .from("leads")
          .update({ metadata })
          .eq("id", lead.id);
        if (!error) processed++;
      } else if (action === "exclude") {
        metadata.excluded_at = new Date().toISOString();
        metadata.excluded_reason = "manual_rgpd";
        const { error } = await supabase
          .from("leads")
          .update({ status: "disqualified", metadata })
          .eq("id", lead.id);

        if (!error) {
          const hashes = [];
          if (lead.email) {
            hashes.push({
              hashed_value: crypto.createHash("sha256").update(lead.email.toLowerCase()).digest("hex"),
              source: "email",
            });
          }
          if (lead.linkedin_url) {
            hashes.push({
              hashed_value: crypto.createHash("sha256").update(lead.linkedin_url.toLowerCase()).digest("hex"),
              source: "linkedin",
            });
          }
          if (hashes.length > 0) {
            await supabase
              .from("suppression_list")
              .upsert(hashes, { onConflict: "hashed_value" });
          }
          processed++;
        }
      }
    }

    res.json({ ok: true, processed });
  } catch (err) {
    console.error("Leads POST /bulk-action error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
