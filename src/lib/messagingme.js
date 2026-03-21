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

module.exports = {
  createWhatsAppTemplate,
  listTemplates,
  syncTemplates,
  sendWhatsAppByUserId,
};
