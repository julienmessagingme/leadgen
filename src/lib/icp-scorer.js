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
  const { data, error } = await supabase.from("icp_rules").select("*");
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
  const sizeRules = rules.filter((r) => r.category === "company_size");
  const seniorityRules = rules.filter((r) => r.category === "seniority");

  const sizeRange = sizeRules.length > 0
    ? sizeRules.map((r) => r.value).join(", ")
    : "non specifie";
  const minSeniority = seniorityRules.length > 0
    ? seniorityRules.map((r) => r.value).join(", ")
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

  return "Tu es un expert en qualification de prospects B2B pour MessagingMe, une plateforme de messaging WhatsApp/RCS pour entreprises.\n\n" +
    "Evalue ce prospect selon le profil client ideal (ICP) suivant:\n\n" +
    "**Titres recherches (positifs):** " + (positiveTitles.length > 0 ? positiveTitles.join(", ") : "non specifie") + "\n" +
    "**Titres a exclure (negatifs):** " + (negativeTitles.length > 0 ? negativeTitles.join(", ") : "aucun") + "\n" +
    "**Secteurs cibles:** " + (targetSectors.length > 0 ? targetSectors.join(", ") : "non specifie") + "\n" +
    "**Taille entreprise:** " + sizeRange + "\n" +
    "**Seniorite minimum:** " + minSeniority + "\n\n" +
    "**Prospect a evaluer:**\n" +
    "- Nom: " + (sanitizeForPrompt(lead.full_name) || "inconnu") + "\n" +
    "- Titre: " + (sanitizeForPrompt(lead.headline) || "inconnu") + "\n" +
    "- Entreprise: " + (sanitizeForPrompt(lead.company_name) || "inconnue") + "\n" +
    "- Taille entreprise: " + (sanitizeForPrompt(lead.company_size) || "inconnue") + "\n" +
    "- Secteur: " + (sanitizeForPrompt(lead.company_sector) || "inconnu") + "\n" +
    "- Localisation: " + (sanitizeForPrompt(lead.location) || "inconnue") + "\n" +
    newsSection + "\n\n" +
    "Attribue un score de 0 a 100 et un tier:\n" +
    "- hot (>=70): prospect tres qualifie, correspond fortement a l'ICP\n" +
    "- warm (>=40): prospect interessant, correspond partiellement\n" +
    "- cold (<40): prospect peu qualifie, ne correspond pas\n\n" +
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
        "Lead " + (lead.full_name || lead.id) + " skipped: signal too old (" + signalAge + "d > " + skipDays + "d)");
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
      model: "claude-3-haiku-20240307",
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
      concurrent: getNumericRuleValue(signalWeightRules, "concurrent", 25),
      influenceur: getNumericRuleValue(signalWeightRules, "influenceur", 15),
      sujet: getNumericRuleValue(signalWeightRules, "sujet", 10),
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

    // Step 6: Final score and tier (ICP-05)
    var finalScore = Math.max(0, Math.min(100, haikuScore + signalBonus + freshnessMalus + newsBonus));
    var finalTier;
    if (finalScore >= 70) {
      finalTier = "hot";
    } else if (finalScore >= 40) {
      finalTier = "warm";
    } else {
      finalTier = "cold";
    }

    await log(runId, "icp-scorer", "info",
      "Lead " + (lead.full_name || lead.id) + " scored: " + finalScore + " (" + finalTier + ")", {
      haiku_score: haikuScore,
      signal_bonus: signalBonus,
      freshness_malus: freshnessMalus,
      news_bonus: newsBonus,
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
  var rule = rules.find(function(r) { return r.key === key || r.value === key; });
  if (rule && rule.numeric_value !== undefined && rule.numeric_value !== null) {
    return Number(rule.numeric_value);
  }
  if (rule && rule.threshold !== undefined && rule.threshold !== null) {
    return Number(rule.threshold);
  }
  return defaultValue;
}

module.exports = { scoreLead, loadIcpRules };
