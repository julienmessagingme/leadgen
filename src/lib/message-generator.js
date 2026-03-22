/**
 * Claude Sonnet message generator for all outreach channels.
 * Uses messages.create with JSON instruction in prompt.
 * Returns null on error to let calling tasks decide fallback behavior.
 *
 * Supports both signal-based and cold outbound leads.
 * Cold leads receive prompts that never reference LinkedIn signals.
 */

const { getAnthropicClient } = require("./anthropic");
const { supabase } = require("./supabase");

const MODEL = "claude-sonnet-4-20250514";

function sanitizeForPrompt(value, maxLen = 200) {
  if (!value) return "";
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, maxLen);
}

// ────────────────────────────────────────────────────────────
// Cold lead detection
// ────────────────────────────────────────────────────────────

/**
 * Determine if a lead is a cold outbound lead (no LinkedIn signal).
 * @param {object} lead
 * @returns {boolean}
 */
function isColdLead(lead) {
  if (!lead) return false;
  if (lead.signal_category === "cold_outbound") return true;
  if (lead.signal_type === "cold_search") return true;
  if (lead.metadata && lead.metadata.cold_outbound === true) return true;
  return false;
}

// ────────────────────────────────────────────────────────────
// Signal-based default templates
// ────────────────────────────────────────────────────────────

var DEFAULT_INVITATION_TEMPLATE =
  "Redige une invitation LinkedIn personnalisee pour ce prospect.\n\n" +
  "Regles:\n" +
  "- Reference au signal detecte\n" +
  "- Ton professionnel mais humain\n" +
  "- Max 280 caracteres STRICT\n" +
  "- Pas d'emojis, pas de pitch commercial\n" +
  "- Pas de guillemets autour du texte";

var DEFAULT_FOLLOWUP_TEMPLATE =
  "Redige un message de suivi LinkedIn post-connexion.\n\n" +
  "Regles:\n" +
  "- Remercier pour la connexion\n" +
  "- Proposer un echange sur le sujet du signal\n" +
  "- Mentionner MessagingMe brievement\n" +
  "- 3 a 5 phrases max\n" +
  "- Ton naturel et direct";

var DEFAULT_EMAIL_TEMPLATE =
  "Redige un email de relance J+7 apres connexion LinkedIn.\n\n" +
  "Regles:\n" +
  "- Objet accrocheur et court\n" +
  "- Corps en HTML simple (pas de CSS inline complexe)\n" +
  "- Reference a la connexion LinkedIn\n" +
  "- Proposition de valeur MessagingMe pour leur secteur\n" +
  "- CTA: lien Calendly {calendlyUrl}\n" +
  "- Signature: Julien Poupard, DG MessagingMe\n" +
  "- Ton professionnel mais personnel";

var DEFAULT_WHATSAPP_TEMPLATE =
  "Redige un message WhatsApp pour ce prospect.\n\n" +
  "Regles:\n" +
  "- 3 a 4 lignes max\n" +
  "- Reference au signal et a l'echange LinkedIn\n" +
  "- Proposition de RDV via Calendly\n" +
  "- Ton direct et personnel\n" +
  "- Pas d'emojis excessifs";

// ────────────────────────────────────────────────────────────
// Cold outbound default templates (no signal references)
// ────────────────────────────────────────────────────────────

var DEFAULT_COLD_INVITATION_TEMPLATE =
  "Redige une invitation LinkedIn courte et professionnelle pour ce prospect.\n\n" +
  "Regles:\n" +
  "- Presentation courte de Julien et MessagingMe\n" +
  "- Proposition de valeur adaptee au secteur du prospect\n" +
  "- Ton professionnel et direct\n" +
  "- Max 200 caracteres STRICT (cible 150-200)\n" +
  "- Pas d'emojis, pas de pitch commercial\n" +
  "- NE JAMAIS mentionner un post, like, commentaire ou signal LinkedIn\n" +
  "- Personnaliser avec le nom et l'entreprise (PAS le titre)";

var DEFAULT_COLD_FOLLOWUP_TEMPLATE =
  "Redige un message de suivi LinkedIn post-connexion pour un prospect contacte en cold.\n\n" +
  "Regles:\n" +
  "- Remercier pour la connexion\n" +
  "- Proposer un echange sur les enjeux de messaging/communication client\n" +
  "- Mentionner MessagingMe brievement\n" +
  "- 3 a 5 phrases max\n" +
  "- Ton naturel et direct\n" +
  "- NE JAMAIS mentionner un signal LinkedIn";

var DEFAULT_COLD_EMAIL_TEMPLATE =
  "Redige un email de relance pour un prospect contacte en cold.\n\n" +
  "Regles:\n" +
  "- Objet accrocheur et court\n" +
  "- Corps en HTML simple\n" +
  "- Proposition de valeur MessagingMe pour leur secteur\n" +
  "- CTA: lien Calendly {calendlyUrl}\n" +
  "- Signature: Julien Poupard, DG MessagingMe\n" +
  "- Ton professionnel mais personnel\n" +
  "- NE JAMAIS mentionner un post, like ou signal LinkedIn";

var DEFAULT_COLD_WHATSAPP_TEMPLATE =
  "Redige un message WhatsApp pour un prospect contacte en cold.\n\n" +
  "Regles:\n" +
  "- 3 a 4 lignes max\n" +
  "- Proposition de RDV via Calendly\n" +
  "- Ton direct et personnel\n" +
  "- Pas d'emojis excessifs\n" +
  "- NE JAMAIS mentionner un signal LinkedIn";

// ────────────────────────────────────────────────────────────
// Cold template helper
// ────────────────────────────────────────────────────────────

/**
 * Pick a cold template from configured templates (random for variety).
 * @param {Array} coldTemplates - Array of {name, prompt, value_proposition}
 * @returns {object|null} Selected template or null
 */
function pickColdTemplate(coldTemplates) {
  if (!Array.isArray(coldTemplates) || coldTemplates.length === 0) return null;
  var idx = Math.floor(Math.random() * coldTemplates.length);
  return coldTemplates[idx];
}

/**
 * Build the user prompt for a cold lead (no signal references).
 * @param {string} instructions - Cold template instructions
 * @param {string} valueProposition - Value proposition text
 * @param {object} lead - Lead data
 * @param {string} jsonShape - Expected JSON response shape
 * @returns {string}
 */
function buildColdPrompt(instructions, valueProposition, lead, jsonShape) {
  var parts = [instructions];
  if (valueProposition) {
    parts.push("\nProposition de valeur a mettre en avant: " + valueProposition);
  }
  parts.push(
    "\nProspect: " + (sanitizeForPrompt(lead.full_name) || "inconnu") +
    "\nEntreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue")
  );
  parts.push("\nReponds en JSON: " + jsonShape);
  return parts.join("\n");
}

// ────────────────────────────────────────────────────────────
// Template loading
// ────────────────────────────────────────────────────────────

/**
 * Load template instructions from settings table.
 * Fail-open: returns empty object on error (hardcoded defaults will be used).
 * Also loads cold_templates key (JSON array of cold template objects).
 * @returns {Promise<object>} Map of template key to value
 */
async function loadTemplates() {
  try {
    var { data, error } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", [
        "template_invitation", "template_followup", "template_email", "template_whatsapp",
        "cold_templates"
      ]);
    if (error || !data) return {};
    var result = {};
    for (var i = 0; i < data.length; i++) {
      var r = data[i];
      if (r.key === "cold_templates") {
        try {
          result.cold_templates = JSON.parse(r.value);
        } catch (_e) {
          result.cold_templates = [];
        }
      } else {
        result[r.key] = r.value;
      }
    }
    return result;
  } catch (e) {
    console.warn("loadTemplates failed:", e.message);
    return {};
  }
}

/**
 * Helper: call Claude and parse JSON response.
 */
async function callClaude(systemPrompt, userPrompt, maxTokens) {
  var response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  return JSON.parse(response.content[0].text);
}

var SYSTEM = "Tu es Julien Poupard, DG de MessagingMe (plateforme de messaging WhatsApp/RCS pour entreprises). Reponds UNIQUEMENT en JSON valide, sans markdown, sans code block.";

// ────────────────────────────────────────────────────────────
// Message generation functions
// ────────────────────────────────────────────────────────────

/**
 * Generate a personalized LinkedIn invitation note.
 * @param {object} lead - Lead data
 * @returns {Promise<string|null>} Invitation note (max 280 chars signal / 200 chars cold) or null on error
 */
async function generateInvitationNote(lead, templates) {
  try {
    var tpl = templates || (await loadTemplates());

    // Cold lead branch
    if (isColdLead(lead)) {
      var coldTpl = pickColdTemplate(tpl.cold_templates);
      var coldInstructions = coldTpl ? coldTpl.prompt : DEFAULT_COLD_INVITATION_TEMPLATE;
      var coldValueProp = coldTpl ? coldTpl.value_proposition : "";

      var coldResult = await callClaude(SYSTEM,
        buildColdPrompt(coldInstructions, coldValueProp, lead, '{"note": "..."}'),
        256);

      var coldNote = coldResult.note || "";
      if (coldNote.length > 200) {
        coldNote = coldNote.substring(0, 197) + "...";
      }
      return coldNote;
    }

    // Signal-based lead (existing behavior)
    var instructions = tpl.template_invitation || DEFAULT_INVITATION_TEMPLATE;

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      "Prospect: " + (sanitizeForPrompt(lead.full_name) || "inconnu") + "\n" +
      "Titre: " + (sanitizeForPrompt(lead.headline) || "inconnu") + "\n" +
      "Entreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue") + "\n" +
      "Signal detecte: " + (sanitizeForPrompt(lead.signal_type) || "inconnu") + " - " + sanitizeForPrompt(lead.signal_detail) + "\n\n" +
      'Reponds en JSON: {"note": "..."}', 256);

    var note = result.note || "";
    if (note.length > 280) {
      note = note.substring(0, 277) + "...";
    }
    return note;
  } catch (err) {
    console.warn("generateInvitationNote failed:", err.message);
    return null;
  }
}

/**
 * Generate a LinkedIn follow-up message post-connection.
 * @param {object} lead - Lead data
 * @returns {Promise<string|null>} Follow-up message or null on error
 */
async function generateFollowUpMessage(lead, templates) {
  try {
    var tpl = templates || (await loadTemplates());

    // Cold lead branch
    if (isColdLead(lead)) {
      var coldTpl = pickColdTemplate(tpl.cold_templates);
      var coldInstructions = coldTpl ? coldTpl.prompt : DEFAULT_COLD_FOLLOWUP_TEMPLATE;
      var coldValueProp = coldTpl ? coldTpl.value_proposition : "";

      var coldResult = await callClaude(SYSTEM,
        buildColdPrompt(coldInstructions, coldValueProp, lead, '{"message": "..."}'),
        512);

      return coldResult.message || null;
    }

    // Signal-based lead (existing behavior)
    var instructions = tpl.template_followup || DEFAULT_FOLLOWUP_TEMPLATE;

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      "Prospect: " + (sanitizeForPrompt(lead.full_name) || "inconnu") + "\n" +
      "Titre: " + (sanitizeForPrompt(lead.headline) || "inconnu") + "\n" +
      "Entreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue") + "\n" +
      "Signal detecte: " + (sanitizeForPrompt(lead.signal_type) || "inconnu") + " - " + sanitizeForPrompt(lead.signal_detail) + "\n\n" +
      'Reponds en JSON: {"message": "..."}', 512);

    return result.message || null;
  } catch (err) {
    console.warn("generateFollowUpMessage failed:", err.message);
    return null;
  }
}

/**
 * Generate an email (subject + HTML body) for follow-up.
 * @param {object} lead - Lead data
 * @returns {Promise<{subject: string, body: string}|null>} Email object or null on error
 */
async function generateEmail(lead, templates) {
  try {
    var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme";
    var tpl = templates || (await loadTemplates());

    // Cold lead branch
    if (isColdLead(lead)) {
      var coldTpl = pickColdTemplate(tpl.cold_templates);
      var coldInstructions = (coldTpl ? coldTpl.prompt : DEFAULT_COLD_EMAIL_TEMPLATE)
        .replace("{calendlyUrl}", calendlyUrl);
      var coldValueProp = coldTpl ? coldTpl.value_proposition : "";

      var coldResult = await callClaude(SYSTEM,
        buildColdPrompt(coldInstructions, coldValueProp, lead, '{"subject": "...", "body": "<html>...</html>"}'),
        1024);

      if (!coldResult.subject || !coldResult.body) return null;
      return { subject: coldResult.subject, body: coldResult.body };
    }

    // Signal-based lead (existing behavior)
    var instructions = (tpl.template_email || DEFAULT_EMAIL_TEMPLATE).replace("{calendlyUrl}", calendlyUrl);

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      "Prospect: " + (sanitizeForPrompt(lead.full_name) || "inconnu") + "\n" +
      "Titre: " + (sanitizeForPrompt(lead.headline) || "inconnu") + "\n" +
      "Entreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue") + "\n" +
      "Signal detecte: " + (sanitizeForPrompt(lead.signal_type) || "inconnu") + " - " + sanitizeForPrompt(lead.signal_detail) + "\n" +
      "Email: " + sanitizeForPrompt(lead.email) + "\n\n" +
      'Reponds en JSON: {"subject": "...", "body": "<html>...</html>"}', 1024);

    if (!result.subject || !result.body) return null;
    return { subject: result.subject, body: result.body };
  } catch (err) {
    console.warn("generateEmail failed:", err.message);
    return null;
  }
}

/**
 * Generate a WhatsApp message body.
 * @param {object} lead - Lead data
 * @returns {Promise<string|null>} WhatsApp body text or null on error
 */
async function generateWhatsAppBody(lead, templates) {
  try {
    var tpl = templates || (await loadTemplates());

    // Cold lead branch
    if (isColdLead(lead)) {
      var coldTpl = pickColdTemplate(tpl.cold_templates);
      var coldInstructions = coldTpl ? coldTpl.prompt : DEFAULT_COLD_WHATSAPP_TEMPLATE;
      var coldValueProp = coldTpl ? coldTpl.value_proposition : "";

      var coldResult = await callClaude(SYSTEM,
        buildColdPrompt(coldInstructions, coldValueProp, lead, '{"body": "..."}'),
        512);

      return coldResult.body || null;
    }

    // Signal-based lead (existing behavior)
    var instructions = tpl.template_whatsapp || DEFAULT_WHATSAPP_TEMPLATE;

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      "Prospect: " + (sanitizeForPrompt(lead.full_name) || "inconnu") + "\n" +
      "Titre: " + (sanitizeForPrompt(lead.headline) || "inconnu") + "\n" +
      "Entreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue") + "\n" +
      "Signal detecte: " + (sanitizeForPrompt(lead.signal_type) || "inconnu") + " - " + sanitizeForPrompt(lead.signal_detail) + "\n\n" +
      'Reponds en JSON: {"body": "..."}', 512);

    return result.body || null;
  } catch (err) {
    console.warn("generateWhatsAppBody failed:", err.message);
    return null;
  }
}

/**
 * Generate a LinkedIn InMail (subject + body).
 * @param {object} lead - Lead data
 * @returns {Promise<{subject: string, body: string}|null>} InMail object or null on error
 */
async function generateInMail(lead) {
  try {
    var result = await callClaude(SYSTEM,
      "Redige un InMail LinkedIn.\n\n" +
      "Prospect: " + (sanitizeForPrompt(lead.full_name) || "inconnu") + "\n" +
      "Titre: " + (sanitizeForPrompt(lead.headline) || "inconnu") + "\n" +
      "Entreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue") + "\n" +
      "Secteur: " + (sanitizeForPrompt(lead.company_sector) || "inconnu") + "\n" +
      "Signal detecte: " + (sanitizeForPrompt(lead.signal_type) || "inconnu") + " - " + sanitizeForPrompt(lead.signal_detail) + "\n\n" +
      "Regles:\n" +
      "- Objet percutant et court\n" +
      "- Corps: reference au signal, valeur MessagingMe pour leur secteur, CTA clair\n" +
      "- Ton professionnel\n" +
      "- 5 a 8 phrases max\n\n" +
      'Reponds en JSON: {"subject": "...", "body": "..."}', 1024);

    if (!result.subject || !result.body) return null;
    return { subject: result.subject, body: result.body };
  } catch (err) {
    console.warn("generateInMail failed:", err.message);
    return null;
  }
}

module.exports = {
  isColdLead,
  loadTemplates,
  generateInvitationNote,
  generateFollowUpMessage,
  generateEmail,
  generateWhatsAppBody,
  generateInMail,
};
