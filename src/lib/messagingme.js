/**
 * MessagingMe WhatsApp API wrapper.
 * Lazy-init pattern: does not throw at module load if env vars missing.
 */

const MESSAGINGME_BASE = "https://www.uchat.com.au/api";

/**
 * Internal POST helper for MessagingMe API.
 * @param {string} endpoint - API endpoint path
 * @param {object} body - Request body
 * @returns {Promise<object>} Parsed JSON response
 */
async function messagingme(endpoint, body = {}) {
  var apiKey = process.env.MESSAGINGME_API_KEY;
  var workspaceId = process.env.MESSAGINGME_WORKSPACE_ID;

  if (!apiKey) {
    throw new Error("MESSAGINGME_API_KEY is not set in environment");
  }
  if (!workspaceId) {
    throw new Error("MESSAGINGME_WORKSPACE_ID is not set in environment");
  }

  var res = await fetch(MESSAGINGME_BASE + endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + apiKey,
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    var text = await res.text();
    throw new Error("MessagingMe " + endpoint + " failed (" + res.status + "): " + text);
  }

  return res.json();
}

/**
 * Create a WhatsApp template.
 * @param {string} name - Template name
 * @param {string} bodyText - Template body text
 * @param {string} buttonUrl - URL for the CTA button
 */
async function createWhatsAppTemplate(name, bodyText, buttonUrl) {
  return messagingme("/whatsapp-template/create", {
    name: name,
    language: "fr",
    category: "MARKETING",
    components: [
      {
        type: "BODY",
        text: bodyText,
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "Prendre RDV",
            url: buttonUrl,
          },
        ],
      },
    ],
  });
}

/**
 * List WhatsApp templates, optionally filtered by name.
 * @param {string|null} name - Optional template name filter
 */
async function listTemplates(name) {
  var body = {};
  if (name) {
    body.name = name;
  }
  return messagingme("/whatsapp-template/list", body);
}

/**
 * Sync WhatsApp templates with Meta status.
 */
async function syncTemplates() {
  return messagingme("/whatsapp-template/sync", {});
}

/**
 * Send a WhatsApp template message by user ID.
 * @param {string} userId - Recipient user ID
 * @param {string} templateNamespace - Template namespace
 * @param {string} templateName - Template name
 * @param {string} lang - Language code (default: 'fr')
 * @param {Array} params - Template parameters
 */
async function sendWhatsAppByUserId(userId, templateNamespace, templateName, lang, params) {
  return messagingme("/subscriber/send-whatsapp-template-by-user-id", {
    user_id: userId,
    create_if_not_found: "yes",
    content: {
      namespace: templateNamespace,
      name: templateName,
      lang: lang || "fr",
      params: params || [],
    },
  });
}

/**
 * Find an existing uChat subscriber by phone number.
 * Returns null if no match. GET /subscribers?phone=E164 is whitespace-
 * sensitive (uChat stores E.164 without spaces) — normalise before calling.
 *
 * @param {string} phone - E.164 phone number (e.g. "+33612345678")
 * @returns {Promise<object|null>} Full subscriber object or null
 */
async function findSubscriberByPhone(phone) {
  var apiKey = process.env.MESSAGINGME_API_KEY;
  var workspaceId = process.env.MESSAGINGME_WORKSPACE_ID;
  if (!apiKey || !workspaceId) throw new Error("MessagingMe credentials not configured");
  var url = MESSAGINGME_BASE + "/subscribers?phone=" + encodeURIComponent(phone);
  var res = await fetch(url, {
    method: "GET",
    headers: { "Authorization": "Bearer " + apiKey, "X-Workspace-Id": workspaceId },
  });
  if (!res.ok) {
    throw new Error("findSubscriberByPhone failed (" + res.status + "): " + (await res.text()));
  }
  var data = await res.json();
  return (data.data && data.data.length > 0) ? data.data[0] : null;
}

/**
 * Create a new uChat subscriber with the given phone number.
 * Only `phone` is required — uChat infers the channel (whatsapp_cloud for
 * E.164 numbers). Extra fields like first_name, last_name, etc. can be
 * passed via `opts` and will land in subscriber custom fields.
 *
 * @param {string} phone - E.164 phone number
 * @param {object} opts - Optional fields { first_name, last_name, email, ... }
 * @returns {Promise<object>} Created subscriber
 */
async function createSubscriber(phone, opts) {
  var body = Object.assign({ phone: phone }, opts || {});
  var data = await messagingme("/subscriber/create", body);
  return data.data;
}

/**
 * Find the subscriber by phone or create one if missing.
 * Idempotent-ish: two concurrent calls could both see "not found" and both
 * try to create — uChat tolerates duplicate-phone creates (returns 201 each
 * time with a new user_ns). Minor edge case, not worth locking for here.
 *
 * @param {string} phone
 * @param {object} [opts] - Fields to set if we end up creating
 * @returns {Promise<{subscriber: object, created: boolean}>}
 */
async function findOrCreateSubscriber(phone, opts) {
  var existing = await findSubscriberByPhone(phone);
  if (existing) return { subscriber: existing, created: false };
  var created = await createSubscriber(phone, opts);
  return { subscriber: created, created: true };
}

/**
 * Send a sub-flow to a subscriber by user_id. The sub-flow typically wraps
 * a Meta-approved template carousel plus any tagging/tracking logic Julien
 * configured in uChat — we just trigger it, uChat handles the rest.
 *
 * @param {string} userId   - Subscriber user_id (E.164 without the +)
 * @param {string} subFlowNs - e.g. "f174727s3798065"
 * @returns {Promise<object>} uChat response
 */
async function sendSubFlowByUserId(userId, subFlowNs) {
  return messagingme("/subscriber/send-sub-flow-by-user-id", {
    user_id: userId,
    sub_flow_ns: subFlowNs,
  });
}

module.exports = {
  createWhatsAppTemplate,
  listTemplates,
  syncTemplates,
  sendWhatsAppByUserId,
  findSubscriberByPhone,
  createSubscriber,
  findOrCreateSubscriber,
  sendSubFlowByUserId,
};
