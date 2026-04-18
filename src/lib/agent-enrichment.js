/**
 * Deterministic enrichment for the AI Agent cold pipeline.
 *
 * Replaces the previous agent-based Qualifier that had tool access and could
 * hang on timeouts, silently skip candidates, or pre-filter without enriching.
 *
 * This module runs in pure Node (no LLM) and enriches a batch of candidates
 * in parallel with bounded concurrency. Every candidate gets the same
 * treatment: visit profile + visit company + find email. Failures are
 * captured per-candidate without blocking the rest. Output is predictable
 * (credit cost = 3 × N candidates, modulo FullEnrich skips).
 *
 * The Qualifier LLM then receives pre-enriched data as pure text and only
 * has to apply the 5 checks — no tools, no hang, no drops.
 */

const { visitProfile, visitCompany } = require("./bereach");
const { enrichContactInfo } = require("./fullenrich");
const { log } = require("./logger");

/**
 * Run a set of async tasks with a concurrency cap. Mirrors p-limit semantics.
 */
async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        results[i] = await mapper(items[i], i);
      } catch (err) {
        results[i] = { _error: err && err.message ? err.message.slice(0, 200) : String(err) };
      }
    }
  }
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(() => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Enrich a single candidate with profile + company + email data.
 * Returns { profile, company, email, errors } with partial data on failure.
 *
 * We capture errors per-field so the downstream Qualifier can still decide
 * based on whatever we managed to get.
 */
async function enrichOneCandidate(candidate, runId) {
  const out = {
    profile: null,
    company: null,
    email: null,
    email_status: null,
    errors: {},
  };

  // 1. Profile visit (1 BeReach credit)
  if (candidate.linkedin_url) {
    try {
      const profile = await visitProfile(candidate.linkedin_url, {});
      // Keep the useful fields compact to avoid ballooning the Qualifier prompt.
      out.profile = profile ? {
        headline: profile.headline || candidate.headline || null,
        summary: (profile.summary || "").slice(0, 400) || null,
        experience: Array.isArray(profile.experience) ? profile.experience.slice(0, 3).map((e) => ({
          title: e.title, company: e.company, duration: e.duration,
        })) : null,
        location: profile.location || candidate.location || null,
        recent_posts: Array.isArray(profile.posts) ? profile.posts.slice(0, 3).map((p) => (p.text || "").slice(0, 200)) : null,
        company_linkedin_url: profile.currentCompany && profile.currentCompany.url,
      } : null;
    } catch (err) {
      out.errors.profile = (err && err.message || String(err)).slice(0, 120);
    }
  }

  // 2. Company visit (1 BeReach credit) — use the company URL from the profile if we got one
  const companyUrl = (out.profile && out.profile.company_linkedin_url) || null;
  if (companyUrl) {
    try {
      const company = await visitCompany(companyUrl);
      out.company = company ? {
        name: company.name || candidate.company || null,
        sector: company.industry || null,
        size: company.employeeCount || null,
        location: company.headquarter || null,
        description: (company.description || company.summary || "").slice(0, 300) || null,
        website: company.website || null,
      } : null;
    } catch (err) {
      out.errors.company = (err && err.message || String(err)).slice(0, 120);
    }
  } else if (candidate.company) {
    // No company URL from profile — use the name the Researcher gave us
    out.company = { name: candidate.company, sector: null, size: null, location: null, description: null, website: null };
  }

  // 3. Email lookup via FullEnrich (1 credit when DELIVERABLE found)
  if (candidate.linkedin_url) {
    try {
      const enrichResult = await enrichContactInfo(candidate.linkedin_url, runId);
      if (enrichResult && enrichResult.email) {
        out.email = enrichResult.email;
        out.email_status = "found";
      } else {
        out.email_status = "not_found";
      }
    } catch (err) {
      out.email_status = "error";
      out.errors.email = (err && err.message || String(err)).slice(0, 120);
    }
  }

  return out;
}

/**
 * Enrich a list of candidates in parallel with a concurrency cap.
 *
 * @param {Array} candidates - list of { full_name, linkedin_url, company, ... }
 * @param {Object} opts
 * @param {string} opts.runId - for logging
 * @param {number} [opts.concurrency=3] - max concurrent enrichments (BeReach rate limits)
 * @returns {Promise<{enriched, stats}>}
 */
async function enrichAllCandidates(candidates, opts = {}) {
  const { runId = null, concurrency = 3 } = opts;
  const startMs = Date.now();

  if (runId) {
    await log(runId, "enrichment", "info",
      "Starting deterministic enrichment of " + candidates.length + " candidates " +
      "(concurrency=" + concurrency + ", ~" + (candidates.length * 3) + " BeReach credits + " +
      candidates.length + " FullEnrich credits)");
  }

  const enriched = await mapWithConcurrency(candidates, concurrency, async (c, idx) => {
    const data = await enrichOneCandidate(c, runId);
    if (runId && (idx + 1) % 5 === 0) {
      await log(runId, "enrichment", "info",
        "Enriched " + (idx + 1) + "/" + candidates.length + " candidates");
    }
    return {
      ...c,
      enrichment: data,
    };
  });

  const stats = {
    total: candidates.length,
    with_email: enriched.filter((e) => e.enrichment && e.enrichment.email).length,
    with_profile: enriched.filter((e) => e.enrichment && e.enrichment.profile).length,
    with_company: enriched.filter((e) => e.enrichment && e.enrichment.company).length,
    email_not_found: enriched.filter((e) => e.enrichment && e.enrichment.email_status === "not_found").length,
    errors: enriched.reduce((acc, e) => acc + Object.keys((e.enrichment && e.enrichment.errors) || {}).length, 0),
    duration_ms: Date.now() - startMs,
  };

  if (runId) {
    await log(runId, "enrichment", "info",
      "Enrichment done in " + Math.round(stats.duration_ms / 1000) + "s. " +
      stats.with_profile + "/" + stats.total + " profiles, " +
      stats.with_company + "/" + stats.total + " companies, " +
      stats.with_email + "/" + stats.total + " emails, " +
      stats.errors + " partial errors.");
  }

  return { enriched, stats };
}

module.exports = { enrichAllCandidates, enrichOneCandidate };
