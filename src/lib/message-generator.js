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
  "Pas de note d'invitation. On invite sans message.";

var DEFAULT_FOLLOWUP_TEMPLATE =
  "Redige le PREMIER MESSAGE LinkedIn apres que le prospect a accepte l'invitation.\n\n" +
  "C'est le message le plus important de toute la sequence. Il doit etre CLEVER, pas commercial.\n\n" +
  "REGLES ABSOLUES :\n" +
  "1. REAGIR AU SIGNAL : Le prospect a montre un interet (like, commentaire, post). Le message DOIT partir de ce signal. C'est ce qui le rend pertinent. Si le signal est precis (ex: a commente sur WhatsApp retail), on parle de ca. Si c'est generique (like page Infobip), on peut elargir.\n" +
  "2. PAS DE PITCH : Ne JAMAIS vendre MessagingMe dans ce premier message. On est la pour echanger, comprendre, partager une vision. On se positionne comme un pair qui s'interesse au meme sujet.\n" +
  "3. SI SIGNAL CONCURRENT : Le prospect a peut-etre deja un outil. On se positionne en expert strategie conversationnelle, pas en outil concurrent. On apporte de la hauteur, une vision, pas un produit.\n" +
  "4. QUESTION OUVERTE : Terminer par une question ouverte qui engage la conversation. Pas 'voulez-vous un RDV' mais plutot 'comment vous gerez X chez vous ?' ou 'vous avez teste Y ?'\n" +
  "5. FORMAT : 3 a 5 phrases max. Ton naturel, pair a pair. Pas de formules commerciales. Pas de 'je me permets', pas de 'n hesitez pas'. Parler comme un humain, pas comme un commercial.\n" +
  "6. EN FRANCAIS si le prospect est en France, EN ANGLAIS si zone GCC/international.";

var DEFAULT_EMAIL_TEMPLATE =
  "Redige un email de relance pour un prospect qui n'a PAS accepte l'invitation LinkedIn apres 7 jours.\n\n" +
  "REGLES :\n" +
  "1. REAGIR AU SIGNAL : Meme principe que le message LinkedIn. On part du signal detecte.\n" +
  "2. APPORTER DE LA VALEUR : Partager un insight, une tendance, un retour d'experience concret sur le sujet du signal. Pas un pitch produit.\n" +
  "3. SI SIGNAL CONCURRENT : Se positionner comme consultant en strategie conversationnelle. On aide a choisir les bons canaux, la bonne approche. Notre techno vient en complement.\n" +
  "4. CTA LEGER : Proposer un echange rapide (15 min), pas un 'demo produit'. Lien Calendly : {calendlyUrl}\n" +
  "5. FORMAT : Objet court et accrocheur (pas 'Relance' ou 'Suite a'). Corps : 4-6 phrases. HTML simple. Signature : juste 'Julien' (PAS de titre, PAS de 'DG', PAS de 'Fondateur').\n" +
  "6. EN FRANCAIS si le prospect est en France, EN ANGLAIS si zone GCC/international.";

var DEFAULT_WHATSAPP_TEMPLATE =
  "Redige un message WhatsApp pour ce prospect.\n\n" +
  "REGLES :\n" +
  "1. REAGIR AU SIGNAL : Partir du signal detecte et de l'echange LinkedIn precedent.\n" +
  "2. ULTRA COURT : 2-3 lignes max. C'est du WhatsApp, pas un email.\n" +
  "3. CTA DIRECT : Proposer un call rapide ou un echange. Lien Calendly si pertinent.\n" +
  "4. TON : Direct, personnel, comme un message a un contact pro. Pas de formalisme.\n" +
  "5. EN FRANCAIS si le prospect est en France, EN ANGLAIS si zone GCC/international.";

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

var SYSTEM = "Tu es Julien, expert en strategie conversationnelle et messaging (WhatsApp, RCS, SMS). Tu diriges MessagingMe (messagingme.app), a la fois cabinet de conseil et plateforme techno." +
" REGLE ABSOLUE DE TON : Ecris comme un humain qui envoie un vrai message LinkedIn, pas comme un commercial. INTERDICTIONS STRICTES : JAMAIS de 'En tant que DG/CEO/fondateur/specialiste/expert de...', JAMAIS de 'Chez MessagingMe, nous...', JAMAIS d auto-proclamation ('nous sommes experts en...', 'en tant que specialistes de la strategie conversationnelle'). Montre ton expertise PAR LE CONTENU du message, pas en te presentant. Tu es un pair qui reagit a quelque chose qu il a vu. Ton = decontracte, direct, curieux. Comme si tu ecrivais a un collegue de ton reseau. Court (3-4 phrases max pour LinkedIn, 4-6 pour email). Pas de formules creuses ('je serais ravi', 'n hesitez pas', 'seriez-vous interesse'). Pas de bullet points. Pas de signature formelle, juste 'Julien'." +
" REGLE N1 ABSOLUE : Le premier contact REAGIT au signal chaud detecte. C est le hook. Si le mec a like un post sur l abandon de panier WhatsApp, on parle d abandon de panier. Si il a commente sur le RCS, on parle RCS. Si il dit clairement qu il veut du WhatsApp, on y va direct sur la techno, pas de blabla strategie. Le signal = le sujet de conversation. C est ce qui rend le message pertinent et non spam. Ne jamais pitcher la plateforme en premier." +
" REGLE N2 : Le positionnement conseil/strategie vient EN COMPLEMENT du signal, ou en REMPLACEMENT si le signal est trop generique pour accrocher. Par exemple : signal generique (like page Infobip) = on peut ajouter l angle conseil. Signal precis (commente un post sur WhatsApp dans le retail) = on reste 100% sur le signal." +
" REGLE N3 - SIGNAL CONCURRENT : Quand le prospect a reagi a un post d un concurrent (WAX, Alcmeon, Simio, WATI, Respond.io, etc.), il est PEUT-ETRE deja en relation avec eux. Dans ce cas : (1) reagir au signal normalement (le sujet du post), (2) se positionner en COMPLEMENT : on est des consultants en strategie conversationnelle, on aide a prendre de la hauteur, choisir les bons canaux, la bonne approche, et on peut aussi integrer notre techno. Ne PAS attaquer le concurrent. Se positionner comme l expert qui apporte une vision strategique, pas juste un outil de plus. Sauf si le signal montre clairement un besoin precis (ex: le prospect cherche du WhatsApp) = la on y va direct sur notre capacite a livrer." +
" REGLE N4 - ADAPTATION AU CONTEXTE : Tu as toutes les infos sur le prospect (entreprise, description, specialites, secteur, taille, localisation). UTILISE-LES intelligemment. Si c est un retailer, parle d abandon de panier et de messaging client. Si c est une banque, parle de notifications transactionnelles. Si c est du SaaS, parle d onboarding conversationnel. Si c est du luxe, parle d experience client premium. Adapte le vocabulaire, les exemples et l angle a leur realite metier. Ne fais pas de message generique." +
" ADAPTATION ZONE FRANCE : Ton = pair a pair, expert accessible. Tutoiement ok si le prospect a l air jeune/startup. En francais." +
" ADAPTATION ZONE GCC (Dubai, KSA, Qatar, Oman, Koweit, UAE) : Ton = business, en anglais. On peut mentionner notre expertise MENA." +
" Reponds UNIQUEMENT en JSON valide, sans markdown, sans code block.";

/**
 * Build full prospect context for Claude, including all signals history.
 * @param {object} lead - Lead data with metadata
 * @returns {string} Formatted context block
 */
function buildLeadContext(lead) {
  var meta = lead.metadata || {};
  var lines = [];
  lines.push("Prospect: " + (sanitizeForPrompt(lead.full_name) || "inconnu"));
  lines.push("Titre: " + (sanitizeForPrompt(lead.headline) || "inconnu"));
  lines.push("Entreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue"));
  if (meta.company_description) lines.push("Description entreprise: " + sanitizeForPrompt(meta.company_description, 300));
  if (meta.company_specialities && meta.company_specialities.length > 0) lines.push("Specialites: " + sanitizeForPrompt(meta.company_specialities.join(", ")));
  if (meta.company_website) lines.push("Site web: " + sanitizeForPrompt(meta.company_website));
  lines.push("Secteur: " + (sanitizeForPrompt(lead.company_sector) || "inconnu"));
  lines.push("Taille: " + (sanitizeForPrompt(lead.company_size) || "inconnue") + (meta.company_founded ? " (fondee en " + meta.company_founded + ")" : ""));
  lines.push("Localisation: " + (sanitizeForPrompt(lead.location || lead.company_location) || "inconnue"));
  if (lead.seniority_years) lines.push("Seniorite: " + lead.seniority_years + " ans");
  if (lead.connections_count) lines.push("Connexions LinkedIn: " + lead.connections_count);
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

  // Post context — the actual content that triggered the signal
  if (meta.post_text) {
    lines.push("");
    lines.push("Contenu du post qui a declenche le signal :");
    lines.push("\"" + sanitizeForPrompt(meta.post_text, 300) + "\"");
    if (meta.post_author_name) {
      var authorInfo = "Auteur du post : " + sanitizeForPrompt(meta.post_author_name);
      if (meta.post_author_headline) authorInfo += " — " + sanitizeForPrompt(meta.post_author_headline);
      lines.push(authorInfo);
    }
    if (meta.post_url) lines.push("URL du post: " + sanitizeForPrompt(meta.post_url));
  }
  if (meta.comment_text) {
    lines.push("Commentaire du prospect sur ce post : \"" + sanitizeForPrompt(meta.comment_text, 200) + "\"");
  }

  // Previous signals (re-engagements)
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

  // Prospect's recent LinkedIn activity
  if (meta.prospect_posts && meta.prospect_posts.length > 0) {
    lines.push("");
    lines.push("Posts recents du prospect (ce qu il publie sur LinkedIn) :");
    for (var k = 0; k < Math.min(3, meta.prospect_posts.length); k++) {
      var pp = meta.prospect_posts[k];
      lines.push("  - \"" + sanitizeForPrompt(pp.text, 200) + "\"" + (pp.likes ? " (" + pp.likes + " likes)" : ""));
    }
    lines.push("UTILISE ces posts pour personnaliser ton message. Si le prospect parle d un sujet lie au messaging/CRM/experience client, rebondis dessus.");
  }
  if (meta.prospect_comments && meta.prospect_comments.length > 0) {
    lines.push("");
    lines.push("Posts recemment commentes par le prospect :");
    for (var m = 0; m < Math.min(3, meta.prospect_comments.length); m++) {
      var pc = meta.prospect_comments[m];
      lines.push("  - A commente sur un post de " + sanitizeForPrompt(pc.targetPostAuthor) + " : \"" + sanitizeForPrompt(pc.targetPostText, 150) + "\"");
    }
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

/**
 * Check if a lead is a cold outbound lead (no warm signal, found via direct search).
 * Cold leads have signal_category "cold" or no signal_category at all with no post context.
 */
function isColdLead(lead) {
  if (!lead) return false;
  if (lead.signal_category === "cold") return true;
  if (!lead.signal_type && !lead.signal_category) return true;
  return false;
}

module.exports = {
  loadTemplates,
  generateInvitationNote,
  generateFollowUpMessage,
  generateEmail,
  generateWhatsAppBody,
  generateInMail,
  isColdLead,
};
