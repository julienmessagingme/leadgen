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
  return String(value)
    .replace(/[\uD800-\uDFFF]/g, "")  // remove lone surrogates (invalid Unicode)
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maxLen);
}

/**
 * Detect whether the prospect likely speaks English based on their profile.
 * Checks headline, location, company name for English-language signals.
 * GCC region (Dubai, KSA, Qatar, UAE) → always English.
 * Non-French location + English headline → English.
 */
function stripAccents(str) {
  return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function detectLanguage(lead) {
  var location = stripAccents(((lead.location || "") + " " + (lead.company_location || "")).toLowerCase());
  var headline = stripAccents((lead.headline || "").toLowerCase());

  // GCC / Middle East → English
  var gccPatterns = ["dubai", "abu dhabi", "uae", "united arab", "saudi", "ksa", "qatar", "doha", "bahrain", "oman", "kuwait", "riyadh", "jeddah"];
  for (var i = 0; i < gccPatterns.length; i++) {
    if (location.includes(gccPatterns[i])) return "en";
  }

  // Explicitly French-speaking countries → French
  var frPatterns = ["france", "paris", "lyon", "marseille", "toulouse", "bordeaux", "lille", "nantes", "strasbourg", "belgique", "belgium", "bruxelles", "brussels", "suisse", "switzerland", "geneve", "geneva", "lausanne", "luxembourg", "montreal", "quebec"];
  var isFrenchLocation = false;
  for (var j = 0; j < frPatterns.length; j++) {
    if (location.includes(frPatterns[j])) { isFrenchLocation = true; break; }
  }

  // If location is French-speaking, default to French
  if (isFrenchLocation) return "fr";

  // English-speaking headline keywords (job titles typically in English)
  var enHeadlinePatterns = ["head of", "chief", "ceo", "cto", "cmo", "coo", "vp ", "vice president", "director", "manager", "lead", "officer", "founder", "co-founder", "partner", "consultant", "advisor", "engineer", "developer", "product", "growth", "marketing", "sales", "business development", "customer success", "digital", "strategy"];
  var frHeadlinePatterns = ["directeur", "directrice", "responsable", "chef de", "gerant", "fondateur", "fondatrice", "charge", "chargee", "conseiller", "conseillere", "adjoint", "adjointe", "ingenieur"];

  var enScore = 0;
  var frScore = 0;
  for (var k = 0; k < enHeadlinePatterns.length; k++) {
    if (headline.includes(enHeadlinePatterns[k])) enScore++;
  }
  for (var m = 0; m < frHeadlinePatterns.length; m++) {
    if (headline.includes(frHeadlinePatterns[m])) frScore++;
  }

  // Non-French location + English headline → English
  if (!isFrenchLocation && enScore > 0 && frScore === 0) return "en";

  // English-speaking countries → English
  var enLocations = ["united states", "usa", "uk", "united kingdom", "london", "new york", "canada", "australia", "singapore", "hong kong", "india", "mumbai", "delhi", "bangalore", "hyderabad", "chennai", "pune", "germany", "berlin", "munich", "netherlands", "amsterdam", "spain", "madrid", "barcelona", "italy", "milan", "rome", "portugal", "lisbon", "ireland", "dublin", "sweden", "stockholm", "norway", "oslo", "denmark", "copenhagen", "finland", "helsinki", "poland", "warsaw", "japan", "tokyo", "korea", "seoul", "nigeria", "lagos", "south africa", "johannesburg", "kenya", "nairobi"];
  for (var n = 0; n < enLocations.length; n++) {
    if (location.includes(enLocations[n])) return "en";
  }

  // If no location but headline is clearly English → English
  if (!location.trim() && enScore > 0 && frScore === 0) return "en";

  // Default: French
  return "fr";
}

/**
 * Default template instructions (used as fallback when settings table is unavailable).
 */
var DEFAULT_INVITATION_TEMPLATE =
  "Pas de note d'invitation. On invite sans message.";

var DEFAULT_FOLLOWUP_TEMPLATE =
  "Redige le PREMIER MESSAGE LinkedIn apres connexion. 2-3 phrases. Naturel, direct, vouvoiement.\n" +
  "Pars du contenu du post (ce dont il parlait) croise avec le metier du prospect.\n" +
  "Termine par une question sur LEUR usage/situation. Pas de pitch, pas d explication du messaging si le prospect est deja dans cet univers.";

var DEFAULT_EMAIL_TEMPLATE =
  "Redige un email de relance pour un prospect qui n'a PAS accepte l'invitation LinkedIn apres 7 jours.\n\n" +
  "REGLES :\n" +
  "1. REAGIR AU SIGNAL : Meme principe que le message LinkedIn. On part du signal detecte.\n" +
  "2. APPORTER DE LA VALEUR : Partager un insight, une tendance, un retour d'experience concret sur le sujet du signal. Pas un pitch produit.\n" +
  "3. SI SIGNAL CONCURRENT : Se positionner comme consultant en strategie conversationnelle. On aide a choisir les bons canaux, la bonne approche. Notre techno vient en complement.\n" +
  "4. CTA LEGER : Proposer un echange rapide (15 min), pas un 'demo produit'. Lien Calendly : {calendlyUrl}\n" +
  "5. FORMAT : Objet court et accrocheur (pas 'Relance' ou 'Suite a'). Corps : 4-6 phrases. HTML simple.\n" +
  "6. SIGNATURE : Terminer TOUJOURS par cette signature exacte (en HTML) :\\n<br><br>Julien Dumas<br>CEO MessagingMe<br><a href=\\\"https://www.messagingme.fr\\\">www.messagingme.fr</a>\n" +
  "7. EN FRANCAIS si le prospect est en France, EN ANGLAIS si zone GCC/international.";

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
 * @param {string} prefill - Optional assistant prefill to force response start
 */
async function callClaude(systemPrompt, userPrompt, maxTokens, prefill) {
  var messages = [{ role: "user", content: userPrompt }];
  if (prefill) messages.push({ role: "assistant", content: prefill });

  var response = await getAnthropicClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: messages,
  });
  var raw = (prefill || "") + response.content[0].text;
  // Strip markdown code fences if Sonnet wraps its response
  raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  return JSON.parse(raw);
}

var SYSTEM = "Tu es Julien, expert en strategie conversationnelle et messaging (WhatsApp, RCS, SMS). Tu diriges MessagingMe (messagingme.app), cabinet de conseil et plateforme techno." +

" TON : Naturel, direct, pair a pair. Pas corporate, pas commercial. Vouvoiement TOUJOURS en France. 2-3 phrases max. Se termine par une question ouverte. JAMAIS de signature. JAMAIS de 'je me permets', 'n hesitez pas', 'serait-il possible'. JAMAIS de 'En tant que', 'Chez MessagingMe nous', 'en tant que specialistes'. Pas de bullet points. Tu parles a une PERSONNE, pas a une marque ou une entreprise. Jamais 'pour des marques comme X', 'pour une entreprise comme X', 'pour X'. Tu t adresses a elle directement : son poste, ses enjeux, son quotidien." +

" CE QUI DECLENCHE LE MESSAGE : Un post LinkedIn dont tu as le contenu. Ce post traite d un sujet (abandon de panier WhatsApp, RCS retail, messaging B2C, etc.). C est ce SUJET qui t interesse, pas le fait que quelqu un ait like ou commente. Tu ecris parce que le SUJET t a saute aux yeux en lien avec ce que fait cette personne dans son metier." +

" COMMENT CONSTRUIRE LE MESSAGE : Croise le sujet du post avec le contexte du prospect (son entreprise, son secteur, ses propres posts recents). Ex : post sur l abandon de panier WhatsApp + prospect directrice e-commerce retail → 'L abandon de panier via WhatsApp commence a faire ses preuves dans le retail — vous avez explore ca chez [entreprise] ?'. Tu n expliques pas ce qu est le messaging conversationnel si le prospect bosse deja dans cet ecosysteme." +

" INTERDICTIONS ABSOLUES : 'j ai vu que vous avez like', 'j ai remarque votre activite', 'vous avez commente', 'Merci pour la connexion', 'je tombe sur votre profil', 'en tant que DG/fondateur/expert', 'Chez MessagingMe', 'via MessagingMe', 'chez MessagingMe', 'MessagingMe'. Tu ecris en tant que Julien, une personne, pas en representant une entreprise. JAMAIS de nom de societe dans le message." +
" EXEMPLES : BON : 'L abandon de panier via WhatsApp commence a faire ses preuves dans le retail — vous avez explore ca chez Odaje ?' | BON : 'Le RCS change vraiment la donne pour les notifications transactionnelles dans le retail — c est un sujet chez vous en ce moment ?' | MAUVAIS : 'Merci pour la connexion ! J ai vu que vous avez like...' | MAUVAIS : 'Chez MessagingMe on accompagne...' | Le message commence DIRECTEMENT sur le fond, sans formule introductive." +

" SIGNAL CONCURRENT (WAX, Alcmeon, WATI, Respond.io, etc.) : Ce prospect connait deja le sujet, probablement deja equipe. Pas de pitch, pas d explication. Aborde un angle precis, une question sur leur usage, un retour d experience. On est un pair qui echange, pas un concurrent qui prospecte." +

" SI PAS DE CONTENU DE POST : Pars du secteur et du poste du prospect, va droit au but sans detour — est-ce que le messaging conversationnel est un sujet chez eux ?" +

" ZONE GCC (Dubai, KSA, Qatar, UAE...) : En anglais." +

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
  // NE PAS passer le nom de la source (signalSource/signalDetail) à Sonnet — il le citerait dans le message
  if (signalCategory === "concurrent") {
    lines.push("Contexte : ce prospect evolue dans l ecosysteme messaging/conversationnel, il connait probablement deja le sujet. Pas besoin d expliquer ce qu est WhatsApp ou le messaging. Applique la REGLE N3.");
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
    var lang = detectLanguage(lead);

    var firstName = (lead.full_name || "").split(" ")[0];

    // Adapt instructions based on detected language
    var langInstruction = lang === "en"
      ? "\n\nIMPORTANT: This prospect is NOT French-speaking. Write the message ENTIRELY IN ENGLISH. Use 'you' (informal professional tone). Do NOT use French words. The greeting 'Hi [firstname]' will be added automatically."
      : "";

    var jsonInstruction = lang === "en"
      ? 'Reply in JSON: {"message": "..."}\nIMPORTANT: the message field does NOT start with "Hi", "Hey", "Thanks for connecting" or any greeting. It starts DIRECTLY with the substance (observation, question, insight about their work). The "Hi [firstname], " will be added automatically before your text.'
      : "Reponds en JSON: {\"message\": \"...\"}\nIMPORTANT : le champ message NE COMMENCE PAS par 'Bonjour', 'Merci' ou une formule d intro. Il commence DIRECTEMENT par le fond (observation, question, constat sur leur metier). Le 'Bonjour [prenom]' sera ajoute automatiquement avant ton texte.";

    var result = await callClaude(SYSTEM,
      instructions + langInstruction + "\n\n" +
      buildLeadContext(lead) + "\n\n" +
      jsonInstruction, 512);

    var core = (result.message || "").trim();
    // Strip any opener Sonnet might have added anyway (French or English)
    core = core.replace(/^(bonjour\s+\w+[\s,!]*|merci pour la connexion[\s!]*|salut\s+\w+[\s,!]*|hi\s+\w+[\s,!]*|hey\s+\w+[\s,!]*|hello\s+\w+[\s,!]*|thanks for connecting[\s!]*)/i, "").trim();
    // Strip any MessagingMe mention (including dangling "Je dirige" / "je fondé" left behind)
    core = core.replace(/\s*(chez|via|avec|pour|de)\s+MessagingMe/gi, "").trim();
    core = core.replace(/\bMessagingMe\b/g, "").trim();
    core = core.replace(/\bje\s+dirige\s+[,.]?\s*/gi, "").trim();
    core = core.replace(/\s{2,}/g, " ").trim();

    var greeting = lang === "en" ? "Hi " + firstName + ", " : "Bonjour " + firstName + ", ";
    return core ? greeting + core : null;
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
    var lang = detectLanguage(lead);

    var langInstruction = lang === "en"
      ? "\n\nIMPORTANT: This prospect is NOT French-speaking. Write the ENTIRE email (subject + body) IN ENGLISH. Professional but warm tone."
      : "";

    var result = await callClaude(SYSTEM,
      instructions + langInstruction + "\n\n" +
      buildLeadContext(lead) + "\n" +
      "Email: " + sanitizeForPrompt(lead.email) + "\n\n" +
      'Reponds en JSON: {"subject": "...", "body": "<html>...</html>"}', 1024);

    if (!result.subject || !result.body) return null;

    // Ensure signature is present at the end of the body
    var signature = '<br><br>Julien Dumas<br>CEO MessagingMe<br><a href="https://www.messagingme.fr">www.messagingme.fr</a>';
    if (!result.body.includes("Julien Dumas")) {
      // Insert before closing </html> or </body> or at end
      result.body = result.body.replace(/<\/(body|html)>/i, signature + "</$1>");
      if (!result.body.includes("Julien Dumas")) {
        result.body = result.body + signature;
      }
    }

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
