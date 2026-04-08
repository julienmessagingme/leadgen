const { Router } = require("express");
const crypto = require("crypto");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");

const router = Router();
router.use(authMiddleware);

const ALLOWED_CONFIG_KEYS = [
  "daily_invitation_limit",
  "daily_email_limit",
  "daily_whatsapp_limit",
  "min_icp_score",
  "email_template_subject",
  "email_template_body",
  "whatsapp_template",
  "invitation_note_template",
  "followup_delay_days",
  "email_delay_days",
  "whatsapp_delay_days",
];

const VALID_ICP_CATEGORIES = [
  "title_positive",
  "title_negative",
  "sector",
  "geo_positive",
  "company_size",
  "seniority",
  "freshness",
  "signal_weights",
];

// ────────────────────────────────────────────────────────────
// CONF-01 -- ICP Rules
// ────────────────────────────────────────────────────────────

router.get("/icp-rules", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("icp_rules")
      .select("*")
      .order("category");

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json({ rules: data });
  } catch (err) {
    console.error("Settings GET /icp-rules error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/icp-rules", async (req, res) => {
  try {
    const { category, value, key, numeric_value, threshold } = req.body;

    if (!category || !VALID_ICP_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `Invalid category. Allowed: ${VALID_ICP_CATEGORIES.join(", ")}`,
      });
    }

    const { data, error } = await supabase
      .from("icp_rules")
      .insert({ category, value, key, numeric_value, threshold })
      .select()
      .single();

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error("Settings POST /icp-rules error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/icp-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { category, value, key, numeric_value, threshold } = req.body;

    if (category && !VALID_ICP_CATEGORIES.includes(category)) {
      return res.status(400).json({
        error: `Invalid category. Allowed: ${VALID_ICP_CATEGORIES.join(", ")}`,
      });
    }

    const updates = {};
    if (category !== undefined) updates.category = category;
    if (value !== undefined) updates.value = value;
    if (key !== undefined) updates.key = key;
    if (numeric_value !== undefined) updates.numeric_value = numeric_value;
    if (threshold !== undefined) updates.threshold = threshold;

    const { data, error } = await supabase
      .from("icp_rules")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json(data);
  } catch (err) {
    console.error("Settings PUT /icp-rules/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/icp-rules/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("icp_rules")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Settings DELETE /icp-rules/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// CONF-02 -- Suppression List
// ────────────────────────────────────────────────────────────

router.get("/suppression", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("suppression_list")
      .select("*");

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json({ entries: data });
  } catch (err) {
    console.error("Settings GET /suppression error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/suppression", async (req, res) => {
  try {
    const { value, source } = req.body;

    if (!value || !source) {
      return res.status(400).json({ error: "value and source are required" });
    }
    if (!["email", "linkedin"].includes(source)) {
      return res.status(400).json({ error: "source must be 'email' or 'linkedin'" });
    }

    const hashed_value = crypto
      .createHash("sha256")
      .update(value.trim().toLowerCase())
      .digest("hex");

    const { error } = await supabase
      .from("suppression_list")
      .upsert({ hashed_value, source }, { onConflict: "hashed_value" });

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error("Settings POST /suppression error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/suppression/:hash", async (req, res) => {
  try {
    const { hash } = req.params;

    const { error } = await supabase
      .from("suppression_list")
      .delete()
      .eq("hashed_value", hash);

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Settings DELETE /suppression/:hash error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// CONF-03 + CONF-05 -- Config (limits + templates)
// ────────────────────────────────────────────────────────────

router.get("/config", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("global_settings")
      .select("*");

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json({ settings: data });
  } catch (err) {
    console.error("Settings GET /config error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.patch("/config/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const { value } = req.body;

    if (!ALLOWED_CONFIG_KEYS.includes(key)) {
      return res.status(400).json({ error: `Invalid config key. Allowed: ${ALLOWED_CONFIG_KEYS.join(", ")}` });
    }

    if (value === undefined) {
      return res.status(400).json({ error: "value is required" });
    }

    const { data, error } = await supabase
      .from("global_settings")
      .upsert(
        { key, value, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      )
      .select()
      .single();

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json(data);
  } catch (err) {
    console.error("Settings PATCH /config/:key error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// CONF-04 -- Watchlist
// ────────────────────────────────────────────────────────────

router.get("/watchlist", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("watchlist")
      .select("*")
      .order("source_type");

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json({ sources: data });
  } catch (err) {
    console.error("Settings GET /watchlist error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/watchlist", async (req, res) => {
  try {
    const { source_type, source_label, source_url, keywords, is_active, sequence_id, priority } = req.body;

    if (!source_type || !source_label) {
      return res.status(400).json({ error: "source_type and source_label are required" });
    }

    const { data, error } = await supabase
      .from("watchlist")
      .insert({ source_type, source_label, source_url, keywords, is_active, sequence_id, priority: priority || "P1" })
      .select()
      .single();

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.status(201).json(data);
  } catch (err) {
    console.error("Settings POST /watchlist error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.put("/watchlist/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { source_type, source_label, source_url, keywords, is_active, sequence_id, priority } = req.body;

    const updates = {};
    if (source_type !== undefined) updates.source_type = source_type;
    if (source_label !== undefined) updates.source_label = source_label;
    if (source_url !== undefined) updates.source_url = source_url;
    if (keywords !== undefined) updates.keywords = keywords;
    if (is_active !== undefined) updates.is_active = is_active;
    if (sequence_id !== undefined) updates.sequence_id = sequence_id;
    if (priority !== undefined) updates.priority = priority;

    const { data, error } = await supabase
      .from("watchlist")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json(data);
  } catch (err) {
    console.error("Settings PUT /watchlist/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.delete("/watchlist/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabase
      .from("watchlist")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Settings supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("Settings DELETE /watchlist/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// Watchlist performance stats (aggregated leads by signal_source)
// Returns for each source: leads count, hot/warm/cold breakdown, avg score, last seen
// ────────────────────────────────────────────────────────────

router.get("/watchlist-stats", async (req, res) => {
  try {
    // Fetch watchlist entries
    const { data: sources, error: srcErr } = await supabase
      .from("watchlist")
      .select("id, source_type, source_label, source_url, keywords, priority, is_active, last_scraped_at");

    if (srcErr) return res.status(500).json({ error: srcErr.message });

    // Fetch all leads with signal_source (we only need a few fields, not heavy)
    const { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("id, signal_source, tier, icp_score, created_at")
      .not("signal_source", "is", null);

    if (leadsErr) return res.status(500).json({ error: leadsErr.message });

    // Group leads by signal_source (case-insensitive to handle label drift)
    const leadsBySource = {};
    for (const l of leads || []) {
      const key = (l.signal_source || "").toLowerCase().trim();
      if (!key) continue;
      if (!leadsBySource[key]) leadsBySource[key] = [];
      leadsBySource[key].push(l);
    }

    // Compute stats per source
    const stats = (sources || []).map((s) => {
      const key = (s.source_label || "").toLowerCase().trim();
      const matched = leadsBySource[key] || [];

      let hot = 0, warm = 0, cold = 0;
      let scoreSum = 0, scoreCount = 0;
      let lastLeadAt = null;

      for (const l of matched) {
        if (l.tier === "hot") hot++;
        else if (l.tier === "warm") warm++;
        else if (l.tier === "cold") cold++;
        if (typeof l.icp_score === "number") { scoreSum += l.icp_score; scoreCount++; }
        if (l.created_at && (!lastLeadAt || l.created_at > lastLeadAt)) lastLeadAt = l.created_at;
      }

      const total = matched.length;
      const avgScore = scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : null;
      const hotPct = total > 0 ? Math.round((hot / total) * 100) : 0;

      return {
        id: s.id,
        source_type: s.source_type,
        source_label: s.source_label,
        source_url: s.source_url,
        keywords: s.keywords,
        priority: s.priority,
        is_active: s.is_active,
        last_scraped_at: s.last_scraped_at,
        leads_count: total,
        hot_count: hot,
        warm_count: warm,
        cold_count: cold,
        hot_pct: hotPct,
        avg_score: avgScore,
        last_lead_at: lastLeadAt,
      };
    });

    // Also include unmatched signal_sources (leads with a source that doesn't match any watchlist entry)
    const matchedKeys = new Set((sources || []).map((s) => (s.source_label || "").toLowerCase().trim()));
    const orphanStats = [];
    for (const key of Object.keys(leadsBySource)) {
      if (matchedKeys.has(key)) continue;
      const matched = leadsBySource[key];
      let hot = 0, warm = 0, cold = 0, scoreSum = 0, scoreCount = 0, lastLeadAt = null;
      for (const l of matched) {
        if (l.tier === "hot") hot++;
        else if (l.tier === "warm") warm++;
        else if (l.tier === "cold") cold++;
        if (typeof l.icp_score === "number") { scoreSum += l.icp_score; scoreCount++; }
        if (l.created_at && (!lastLeadAt || l.created_at > lastLeadAt)) lastLeadAt = l.created_at;
      }
      const total = matched.length;
      orphanStats.push({
        id: null,
        source_type: "unknown",
        source_label: matched[0].signal_source,
        source_url: null,
        keywords: null,
        priority: null,
        is_active: null,
        last_scraped_at: null,
        leads_count: total,
        hot_count: hot,
        warm_count: warm,
        cold_count: cold,
        hot_pct: total > 0 ? Math.round((hot / total) * 100) : 0,
        avg_score: scoreCount > 0 ? Math.round((scoreSum / scoreCount) * 10) / 10 : null,
        last_lead_at: lastLeadAt,
        orphan: true,
      });
    }

    res.json({ stats: stats.concat(orphanStats), total_leads: (leads || []).length });
  } catch (err) {
    console.error("Settings GET /watchlist-stats error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// BeReach credit usage (last 4 days)
// ────────────────────────────────────────────────────────────

router.get("/bereach-credits", async (req, res) => {
  try {
    const { data, error } = await supabase.rpc("get_bereach_credits");

    if (error) {
      // Fallback: query logs directly
      const { data: logs, error: logErr } = await supabase
        .from("logs")
        .select("created_at, message")
        .like("message", "%for collection%")
        .gte("created_at", new Date(Date.now() - 4 * 86400000).toISOString())
        .order("created_at", { ascending: false });

      if (logErr) return res.status(500).json({ error: logErr.message });

      // Parse credit values from Task A budget log:
      // "Budget: 300 - X (Task C) - Y (Task B) - Z (mark-connected) - 30 (enrichment) = W for collection"
      const days = {};
      (logs || []).forEach((l) => {
        const day = l.created_at.substring(0, 10);
        const match = l.message.match(/Budget: (\d+) - .* = (\d+) for collection/);
        if (match) {
          const total = parseInt(match[1]);
          const collectionBudget = parseInt(match[2]);
          const credits_used = total - collectionBudget; // taskC + taskB + markConnected + enrichReserve
          if (!days[day] || credits_used > days[day].credits_used) {
            days[day] = { day, credits_used, budget: total };
          }
        }
      });

      return res.json(Object.values(days).sort((a, b) => a.day.localeCompare(b.day)));
    }

    res.json(data);
  } catch (err) {
    console.error("BeReach credits error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// CONF-06 -- Cron Schedule (static, read-only)
// ────────────────────────────────────────────────────────────

router.get("/cron", (req, res) => {
  res.json([
    { task: "task-c-followup", label: "C - Follow-up", cron: "20 7 * * 1-6", time: "07h20", days: "Lun-Sam" },
    { task: "task-b-invitations", label: "B - Invitations", cron: "25 7 * * 1-6", time: "07h25", days: "Lun-Sam" },
    { task: "task-a-signals", label: "A - Signaux", cron: "30 7 * * 1-6", time: "07h30", days: "Lun-Sam" },
    { task: "task-d-email", label: "D - Email", cron: "0 10 * * 1-6", time: "10h00", days: "Lun-Sam" },
    { task: "task-e-whatsapp", label: "E - WhatsApp", cron: "30 10 * * 1-6", time: "10h30", days: "Lun-Sam" },
    { task: "whatsapp-poll", label: "WhatsApp Poll", cron: "*/15 9-18 * * 1-6", time: "Toutes les 15min", days: "Lun-Sam 9h-18h" },
  ]);
});

module.exports = router;
