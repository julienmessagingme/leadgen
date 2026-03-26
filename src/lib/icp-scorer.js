const { getAnthropicClient } = require("./anthropic");
const { supabase } = require("./supabase");
const { log } = require("./logger");

function sanitizeForPrompt(value, maxLen = 200) {
  if (!value) return "";
  return String(value).replace(/[\r\n]+/g, " ").trim().slice(0, maxLen);
}

/**
 * Load ICP rules from Supabase icp_rules table.
 * Called once per task-a run, results passed to scoreLead.
 * @returns {Array} Array of rule objects
 */
async function loadIcpRules() {
  const { data, error } = await supabase.from("icp_rules").select("category, value, key, numeric_value, threshold");
  if (error) {
    console.error("Failed to load ICP rules:", error.message);
    return [];
  }
  return data || [];
}

/**
 * Build the scoring prompt in French for Claude Haiku.
 * @param {object} lead - Lead data
 * @param {Array} newsEvidence - News evidence array
 * @param {Array} rules - ICP rules from Supabase
 * @returns {string} Structured prompt
 */
function buildScoringPrompt(lead, newsEvidence, rules) {
  // Extract rule categories
  const positiveTitles = rules
    .filter((r) => r.category === "title_positive")
    .map((r) => r.value);
  const negativeTitles = rules
    .filter((r) => r.category === "title_negative")
    .map((r) => r.value);
  const targetSectors = rules
    .filter((r) => r.category === "sector")
    .map((r) => r.value);
  const targetGeos = rules
    .filter((r) => r.category === "geo_positive")
    .map((r) => r.value);
  const sizeRules = rules.filter((r) => r.category === "company_size");
  const seniorityRules = rules.filter((r) => r.category === "seniority");

  // Build human-readable size range from min/max/ideal_min/ideal_max
  var sizeMin = sizeRules.find((r) => r.key === "min");
  var sizeMax = sizeRules.find((r) => r.key === "max");
  var sizeIdealMin = sizeRules.find((r) => r.key === "ideal_min");
  var sizeIdealMax = sizeRules.find((r) => r.key === "ideal_max");
  var sizeRange = "non specifie";
  if (sizeIdealMin && sizeIdealMax) {
    sizeRange = (sizeIdealMin.value || "10") + " a " + (sizeIdealMax.value || "5000") + " employes (ideal)";
    if (sizeMin) sizeRange += ", minimum " + (sizeMin.value || "10");
    if (sizeMax) sizeRange += ", maximum " + (sizeMax.value || "50000");
  }
  const minSeniority = seniorityRules.length > 0
    ? seniorityRules.map((r) => (r.key || "") + ": " + (r.value || "")).join(", ")
    : "non specifie";

  // Format news evidence if available
  let newsSection = "";
  if (newsEvidence && newsEvidence.length > 0) {
    const newsItems = newsEvidence
      .filter((n) => n.title)
      .map((n) => "- " + n.title + (n.source_url ? " (source: " + n.source_url + ")" : ""))
      .join("\n");
    if (newsItems) {
      newsSection = "\nActualites recentes de l'entreprise:\n" + newsItems;
    }
  }

  return "Tu es un expert en qualification de prospects B2B pour MessagingMe, une plateforme de messaging WhatsApp/RCS pour entreprises.\n" +
    "MessagingMe VEND une solution de messaging aux entreprises. On cherche des ACHETEURS potentiels, PAS des concurrents.\n\n" +
    "Evalue ce prospect selon le profil client ideal (ICP) suivant:\n\n" +
    "**Titres recherches (positifs):** " + (positiveTitles.length > 0 ? positiveTitles.join(", ") : "non specifie") + "\n" +
    "**Titres a exclure (negatifs):** " + (negativeTitles.length > 0 ? negativeTitles.join(", ") : "aucun") + "\n" +
    "**Secteurs cibles:** " + (targetSectors.length > 0 ? targetSectors.join(", ") : "non specifie") + "\n" +
    "**Zones geographiques cibles:** " + (targetGeos.length > 0 ? targetGeos.join(", ") : "non specifie") + "\n" +
    "**Taille entreprise:** " + sizeRange + "\n" +
    "**Seniorite minimum:** " + minSeniority + "\n\n" +
    "**REGLES STRICTES (a appliquer dans cet ordre) :**\n" +
    "1. CONCURRENTS = COLD : Si le prospect travaille pour une entreprise qui VEND des solutions de messaging, chatbot, WhatsApp API, CPaaS, communication client, ou marketing automation avec messaging (ex: Twilio, Sinch, Vonage, Alcmeon, iAdvize, Zendesk, Intercom, Freshdesk, Respond.io, WATI, Manychat, WAX, Simio, Gupshup, Infobip, MessageBird, CM.com, Brevo, Klaviyo, Charles, Trengo, Landbot, Botpress, Bandwidth, Plivo, Telnyx, Kaleyra, Clickatell, Mitto, Drift, Crisp, Tidio, LiveChat, Olark, Userlike, Front, 360dialog, Zoko, DelightChat, Gallabox, AiSensy, DoubleTick, HubSpot, Salesforce, Adobe Campaign, Cisco Webex Connect, Bird, Podium, Attentive, Postscript, Recart, Octane AI, MoEngage, WebEngage, CleverTap, Insider, Netcore, Exotel, Knowlarity, Ozonetel, Sarv, Route Mobile, Tanla, ValueFirst, ACL Mobile, Spring Edge, Viber Business, LINE Business, Telegram Business, RCS Business Messaging, etc.), c'est un CONCURRENT → score cold (<20).\n" +
    "2. GEOGRAPHIE : Les zones cibles prioritaires sont : " + (targetGeos.length > 0 ? targetGeos.join(", ") : "non specifie") + ". Un prospect dans ces zones a un bonus. Un prospect hors zone peut etre warm/hot SEULEMENT si c'est une vraie entreprise credible (pas un freelance) avec un besoin clair de messaging B2C. Sinon, cold.\n" +
    "3. TAILLE ENTREPRISE : On cible des entreprises de " + (sizeMin ? sizeMin.value : "10") + "+ employes (max " + (sizeMax ? sizeMax.value : "50000") + "). Les freelances, consultants solo, micro-agences, 'Founder of [nom perso] Consulting', self-employed, solopreneurs → cold (<20). Indices : headline avec 'Freelance', 'Independent', 'Self-employed', 'Solopreneur', nom de boite = nom de la personne + 'Consulting'.\n" +
    "4. PERTINENCE METIER : Le prospect doit etre un ACHETEUR potentiel de messaging pour sa relation client B2C/B2B. On cherche des CMO, CRM managers, directeurs marketing, responsables relation client dans des boites qui ont des CLIENTS FINAUX a contacter par messaging. Pas des consultants, coaches, auteurs, conferenciers, recruteurs.\n" +
    "5. Si l'entreprise ou la localisation sont inconnues, sois CONSERVATEUR : ne mets pas hot sans certitude. Un titre senior seul ne suffit pas. Quand tu doutes, mets warm (40-50) max.\n\n" +
    "**Prospect a evaluer:**\n" +
    "- Nom: " + (sanitizeForPrompt(lead.full_name) || "inconnu") + "\n" +
    "- Titre: " + (sanitizeForPrompt(lead.headline) || "inconnu") + "\n" +
    "- Entreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue") + "\n" +
    "- Description entreprise: " + (sanitizeForPrompt(lead.metadata && lead.metadata.company_description) || "inconnue") + "\n" +
    "- Specialites entreprise: " + (lead.metadata && lead.metadata.company_specialities && lead.metadata.company_specialities.length > 0 ? sanitizeForPrompt(lead.metadata.company_specialities.join(", ")) : "inconnues") + "\n" +
    "- Site web entreprise: " + (sanitizeForPrompt(lead.metadata && lead.metadata.company_website) || "inconnu") + "\n" +
    "- Taille entreprise: " + (sanitizeForPrompt(lead.company_size) || "inconnue") + (lead.metadata && lead.metadata.company_founded ? " (fondee en " + lead.metadata.company_founded + ")" : "") + "\n" +
    "- Secteur: " + (sanitizeForPrompt(lead.company_sector) || "inconnu") + "\n" +
    "- Localisation: " + (sanitizeForPrompt(lead.location || lead.company_location) || "inconnue") + "\n" +
    "- Seniorite: " + (lead.seniority_years ? lead.seniority_years + " ans" : "inconnue") + "\n" +
    "- Connexions LinkedIn: " + (lead.connections_count || "inconnu") + "\n" +
    (function() {
      var meta = lead.metadata || {};
      var actLines = "";
      if (meta.prospect_posts && meta.prospect_posts.length > 0) {
        actLines += "- Posts recents LinkedIn (" + meta.prospect_posts.length + "): ";
        actLines += meta.prospect_posts.slice(0, 3).map(function(p) { return "\"" + sanitizeForPrompt(p.text, 100) + "\""; }).join(" | ");
        actLines += "\n";
      }
      if (meta.prospect_comments && meta.prospect_comments.length > 0) {
        actLines += "- Commente recemment sur des posts de: ";
        actLines += meta.prospect_comments.slice(0, 3).map(function(c) { return sanitizeForPrompt(c.targetPostAuthor || "?") + " (sujet: " + sanitizeForPrompt(c.targetPostText, 60) + ")"; }).join(" | ");
        actLines += "\n";
      }
      if (!actLines) actLines = "- Activite LinkedIn recente: inconnue\n";
      return actLines;
    })() +
    newsSection + "\n\n" +
    "Attribue un score de 0 a 100 et un tier:\n" +
    "- hot (>=70): decideur senior dans une entreprise cible, en zone geographique cible, qui ACHETERAIT du messaging\n" +
    "- warm (40-69): profil interessant mais informations incompletes ou localisation incertaine\n" +
    "- cold (<40): concurrent, hors zone, pas de potentiel d'achat, ou profil non pertinent\n\n" +
    "Reponds avec ton evaluation et un raisonnement concis.";
}

/**
 * Score a lead using Claude Haiku 4.5 with deterministic adjustments.
 *
 * @param {object} lead - Lead data object
 * @param {Array} newsEvidence - Array of news evidence objects
 * @param {Array} rules - ICP rules from Supabase
 * @param {string} runId - Current run ID for logging
 * @returns {object} Lead enriched with icp_score, tier, scoring metadata
 */
async function scoreLead(lead, newsEvidence, rules, runId) {
  try {
    // Step 1: Freshness TTL check (ICP-04)
    const freshnessRules = rules.filter((r) => r.category === "freshness");
    const skipDays = getNumericRuleValue(freshnessRules, "skip_days", 15);
    const malusDays = getNumericRuleValue(freshnessRules, "malus_days", 10);
    const warnDays = getNumericRuleValue(freshnessRules, "warn_days", 5);

    const signalAge = lead.signal_date
      ? Math.floor((Date.now() - new Date(lead.signal_date).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    if (signalAge > skipDays) {
      await log(runId, "icp-scorer", "info",
        "Lead " + (lead.full_name || ((lead.first_name || "") + " " + (lead.last_name || "")).trim() || "unknown") + " skipped: signal too old (" + signalAge + "d > " + skipDays + "d)");
      return {
        ...lead,
        icp_score: 0,
        tier: "cold",
        scoring_metadata: {
          reasoning: "Signal trop ancien - skip automatique",
          signal_age_days: signalAge,
          skipped: true,
        },
      };
    }

    var freshnessMalus = 0;
    if (signalAge > malusDays) {
      freshnessMalus = -15;
    } else if (signalAge > warnDays) {
      freshnessMalus = -5;
    }

    // Step 2: Claude Haiku scoring (ICP-01)
    var prompt = buildScoringPrompt(lead, newsEvidence, rules);

    var response = await getAnthropicClient().messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              icp_score: { type: "number" },
              tier: { type: "string", enum: ["hot", "warm", "cold"] },
              reasoning: { type: "string" },
            },
            required: ["icp_score", "tier", "reasoning"],
            additionalProperties: false,
          },
        },
      },
    });

    var haikuResult = JSON.parse(response.content[0].text);
    var haikuScore = Math.max(0, Math.min(100, haikuResult.icp_score));

    // Step 3: Signal weight bonus (ICP-03)
    var signalWeightRules = rules.filter((r) => r.category === "signal_weights");
    var signalWeights = {
      concurrent: getNumericRuleValue(signalWeightRules, "concurrent", 10),
      influenceur: getNumericRuleValue(signalWeightRules, "influenceur", 5),
      sujet: getNumericRuleValue(signalWeightRules, "sujet", 5),
      job: getNumericRuleValue(signalWeightRules, "job", 5),
    };
    var signalBonus = signalWeights[lead.signal_category] || 0;

    // Step 4: Freshness malus already calculated in Step 1

    // Step 5: News bonus (ICP-06)
    var newsBonus = 0;
    if (newsEvidence && newsEvidence.length > 0) {
      var sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      var verifiableRecent = newsEvidence.filter(function(n) {
        if (!n.source_url || !n.published_at) return false;
        var pubDate = new Date(n.published_at);
        return pubDate >= sixMonthsAgo;
      });

      if (verifiableRecent.length > 0) {
        newsBonus = 10;
      }
    }

    // Step 6: LinkedIn activity bonus — active prospects are easier to engage
    var activityBonus = 0;
    var leadMeta = lead.metadata || {};
    var hasPosts = leadMeta.prospect_posts && leadMeta.prospect_posts.length > 0;
    var hasComments = leadMeta.prospect_comments && leadMeta.prospect_comments.length > 0;
    if (hasPosts && hasComments) {
      activityBonus = 10; // Very active — posts AND comments
    } else if (hasPosts || hasComments) {
      activityBonus = 5; // Somewhat active
    }

    // Step 7: Final score and tier (ICP-05)
    var finalScore = Math.max(0, Math.min(100, haikuScore + signalBonus + freshnessMalus + newsBonus + activityBonus));
    var finalTier;
    if (finalScore >= 70) {
      finalTier = "hot";
    } else if (finalScore >= 40) {
      finalTier = "warm";
    } else {
      finalTier = "cold";
    }

    await log(runId, "icp-scorer", "info",
      "Lead " + (lead.full_name || ((lead.first_name || "") + " " + (lead.last_name || "")).trim() || "unknown") + " scored: " + finalScore + " (" + finalTier + ")", {
      haiku_score: haikuScore,
      signal_bonus: signalBonus,
      freshness_malus: freshnessMalus,
      news_bonus: newsBonus,
      activity_bonus: activityBonus,
      final_score: finalScore,
    });

    return {
      ...lead,
      icp_score: finalScore,
      tier: finalTier,
      scoring_metadata: {
        reasoning: haikuResult.reasoning,
        haiku_score: haikuScore,
        signal_bonus: signalBonus,
        signal_category: lead.signal_category,
        freshness_malus: freshnessMalus,
        signal_age_days: signalAge,
        news_bonus: newsBonus,
        activity_bonus: activityBonus,
        final_score: finalScore,
      },
    };
  } catch (err) {
    // Fail safe: if Anthropic API fails, return cold tier
    console.error("ICP scoring failed for lead:", lead.full_name || lead.id, err.message);
    await log(runId, "icp-scorer", "error",
      "ICP scoring failed for " + (lead.full_name || lead.id) + ": " + err.message);

    return {
      ...lead,
      icp_score: 0,
      tier: "cold",
      scoring_metadata: {
        reasoning: "Scoring error - fail safe cold",
        error: err.message,
      },
    };
  }
}

/**
 * Extract a numeric value from a rules array by key.
 * @param {Array} rules - Filtered rules array
 * @param {string} key - The key/value name to find
 * @param {number} defaultValue - Default if not found
 * @returns {number}
 */
function getNumericRuleValue(rules, key, defaultValue) {
  var rule = rules.find(function(r) { return r.key === key; });
  if (!rule) return defaultValue;
  // Try numeric_value, threshold, then value (where DB actually stores it)
  if (rule.numeric_value !== undefined && rule.numeric_value !== null) {
    return Number(rule.numeric_value);
  }
  if (rule.threshold !== undefined && rule.threshold !== null) {
    return Number(rule.threshold);
  }
  if (rule.value !== undefined && rule.value !== null && !isNaN(Number(rule.value))) {
    return Number(rule.value);
  }
  return defaultValue;
}

module.exports = { scoreLead, loadIcpRules };
