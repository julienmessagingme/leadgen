/**
 * WhatsApp delivery status webhook.
 *
 * Julien (or uChat/MessagingMe downstream) POSTs here each time a WhatsApp
 * send transitions status (delivered / read / failed). We resolve the
 * target lead by either the WhatsApp message_id we stored at send time, or
 * fallback to the most recent WhatsApp send to this phone number within the
 * last 72h. Then we write the status into metadata.whatsapp_*.
 *
 * This endpoint is intentionally READ/WRITE but scoped only to whatsapp_*
 * metadata keys + the `whatsapp_sent_at` timestamp column — it cannot
 * modify anything else on the lead.
 */

const { Router } = require("express");
const { supabase } = require("../lib/supabase");

const router = Router();

function webhookAuth(req, res, next) {
  const expected = process.env.WHATSAPP_WEBHOOK_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: "Webhook not configured (WHATSAPP_WEBHOOK_TOKEN missing)" });
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token || token !== expected) {
    return res.status(401).json({ error: "Invalid or missing webhook token" });
  }
  next();
}

const VALID_STATUSES = new Set(["sent", "delivered", "read", "failed"]);

function normalizePhone(p) {
  if (!p) return null;
  // Strip whitespace and punctuation we commonly see in uChat / CRM exports.
  let s = String(p).replace(/[\s\-().]/g, "");
  if (!s) return null;
  // Already E.164
  if (s.startsWith("+")) return s;
  // Raw international digits (e.g. uChat sends "33633921577") → prefix +.
  // We deliberately do NOT try to infer country from a leading 0 — that would
  // require knowing the caller's region. If it ever shows up we'll see the
  // lookup miss and flag it explicitly.
  if (/^\d+$/.test(s)) return "+" + s;
  return s;
}

/**
 * POST /api/whatsapp/delivery-status
 *
 * Body:
 *   {
 *     phone_number:  "+33612345678",        // REQUIRED, E.164 preferred
 *     status:        "sent"|"delivered"|"read"|"failed", // REQUIRED
 *     error_code:    "131049",              // required if status=failed
 *     error_message: "User does not have WhatsApp", // optional
 *     message_id:    "wamid.XXX"            // optional, disambiguates same-phone repeat
 *   }
 *
 * Response:
 *   200 { ok: true, lead_id, previous_status, new_status }
 *   404 { error: "No recent WhatsApp send matches this phone/message_id" }
 *   400 { error: "..." }                    // malformed body
 *   401 { error: "..." }                    // bad token
 */
router.post("/delivery-status", webhookAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const phone = normalizePhone(body.phone_number);
    const status = typeof body.status === "string" ? body.status.toLowerCase() : null;
    const messageId = body.message_id ? String(body.message_id).slice(0, 200) : null;

    if (!phone) return res.status(400).json({ error: "phone_number is required" });
    if (!status || !VALID_STATUSES.has(status)) {
      return res.status(400).json({ error: "status must be one of " + [...VALID_STATUSES].join(", ") });
    }
    // error_code is optional — Julien's uChat flow sends only error_message.

    // 1. Try to resolve the lead via message_id first (exact match, robust to
    //    phone reuse or number porting).
    let lead = null;
    if (messageId) {
      const { data, error } = await supabase
        .from("leads")
        .select("id, status, phone, metadata")
        .eq("metadata->>whatsapp_message_id", messageId)
        .limit(1);
      if (error) {
        console.warn("[whatsapp-webhook] message_id lookup failed:", error.message);
      } else if (data && data.length > 0) {
        lead = data[0];
      }
    }

    // 2. Fallback: most recent WhatsApp send to this phone in the last 72h.
    //    We match on the normalized phone so different formats resolve the
    //    same lead.
    if (!lead) {
      const cutoffIso = new Date(Date.now() - 72 * 3600 * 1000).toISOString();
      const { data, error } = await supabase
        .from("leads")
        .select("id, status, phone, metadata, whatsapp_sent_at")
        .not("whatsapp_sent_at", "is", null)
        .gte("whatsapp_sent_at", cutoffIso)
        .order("whatsapp_sent_at", { ascending: false })
        .limit(50);
      if (error) {
        console.error("[whatsapp-webhook] recent-sends lookup failed:", error.message);
        return res.status(500).json({ error: "DB error" });
      }
      lead = (data || []).find((l) => normalizePhone(l.phone) === phone) || null;
    }

    if (!lead) {
      return res.status(404).json({
        error: "No recent WhatsApp send found for this phone (last 72h)",
        phone_number: phone,
        message_id: messageId,
      });
    }

    // 3. Patch lead metadata. We never touch columns outside the whatsapp
    //    namespace here.
    const md = lead.metadata || {};
    const updatedMeta = Object.assign({}, md, {
      whatsapp_status: status,
      whatsapp_status_at: new Date().toISOString(),
      // Both error fields are optional — store whichever was sent, keep the
      // previous value otherwise (so a later 'delivered' event doesn't wipe
      // a recorded failure before it was actioned on).
      whatsapp_error_code: (status === "failed" && body.error_code)
        ? String(body.error_code).slice(0, 50)
        : (md.whatsapp_error_code || null),
      whatsapp_error_message: (status === "failed" && body.error_message)
        ? String(body.error_message).slice(0, 500)
        : (md.whatsapp_error_message || null),
      whatsapp_webhook_last_payload: {
        phone_number: phone,
        status,
        error_code: body.error_code || null,
        error_message: body.error_message || null,
        message_id: messageId,
        received_at: new Date().toISOString(),
      },
    });

    const { error: updErr } = await supabase
      .from("leads")
      .update({ metadata: updatedMeta })
      .eq("id", lead.id);

    if (updErr) {
      console.error("[whatsapp-webhook] update failed:", updErr.message);
      return res.status(500).json({ error: "Failed to persist status" });
    }

    res.json({
      ok: true,
      lead_id: lead.id,
      previous_status: md.whatsapp_status || null,
      new_status: status,
    });
  } catch (err) {
    console.error("[whatsapp-webhook] error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
