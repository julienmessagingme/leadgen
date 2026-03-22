const { Router } = require("express");
const crypto = require("crypto");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");

const router = Router();
router.use(authMiddleware);

const PII_NULLS = {
  email: null,
  first_name: null,
  last_name: null,
  full_name: null,
  phone: null,
  linkedin_url: null,
  headline: null,
};

const VALID_SORTS = ["icp_score", "created_at", "signal_date", "status"];

/**
 * ISO-8601 date validation helper.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/;
function isValidDate(str) {
  return ISO_DATE_RE.test(str) && !isNaN(Date.parse(str));
}

/**
 * Sanitize search term: remove ALL PostgREST special characters.
 */
function sanitizeSearch(term) {
  return term.replace(/[.,()!<>%\\:"']/g, "").trim().slice(0, 100);
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
      console.error("Leads GET / supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    res.json({ leads: data, total: count });
  } catch (err) {
    console.error("Leads GET / error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /export -- CSV export with filters
 */
router.get("/export", async (req, res) => {
  try {
    const { status, tier, source, search, date_from, date_to } = req.query;

    let query = supabase
      .from("leads")
      .select("first_name, last_name, email, linkedin_url, icp_score, tier, status, company_name, created_at");

    // Status filter
    if (status) {
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
      query = query.in("status", statuses);
    }

    // Tier filter
    if (tier) {
      query = query.eq("tier", tier);
    }

    // Source filter (signal_category)
    if (source) {
      query = query.eq("signal_category", source);
    }

    // Search filter
    if (search) {
      const term = sanitizeSearch(search);
      if (term) {
        query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,company_name.ilike.%${term}%`);
      }
    }

    // Validate date params
    if (date_from && !isValidDate(date_from)) {
      return res.status(400).json({ error: "Invalid date_from format" });
    }
    if (date_to && !isValidDate(date_to)) {
      return res.status(400).json({ error: "Invalid date_to format" });
    }

    // Date range filters
    if (date_from) {
      query = query.gte("created_at", date_from);
    }
    if (date_to) {
      query = query.lte("created_at", date_to);
    }

    query = query.order("created_at", { ascending: false }).limit(10000);

    const { data, error } = await query;

    if (error) {
      console.error("Leads GET /export supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    // Build CSV
    const headers = "Nom,Prenom,Email,LinkedIn,Entreprise,Score ICP,Tier,Statut,Date";

    function escapeCSV(v) {
      if (v === null || v === undefined) return '""';
      return '"' + String(v).replace(/"/g, '""') + '"';
    }

    const rows = (data || []).map((row) =>
      [
        escapeCSV(row.last_name),
        escapeCSV(row.first_name),
        escapeCSV(row.email),
        escapeCSV(row.linkedin_url),
        escapeCSV(row.company_name),
        escapeCSV(row.icp_score),
        escapeCSV(row.tier),
        escapeCSV(row.status),
        escapeCSV(row.created_at),
      ].join(",")
    );

    const csv = "\uFEFF" + headers + "\n" + rows.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="leads-export.csv"');
    res.send(csv);
  } catch (err) {
    console.error("Leads GET /export error:", err.message);
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
      console.error("Leads GET /:id supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
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
      console.error("Leads PATCH /:id/action fetch error:", fetchErr.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    const metadata = lead.metadata || {};

    if (action === "pause") {
      metadata.is_paused = true;
      metadata.paused_at = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ metadata })
        .eq("id", id);

      if (updateErr) {
        console.error("Leads PATCH /:id/action pause error:", updateErr.message);
        return res.status(500).json({ error: "Internal server error" });
      }
      return res.json({ ok: true, action: "paused" });
    }

    if (action === "resume") {
      delete metadata.is_paused;
      delete metadata.paused_at;

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ metadata })
        .eq("id", id);

      if (updateErr) {
        console.error("Leads PATCH /:id/action resume error:", updateErr.message);
        return res.status(500).json({ error: "Internal server error" });
      }
      return res.json({ ok: true, action: "resumed" });
    }

    if (action === "exclude") {
      metadata.excluded_at = new Date().toISOString();
      metadata.excluded_reason = "manual_rgpd";

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ status: "disqualified", metadata, ...PII_NULLS })
        .eq("id", id);

      if (updateErr) {
        console.error("Leads PATCH /:id/action exclude error:", updateErr.message);
        return res.status(500).json({ error: "Internal server error" });
      }

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

    if (fetchErr) {
      console.error("Leads POST /bulk-action fetch error:", fetchErr.message);
      return res.status(500).json({ error: "Internal server error" });
    }

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
          .update({ status: "disqualified", metadata, ...PII_NULLS })
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
