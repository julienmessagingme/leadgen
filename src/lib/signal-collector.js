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
  collectProfilePosts,
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
      source_origin: "bereach",
      post_text: p.post_text || null,
      post_url: p.post_url || null,
      comment_text: p.comment_text || null,
      post_author_name: p.post_author_name || null,
      post_author_headline: p.post_author_headline || null,
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

  // Get recent posts using the right BeReach endpoint:
  // - Influencer (/in/ URL) → collectProfilePosts with the actual LinkedIn URL
  // - Company (/company/ URL) → searchPostsByKeywords with the source label (no direct API)
  var postsResult;
  var sourceDesc;
  if (source.source_url && source.source_url.includes("linkedin.com/in/")) {
    // Influencer: use direct profile posts endpoint with LinkedIn URL
    sourceDesc = source.source_url;
    postsResult = await collectProfilePosts(source.source_url);
  } else if (source.source_url && source.source_url.includes("linkedin.com/company/")) {
    // Company page: use source_label for keyword search (no company posts endpoint in BeReach)
    sourceDesc = source.source_label;
    postsResult = await searchPostsByKeywords(source.source_label);
  } else {
    sourceDesc = source.source_label;
    postsResult = await searchPostsByKeywords(source.source_label);
  }
  await rateLimitDelay(1000, 3000);

  // Extract posts from search results
  var posts = Array.isArray(postsResult) ? postsResult : (postsResult.items || postsResult.posts || postsResult.results || []);

  if (posts.length === 0) {
    await log(runId, "signal-collector", "info",
      "No posts found for " + signalCategory + " source: " + sourceDesc);
    return signals;
  }

  // Filter out already-scraped posts (avoid wasting credits on same posts)
  var newPosts = [];
  for (var p = 0; p < posts.length; p++) {
    var pUrl = posts[p].postUrl || posts[p].url || posts[p].post_url;
    if (!pUrl) continue;
    var { data: existing } = await supabase.from("scraped_posts").select("id").eq("post_url", pUrl).limit(1);
    if (!existing || existing.length === 0) {
      newPosts.push(posts[p]);
    }
  }

  if (newPosts.length === 0) {
    await log(runId, "signal-collector", "info",
      "All posts already scraped for " + signalCategory + " source: " + sourceDesc + " (" + posts.length + " posts seen)");
    return signals;
  }

  // Pick the best new post: highest engagement (likes + comments)
  newPosts.sort(function(a, b) {
    var engA = (a.likesCount || 0) + (a.commentsCount || 0);
    var engB = (b.likesCount || 0) + (b.commentsCount || 0);
    return engB - engA;
  });
  var bestPost = newPosts[0];
  var postUrl = bestPost.postUrl || bestPost.url || bestPost.post_url;
  var postText = (bestPost.text || "").substring(0, 300);

  // Extract post author info
  var postAuthor = bestPost.author || {};
  var postAuthorName = postAuthor.firstName && postAuthor.lastName
    ? postAuthor.firstName + " " + postAuthor.lastName
    : postAuthor.name || bestPost.authorName || bestPost.name || null;
  var postAuthorHeadline = postAuthor.headline || bestPost.authorHeadline || null;

  // Mark as scraped
  var _sp = await supabase.from("scraped_posts").insert({ post_url: postUrl, source_id: source.id }); // ignore errors

  // Collect likers (1 credit)
  try {
    var likers = await collectPostLikers(postUrl);
    await rateLimitDelay(1000, 3000);
    var likerProfiles = Array.isArray(likers) ? likers : (likers.items || likers.profiles || likers.results || []);
    // Inject post context + author into each liker profile
    likerProfiles.forEach(function(lp) { lp.post_text = postText; lp.post_url = postUrl; lp.post_author_name = postAuthorName; lp.post_author_headline = postAuthorHeadline; });
    var likerSignals = formatSignals(likerProfiles, "like", signalCategory, source);
    signals = signals.concat(likerSignals);
  } catch (err) {
    await log(runId, "signal-collector", "warn",
      "Failed to collect likers for post: " + err.message, { postUrl: postUrl });
  }

  // Collect commenters (1 credit)
  try {
    var commenters = await collectPostCommenters(postUrl);
    await rateLimitDelay(1000, 3000);
    var commenterProfiles = Array.isArray(commenters) ? commenters : (commenters.items || commenters.profiles || commenters.results || []);
    // Inject post context + comment text + author into each commenter
    commenterProfiles.forEach(function(cp) { cp.post_text = postText; cp.post_url = postUrl; cp.comment_text = cp.text || cp.comment || null; cp.post_author_name = postAuthorName; cp.post_author_headline = postAuthorHeadline; });
    var commenterSignals = formatSignals(commenterProfiles, "comment", signalCategory, source);
    signals = signals.concat(commenterSignals);
  } catch (err) {
    await log(runId, "signal-collector", "warn",
      "Failed to collect commenters for post: " + err.message, { postUrl: postUrl });
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
  var kw = Array.isArray(source.keywords) ? source.keywords.join(" ") : (source.keywords || source.source_label);
  var result = await searchPostsByKeywords(kw);
  await rateLimitDelay(1000, 3000);

  var posts = Array.isArray(result) ? result : (result.items || result.posts || result.results || []);

  // Extract post authors as profiles, keeping post context
  var authors = posts
    .filter(function (p) { return p.author || p.profileUrl || p.profile_url; })
    .map(function (p) {
      var postText = (p.text || "").substring(0, 300);
      return {
        profileUrl: p.author ? (p.author.profileUrl || p.author.url) : (p.profileUrl || p.profile_url),
        firstName: p.author ? (p.author.firstName || p.author.first_name) : (p.firstName || p.first_name),
        lastName: p.author ? (p.author.lastName || p.author.last_name) : (p.lastName || p.last_name),
        name: p.author ? p.author.name : p.name,
        headline: p.author ? p.author.headline : p.headline,
        company: p.author ? p.author.company : p.company,
        post_text: postText,
        post_url: p.postUrl || p.url || p.post_url || null,
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

  var kw = Array.isArray(source.keywords) ? source.keywords.join(" ") : (source.keywords || source.source_label);
  var result = await searchJobs(kw);
  await rateLimitDelay(1000, 3000);

  var jobs = Array.isArray(result) ? result : (result.items || result.jobs || result.results || []);

  // Limit to first 2 jobs to control credit consumption (1 searchJobs + 2 DM searches = 3 credits max)
  var maxJobs = 2;
  for (var i = 0; i < Math.min(jobs.length, maxJobs); i++) {
    var job = jobs[i];
    var companyName = job.company || job.companyName || job.company_name;
    var jobTitle = job.title || job.jobTitle || job.job_title || "unknown";

    if (!companyName) continue;

    try {
      // Decision-maker lookup: search for CX/digital executives at this company
      var dmQuery = "\"" + companyName + "\" AND (\"directeur experience client\" OR \"head of CX\" OR \"directeur digital\" OR \"chief digital officer\" OR \"VP customer experience\")";
      var dmResult = await searchPostsByKeywords(dmQuery);
      await rateLimitDelay(1000, 3000);

      var dmPosts = Array.isArray(dmResult) ? dmResult : (dmResult.items || dmResult.posts || dmResult.results || []);

      // Extract profiles from search results that match the hiring company
      var decisionMakers = dmPosts
        .filter(function (p) {
          var authorCompany = (p.author && p.author.company) || p.company || p.companyName || "";
          return authorCompany.toLowerCase().indexOf(companyName.toLowerCase()) !== -1;
        })
        .map(function (p) {
          var postText = (p.text || "").substring(0, 300);
          return {
            profileUrl: p.author ? (p.author.profileUrl || p.author.url) : (p.profileUrl || p.profile_url),
            firstName: p.author ? (p.author.firstName || p.author.first_name) : (p.firstName || p.first_name),
            lastName: p.author ? (p.author.lastName || p.author.last_name) : (p.lastName || p.last_name),
            name: p.author ? p.author.name : p.name,
            headline: p.author ? p.author.headline : p.headline,
            company: companyName,
            post_text: postText,
            post_url: p.postUrl || p.url || p.post_url || null,
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
  // ══════════════════════════════════════════════════════════════
  // SMART COLLECTION STRATEGY (priority from DB column `priority`)
  // ══════════════════════════════════════════════════════════════
  // Budget: 280 credits/day (safety margin on 300 limit)
  //
  // P1 (every day, ~1 credit each): keywords + job_keywords
  // P2 (rotation prioritaire, ~3 credits each): FR concurrents/influenceurs
  // P3 (rotation secondaire, ~3 credits each): international/low priority
  //
  // P2 passe avant P3 sur le budget restant après P1.
  // Rotation oldest-first (last_scraped_at ASC).
  // ══════════════════════════════════════════════════════════════

  var DAILY_SCRAPING_BUDGET = 300; // BeReach daily limit = 300 credits
  var creditsUsed = 0;

  // Load all active sources (with priority column from DB)
  var { data: allSources, error } = await supabase
    .from("watchlist")
    .select("id, source_type, source_label, source_url, keywords, sequence_id, last_scraped_at, priority")
    .eq("is_active", true);

  if (error) {
    await log(runId, "signal-collector", "error", "Failed to load watchlist: " + error.message);
    return [];
  }

  if (!allSources || allSources.length === 0) {
    await log(runId, "signal-collector", "info", "No active watchlist sources found");
    return [];
  }

  // Split into priority groups from DB column (P1/P2/P3)
  var priority1 = allSources.filter(function(s) { return s.priority === "P1"; });
  var priority2 = allSources.filter(function(s) { return s.priority === "P2"; });
  var priority3 = allSources.filter(function(s) { return s.priority === "P3"; });

  // Sort P2 and P3 by last_scraped_at ASC (oldest first = rotation)
  function sortByOldest(arr) {
    arr.sort(function(a, b) {
      if (!a.last_scraped_at && !b.last_scraped_at) return 0;
      if (!a.last_scraped_at) return -1;
      if (!b.last_scraped_at) return 1;
      return new Date(a.last_scraped_at) - new Date(b.last_scraped_at);
    });
  }
  sortByOldest(priority2);
  sortByOldest(priority3);

  await log(runId, "signal-collector", "info",
    "Loaded " + allSources.length + " sources: " +
    priority1.length + " P1 (daily) + " +
    priority2.length + " P2 (rotation prioritaire) + " +
    priority3.length + " P3 (rotation secondaire). Budget: " + DAILY_SCRAPING_BUDGET);

  var allSignals = [];
  var sourcesProcessed = 0;

  // ── HELPER: process a single source ──
  async function processSource(source) {
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
    }
    return sourceSignals;
  }

  // ── PRIORITY 1: Keywords + Job keywords (every day) ──
  await log(runId, "signal-collector", "info",
    "── Priority 1: " + priority1.length + " keyword/job sources (daily) ──");

  for (var i = 0; i < priority1.length; i++) {
    var source = priority1[i];

    // job_keyword costs ~3 credits (1 searchJobs + 2 DM searches), keyword costs 1
    var sourceCost = source.source_type === "job_keyword" ? 3 : 1;
    if (creditsUsed + sourceCost > DAILY_SCRAPING_BUDGET) {
      await log(runId, "signal-collector", "info",
        "Budget exhausted during priority 1 at " + creditsUsed + " credits");
      break;
    }

    try {
      var signals = await processSource(source);
      creditsUsed += sourceCost;
      sourcesProcessed++;
      allSignals = allSignals.concat(signals);

      await log(runId, "signal-collector", "info",
        "[P1] '" + source.source_label + "' → " + signals.length +
        " signals (credits: " + creditsUsed + "/" + DAILY_SCRAPING_BUDGET + ")");

      await supabase.from("watchlist").update({ last_scraped_at: new Date().toISOString() }).eq("id", source.id);

    } catch (err) {
      if (err.message && err.message.includes("daily limit exhausted")) {
        await log(runId, "signal-collector", "warn",
          "BeReach daily limit reached after " + creditsUsed + " credits. Stopping collection.");
        return allSignals;
      }
      await log(runId, "signal-collector", "error",
        "[P1] '" + source.source_label + "' failed: " + err.message);
      creditsUsed += sourceCost;
    }
  }

  // ── Helper: process a priority group with rotation ──
  async function processGroup(label, sources, creditsPerSource) {
    var processed = 0;
    await log(runId, "signal-collector", "info",
      "── " + label + ": " + sources.length + " sources (rotation) ──");

    for (var j = 0; j < sources.length; j++) {
      if (creditsUsed + creditsPerSource > DAILY_SCRAPING_BUDGET) {
        await log(runId, "signal-collector", "info",
          label + " budget exhausted at " + creditsUsed + " credits. " +
          (sources.length - j) + " sources deferred.");
        break;
      }

      var src = sources[j];
      try {
        var sigs = await processSource(src);
        creditsUsed += creditsPerSource;
        sourcesProcessed++;
        processed++;
        allSignals = allSignals.concat(sigs);

        await log(runId, "signal-collector", "info",
          "[" + label + "] '" + src.source_label + "' → " + sigs.length +
          " signals (credits: " + creditsUsed + "/" + DAILY_SCRAPING_BUDGET + ")");

        await supabase.from("watchlist").update({ last_scraped_at: new Date().toISOString() }).eq("id", src.id);

      } catch (err) {
        if (err.message && err.message.includes("daily limit exhausted")) {
          await log(runId, "signal-collector", "warn",
            "BeReach daily limit reached during " + label + " after " + creditsUsed + " credits. Stopping.");
          return processed;
        }
        await log(runId, "signal-collector", "error",
          "[" + label + "] '" + src.source_label + "' failed: " + err.message);
        creditsUsed += creditsPerSource;
      }
    }
    return processed;
  }

  // ── PRIORITY 2: rotation prioritaire (FR influenceurs/concurrents) ──
  var p2Processed = await processGroup("P2", priority2, 3);

  // ── PRIORITY 3: rotation secondaire (international) ──
  var p3Processed = await processGroup("P3", priority3, 3);

  // ── SUMMARY ──
  var deferredP2 = priority2.length - p2Processed;
  var deferredP3 = priority3.length - p3Processed;
  await log(runId, "signal-collector", "info",
    "Collection complete: " + allSignals.length + " signals from " + sourcesProcessed + " sources. " +
    "Credits: ~" + creditsUsed + "/" + DAILY_SCRAPING_BUDGET + ". " +
    "P2 deferred: " + deferredP2 + ", P3 deferred: " + deferredP3 + ".");

  return allSignals;
}

module.exports = { collectSignals };
