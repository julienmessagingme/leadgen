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
  var companyName = stripAccents((lead.company_name || "").toLowerCase());
  // Combine all text fields for French location detection (handles "chez McDonald's France" in headline)
  var allText = location + " " + headline + " " + companyName;

  // GCC / Middle East → English
  var gccPatterns = ["dubai", "abu dhabi", "uae", "united arab", "saudi", "ksa", "qatar", "doha", "bahrain", "oman", "kuwait", "riyadh", "jeddah"];
  for (var i = 0; i < gccPatterns.length; i++) {
    if (allText.includes(gccPatterns[i])) return "en";
  }

  // Explicitly French-speaking patterns → French (check location + headline + company)
  var frPatterns = ["france", "paris", "lyon", "marseille", "toulouse", "bordeaux", "lille", "nantes", "strasbourg", "belgique", "belgium", "bruxelles", "brussels", "suisse", "switzerland", "geneve", "geneva", "lausanne", "luxembourg", "montreal", "quebec", "guyancourt", "ile-de-france", "ile de france"];
  var isFrench = false;
  for (var j = 0; j < frPatterns.length; j++) {
    if (allText.includes(frPatterns[j])) { isFrench = true; break; }
  }

  // If any French location signal found anywhere → French
  if (isFrench) return "fr";

  // French headline keywords (job titles in French = prospect is French-speaking)
  var frHeadlinePatterns = ["directeur", "directrice", "responsable", "chef de", "cheffe", "gerant", "gerante", "fondateur", "fondatrice", "charge", "chargee", "conseiller", "conseillere", "adjoint", "adjointe", "ingenieur", "ingenieure", " chez ", "projet", "stagiaire", "alternance", "comptable", "redacteur", "redactrice", "coordinateur", "coordinatrice"];
  var frScore = 0;
  for (var m = 0; m < frHeadlinePatterns.length; m++) {
    if (headline.includes(frHeadlinePatterns[m])) frScore++;
  }

  // If headline has French job titles → French (even without location)
  if (frScore > 0) return "fr";

  // English-speaking headline keywords (terms that only appear in English headlines)
  var enHeadlinePatterns = ["head of", "chief", "ceo", "cto", "cmo", "coo", "vp ", "vice president", "director", "manager", "officer", "founder", "co-founder", "partner", "advisor", "engineer", "developer", "product", "growth", "sales", "business development", "customer success", "specialist", "analyst", "associate", "strategist", "leader at", "certified"];
  var enScore = 0;
  for (var k = 0; k < enHeadlinePatterns.length; k++) {
    if (headline.includes(enHeadlinePatterns[k])) enScore++;
  }

  // English-speaking countries in location → English
  var enLocations = ["united states", "usa", ", us", "uk", "united kingdom", "london", "new york", "dallas", "chicago", "san francisco", "los angeles", "boston", "seattle", "miami", "atlanta", "houston", "denver", "toronto", "vancouver", "canada", "australia", "sydney", "melbourne", "singapore", "hong kong", "india", "mumbai", "delhi", "bangalore", "hyderabad", "chennai", "pune", "germany", "berlin", "munich", "netherlands", "amsterdam", "spain", "madrid", "barcelona", "italy", "milan", "rome", "portugal", "lisbon", "ireland", "dublin", "sweden", "stockholm", "norway", "oslo", "denmark", "copenhagen", "finland", "helsinki", "poland", "warsaw", "japan", "tokyo", "korea", "seoul", "nigeria", "lagos", "south africa", "johannesburg", "kenya", "nairobi"];
  for (var n = 0; n < enLocations.length; n++) {
    if (location.includes(enLocations[n])) return "en";
  }

  // If no location and only English headline signals → English
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
  "Redige un email de relance pour un prospect qui n'a PAS accepte l'invitation LinkedIn apres 3 jours.\n\n" +
  "REGLES :\n" +
  "1. ANCRAGE OBLIGATOIRE — MESSAGING CONVERSATIONNEL : le mail DOIT parler explicitement de messaging conversationnel (WhatsApp Business, chatbots IA, RCS) comme levier concret d amelioration de l experience client ou de la performance commerciale. Pas juste 'experience client' en general — ca fait generique, on passe pour un consultant CX random. Le conversationnel est TOUJOURS le fil rouge, meme court.\n" +
  "2. REAGIR AU SUJET DU SIGNAL : part du theme du post/signal, mais tord-le vers l angle conversationnel pertinent pour le metier du prospect. Exemple : si le post parle de SAV dans le retail, l angle devient 'WhatsApp pour automatiser le SAV 1er niveau et desengorger les conseillers' — pas 'l experience SAV en general'.\n" +
  "3. APPORTER DE LA VALEUR : un insight concret, une tendance, ou un retour d experience sur comment le conversationnel resout un probleme specifique au secteur/taille du prospect. Tu peux dire 'le messaging conversationnel' ou 'WhatsApp Business' ou 'chatbot IA' sans probleme. Pas un pitch produit.\n" +
  "4. SI SIGNAL CONCURRENT (Sinch, WAX, Respond.io, Brevo, CM.com, etc.) : on se positionne comme conseil en strategie conversationnelle (on aide a choisir le bon canal, la bonne approche), notre techno (messagingme.app) vient en complement. Ne jamais denigrer le concurrent.\n" +
  "5. PAS DE CTA : ne propose PAS de RDV, PAS de lien Calendly, PAS de 'reserver un creneau', PAS de 'programmer un echange'. Le lien sera ajoute automatiquement en signature.\n" +
  "6. FORMAT : Objet court et accrocheur qui contient le theme conversationnel de maniere evidente (ex: 'WhatsApp + SAV chez [SECTEUR]', 'Chatbot et conversion e-commerce', 'Messaging conversationnel en assurance'). Evite 'Relance' ou 'Suite a'. Corps : 4-6 phrases. HTML simple. Terminer par une question ouverte, concrete, metier — pas une banalite.\n" +
  "7. SIGNATURE : NE PAS mettre de signature, NE PAS mettre 'Bonne journee', NE PAS mettre 'Cordialement'. Tout sera ajoute automatiquement.\n" +
  "8. EN FRANCAIS si le prospect est en France, EN ANGLAIS si zone GCC/international.\n" +
  "9. INTERDICTIONS ABSOLUES : 'j ai vu que vous avez like/commente/reagi', 'vous avez reagi a mes posts', 'vous suivez de pres', 'vos interactions recentes', 'votre activite recente', 'your repeated engagement', 'I noticed you ve been exploring', 'caught my attention', 'le sujet revient souvent dans vos echanges'. JAMAIS de reference au fait qu on surveille ou observe l activite LinkedIn du prospect — ca fait flicage/stalking. On ecrit parce que le SUJET nous interesse, pas parce qu on a vu que la personne a like un post. Pas de 'MessagingMe' comme nom de societe (juste le sujet 'messaging conversationnel').\n" +
  "10. ANTI-HALLUCINATION — NOMS PROPRES : NE JAMAIS inventer de nom d auteur de post. Si l auteur n est PAS explicitement fourni (champ 'Auteur du post :'), reference le theme/sujet du post, pas l auteur. JAMAIS utiliser un label interne (ex: 'nahmias', 'wax', 'mtarget', 'alcmeon') comme nom de personne. Si pas 100% sur d un nom, ne le cite pas.\n" +
  "11. POLITESSE EMAIL — QUESTIONS EN INVERSION OBLIGATOIRE : les questions DOIVENT utiliser l inversion sujet-verbe (« Explorez-vous ce sujet ? », « Avez-vous deja regarde ... ? », « Etes-vous confronte a ... ? », « Comment abordez-vous ... ? »). JAMAIS la forme orale « vous explorez ... ? », « vous avez ... ? », « vous etes ... ? ». C est un mail pro, registre poli francais correct. Le parler oral (sans inversion) ne marche qu en DM LinkedIn, pas en email.";

var DEFAULT_EMAIL_FOLLOWUP_TEMPLATE =
  "Redige un 2e email de relance (le 1er est reste sans reponse depuis 7 jours).\n\n" +
  "REGLES :\n" +
  "1. ANCRAGE OBLIGATOIRE — MESSAGING CONVERSATIONNEL : comme le 1er email, le mail DOIT parler explicitement de messaging conversationnel (WhatsApp Business, chatbots IA) comme levier concret. Pas juste 'experience client' en general.\n" +
  "2. ANGLE DIFFERENT du 1er email : ne re-cite PAS le signal initial (like/commentaire sur un post). Pars sur un cas client concret et croise avec le metier/taille du prospect via l angle conversationnel.\n" +
  "3. CITER UN CAS CLIENT : si un cas est fourni dans le contexte (champ 'Cas client a citer'), cite le nom du client + le chiffre + 1 phrase de contexte ET fais le lien explicite avec le conversationnel (quel canal, quel use-case). Si AUCUN cas n est fourni, parle d une tendance generale sur le conversationnel dans le secteur SANS inventer de chiffres precis.\n" +
  "4. MENTIONNER MessagingMe UNE FOIS MAX : juste pour situer (ex: 'c est le type de deploiement qu on pilote chez MessagingMe'). Pas de pitch produit, pas de 'notre solution'.\n" +
  "5. PAS DE CTA : ne propose PAS de RDV, PAS de lien Calendly, PAS de 'reserver un creneau', PAS de 'programmer un echange'. Le lien sera ajoute automatiquement en signature.\n" +
  "6. FORMAT : Objet court ET DIFFERENT du 1er email (pas de 'Re:' — la signature de thread est geree automatiquement). L objet doit evoquer explicitement le conversationnel (WhatsApp, chatbot, messaging). Corps : 4-6 phrases. HTML simple. Terminer par une question ouverte et concrete.\n" +
  "7. SIGNATURE : NE PAS mettre de signature, NE PAS mettre 'Bonne journee', NE PAS mettre 'Cordialement'. Tout sera ajoute automatiquement.\n" +
  "8. EN FRANCAIS si le prospect est en France, EN ANGLAIS si zone GCC/international.\n" +
  "9. INTERDICTIONS ABSOLUES : 'j ai vu que vous avez like/commente/reagi', 'vous avez reagi a mes posts', 'vous suivez de pres', 'vos interactions recentes', 'votre activite recente', 'your repeated engagement', 'I noticed you ve been exploring', 'caught my attention', 'le sujet revient souvent dans vos echanges'. JAMAIS de reference au fait qu on surveille ou observe l activite LinkedIn du prospect — ca fait flicage/stalking.\n" +
  "10. ANTI-HALLUCINATION — NOMS PROPRES : NE JAMAIS inventer de nom d auteur de post. Pas de label interne (nahmias, wax, mtarget).\n" +
  "11. ANTI-FAKE-METRIC : si AUCUN cas client n est fourni dans le contexte, NE PAS inventer de chiffre precis. Tu peux dire 'on observe' ou 'la tendance est' sans donner un pourcentage invente.\n" +
  "12. POLITESSE EMAIL — QUESTIONS EN INVERSION OBLIGATOIRE : les questions DOIVENT utiliser l inversion sujet-verbe (« Explorez-vous ... ? », « Avez-vous deja ... ? », « Etes-vous confronte a ... ? », « Comment abordez-vous ... ? »). JAMAIS la forme orale « vous explorez ... ? », « vous avez ... ? », « vous etes ... ? ». C est un mail pro, registre poli francais correct. Le parler oral sans inversion ne marche qu en DM LinkedIn, pas en email.";

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
      .in("key", ["template_invitation", "template_followup", "template_email", "template_email_followup", "template_whatsapp"]);
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

var SYSTEM = "Tu es Julien Dumas, expert en strategie conversationnelle et messaging (WhatsApp, RCS, SMS). Tu diriges MessagingMe (messagingme.fr), cabinet de conseil et plateforme techno." +

" TON : Naturel, direct, pair a pair. Pas corporate, pas commercial. Vouvoiement TOUJOURS en France. 2-3 phrases max. Se termine par une question ouverte. JAMAIS de signature. JAMAIS de 'je me permets', 'n hesitez pas', 'serait-il possible'. JAMAIS de 'En tant que', 'Chez MessagingMe nous', 'en tant que specialistes'. Pas de bullet points. Tu parles a une PERSONNE, pas a une marque ou une entreprise. Jamais 'pour des marques comme X', 'pour une entreprise comme X', 'pour X'. Tu t adresses a elle directement : son poste, ses enjeux, son quotidien." +

" ZERO FLATTERIE — REGLE CRITIQUE : JAMAIS de fausse admiration. INTERDITS : 'm a marque', 'm a interpelle', 'm a frappe', 'votre vision', 'votre approche', 'impressionnant', 'passionnant', 'inspirant', 'pertinent', 'brillant', 'j ai beaucoup aime', 'j ai trouve tres juste', 'avec grand interet'. Personne ne croit a ces formules dans un premier message. Tu ne COMMENTES pas ce que la personne a dit ou ecrit. Tu ne COMPLIMENTES pas. Tu ENCHAINES directement sur le sujet concret avec une question. Si le post parle d abandon de panier WhatsApp, tu demandes ou ils en sont sur ce sujet — tu ne dis pas que leur vision t a marque." +

" CE QUI DECLENCHE LE MESSAGE : Un post LinkedIn dont tu as le contenu. Ce post traite d un sujet (abandon de panier WhatsApp, RCS retail, messaging B2C, etc.). C est ce SUJET qui t interesse. Tu enchaines directement dessus avec une question liee au metier du prospect." +

" COMMENT CONSTRUIRE LE MESSAGE : Croise le sujet du post avec le contexte du prospect (son entreprise, son secteur, ses propres posts recents). Formule une question directe sur leur situation. Ex : post sur l abandon de panier WhatsApp + prospect directrice e-commerce retail → 'L abandon de panier via WhatsApp commence a faire ses preuves dans le retail — vous avez explore ca chez [entreprise] ?'. Tu n expliques pas ce qu est le messaging conversationnel si le prospect bosse deja dans cet ecosysteme." +

" INTERDICTIONS ABSOLUES : 'j ai vu que vous avez like', 'j ai remarque votre activite', 'vous avez commente', 'Merci pour la connexion', 'je tombe sur votre profil', 'en tant que DG/fondateur/expert', 'Chez MessagingMe', 'via MessagingMe', 'chez MessagingMe', 'MessagingMe', 'vos interactions recentes', 'votre activite recente', 'vos echanges recents', 'le sujet revient souvent', 'j ai pu observer', 'your recent interactions', 'your recent activity'. JAMAIS de reference au fait qu on surveille ou observe l activite du prospect — ca fait flicage. Tu ecris en tant que Julien, une personne, pas en representant une entreprise. JAMAIS de nom de societe dans le message." +

" ANTI-HALLUCINATION — NOMS PROPRES : NE JAMAIS inventer de nom d auteur de post. Si l auteur du post n est PAS explicitement fourni dans le contexte (champ 'Auteur du post :'), NE PAS nommer l auteur. Reference seulement le sujet/theme du post. JAMAIS utiliser un label interne (ex: 'nahmias', 'wax', 'mtarget') comme nom de personne. Si tu n es pas 100% sur d un nom, tu ne le cites pas." +
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
  // NE JAMAIS passer signal_source ni signal_detail à Sonnet — ce sont des labels internes
  // (ex: "nahmias", "wax", "mtarget") que Sonnet transformerait en faux noms propres.
  if (signalCategory === "concurrent") {
    lines.push("Contexte : ce prospect evolue dans l ecosysteme messaging/conversationnel, il connait probablement deja le sujet. Pas besoin d expliquer ce qu est WhatsApp ou le messaging. Applique la REGLE N3.");
  } else if (signalCategory) {
    lines.push("Origine du signal: " + sanitizeForPrompt(signalCategory));
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

  // Additional case studies (when Julien selected multiple in the UI).
  // Note: the case study "MessagingMe — Conseil conversationnel de stratégie"
  // (id #20) acts as a positioning/angle directive rather than a client to
  // cite — its description tells the LLM to adopt the agnostic consulting
  // stance instead of name-dropping a client.
  if (meta._additional_case_studies && meta._additional_case_studies.length > 0) {
    lines.push("");
    lines.push("Cas clients supplementaires a citer si pertinents :");
    for (var ac = 0; ac < meta._additional_case_studies.length; ac++) {
      lines.push("  - " + meta._additional_case_studies[ac]);
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
    var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme/30min";
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

    // Strip any signature Sonnet may have generated (wrong name, wrong format, etc.)
    // Common patterns: "Julien\nMessagingMe", "Julien Poupard", "Cordialement,\nJulien", etc.
    result.body = result.body
      // Strip closing formulas (Cordialement, Bonne journee, Best regards...)
      .replace(/<br\s*\/?>\s*(Cordialement|Best regards|Kind regards|Regards|Bien cordialement|A bientot|A tres vite|Bonne journee|Bonne soiree)[,.]?\s*(<br\s*\/?>.*?)?\s*Julien[^<]*/gi, "")
      .replace(/<p>\s*(Cordialement|Best regards|Kind regards|Regards|Bien cordialement|Bonne journee)[,.]?\s*<\/p>(\s*<p>[^<]*<\/p>)*/gi, "")
      // Strip any "Julien" signature lines
      .replace(/Julien\s+(Poupard|Dumas|MessagingMe)[^<]*/gi, "")
      .replace(/--\s*<br\s*\/?>\s*Julien[^<]*/gi, "")
      // Strip Calendly CTA that Sonnet might add despite instructions
      .replace(/<a[^>]*calendly[^>]*>[^<]*<\/a>/gi, "")
      .replace(/<p[^>]*>\s*<a[^>]*calendly[^>]*>[^<]*<\/a>\s*<\/p>/gi, "")
      .replace(/[Rr]eserv(er|ez)\s+un\s+creneau[^<]*/gi, "")
      .replace(/[Pp]rogramm(er|ez)\s+un\s+echange[^<]*/gi, "")
      // Strip standalone "Bonne journee" / "MessagingMe" lines
      .replace(/<p>\s*(Bonne journee|Bonne soiree|MessagingMe)\s*,?\s*<\/p>/gi, "")
      .replace(/<br\s*\/?>\s*(Bonne journee|Bonne soiree|MessagingMe)\s*,?\s*(<br\s*\/?>)?/gi, "")
      // Clean up empty paragraphs and excessive breaks
      .replace(/<p>\s*<\/p>/g, "")
      .replace(/(<br\s*\/?>){3,}/g, "<br><br>");

    // Add the correct signature before closing tags or at end
    var ctaLabel = lang === "en" ? "Schedule a call" : "Programmer un echange";
    var signature = '<br><br>Julien Dumas<br>CEO MessagingMe<br><a href="https://www.messagingme.fr">www.messagingme.fr</a>' +
      '<br><br><a href="' + calendlyUrl + '" style="display:inline-block;padding:10px 20px;background-color:#4F46E5;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">' + ctaLabel + '</a>';
    // Remove existing correct signature if present (avoid double)
    result.body = result.body.replace(/(<br\s*\/?>){1,3}\s*Julien Dumas\s*<br\s*\/?>.*?messagingme\.fr<\/a>/gi, "");
    // Insert before closing </body> or </html>
    if (result.body.match(/<\/(body|html)>/i)) {
      result.body = result.body.replace(/<\/(body|html)>/i, signature + "</$1>");
    } else {
      result.body = result.body + signature;
    }

    return { subject: result.subject, body: result.body };
  } catch (err) {
    console.warn("generateEmail failed:", err.message);
    return null;
  }
}

/**
 * Generate the 2nd follow-up email (Task F, J+14 from invitation).
 * Different angle from the 1st email: cites a case study + light MessagingMe mention.
 *
 * @param {object} lead - Lead data
 * @param {object} templates - Loaded templates (optional)
 * @param {object|null} caseStudy - { client_name, sector, metric_label, metric_value, description } or null
 * @returns {Promise<{subject: string, body: string}|null>}
 */
async function generateFollowupEmail(lead, templates, caseStudy) {
  try {
    var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme/30min";
    var tpl = templates || (await loadTemplates());
    var instructions = (tpl.template_email_followup || DEFAULT_EMAIL_FOLLOWUP_TEMPLATE);
    var lang = detectLanguage(lead);

    // Build case study context block
    var caseContext = "";
    if (caseStudy && caseStudy.client_name) {
      caseContext = "\n\nCas client a citer : " + sanitizeForPrompt(caseStudy.client_name) +
        " (secteur " + sanitizeForPrompt(caseStudy.sector || "") + ") — " +
        sanitizeForPrompt(caseStudy.metric_label || "") + " : " +
        sanitizeForPrompt(caseStudy.metric_value || "") +
        (caseStudy.description ? ". " + sanitizeForPrompt(caseStudy.description, 300) : "");
    } else {
      caseContext = "\n\nAUCUN cas client fourni — applique la REGLE 10 (pas de chiffre invente).";
    }

    var langInstruction = lang === "en"
      ? "\n\nIMPORTANT: This prospect is NOT French-speaking. Write the ENTIRE email (subject + body) IN ENGLISH. Professional but warm tone."
      : "";

    var result = await callClaude(SYSTEM,
      instructions + langInstruction + "\n\n" +
      buildLeadContext(lead) + caseContext + "\n\n" +
      'Reponds en JSON: {"subject": "...", "body": "<html>...</html>"}', 1024);

    if (!result.subject || !result.body) return null;

    // Strip any signature Sonnet may have generated (same patterns as generateEmail)
    result.body = result.body
      .replace(/<br\s*\/?>\s*(Cordialement|Best regards|Kind regards|Regards|Bien cordialement|A bientot|A tres vite|Bonne journee|Bonne soiree)[,.]?\s*(<br\s*\/?>.*?)?\s*Julien[^<]*/gi, "")
      .replace(/<p>\s*(Cordialement|Best regards|Kind regards|Regards|Bien cordialement|Bonne journee)[,.]?\s*<\/p>(\s*<p>[^<]*<\/p>)*/gi, "")
      .replace(/Julien\s+(Poupard|Dumas|MessagingMe)[^<]*/gi, "")
      .replace(/--\s*<br\s*\/?>\s*Julien[^<]*/gi, "")
      .replace(/<a[^>]*calendly[^>]*>[^<]*<\/a>/gi, "")
      .replace(/<p[^>]*>\s*<a[^>]*calendly[^>]*>[^<]*<\/a>\s*<\/p>/gi, "")
      .replace(/[Rr]eserv(er|ez)\s+un\s+creneau[^<]*/gi, "")
      .replace(/[Pp]rogramm(er|ez)\s+un\s+echange[^<]*/gi, "")
      .replace(/<p>\s*(Bonne journee|Bonne soiree|MessagingMe)\s*,?\s*<\/p>/gi, "")
      .replace(/<br\s*\/?>\s*(Bonne journee|Bonne soiree|MessagingMe)\s*,?\s*(<br\s*\/?>)?/gi, "")
      .replace(/<p>\s*<\/p>/g, "")
      .replace(/(<br\s*\/?>){3,}/g, "<br><br>");

    // Add correct signature
    var ctaLabel = lang === "en" ? "Schedule a call" : "Programmer un echange";
    var signature = '<br><br>Julien Dumas<br>CEO MessagingMe<br><a href="https://www.messagingme.fr">www.messagingme.fr</a>' +
      '<br><br><a href="' + calendlyUrl + '" style="display:inline-block;padding:10px 20px;background-color:#4F46E5;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">' + ctaLabel + '</a>';
    result.body = result.body.replace(/(<br\s*\/?>){1,3}\s*Julien Dumas\s*<br\s*\/?>.*?messagingme\.fr<\/a>/gi, "");
    if (result.body.match(/<\/(body|html)>/i)) {
      result.body = result.body.replace(/<\/(body|html)>/i, signature + "</$1>");
    } else {
      result.body = result.body + signature;
    }

    return { subject: result.subject, body: result.body };
  } catch (err) {
    console.warn("generateFollowupEmail failed:", err.message);
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
  // "cold_outbound" is the enum value actually persisted by both the agent-driven
  // cold_outreach_ai flow (src/api/agent.js) and the manual Cold Outbound feature.
  // "cold" is a legacy value kept for safety in case older rows exist.
  if (lead.signal_category === "cold_outbound") return true;
  if (lead.signal_category === "cold") return true;
  if (!lead.signal_type && !lead.signal_category) return true;
  return false;
}

/**
 * Generate a COLD email for a lead proposed by the autonomous cold-outreach
 * agent (e.g. Troudebal on OpenClaw). No warm signal — true first contact.
 *
 * Draws context from the agent-produced metadata fields:
 *   metadata.icp_fit_reasoning     — 2 lines explaining why this lead fits ICP
 *   metadata.angle_of_approach     — 2 lines of suggested angle
 *   metadata.enrichment            — free-form bag of enrichment findings
 *
 * Output: { subject, body } with HTML body + Julien's signature + Calendly CTA
 * (same post-processing as generateEmail so the tone/signature stays consistent
 * across all outbound emails).
 *
 * @param {object} lead - Lead row from Supabase (with metadata populated by the agent)
 * @returns {Promise<{subject: string, body: string}|null>}
 */
async function generateColdEmail(lead, caseStudy) {
  try {
    var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme/30min";
    var lang = detectLanguage(lead);
    var md = (lead && lead.metadata) || {};
    var angle = sanitizeForPrompt(md.angle_of_approach, 500);
    var icpReason = sanitizeForPrompt(md.icp_fit_reasoning, 400);

    // Flatten enrichment into a compact block (cap to avoid prompt bloat).
    var enrichText = "";
    if (md.enrichment && typeof md.enrichment === "object") {
      try {
        enrichText = JSON.stringify(md.enrichment).slice(0, 1500);
      } catch (_e) {
        enrichText = "";
      }
    }

    var instructions =
      "Redige un email COLD OUTREACH. Premier contact, le prospect ne nous connait pas.\n\n" +
      "REGLES :\n" +
      "1. 1er contact total : pas de 'j ai vu que vous avez...', pas de flicage, pas de reference a une activite LinkedIn observee. On ecrit parce que le SUJET nous interesse.\n" +
      "2. POSITIONNEMENT : MessagingMe = strategie conversationnelle WhatsApp & chatbots pour grandes entreprises. Clients de reference utilisables : Gan Prevoyance, Keolis, Odalys, DPD, Neoma, EDHEC.\n" +
      "3. UTILISER L ANGLE SUGGERE par le scout (champ 'Angle'). C est la these d approche validee, reste aligne dessus.\n" +
      "4. UTILISER LE CONTEXTE d enrichissement pour personnaliser (actualite entreprise, poste recent, sujet sur lequel le prospect s exprime). Mais JAMAIS inventer de fait non present dans le contexte.\n" +
      "5. FORMAT : objet court et specifique au lead (pas 'Prise de contact', pas 'Decouverte MessagingMe'). Corps : 4-6 phrases, HTML simple. Terminer par une question ouverte qui invite a repondre.\n" +
      "6. PAS DE CTA : ne propose PAS de RDV, PAS de lien Calendly. Lien ajoute automatiquement en signature.\n" +
      "7. SIGNATURE : NE PAS mettre de signature, NE PAS mettre 'Cordialement', 'Bonne journee', 'MessagingMe'. Tout est ajoute automatiquement.\n" +
      "8. EN FRANCAIS par defaut, EN ANGLAIS si zone GCC / international.\n" +
      "9. ANTI-HALLUCINATION : ne cite aucun nom, chiffre, client, fait qui n est pas dans le contexte ou dans la liste de clients de reference. Si tu n es pas sur, parle du sujet en termes generaux.";

    var langInstruction = lang === "en"
      ? "\n\nIMPORTANT: This prospect is NOT French-speaking. Write the ENTIRE email (subject + body) IN ENGLISH. Professional but warm tone."
      : "";

    var caseStudyBlock = "";
    if (caseStudy && caseStudy.client_name) {
      var csLines = [
        "Client: " + caseStudy.client_name,
        "Secteur: " + (caseStudy.sector || ""),
        "Metrique cle: " + (caseStudy.metric_label || "") + " = " + (caseStudy.metric_value || ""),
      ];
      if (caseStudy.description) csLines.push("Description: " + caseStudy.description);
      caseStudyBlock =
        "\n\nCAS CLIENT A UTILISER COMME PREUVE SOCIALE (complete l'angle, ne l'ecrase pas) :\n" +
        csLines.join("\n") +
        "\nGlisse une reference concise a ce cas dans le mail (chiffre + client) SI ca renforce naturellement l'angle. Sinon ignore-le. Ne cite jamais un chiffre ou un client absent de ce bloc.";
    }

    var coldContext =
      "\n\nAngle d'attaque suggere par le scout :\n" + (angle || "(aucun)") +
      "\n\nICP fit (raison de cibler) :\n" + (icpReason || "(aucun)") +
      (enrichText ? "\n\nContexte d'enrichissement (JSON brut) :\n" + enrichText : "") +
      caseStudyBlock;

    var result = await callClaude(SYSTEM,
      instructions + langInstruction + "\n\n" +
      buildLeadContext(lead) + coldContext + "\n" +
      "Email destinataire: " + sanitizeForPrompt(lead.email) + "\n\n" +
      'Reponds en JSON: {"subject": "...", "body": "<html>...</html>"}', 2048);

    if (!result || !result.subject || !result.body) return null;

    // Reuse the exact post-processing chain from generateEmail for consistency:
    // strip any Sonnet-invented signature/CTA, then append Julien's canonical signature.
    result.body = result.body
      .replace(/<br\s*\/?>\s*(Cordialement|Best regards|Kind regards|Regards|Bien cordialement|A bientot|A tres vite|Bonne journee|Bonne soiree)[,.]?\s*(<br\s*\/?>.*?)?\s*Julien[^<]*/gi, "")
      .replace(/<p>\s*(Cordialement|Best regards|Kind regards|Regards|Bien cordialement|Bonne journee)[,.]?\s*<\/p>(\s*<p>[^<]*<\/p>)*/gi, "")
      .replace(/Julien\s+(Poupard|Dumas|MessagingMe)[^<]*/gi, "")
      .replace(/--\s*<br\s*\/?>\s*Julien[^<]*/gi, "")
      .replace(/<a[^>]*calendly[^>]*>[^<]*<\/a>/gi, "")
      .replace(/<p[^>]*>\s*<a[^>]*calendly[^>]*>[^<]*<\/a>\s*<\/p>/gi, "")
      .replace(/[Rr]eserv(er|ez)\s+un\s+creneau[^<]*/gi, "")
      .replace(/[Pp]rogramm(er|ez)\s+un\s+echange[^<]*/gi, "")
      .replace(/<p>\s*(Bonne journee|Bonne soiree|MessagingMe)\s*,?\s*<\/p>/gi, "")
      .replace(/<br\s*\/?>\s*(Bonne journee|Bonne soiree|MessagingMe)\s*,?\s*(<br\s*\/?>)?/gi, "")
      .replace(/<p>\s*<\/p>/g, "")
      .replace(/(<br\s*\/?>){3,}/g, "<br><br>");

    var ctaLabel = lang === "en" ? "Schedule a call" : "Programmer un echange";
    var signature = '<br><br>Julien Dumas<br>CEO MessagingMe<br><a href="https://www.messagingme.fr">www.messagingme.fr</a>' +
      '<br><br><a href="' + calendlyUrl + '" style="display:inline-block;padding:10px 20px;background-color:#4F46E5;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">' + ctaLabel + '</a>';
    result.body = result.body.replace(/(<br\s*\/?>){1,3}\s*Julien Dumas\s*<br\s*\/?>.*?messagingme\.fr<\/a>/gi, "");
    if (result.body.match(/<\/(body|html)>/i)) {
      result.body = result.body.replace(/<\/(body|html)>/i, signature + "</$1>");
    } else {
      result.body = result.body + signature;
    }

    return { subject: result.subject, body: result.body };
  } catch (err) {
    console.warn("generateColdEmail failed:", err.message);
    return null;
  }
}

// Expose the hardcoded defaults so scripts/seed-default-templates.js (and any
// future admin reseed endpoint) can persist them into the global_settings
// table without retyping the long strings.
const DEFAULT_TEMPLATES = {
  template_invitation: DEFAULT_INVITATION_TEMPLATE,
  template_followup: DEFAULT_FOLLOWUP_TEMPLATE,
  template_email: DEFAULT_EMAIL_TEMPLATE,
  template_email_followup: DEFAULT_EMAIL_FOLLOWUP_TEMPLATE,
  template_whatsapp: DEFAULT_WHATSAPP_TEMPLATE,
};

module.exports = {
  loadTemplates,
  generateInvitationNote,
  generateFollowUpMessage,
  generateEmail,
  generateFollowupEmail,
  generateColdEmail,
  generateWhatsAppBody,
  generateInMail,
  isColdLead,
  DEFAULT_TEMPLATES,
};
