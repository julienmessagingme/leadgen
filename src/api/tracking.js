const { Router } = require("express");
const { supabase } = require("../lib/supabase");
const { verifyToken } = require("../lib/tracking");

const router = Router();

// Public endpoints -- NO auth middleware
// These are called by email recipients' browsers to log click/open events.

// 1x1 transparent PNG (43 bytes)
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=",
  "base64"
);

/**
 * GET /track/click/:leadId/:emailType/:token?to=<url>
 * Logs the click and 302 redirects to the target URL.
 */
router.get("/click/:leadId/:emailType/:token", async (req, res) => {
  try {
    const leadId = parseInt(req.params.leadId, 10);
    const emailType = req.params.emailType;
    const token = req.params.token;
    const targetUrl = req.query.to;

    if (!targetUrl || isNaN(leadId)) {
      return res.status(400).send("Invalid tracking link");
    }
    if (!verifyToken(token, leadId, emailType)) {
      // Still redirect -- don't block the user, just don't log
      return res.redirect(302, targetUrl);
    }

    // Best-effort logging -- never block the redirect on errors
    supabase
      .from("email_events")
      .insert({
        lead_id: leadId,
        email_type: emailType,
        event_type: "click",
        url_clicked: targetUrl,
        ip: req.headers["x-forwarded-for"] || req.ip || null,
        user_agent: req.headers["user-agent"] || null,
      })
      .then(() => {})
      .catch((e) => console.error("Click log failed:", e.message));

    res.redirect(302, targetUrl);
  } catch (err) {
    console.error("GET /track/click error:", err.message);
    if (req.query.to) return res.redirect(302, req.query.to);
    res.status(500).send("Tracking error");
  }
});

/**
 * GET /track/open/:leadId/:emailType/:tokenPng
 * Logs the open and returns a 1x1 transparent PNG.
 * Filters out pre-loads (< 30 seconds after the email was sent -- Apple Mail Privacy).
 */
router.get("/open/:leadId/:emailType/:tokenPng", async (req, res) => {
  // Always return the pixel -- never reveal valid/invalid tokens
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");

  try {
    const leadId = parseInt(req.params.leadId, 10);
    const emailType = req.params.emailType;
    // tokenPng is "<token>.png" -- strip the extension
    const token = req.params.tokenPng.replace(/\.png$/, "");

    if (isNaN(leadId) || !verifyToken(token, leadId, emailType)) {
      return res.send(PIXEL_PNG);
    }

    // Filter Apple Mail Privacy pre-loads: skip if < 30s after send
    const { data: lead } = await supabase
      .from("leads")
      .select("email_sent_at, email_followup_sent_at")
      .eq("id", leadId)
      .single();

    const sentAt = emailType === "email_followup"
      ? lead && lead.email_followup_sent_at
      : lead && lead.email_sent_at;

    if (sentAt) {
      const ageSeconds = (Date.now() - new Date(sentAt).getTime()) / 1000;
      if (ageSeconds < 30) {
        return res.send(PIXEL_PNG);
      }
    }

    // Log the open (best-effort, never block the response)
    supabase
      .from("email_events")
      .insert({
        lead_id: leadId,
        email_type: emailType,
        event_type: "open",
        ip: req.headers["x-forwarded-for"] || req.ip || null,
        user_agent: req.headers["user-agent"] || null,
      })
      .then(() => {})
      .catch((e) => console.error("Open log failed:", e.message));

    res.send(PIXEL_PNG);
  } catch (err) {
    console.error("GET /track/open error:", err.message);
    res.send(PIXEL_PNG);
  }
});

module.exports = router;
