/**
 * Claude Sonnet message generator for all outreach channels.
 * Uses messages.create with JSON instruction in prompt.
 * Returns null on error to let calling tasks decide fallback behavior.
 */

const { getAnthropicClient } = require("./anthropic");
const { supabase } = require("./supabase");

const MODEL = "claude-sonnet-4-20250514";

function sanitizeForPrompt(value, maxLen = 200) {
  if (!value) return "";
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, maxLen);
}

/**
 * Default template instructions (used as fallback when settings table is unavailable).
 */
var DEFAULT_INVITATION_TEMPLATE =
  "Redige une invitation LinkedIn personnalisee pour ce prospect.\n\n" +
  "Regles:\n" +
  "- Reference au signal detecte\n" +
  "- Ton professionnel mais humain\n" +
  "- Max 150 caracteres STRICT (2-3 phrases courtes)\n" +
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
  "- Signature: Julien Dumas, DG MessagingMe\n" +
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
      .from("global_settings")
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

var SYSTEM = "Tu es Julien Dumas, DG de MessagingMe. MessagingMe est a la fois un cabinet de conseil en strategie conversationnelle et une plateforme technologique (messagingme.app). On aide les entreprises a definir leur strategie messaging (WhatsApp, RCS, SMS), puis on les accompagne dans la mise en oeuvre avec notre techno." +
" REGLE N1 ABSOLUE : Le premier contact REAGIT au signal chaud detecte. C est le hook. Si le mec a like un post sur l abandon de panier WhatsApp, on parle d abandon de panier. Si il a commente sur le RCS, on parle RCS. Si il dit clairement qu il veut du WhatsApp, on y va direct sur la techno, pas de blabla strategie. Le signal = le sujet de conversation. C est ce qui rend le message pertinent et non spam. Ne jamais pitcher la plateforme en premier." +
" REGLE N2 : Le positionnement conseil/strategie vient EN COMPLEMENT du signal, ou en REMPLACEMENT si le signal est trop generique pour accrocher. Par exemple : signal generique (like page Infobip) = on peut ajouter l angle conseil. Signal precis (commente un post sur WhatsApp dans le retail) = on reste 100% sur le signal." +
" REGLE N3 - SIGNAL CONCURRENT : Quand le prospect a reagi a un post d un concurrent (WAX, Alcmeon, Simio, WATI, Respond.io, etc.), il est PEUT-ETRE deja en relation avec eux. Dans ce cas : (1) reagir au signal normalement (le sujet du post), (2) se positionner en COMPLEMENT : on est des consultants en strategie conversationnelle, on aide a prendre de la hauteur, choisir les bons canaux, la bonne approche, et on peut aussi integrer notre techno. Ne PAS attaquer le concurrent. Se positionner comme l expert qui apporte une vision strategique, pas juste un outil de plus. Sauf si le signal montre clairement un besoin precis (ex: le prospect cherche du WhatsApp) = la on y va direct sur notre capacite a livrer." +
" ADAPTATION ZONE FRANCE : Ton = pair a pair, expert accessible. On est des strateges ET des technos." +
" ADAPTATION ZONE GCC (Dubai, KSA, Qatar, Oman, Koweit, UAE) : Ton = business, en anglais. On peut mentionner notre expertise MENA." +
" Reponds UNIQUEMENT en JSON valide, sans markdown, sans code block.";

/**
 * Build full prospect context for Claude, including all signals history.
 * @param {object} lead - Lead data with metadata
 * @returns {string} Formatted context block
 */
function buildLeadContext(lead) {
  var lines = [];
  lines.push("Prospect: " + (sanitizeForPrompt(lead.full_name) || "inconnu"));
  lines.push("Titre: " + (sanitizeForPrompt(lead.headline) || "inconnu"));
  lines.push("Entreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue"));
  lines.push("Secteur: " + (sanitizeForPrompt(lead.company_sector) || "inconnu"));
  lines.push("Localisation: " + (sanitizeForPrompt(lead.location) || "inconnue"));
  lines.push("Score ICP: " + (lead.icp_score || 0) + "/100 (" + (lead.tier || "?") + ")");

  // Current signal
  lines.push("");
  var signalCategory = lead.signal_category || lead.metadata?.signal_category || "";
  var signalSource = lead.signal_source || lead.metadata?.signal_source || "";
  lines.push("Signal principal: " + (sanitizeForPrompt(lead.signal_type) || "inconnu") + " - " + sanitizeForPrompt(lead.signal_detail));
  if (signalCategory === "concurrent") {
    lines.push("ATTENTION : Ce signal vient d un post d un CONCURRENT (" + sanitizeForPrompt(signalSource) + "). Le prospect est potentiellement deja en contact avec eux. Applique la REGLE N3.");
  } else if (signalCategory) {
    lines.push("Origine du signal: " + sanitizeForPrompt(signalCategory) + (signalSource ? " (" + sanitizeForPrompt(signalSource) + ")" : ""));
  }

  // Previous signals (re-engagements)
  var meta = lead.metadata || {};
  var prevSignals = meta.previous_signals || [];
  if (prevSignals.length > 0) {
    lines.push("");
    lines.push("Historique d engagement (" + (prevSignals.length + 1) + " signaux detectes) :");
    for (var i = 0; i < prevSignals.length; i++) {
      var ps = prevSignals[i];
      var dateStr = ps.date ? new Date(ps.date).toLocaleDateString("fr-FR") : "?";
      lines.push("  - " + dateStr + " : " + (ps.type || "?") + " via " + (ps.source || "?"));
    }
    lines.push("");
    lines.push("IMPORTANT : Ce prospect a montre un interet REPETE (" + (prevSignals.length + 1) + " fois). Adapte ton message en faisant reference a cet engagement multiple. C est un signal fort.");
  }

  // News evidence if available
  if (meta.news_titles && meta.news_titles.length > 0) {
    lines.push("");
    lines.push("Actualites recentes de son entreprise :");
    for (var j = 0; j < Math.min(3, meta.news_titles.length); j++) {
      lines.push("  - " + meta.news_titles[j]);
    }
  }

  return lines.join("\n");
}



/**
 * Generate a personalized LinkedIn invitation note.
 * @param {object} lead - Lead data
 * @returns {Promise<string|null>} Invitation note (max 150 chars) or null on error
 */
async function generateInvitationNote(lead, templates) {
  try {
    var tpl = templates || (await loadTemplates());
    var instructions = tpl.template_invitation || DEFAULT_INVITATION_TEMPLATE;

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      buildLeadContext(lead) + "\n\n" +
      'Reponds en JSON: {"note": "..."}', 256);

    var note = result.note || "";
    if (note.length > 150) {
      note = note.substring(0, 147) + "...";
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
    var instructions = tpl.template_followup || DEFAULT_FOLLOWUP_TEMPLATE;

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      buildLeadContext(lead) + "\n\n" +
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
async function generateEmail(lead, templates) {
  try {
    var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme";
    var tpl = templates || (await loadTemplates());
    var instructions = (tpl.template_email || DEFAULT_EMAIL_TEMPLATE).replace("{calendlyUrl}", calendlyUrl);

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      buildLeadContext(lead) + "\n" +
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
    var instructions = tpl.template_whatsapp || DEFAULT_WHATSAPP_TEMPLATE;

    var result = await callClaude(SYSTEM,
      instructions + "\n\n" +
      buildLeadContext(lead) + "\n\n" +
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
  loadTemplates,
  generateInvitationNote,
  generateFollowUpMessage,
  generateEmail,
  generateWhatsAppBody,
  generateInMail,
};
