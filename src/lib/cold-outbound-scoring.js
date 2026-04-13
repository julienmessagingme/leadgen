/**
 * Lightweight "prise" scorer for cold outbound results.
 * Evaluates how much personalization material we have on a prospect.
 * Uses Haiku for speed and low cost.
 */
const { getAnthropicClient } = require("./anthropic");

function sanitize(value, maxLen = 300) {
  if (!value) return "";
  return String(value)
    .replace(/[\r\n]+/g, " ")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
    .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "")
    .trim()
    .slice(0, maxLen);
}

/**
 * Score a prospect's "prise" — how much material we have to personalize outreach.
 * @param {object} profile - Enriched profile data from visitProfile
 * @param {string} profile.first_name
 * @param {string} profile.last_name
 * @param {string} profile.headline
 * @param {string} profile.company
 * @param {string} profile.location
 * @param {string} [profile.summary] - Bio / about section
 * @param {Array}  [profile.recent_posts] - Recent posts array
 * @param {number} [profile.connections_count]
 * @returns {Promise<{score: number, reasoning: string}>}
 */
async function scorePrise(profile) {
  var client = getAnthropicClient();

  var postsText = "";
  if (Array.isArray(profile.recent_posts) && profile.recent_posts.length > 0) {
    postsText = profile.recent_posts
      .slice(0, 3)
      .map(function (p, i) { return "Post " + (i + 1) + ": " + sanitize(p.text || p.content || p.title || "", 200); })
      .join("\n");
  }

  var userPrompt = [
    "Prospect a evaluer :",
    "Nom: " + sanitize(profile.first_name) + " " + sanitize(profile.last_name),
    "Titre: " + sanitize(profile.headline),
    "Entreprise: " + sanitize(profile.company),
    "Localisation: " + sanitize(profile.location),
    profile.summary ? "Bio: " + sanitize(profile.summary, 500) : "",
    postsText ? "Publications recentes:\n" + postsText : "Publications: aucune",
    profile.connections_count ? "Connexions: " + profile.connections_count : "",
  ].filter(Boolean).join("\n");

  try {
    var resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 256,
      system: [
        "Tu evalues le potentiel de personnalisation d'un prospect pour une prospection B2B.",
        "Score de 0 a 100 :",
        "- 80-100 : beaucoup de matiere (posts recents pertinents, bio detaillee, contexte entreprise clair)",
        "- 50-79 : matiere correcte (quelques posts ou bio, on peut personnaliser)",
        "- 20-49 : peu de matiere (juste headline + entreprise, message generique)",
        "- 0-19 : quasi rien (profil vide ou inactif)",
        "",
        "Reponds UNIQUEMENT en JSON : { \"score\": number, \"reasoning\": \"1 phrase max\" }",
      ].join("\n"),
      messages: [{ role: "user", content: userPrompt }],
    });

    var text = resp.content[0].text.trim();
    // Extract JSON from response (handle markdown code blocks)
    var jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      var parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0)),
        reasoning: String(parsed.reasoning || "").slice(0, 200),
      };
    }
    return { score: 30, reasoning: "Parse error - score par defaut" };
  } catch (err) {
    console.error("scorePrise error:", err.message);
    return { score: 0, reasoning: "Scoring error: " + err.message.slice(0, 100) };
  }
}

module.exports = { scorePrise };
