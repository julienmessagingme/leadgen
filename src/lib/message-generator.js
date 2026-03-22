/**
 * Claude Sonnet message generator for all outreach channels.
 * Uses messages.create with JSON instruction in prompt.
 * Returns null on error to let calling tasks decide fallback behavior.
 */

const { getAnthropicClient } = require("./anthropic");
const { supabase } = require("./supabase");

const MODEL = "claude-sonnet-4-20250514";

/**
 * Default template instructions (used as fallback when settings table is unavailable).
 */
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

/**
 * Load template instructions from settings table.
 * Fail-open: returns empty object on error (hardcoded defaults will be used).
 * @returns {Promise<object>} Map of template key to value
 */
async function loadTemplates() {
  try {
    var { data, error } = await supabase
      .from("settings")
      .select("key, value")
      .in("key", ["template_invitation", "template_followup", "template_email", "template_whatsapp"]);
    if (error || !data) return {};
    return Object.fromEntries(data.map(function (r) { return [r.key, r.value]; }));
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

/**
 * Generate a personalized LinkedIn invitation note.
 * @param {object} lead - Lead data
 * @returns {Promise<string|null>} Invitation note (max 280 chars) or null on error
 */
async function generateInvitationNote(lead) {
  try {
    var templates = await loadTemplates();
    var instructions = templates.template_invitation || DEFAULT_INVITATION_TEMPLATE;

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      "Prospect: " + (lead.full_name || "inconnu") + "\n" +
      "Titre: " + (lead.headline || "inconnu") + "\n" +
      "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
      "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n\n" +
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
async function generateFollowUpMessage(lead) {
  try {
    var templates = await loadTemplates();
    var instructions = templates.template_followup || DEFAULT_FOLLOWUP_TEMPLATE;

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      "Prospect: " + (lead.full_name || "inconnu") + "\n" +
      "Titre: " + (lead.headline || "inconnu") + "\n" +
      "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
      "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n\n" +
      'Reponds en JSON: {"message": "..."}', 512);

    return result.message || null;
  } catch (err) {
    console.warn("generateFollowUpMessage failed:", err.message);
    return null;
  }
}

/**
 * Generate an email (subject + HTML body) for J+7 follow-up.
 * @param {object} lead - Lead data
 * @returns {Promise<{subject: string, body: string}|null>} Email object or null on error
 */
async function generateEmail(lead) {
  try {
    var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme";
    var templates = await loadTemplates();
    var instructions = (templates.template_email || DEFAULT_EMAIL_TEMPLATE).replace("{calendlyUrl}", calendlyUrl);

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      "Prospect: " + (lead.full_name || "inconnu") + "\n" +
      "Titre: " + (lead.headline || "inconnu") + "\n" +
      "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
      "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n" +
      "Email: " + (lead.email || "") + "\n\n" +
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
async function generateWhatsAppBody(lead) {
  try {
    var templates = await loadTemplates();
    var instructions = templates.template_whatsapp || DEFAULT_WHATSAPP_TEMPLATE;

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      "Prospect: " + (lead.full_name || "inconnu") + "\n" +
      "Titre: " + (lead.headline || "inconnu") + "\n" +
      "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
      "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n\n" +
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
      "Prospect: " + (lead.full_name || "inconnu") + "\n" +
      "Titre: " + (lead.headline || "inconnu") + "\n" +
      "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
      "Secteur: " + (lead.company_sector || "inconnu") + "\n" +
      "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n\n" +
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
  generateInvitationNote,
  generateFollowUpMessage,
  generateEmail,
  generateWhatsAppBody,
  generateInMail,
};
