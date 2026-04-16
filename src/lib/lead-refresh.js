/**
 * Lead refresh — fetches fresh LinkedIn data right before Sonnet generates
 * a follow-up email, so the prompt reflects the prospect's latest posts and
 * the latest company info, not the stale snapshot taken at pipeline entry.
 *
 * Used by POST /leads/:id/generate-followup-now. Kept outside the API route
 * so we can reuse it later (e.g. on-demand refresh button, warm re-scoring).
 *
 * Cost: up to 2 BeReach credits per call (1 profile visit + 1 company visit).
 * Gracefully degrades: if either call fails or a URL is missing, we just
 * skip that half and flag it in the summary so the caller can surface it.
 */

const { visitProfile, visitCompany } = require("./bereach");

/**
 * @param {object} lead - Raw lead row from Supabase (must include metadata)
 * @returns {Promise<{
 *   patch: { metadata: object, company_name?: string, company_size?: string, company_sector?: string, company_location?: string },
 *   summary: {
 *     profile_refreshed: boolean,
 *     company_refreshed: boolean,
 *     prospect_posts_count: number,
 *     prospect_comments_count: number,
 *     company_has_description: boolean,
 *     company_specialities_count: number,
 *     skipped: string[],  // reasons (e.g. "no_profile_url", "bereach_error")
 *   }
 * }>}
 */
async function refreshLeadForFollowup(lead) {
  if (!lead) throw new Error("lead is required");

  const existing = lead.metadata || {};
  const patchMeta = {};
  const summary = {
    profile_refreshed: false,
    company_refreshed: false,
    prospect_posts_count: 0,
    prospect_comments_count: 0,
    company_has_description: false,
    company_specialities_count: 0,
    skipped: [],
  };

  // Decode percent-encoded slugs once (BeReach rejects %C3%A9 on /visit/linkedin/company).
  function safeDecode(url) {
    if (!url) return null;
    try { return decodeURIComponent(url); } catch (_e) { return url; }
  }

  const profileUrl = lead.linkedin_url || null;
  const companyUrl = safeDecode(lead.company_linkedin_url);

  const [profileResult, companyResult] = await Promise.allSettled([
    profileUrl
      ? visitProfile(profileUrl, { includePosts: true, includeComments: true })
      : Promise.reject(new Error("no_profile_url")),
    companyUrl
      ? visitCompany(companyUrl)
      : Promise.reject(new Error("no_company_url")),
  ]);

  // ── Profile refresh ────────────────────────────────────────────────
  if (profileResult.status === "fulfilled" && profileResult.value) {
    const profile = profileResult.value;
    if (Array.isArray(profile.lastPosts) && profile.lastPosts.length > 0) {
      patchMeta.prospect_posts = profile.lastPosts.slice(0, 5).map((p) => ({
        text: String(p.text || "").substring(0, 300),
        url: p.postUrl || null,
        likes: p.likesCount || 0,
        comments: p.commentsCount || 0,
      }));
      summary.prospect_posts_count = patchMeta.prospect_posts.length;
    }
    if (Array.isArray(profile.lastComments) && profile.lastComments.length > 0) {
      patchMeta.prospect_comments = profile.lastComments.slice(0, 5).map((c) => ({
        targetPostText: String(c.targetPostText || "").substring(0, 300),
        targetPostAuthor: c.targetPostAuthor || null,
        type: c.type || "comment",
      }));
      summary.prospect_comments_count = patchMeta.prospect_comments.length;
    }
    patchMeta.profile_last_refreshed_at = new Date().toISOString();
    summary.profile_refreshed = true;
  } else {
    const reason = profileResult.status === "rejected"
      ? (profileResult.reason && profileResult.reason.message) || "bereach_profile_error"
      : "empty_profile";
    summary.skipped.push("profile:" + reason);
  }

  // ── Company refresh ────────────────────────────────────────────────
  const companyPatch = {};
  if (companyResult.status === "fulfilled" && companyResult.value) {
    const company = companyResult.value;

    if (company.name) companyPatch.company_name = company.name;
    if (company.employeeCount || company.size) {
      companyPatch.company_size = company.employeeCount || company.size;
    }
    if (company.industry || company.sector) {
      companyPatch.company_sector = company.industry || company.sector;
    }
    if (company.headquarter) {
      if (typeof company.headquarter === "object") {
        const hq = company.headquarter;
        companyPatch.company_location = [hq.city, hq.country].filter(Boolean).join(", ");
      } else if (typeof company.headquarter === "string") {
        companyPatch.company_location = company.headquarter;
      }
    } else if (company.location || company.headquarters) {
      companyPatch.company_location = company.location || company.headquarters;
    }

    if (company.description) {
      patchMeta.company_description = company.description;
      summary.company_has_description = true;
    }
    if (Array.isArray(company.specialities) && company.specialities.length > 0) {
      patchMeta.company_specialities = company.specialities;
      summary.company_specialities_count = company.specialities.length;
    }
    if (company.websiteUrl) patchMeta.company_website = company.websiteUrl;
    if (company.foundedOn && company.foundedOn.year) {
      patchMeta.company_founded = company.foundedOn.year;
    }
    if (company.employeeCountRange) patchMeta.company_employee_range = company.employeeCountRange;
    if (company.followerCount) patchMeta.company_follower_count = company.followerCount;

    patchMeta.company_last_refreshed_at = new Date().toISOString();
    summary.company_refreshed = true;
  } else {
    const reason = companyResult.status === "rejected"
      ? (companyResult.reason && companyResult.reason.message) || "bereach_company_error"
      : "empty_company";
    summary.skipped.push("company:" + reason);
  }

  return {
    patch: {
      // Merge fresh metadata on top of the existing one so we only overwrite
      // keys we actually refreshed. Caller is responsible for persisting.
      metadata: Object.assign({}, existing, patchMeta),
      ...companyPatch,
    },
    summary,
  };
}

module.exports = { refreshLeadForFollowup };
