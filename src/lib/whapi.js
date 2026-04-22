/**
 * Whapi Cloud wrapper — sends text messages from Julien's personal
 * WhatsApp number via the Whapi Cloud API (distinct from the uChat/Meta
 * template path). Lazy-init : does not throw at module load if env vars
 * missing, only at call time.
 *
 * See docs/plans/2026-04-22-whapi-personal-whatsapp-design.md
 */

const DEFAULT_BASE = "https://gate.whapi.cloud";

function getBase() {
  return process.env.WHAPI_BASE || DEFAULT_BASE;
}

function getToken() {
  var tok = process.env.WHAPI_TOKEN;
  if (!tok) throw new Error("WHAPI_TOKEN is not set in environment");
  return tok;
}

/**
 * Normalize a phone number to E.164 with leading +, which Whapi Cloud
 * accepts for the `to` param. Accepts "+33…", "33…", "0033…", or FR
 * national "06…" / "07…".
 */
function normalizePhone(raw) {
  if (!raw) return null;
  var s = String(raw).replace(/[\s\-().]/g, "");
  if (/^\+\d+$/.test(s)) return s;
  if (/^00\d+$/.test(s)) return "+" + s.slice(2);
  if (/^0[67]\d{8}$/.test(s)) return "+33" + s.slice(1); // FR national → E.164
  if (/^\d{10,15}$/.test(s)) return "+" + s;
  return null;
}

/**
 * Send a plain-text WhatsApp message via Whapi Cloud.
 * @param {string} phone — any format (E.164, FR national, etc.)
 * @param {string} text — message body
 * @returns {Promise<{messageId: string|null, status: string, raw: object}>}
 */
async function sendWhapiText(phone, text) {
  var e164 = normalizePhone(phone);
  if (!e164) throw new Error("invalid_phone: " + phone);
  if (!text || !String(text).trim()) throw new Error("empty_text");

  // Whapi requires digits-only (no '+' prefix) — regex ^[\d-]{9,31}(@...)?
  var whapiTo = e164.replace(/^\+/, "");

  var res = await fetch(getBase() + "/messages/text", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + getToken(),
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    body: JSON.stringify({
      to: whapiTo,
      body: String(text).trim(),
    }),
  });

  if (!res.ok) {
    var errText = await res.text();
    var err = new Error("whapi_send_failed:" + res.status + ":" + errText.slice(0, 300));
    err.status = res.status;
    err.body = errText;
    throw err;
  }

  var data = await res.json();
  // Whapi returns { sent: true, message: { id, ...} } on success
  var messageId = (data && data.message && data.message.id) || (data && data.id) || null;
  return {
    messageId: messageId,
    status: (data && data.sent) ? "sent" : "unknown",
    raw: data,
  };
}

/**
 * Lightweight health check — GET /health. Returns true if the channel
 * is connected (200 OK). Used by the frontend to display a green/red
 * badge in the settings page (optional).
 */
async function checkWhapiHealth() {
  try {
    var res = await fetch(getBase() + "/health", {
      method: "GET",
      headers: { "Authorization": "Bearer " + getToken() },
    });
    return res.ok;
  } catch (_e) {
    return false;
  }
}

module.exports = { sendWhapiText, normalizePhone, checkWhapiHealth };
