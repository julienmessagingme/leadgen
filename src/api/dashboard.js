const { Router } = require("express");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");
const { checkLimits } = require("../lib/bereach");

const router = Router();
router.use(authMiddleware);

// In-memory cache for BeReach limits — BeReach rate-limits /me/limits and the
// dashboard auto-refetches every ~60s, so we cache briefly.
let bereachCache = { data: null, fetchedAt: 0 };
const BEREACH_CACHE_MS = 30_000;

/**
 * Helper: Get start of "today" in Europe/Paris timezone as UTC Date.
 */
function getTodayStartParis() {
  const now = new Date();
  const parisStr = now.toLocaleString("en-US", { timeZone: "Europe/Paris" });
  const parisNow = new Date(parisStr);
  parisNow.setHours(0, 0, 0, 0);
  const utcNow = now.getTime();
  const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getTime();
  const offset = parisTime - utcNow;
  return new Date(parisNow.getTime() - offset);
}

/**
 * Helper: Get start of the current week (Monday 00:00) in Europe/Paris timezone as UTC Date.
 */
function getWeekStartParis() {
  const now = new Date();
  const parisStr = now.toLocaleString("en-US", { timeZone: "Europe/Paris" });
  const parisNow = new Date(parisStr);
  const day = parisNow.getDay();
  const diff = day === 0 ? 6 : day - 1;
  parisNow.setDate(parisNow.getDate() - diff);
  parisNow.setHours(0, 0, 0, 0);
  const utcNow = now.getTime();
  const parisTime = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Paris" })).getTime();
  const offset = parisTime - utcNow;
  return new Date(parisNow.getTime() - offset);
}

/**
 * Helper: Get a Paris-timezone date string (YYYY-MM-DD) for a given Date object.
 */
function toParisDateStr(date) {
  return date.toLocaleDateString("en-CA", { timeZone: "Europe/Paris" });
}

/**
 * GET /stats -- Funnel counts, activity counters, LinkedIn gauge
 * Uses dashboard_stats() RPC for single DB round-trip.
 */
router.get("/stats", async (req, res) => {
  try {
    const todayStart = getTodayStartParis().toISOString();
    const weekStart = getWeekStartParis().toISOString();

    const { data, error } = await supabase.rpc("dashboard_stats", {
      p_today_start: todayStart,
      p_week_start: weekStart,
    });

    if (error) {
      console.error("Dashboard supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    const funnel = data.funnel;
    const activity = data.activity;
    const linkedin = data.linkedin;

    // Conversions (percentage of leads that reached each stage or beyond)
    const total = funnel.new + funnel.invited + funnel.connected + funnel.email + funnel.whatsapp;
    const pastNew = funnel.invited + funnel.connected + funnel.email + funnel.whatsapp;
    const pastInvited = funnel.connected + funnel.email + funnel.whatsapp;
    const pastConnected = funnel.email + funnel.whatsapp;

    const conversions = {
      invited_pct: total > 0 ? Math.round(pastNew / total * 100) : 0,
      connected_pct: pastNew > 0 ? Math.round(pastInvited / pastNew * 100) : 0,
      email_pct: pastInvited > 0 ? Math.round(pastConnected / pastInvited * 100) : 0,
      whatsapp_pct: pastConnected > 0 ? Math.round(funnel.whatsapp / pastConnected * 100) : 0,
    };

    res.json({
      funnel,
      conversions,
      activity,
      linkedin,
    });
  } catch (err) {
    console.error("Dashboard /stats error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /charts -- Signal sources, ICP score histogram, 7-day trend
 * Uses dashboard_charts() RPC for single DB round-trip.
 */
router.get("/charts", async (req, res) => {
  try {
    // Compute 7 days ago from today in Paris timezone
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const startDate = toParisDateStr(sevenDaysAgo) + "T00:00:00Z";

    const { data, error } = await supabase.rpc("dashboard_charts", {
      p_start_date: startDate,
    });

    if (error) {
      console.error("Dashboard supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    // Map RPC response to match existing frontend response shape
    const sources = data.signalSources;
    const scores = data.icpHistogram;
    const trend = data.weekTrend;

    res.json({ sources, scores, trend });
  } catch (err) {
    console.error("Dashboard /charts error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /cron -- Cron task monitoring
 * Uses cron_last_runs() RPC for single DB round-trip instead of 6 sequential queries.
 */
router.get("/cron", async (req, res) => {
  try {
    const taskDefs = [
      { task: "task-c-followup", label: "C - Connexions + Messages (07h20)" },
      { task: "task-b-invitations", label: "B - Invitations LinkedIn (07h25)" },
      { task: "task-a-signals", label: "A - Collecte signaux (07h30)" },
      { task: "task-d-email", label: "D - Email J+7 (10h00)" },
      { task: "task-f-email-followup", label: "F - Relance email J+14 (10h15)" },
      { task: "task-e-whatsapp", label: "E - WhatsApp (10h30)" },
      { task: "whatsapp-poll", label: "WhatsApp poll (toutes les 15min)" },
      { task: "lead-cleanup", label: "Nettoyage leads stale (02h30)" },
      { task: "log-cleanup", label: "Purge logs (02h00)" },
    ];

    const { data: lastRuns, error } = await supabase.rpc("cron_last_runs");

    if (error) {
      console.error("Dashboard supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    // Index RPC results by task name for O(1) lookup
    const runsByTask = {};
    if (lastRuns) {
      for (const run of lastRuns) {
        runsByTask[run.task] = run;
      }
    }

    const tasks = taskDefs.map((def) => {
      const entry = runsByTask[def.task];

      if (!entry) {
        return { task: def.task, label: def.label, status: "never", lastRun: null };
      }

      let status = "unknown";
      if (entry.message && entry.message.includes("completed")) {
        status = "ok";
      } else if (entry.level === "error" || (entry.message && entry.message.includes("error"))) {
        status = "error";
      } else if (entry.message && entry.message.includes("started")) {
        status = "running";
      } else {
        // Other info messages (like "No hot leads for briefing") indicate task ran fine
        status = "ok";
      }

      return {
        task: def.task,
        label: def.label,
        status,
        lastRun: entry.created_at,
      };
    });

    res.json({ tasks });
  } catch (err) {
    console.error("Dashboard /cron error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// GET /email-tracking -- All sent emails with open/click tracking
// ────────────────────────────────────────────────────────────

router.get("/email-tracking", async (req, res) => {
  try {
    // Get all leads that had an email sent
    var { data: leads, error: leadsErr } = await supabase
      .from("leads")
      .select("id, full_name, company_name, email, status, icp_score, tier, email_sent_at, email_followup_sent_at, linkedin_url, metadata")
      .not("email_sent_at", "is", null)
      .order("email_sent_at", { ascending: false })
      .limit(200);

    if (leadsErr) {
      return res.status(500).json({ error: "Failed to fetch leads" });
    }

    if (!leads || leads.length === 0) {
      return res.json({ leads: [] });
    }

    // Get all email events for these leads
    var leadIds = leads.map(function (l) { return l.id; });
    var { data: events } = await supabase
      .from("email_events")
      .select("lead_id, email_type, event_type, created_at")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: true });

    // Group events by lead
    var eventsByLead = {};
    (events || []).forEach(function (e) {
      if (!eventsByLead[e.lead_id]) eventsByLead[e.lead_id] = [];
      eventsByLead[e.lead_id].push(e);
    });

    // Build response
    var result = leads.map(function (l) {
      var evts = eventsByLead[l.id] || [];
      var opens = evts.filter(function (e) { return e.event_type === "open"; });
      var clicks = evts.filter(function (e) { return e.event_type === "click"; });
      return {
        id: l.id,
        full_name: l.full_name,
        company_name: l.company_name,
        email: l.email,
        status: l.status,
        icp_score: l.icp_score,
        tier: l.tier,
        linkedin_url: l.linkedin_url,
        cold_outbound: !!(l.metadata && l.metadata.cold_outbound),
        email_sent_at: l.email_sent_at,
        email_followup_sent_at: l.email_followup_sent_at,
        opens: opens.length,
        first_open: opens.length > 0 ? opens[0].created_at : null,
        clicks: clicks.length,
        first_click: clicks.length > 0 ? clicks[0].created_at : null,
      };
    });

    res.json({ leads: result });
  } catch (err) {
    console.error("Dashboard /email-tracking error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/dashboard/bereach-live
 *
 * Live usage snapshot from BeReach /me/limits. The daily counters returned here
 * are the authoritative source of truth for quota — they reflect EVERY call
 * made with the BeReach key (leadgen pipeline + Troudebal cold outreach agent +
 * manual cold-outbound searches), not just what we happen to have logged.
 *
 * Cached ~30s to avoid hammering /me/limits when the UI auto-refreshes.
 *
 * Response shape:
 * {
 *   updated_at: ISO,
 *   actions: {
 *     scraping:           { current, limit, remaining },  // collect/search -> Task A + Troudebal
 *     profile_visit:      { current, limit, remaining },  // enrichment
 *     connection_request: { current, limit, remaining },  // Task B invitations
 *     message:            { current, limit, remaining },  // Task C messages
 *     chat_search:        { current, limit, remaining },  // lookups
 *   }
 * }
 */
router.get("/bereach-live", async (_req, res) => {
  try {
    const now = Date.now();
    let raw = bereachCache.data;
    if (!raw || now - bereachCache.fetchedAt > BEREACH_CACHE_MS) {
      raw = await checkLimits();
      bereachCache = { data: raw, fetchedAt: now };
    }

    const limits = (raw && raw.limits) || {};
    const wanted = ["scraping", "profile_visit", "connection_request", "message", "chat_search"];
    const actions = {};
    for (const key of wanted) {
      const d = limits[key] && limits[key].daily;
      if (d && typeof d.limit === "number") {
        actions[key] = {
          current: d.current || 0,
          limit: d.limit,
          remaining: typeof d.remaining === "number" ? d.remaining : Math.max(0, d.limit - (d.current || 0)),
        };
      }
    }

    res.json({
      updated_at: new Date(bereachCache.fetchedAt).toISOString(),
      actions,
    });
  } catch (err) {
    console.error("Dashboard /bereach-live error:", err.message);
    res.status(502).json({ error: "Failed to query BeReach", detail: err.message });
  }
});

module.exports = router;
