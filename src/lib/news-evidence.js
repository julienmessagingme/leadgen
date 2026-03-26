/**
 * Company news evidence module.
 * Gathers company news from Google News RSS with verifiable source URLs.
 * Anti-hallucination: every evidence item MUST have a source_url.
 * Never generates news from LLM without a URL.
 *
 * News enrichment is non-critical. All errors are caught and logged;
 * the function returns an empty array on failure.
 *
 * ENR-05: Actu entreprise multi-sources avec preuves anti-hallucination
 */

const { supabase } = require("./supabase");
const { log } = require("./logger");

/** Maximum number of news articles to store per lead. */
const MAX_ARTICLES = 5;

/** Maximum length of article summary in characters. */
const MAX_SUMMARY_LENGTH = 500;

/**
 * Gather company news evidence for a lead.
 * @param {object} lead - Enriched lead object (must have lead.id and lead.company_name)
 * @param {string} runId - UUID for this pipeline run
 * @returns {Promise<Array>} Array of evidence objects (may be empty)
 */
async function gatherNewsEvidence(lead, runId) {
  if (!lead.company_name) {
    await log(runId, "news-evidence", "info",
      "No company name -- skipping news evidence",
      { lead_id: lead.id });
    return [];
  }

  try {
    // Build Google News RSS query with French results
    // Include sector if available to reduce false positives (e.g., "Orange telecom" vs "orange fruit")
    let queryParts = [lead.company_name];
    if (lead.company_sector) {
      queryParts.push(lead.company_sector);
    }
    const query = encodeURIComponent(queryParts.join(" "));
    const rssUrl = "https://news.google.com/rss/search?q=" + query + "&hl=fr&gl=FR&ceid=FR:fr";

    const res = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadGen/1.0)" },
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      await log(runId, "news-evidence", "warn",
        "Google News RSS returned " + res.status,
        { company: lead.company_name });
      return [];
    }

    const xml = await res.text();
    const articles = parseRssXml(xml).slice(0, MAX_ARTICLES);

    if (articles.length === 0) {
      await log(runId, "news-evidence", "info",
        "No news articles found for company",
        { company: lead.company_name });
      return [];
    }

    // Map to evidence objects -- every item MUST have a source_url (anti-hallucination)
    const evidence = articles
      .filter(function(a) { return a.link; }) // Enforce source_url requirement
      .map(function(a) {
        return {
          lead_id: lead.id,
          source_url: a.link,
          source_title: a.title || null,
          summary: a.description ? a.description.substring(0, MAX_SUMMARY_LENGTH) : null,
          published_at: a.pubDate ? safeParseDate(a.pubDate) : null,
          relevance_score: null, // Set during ICP scoring
        };
      });

    // Insert evidence into lead_news_evidence table
    if (evidence.length > 0) {
      const { error } = await supabase.from("lead_news_evidence").insert(evidence);
      if (error) {
        await log(runId, "news-evidence", "warn",
          "Failed to insert news evidence: " + error.message,
          { company: lead.company_name, count: evidence.length });
      } else {
        await log(runId, "news-evidence", "info",
          "Stored " + evidence.length + " news evidence items",
          { company: lead.company_name });
      }
    }

    return evidence;
  } catch (err) {
    // News is non-critical -- catch all, log, return empty
    await log(runId, "news-evidence", "warn",
      "News evidence gathering failed: " + err.message,
      { company: lead.company_name });
    return [];
  }
}

/**
 * Parse Google News RSS XML with simple regex extraction.
 * No xml2js dependency needed -- Google News RSS is predictable.
 * @param {string} xml - RSS XML string
 * @returns {Array} Parsed article objects
 */
function parseRssXml(xml) {
  var items = [];
  var itemRegex = /<item>([\s\S]*?)<\/item>/g;
  var match;
  while ((match = itemRegex.exec(xml)) !== null) {
    var item = match[1];
    items.push({
      title: extractTag(item, "title"),
      link: extractTag(item, "link"),
      description: extractTag(item, "description"),
      pubDate: extractTag(item, "pubDate"),
    });
  }
  return items;
}

/**
 * Extract content from an XML tag, handling CDATA wrapping.
 * @param {string} xml - XML fragment
 * @param {string} tag - Tag name to extract
 * @returns {string|null} Tag content or null
 */
function extractTag(xml, tag) {
  var regex = new RegExp("<" + tag + "[^>]*>([\s\S]*?)<\/" + tag + ">", "i");
  var match = xml.match(regex);
  if (!match) return null;
  // Strip CDATA wrapping
  var content = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "");
  return content.trim();
}

/**
 * Safely parse a date string to ISO format.
 * @param {string} dateStr - Date string (e.g., from pubDate)
 * @returns {string|null} ISO 8601 string or null
 */
function safeParseDate(dateStr) {
  try {
    var d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch (err) {
    return null;
  }
}

module.exports = { gatherNewsEvidence };
