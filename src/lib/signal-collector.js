/**
 * Signal collector module.
 * Orchestrates 4 signal sources from the watchlist table:
 *   - competitor_page (SIG-01): likers & commenters on competitor posts
 *   - influencer (SIG-03): likers & commenters on influencer posts
 *   - keyword (SIG-02): post authors matching keywords
 *   - job_keyword (SIG-04): decision-makers at hiring companies
 *
 * Each source is wrapped in try/catch for error isolation.
 * Rate limiting delays (1-3s) between BeReach calls.
 */

const { supabase } = require("./supabase");
const {
  collectPostLikers,
  collectPostCommenters,
  searchPostsByKeywords,
  searchJobs,
  sleep,
} = require("./bereach");
const { log } = require("./logger");

/**
 * Random delay between min and max ms for rate limiting.
 * @param {number} min
 * @param {number} max
 */
async function rateLimitDelay(min, max) {
  var ms = min + Math.floor(Math.random() * (max - min));
  await sleep(ms);
}

/**
 * Format raw profiles into uniform signal objects.
 * Handles various BeReach response field naming conventions.
 *
 * @param {Array} profiles - Array of profile objects from BeReach
 * @param {string} signalType - Signal type (like, comment, post, job)
 * @param {string} signalCategory - Signal category (concurrent, influenceur, sujet, job)
 * @param {object} source - Watchlist source entry
 * @returns {Array} Formatted signal objects
 */
function formatSignals(profiles, signalType, signalCategory, source) {
  if (!Array.isArray(profiles)) return [];

  return profiles.map(function (p) {
    // Handle various field naming from BeReach responses
    var linkedinUrl = p.profileUrl || p.profile_url || p.url || p.linkedin_url || null;

    var firstName = p.firstName || p.first_name || null;
    var lastName = p.lastName || p.last_name || null;

    // If only full name provided, split it
    if (!firstName && !lastName && p.name) {
      var parts = p.name.trim().split(/\s+/);
      firstName = parts[0] || null;
      lastName = parts.slice(1).join(" ") || null;
    }

    return {
      linkedin_url: linkedinUrl,
      first_name: firstName,
      last_name: lastName,
      headline: p.headline || p.title || null,
      company_name: p.company || p.companyName || p.company_name || null,
      signal_type: signalType,
      signal_category: signalCategory,
      signal_source: source.source_label || source.source_type,
      signal_date: new Date().toISOString(),
      sequence_id: source.sequence_id || null,
    };
  });
}

/**
 * Collect likers and commenters from recent posts found via keyword search on a page.
 * Used for competitor_page (SIG-01) and influencer (SIG-03) sources.
 *
 * Since BeReach does not have a dedicated "get page posts" endpoint,
 * we search posts by the page name/label to find recent activity,
 * then collect likers and commenters from those posts.
 *
 * @param {object} source - Watchlist source with source_url and source_label
 * @param {string} signalCategory - 'concurrent' or 'influenceur'
 * @param {string} runId - Current run ID
 * @returns {Promise<Array>} Formatted signals
 */
async function collectPageSignals(source, signalCategory, runId) {
  var signals = [];

  // Search for recent posts from this page using the source label as keywords
  var searchQuery = source.source_label || source.source_url;
  var postsResult = await searchPostsByKeywords(searchQuery);
  await rateLimitDelay(1000, 3000);

  // Extract post URLs from search results (take last 3)
  var posts = Array.isArray(postsResult) ? postsResult : (postsResult.posts || postsResult.results || []);
  var recentPosts = posts.slice(0, 3);

  if (recentPosts.length === 0) {
    await log(runId, "signal-collector", "info",
      "No posts found for " + signalCategory + " source: " + searchQuery);
    return signals;
  }

  for (var i = 0; i < recentPosts.length; i++) {
    var post = recentPosts[i];
    var postUrl = post.url || post.postUrl || post.post_url || null;

    if (!postUrl) continue;

    // Collect likers
    try {
      var likers = await collectPostLikers(postUrl);
      await rateLimitDelay(1000, 3000);
      var likerProfiles = Array.isArray(likers) ? likers : (likers.profiles || likers.results || []);
      var likerSignals = formatSignals(likerProfiles, "like", signalCategory, source);
      signals = signals.concat(likerSignals);
    } catch (err) {
      await log(runId, "signal-collector", "warn",
        "Failed to collect likers for post: " + err.message, { postUrl: postUrl });
    }

    // Collect commenters
    try {
      var commenters = await collectPostCommenters(postUrl);
      await rateLimitDelay(1000, 3000);
      var commenterProfiles = Array.isArray(commenters) ? commenters : (commenters.profiles || commenters.results || []);
      var commenterSignals = formatSignals(commenterProfiles, "comment", signalCategory, source);
      signals = signals.concat(commenterSignals);
    } catch (err) {
      await log(runId, "signal-collector", "warn",
        "Failed to collect commenters for post: " + err.message, { postUrl: postUrl });
    }
  }

  return signals;
}

/**
 * Collect signals from keyword-based post search (SIG-02).
 * Extracts post authors as leads.
 *
 * @param {object} source - Watchlist source with keywords
 * @param {string} runId - Current run ID
 * @returns {Promise<Array>} Formatted signals
 */
async function collectKeywordSignals(source, runId) {
  var result = await searchPostsByKeywords(source.keywords);
  await rateLimitDelay(1000, 3000);

  var posts = Array.isArray(result) ? result : (result.posts || result.results || []);

  // Extract post authors as profiles
  var authors = posts
    .filter(function (p) { return p.author || p.profileUrl || p.profile_url; })
    .map(function (p) {
      return {
        profileUrl: p.author ? (p.author.profileUrl || p.author.url) : (p.profileUrl || p.profile_url),
        firstName: p.author ? (p.author.firstName || p.author.first_name) : (p.firstName || p.first_name),
        lastName: p.author ? (p.author.lastName || p.author.last_name) : (p.lastName || p.last_name),
        name: p.author ? p.author.name : p.name,
        headline: p.author ? p.author.headline : p.headline,
        company: p.author ? p.author.company : p.company,
      };
    });

  return formatSignals(authors, "post", "sujet", source);
}

/**
 * Collect signals from job keyword search (SIG-04).
 * For each job, finds decision-makers at the hiring company.
 *
 * @param {object} source - Watchlist source with keywords
 * @param {string} runId - Current run ID
 * @returns {Promise<Array>} Formatted signals
 */
async function collectJobSignals(source, runId) {
  var signals = [];

  var result = await searchJobs(source.keywords);
  await rateLimitDelay(1000, 3000);

  var jobs = Array.isArray(result) ? result : (result.jobs || result.results || []);

  for (var i = 0; i < jobs.length; i++) {
    var job = jobs[i];
    var companyName = job.company || job.companyName || job.company_name;
    var jobTitle = job.title || job.jobTitle || job.job_title || "unknown";

    if (!companyName) continue;

    try {
      // Decision-maker lookup: search for CX/digital executives at this company
      var dmQuery = "\"" + companyName + "\" AND (\"directeur experience client\" OR \"head of CX\" OR \"directeur digital\" OR \"chief digital officer\" OR \"VP customer experience\")";
      var dmResult = await searchPostsByKeywords(dmQuery);
      await rateLimitDelay(1000, 3000);

      var dmPosts = Array.isArray(dmResult) ? dmResult : (dmResult.posts || dmResult.results || []);

      // Extract profiles from search results that match the hiring company
      var decisionMakers = dmPosts
        .filter(function (p) {
          var authorCompany = (p.author && p.author.company) || p.company || p.companyName || "";
          return authorCompany.toLowerCase().indexOf(companyName.toLowerCase()) !== -1;
        })
        .map(function (p) {
          return {
            profileUrl: p.author ? (p.author.profileUrl || p.author.url) : (p.profileUrl || p.profile_url),
            firstName: p.author ? (p.author.firstName || p.author.first_name) : (p.firstName || p.first_name),
            lastName: p.author ? (p.author.lastName || p.author.last_name) : (p.lastName || p.last_name),
            name: p.author ? p.author.name : p.name,
            headline: p.author ? p.author.headline : p.headline,
            company: companyName,
          };
        });

      if (decisionMakers.length === 0) {
        await log(runId, "signal-collector", "info",
          "No decision-maker found for " + companyName,
          { jobTitle: jobTitle });
        continue;
      }

      // Create a modified source with job context in signal_source
      var jobSource = {
        source_label: (source.source_label || "job") + " | " + jobTitle + " @ " + companyName,
        sequence_id: source.sequence_id,
      };

      var dmSignals = formatSignals(decisionMakers, "job", "job", jobSource);
      signals = signals.concat(dmSignals);

    } catch (err) {
      await log(runId, "signal-collector", "warn",
        "Decision-maker lookup failed for " + companyName + ": " + err.message,
        { jobTitle: jobTitle });
    }
  }

  return signals;
}

/**
 * Collect signals from all active watchlist sources.
 * Dispatches to the appropriate handler based on source_type.
 * Each source is wrapped in try/catch for error isolation.
 *
 * @param {string} runId - UUID for this pipeline run
 * @returns {Promise<Array>} All collected signals
 */
async function collectSignals(runId) {
  // Load active watchlist entries from Supabase
  var { data: sources, error } = await supabase
    .from("watchlist")
    .select("id, source_type, source_label, source_url, keywords, sequence_id")
    .eq("is_active", true);

  if (error) {
    await log(runId, "signal-collector", "error",
      "Failed to load watchlist: " + error.message);
    return [];
  }

  if (!sources || sources.length === 0) {
    await log(runId, "signal-collector", "info",
      "No active watchlist sources found");
    return [];
  }

  await log(runId, "signal-collector", "info",
    "Loaded " + sources.length + " active watchlist sources");

  var allSignals = [];

  for (var i = 0; i < sources.length; i++) {
    var source = sources[i];
    try {
      var sourceSignals = [];

      switch (source.source_type) {
        case "competitor_page":
          sourceSignals = await collectPageSignals(source, "concurrent", runId);
          break;

        case "influencer":
          sourceSignals = await collectPageSignals(source, "influenceur", runId);
          break;

        case "keyword":
          sourceSignals = await collectKeywordSignals(source, runId);
          break;

        case "job_keyword":
          sourceSignals = await collectJobSignals(source, runId);
          break;

        default:
          await log(runId, "signal-collector", "warn",
            "Unknown source_type: " + source.source_type,
            { source_id: source.id });
          continue;
      }

      await log(runId, "signal-collector", "info",
        "Source '" + (source.source_label || source.source_type) + "' collected " + sourceSignals.length + " signals");

      allSignals = allSignals.concat(sourceSignals);

    } catch (err) {
      // Error isolation: one failing source does not crash collection
      await log(runId, "signal-collector", "error",
        "Source '" + (source.source_label || source.source_type) + "' failed: " + err.message,
        { source_id: source.id, source_type: source.source_type });
    }
  }

  await log(runId, "signal-collector", "info",
    "Total signals collected: " + allSignals.length + " from " + sources.length + " sources");

  return allSignals;
}

module.exports = { collectSignals };
