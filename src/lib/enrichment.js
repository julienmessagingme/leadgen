/**
 * Lead enrichment pipeline module.
 * Orchestrates three enrichment sources:
 *   1. BeReach profile visit (with 48h cache) -- ENR-01, ENR-03
 *   2. BeReach company visit -- ENR-02
 *   3. OpenClaw Sales Navigator (optional, graceful fail) -- ENR-04
 *
 * Each enrichment step is wrapped in try/catch for error isolation.
 * If BeReach profile fails, returns signal with partial data.
 * If company fails, continues. If Sales Nav fails, continues.
 */

const { visitProfile, visitCompany } = require("./bereach");
// OpenClaw Sales Nav DISABLED - bug #25920, see CLAUDE.md
// const { enrichFromSalesNav } = require("./openclaw-browser");
const { log } = require("./logger");

/** Cache duration in hours for BeReach profile data. */
const CACHE_HOURS = 48;

/**
 * Enrich a lead signal with profile, company, and Sales Nav data.
 * @param {object} signal - Raw signal object with linkedin_url and optional cached fields
 * @param {string} runId - UUID for this pipeline run
 * @returns {Promise<object>} Enriched lead object
 */
async function enrichLead(signal, runId) {
  let enriched = { ...signal };

  // ---------------------------------------------------------------
  // 1. Profile enrichment via BeReach (ENR-01) with 48h cache (ENR-03)
  // ---------------------------------------------------------------
  try {
    if (isCacheFresh(signal.profile_last_fetched_at, CACHE_HOURS)) {
      await log(runId, "enrichment", "info",
        "Profile cache fresh (< 48h) -- skipping BeReach call",
        { linkedin_url: signal.linkedin_url });
    } else {
      const profile = await visitProfile(signal.linkedin_url, { includePosts: true, includeComments: true });
      if (profile) {
        enriched.first_name = profile.firstName || profile.first_name || enriched.first_name;
        enriched.last_name = profile.lastName || profile.last_name || enriched.last_name;
        enriched.full_name = ((enriched.first_name || "") + " " + (enriched.last_name || "")).trim() || enriched.full_name;
        enriched.headline = profile.headline || enriched.headline;
        enriched.email = profile.email || enriched.email;
        enriched.phone = profile.phone || enriched.phone;
        enriched.location = profile.location || enriched.location;
        enriched.connections_count = profile.connectionsCount || enriched.connections_count;
        enriched.company_name = profile.company || profile.companyName || enriched.company_name;

        // company_linkedin_url: try direct field, then first current position
        enriched.company_linkedin_url = profile.companyUrl || profile.company_linkedin_url || enriched.company_linkedin_url;
        if (!enriched.company_linkedin_url && profile.positions && profile.positions.length > 0) {
          var currentPos = profile.positions.find(function(p) { return p.isCurrent; }) || profile.positions[0];
          enriched.company_linkedin_url = currentPos.companyUrl || enriched.company_linkedin_url;
        }

        // Calculate seniority from positions if not already set
        if (!enriched.seniority_years && profile.positions && profile.positions.length > 0) {
          var oldest = profile.positions[profile.positions.length - 1];
          if (oldest.startDate && oldest.startDate.year) {
            enriched.seniority_years = new Date().getFullYear() - oldest.startDate.year;
          }
        }

        enriched.profile_last_fetched_at = new Date().toISOString();

        // Store prospect's recent LinkedIn activity for message context
        if (profile.lastPosts && profile.lastPosts.length > 0) {
          enriched.metadata = enriched.metadata || {};
          enriched.metadata.prospect_posts = profile.lastPosts.slice(0, 5).map(function(p) {
            return { text: (p.text || "").substring(0, 300), url: p.postUrl || null, likes: p.likesCount || 0, comments: p.commentsCount || 0 };
          });
        }
        if (profile.lastComments && profile.lastComments.length > 0) {
          enriched.metadata = enriched.metadata || {};
          enriched.metadata.prospect_comments = profile.lastComments.slice(0, 5).map(function(c) {
            return { targetPostText: (c.targetPostText || "").substring(0, 300), targetPostAuthor: c.targetPostAuthor || null, type: c.type || "comment" };
          });
        }

        await log(runId, "enrichment", "info",
          "Profile enriched via BeReach",
          { linkedin_url: signal.linkedin_url, name: enriched.first_name + " " + enriched.last_name, location: enriched.location, company: enriched.company_name, posts: (profile.posts || []).length, comments: (profile.comments || []).length });
      }
    }
  } catch (err) {
    await log(runId, "enrichment", "warn",
      "BeReach profile enrichment failed: " + err.message,
      { linkedin_url: signal.linkedin_url });
  }

  // ---------------------------------------------------------------
  // 2. Company enrichment via BeReach (ENR-02)
  // ---------------------------------------------------------------
  try {
    if (enriched.company_linkedin_url) {
      const company = await visitCompany(enriched.company_linkedin_url);
      if (company) {
        enriched.company_name = company.name || enriched.company_name;
        enriched.company_size = company.employeeCount || company.size || enriched.company_size;
        enriched.company_sector = company.industry || company.sector || enriched.company_sector;

        // headquarter can be object {city, country, ...} or string
        if (company.headquarter) {
          if (typeof company.headquarter === "object") {
            var hq = company.headquarter;
            enriched.company_location = [hq.city, hq.country].filter(Boolean).join(", ") || enriched.company_location;
          } else {
            enriched.company_location = company.headquarter;
          }
        }
        enriched.company_location = enriched.company_location || company.location || company.headquarters || enriched.company_location;

        // Store extra company data in metadata for scoring
        enriched.metadata = {
          ...(enriched.metadata || {}),
          company_description: company.description || null,
          company_specialities: company.specialities || null,
          company_website: company.websiteUrl || null,
          company_founded: company.foundedOn ? company.foundedOn.year : null,
          company_employee_range: company.employeeCountRange || null,
          company_follower_count: company.followerCount || null,
        };

        await log(runId, "enrichment", "info",
          "Company enriched via BeReach",
          { company: enriched.company_name, sector: enriched.company_sector, size: enriched.company_size, location: enriched.company_location });
      }
    } else {
      await log(runId, "enrichment", "info",
        "No company LinkedIn URL -- skipping company enrichment",
        { linkedin_url: signal.linkedin_url });
    }
  } catch (err) {
    await log(runId, "enrichment", "warn",
      "BeReach company enrichment failed: " + err.message,
      { company_url: enriched.company_linkedin_url });
  }

  // ---------------------------------------------------------------
  // 3. Sales Navigator enrichment via OpenClaw (ENR-04) -- DISABLED
  //    Bug OpenClaw #25920 (HMAC-SHA256 token mismatch). Ne pas reactiver
  //    tant que le bug n'est pas fixe. Voir CLAUDE.md pour details.
  // ---------------------------------------------------------------

  return enriched;
}

/**
 * Check if a cached timestamp is still fresh (within the given hours).
 * @param {string|null} timestamp - ISO 8601 timestamp or null
 * @param {number} hours - Cache validity period in hours
 * @returns {boolean} true if cache is fresh
 */
function isCacheFresh(timestamp, hours) {
  if (!timestamp) return false;
  const hoursSinceFetch = (Date.now() - new Date(timestamp).getTime()) / 3600000;
  return hoursSinceFetch < hours;
}

module.exports = { enrichLead };
