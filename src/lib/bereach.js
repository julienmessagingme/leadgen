/**
 * BeReach API wrapper.
 * Centralized wrapper for all BeReach API calls with Bearer auth and error handling.
 * Uses Node 20 built-in fetch (no extra dependency).
 */

const BEREACH_BASE = "https://api.berea.ch";

/**
 * Sleep helper for rate limiting between API calls.
 * @param {number} ms - Milliseconds to wait
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Internal function: POST to BeReach API with Bearer auth.
 * @param {string} endpoint - API endpoint path (e.g. /collect/linkedin/likes)
 * @param {object} body - Request body
 * @returns {Promise<object>} Parsed JSON response
 */
async function bereach(endpoint, body = {}) {
  const apiKey = process.env.BEREACH_API_KEY;
  if (!apiKey) {
    throw new Error("BEREACH_API_KEY is not set in environment");
  }

  const res = await fetch(BEREACH_BASE + endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    var errBody = await res.json().catch(() => ({}));
    // If it's a per-minute rate limit (not daily exhausted), retry after delay
    var daily = errBody.error && errBody.error.daily;
    if (daily && daily.current >= daily.limit) {
      throw new Error("BeReach daily limit exhausted (" + daily.current + "/" + daily.limit + ")");
    }
    var wait = (errBody.error && errBody.error.retryAfter) || 5;
    await new Promise(function(r) { setTimeout(r, wait * 1000); });
    // Retry once with original request body
    var retry = await fetch(BEREACH_BASE + endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!retry.ok) {
      var retryText = await retry.text();
      throw new Error("BeReach " + endpoint + " failed after retry (" + retry.status + "): " + retryText);
    }
    return retry.json();
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error("BeReach " + endpoint + " failed (" + res.status + "): " + text);
  }

  return res.json();
}

/**
 * Collect likers of a LinkedIn post.
 * @param {string} postUrl - LinkedIn post URL
 */
async function collectPostLikers(postUrl) {
  return bereach("/collect/linkedin/likes", { postUrl: postUrl });
}

/**
 * Collect commenters of a LinkedIn post.
 * @param {string} postUrl - LinkedIn post URL
 */
async function collectPostCommenters(postUrl) {
  return bereach("/collect/linkedin/comments", { postUrl: postUrl });
}

/**
 * Search LinkedIn posts by keywords.
 * @param {string} keywords - Search keywords
 */
async function searchPostsByKeywords(keywords) {
  return bereach("/search/linkedin/posts", { keywords });
}

/**
 * Search LinkedIn jobs by keywords.
 * @param {string} keywords - Search keywords
 */
async function searchJobs(keywords) {
  return bereach("/search/linkedin/jobs", { keywords });
}

/**
 * Collect recent posts from a LinkedIn profile.
 * @param {string} profileUrl - LinkedIn profile URL (must be /in/ URL)
 */
async function collectProfilePosts(profileUrl) {
  return bereach("/collect/linkedin/posts", { profileUrl: profileUrl });
}

/**
 * Visit a LinkedIn profile for enrichment data.
 * @param {string} profileUrl - LinkedIn profile URL
 */
async function visitProfile(profileUrl, options) {
  var body = { profile: profileUrl };
  if (options && options.includePosts) body.includePosts = true;
  if (options && options.includeComments) body.includeComments = true;
  return bereach("/visit/linkedin/profile", body);
}

/**
 * Visit a LinkedIn company page for enrichment data.
 * @param {string} companyUrl - LinkedIn company URL
 */
async function visitCompany(companyUrl) {
  return bereach("/visit/linkedin/company", { companyUrl: companyUrl });
}

/**
 * Check current BeReach API usage limits.
 */
async function checkLimits() {
  return bereach("/me/limits");
}


/**
 * Send a LinkedIn connection request to a profile.
 * @param {string} profileUrl - LinkedIn profile URL
 * @param {string|null} note - Optional invitation note (max 280 chars)
 */
async function connectProfile(profileUrl, note) {
  const body = { profile: profileUrl };
  if (note) {
    body.note = note.substring(0, 280);
  }
  return bereach("/connect/linkedin/profile", body);
}

/**
 * Get sent LinkedIn invitations (pending).
 */
async function getSentInvitations() {
  return bereach("/invitations/linkedin/sent", {});
}

/**
 * Send a LinkedIn message to a profile.
 * @param {string} profileUrl - LinkedIn profile URL
 * @param {string} text - Message text
 */
async function sendMessage(profileUrl, text) {
  return bereach("/message/linkedin", { profile: profileUrl, message: text });
}

/**
 * Search LinkedIn inbox by keyword.
 * @param {string} keyword - Search keyword
 */
async function searchInbox(keyword) {
  return bereach("/chats/linkedin/search", { keyword });
}

module.exports = {
  collectPostLikers,
  collectPostCommenters,
  collectProfilePosts,
  searchPostsByKeywords,
  searchJobs,
  visitProfile,
  visitCompany,
  checkLimits,
  sleep,
  connectProfile,
  getSentInvitations,
  sendMessage,
  searchInbox,
};
