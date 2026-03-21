const { Router } = require("express");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");

const router = Router();
router.use(authMiddleware);

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

// Status -> funnel stage mapping
const FUNNEL_MAP = {
  new: "new",
  enriched: "new",
  scored: "new",
  prospected: "new",
  invitation_sent: "invited",
  connected: "connected",
  messaged: "connected",
  email_sent: "email",
  whatsapp_sent: "whatsapp",
  replied: "whatsapp",
  meeting_booked: "whatsapp",
};

/**
 * GET /stats -- Funnel counts, activity counters, LinkedIn gauge
 */
router.get("/stats", async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from("leads")
      .select("status, created_at, invitation_sent_at");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Funnel counts
    const funnel = { new: 0, invited: 0, connected: 0, email: 0, whatsapp: 0 };
    for (const lead of leads) {
      const stage = FUNNEL_MAP[lead.status];
      if (stage) {
        funnel[stage]++;
      }
    }

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

    // Activity counters
    const todayStart = getTodayStartParis().toISOString();
    const weekStart = getWeekStartParis().toISOString();

    let today = 0;
    let week = 0;
    for (const lead of leads) {
      if (lead.created_at && lead.created_at >= todayStart) today++;
      if (lead.created_at && lead.created_at >= weekStart) week++;
    }

    // LinkedIn gauge
    let linkedinSent = 0;
    for (const lead of leads) {
      if (lead.invitation_sent_at && lead.invitation_sent_at >= todayStart) {
        linkedinSent++;
      }
    }

    res.json({
      funnel,
      conversions,
      activity: { today, week },
      linkedin: { sent: linkedinSent, limit: 15 },
    });
  } catch (err) {
    console.error("Dashboard /stats error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /charts -- Signal sources, ICP score histogram, 7-day trend
 */
router.get("/charts", async (req, res) => {
  try {
    const { data: leads, error } = await supabase
      .from("leads")
      .select("signal_category, icp_score, created_at");

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Signal source breakdown
    const sourceCounts = {};
    for (const lead of leads) {
      const cat = lead.signal_category || "unknown";
      sourceCounts[cat] = (sourceCounts[cat] || 0) + 1;
    }
    const sources = Object.entries(sourceCounts).map(([name, value]) => ({ name, value }));

    // ICP score histogram
    const buckets = [
      { range: "0-20", min: 0, max: 20, count: 0 },
      { range: "20-40", min: 20, max: 40, count: 0 },
      { range: "40-60", min: 40, max: 60, count: 0 },
      { range: "60-80", min: 60, max: 80, count: 0 },
      { range: "80-100", min: 80, max: 101, count: 0 },
    ];
    for (const lead of leads) {
      const score = lead.icp_score;
      if (score == null) continue;
      for (const bucket of buckets) {
        if (score >= bucket.min && score < bucket.max) {
          bucket.count++;
          break;
        }
      }
    }
    const scores = buckets.map(({ range, count }) => ({ range, count }));

    // 7-day trend
    const trend = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = toParisDateStr(d);
      trend.push({ date: dateStr, count: 0 });
    }
    for (const lead of leads) {
      if (!lead.created_at) continue;
      const dateStr = toParisDateStr(new Date(lead.created_at));
      const entry = trend.find((t) => t.date === dateStr);
      if (entry) entry.count++;
    }

    res.json({ sources, scores, trend });
  } catch (err) {
    console.error("Dashboard /charts error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /cron -- Cron task monitoring
 */
router.get("/cron", async (req, res) => {
  try {
    const taskDefs = [
      { task: "task-a-signals", label: "A - Signaux" },
      { task: "task-b-invitations", label: "B - Invitations" },
      { task: "task-c-followup", label: "C - Follow-up" },
      { task: "task-d-email", label: "D - Email" },
      { task: "task-e-whatsapp", label: "E - WhatsApp" },
      { task: "task-f-briefing", label: "F - Briefing" },
    ];

    const tasks = [];
    for (const def of taskDefs) {
      const { data, error } = await supabase
        .from("logs")
        .select("task, level, message, created_at")
        .eq("task", def.task)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        tasks.push({ task: def.task, label: def.label, status: "error", lastRun: null });
        continue;
      }

      if (!data || data.length === 0) {
        tasks.push({ task: def.task, label: def.label, status: "never", lastRun: null });
        continue;
      }

      const entry = data[0];
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

      tasks.push({
        task: def.task,
        label: def.label,
        status,
        lastRun: entry.created_at,
      });
    }

    res.json({ tasks });
  } catch (err) {
    console.error("Dashboard /cron error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
