/**
 * BeReach tools exposed to Claude agents in Anthropic tool_use format.
 *
 * Each tool has:
 *   - definition: { name, description, input_schema } — passed to messages.create()
 *   - handler: async (input) => result — executed locally when Claude calls it
 *
 * Tools are grouped by ROLE so each agent only sees what it needs:
 *   - RESEARCHER_TOOLS: search + identify (no enrichment, no email, no outreach)
 *   - QUALIFIER_TOOLS:  enrich + profile visit (no search, no outreach)
 *   - CHALLENGER_TOOLS: none (pure reasoning, no external calls)
 */

const {
  searchPeople,
  searchCompanies,
  visitProfile,
  visitCompany,
  collectPostLikers,
  collectPostComments,
} = require("./bereach");
const { enrichContactInfo } = require("./fullenrich");
const { canonicalizeLinkedInUrl } = require("./url-utils");
const { supabase } = require("./supabase");

// ═══════════════════════════════════════════════════════════
// RESEARCHER TOOLS — search + identify, no enrichment
// ═══════════════════════════════════════════════════════════

const searchPeopleTool = {
  definition: {
    name: "bereach_search_people",
    description: `Search LinkedIn profiles by criteria. Returns up to 25 profiles per call.

IMPORTANT FILTER RULES:
- location: use CITY names (Marseille, Nice, Lyon), NOT region abbreviations (PACA, IDF). If the brief mentions a region, decompose into main cities and run multiple searches.
- industry: use ENGLISH LinkedIn industry names (Transportation, Insurance, Retail, Banking, Hospitality). The tool auto-translates French but it's less reliable.
- companySize: use letter codes — A=1-10, B=11-50, C=51-200, D=201-500, E=501-1000, F=1001-5000, G=5001-10000, H=10001+. For "200+ employees" pass ["D","E","F","G","H"].
- keywords: free text for job title/skill matching. Use this to target specific roles (e.g. "Directeur Relation Client").

The response includes a _warnings[] array when a filter didn't resolve on LinkedIn. READ THEM and adapt your next search (e.g. try a different city name, translate the industry to English, etc).

Strategy tip: do MULTIPLE targeted searches rather than one broad one. For example, for "transporteurs PACA 200+", search separately for Marseille, Nice, Aix-en-Provence with each search focused.`,
    input_schema: {
      type: "object",
      properties: {
        keywords: { type: "string", description: "Job title or skill keywords (e.g. 'Directeur Digital')" },
        company: { type: "string", description: "Company name to filter (optional)" },
        location: { type: "string", description: "City name for geo filter (e.g. 'Marseille', 'Nice')" },
        industry: { type: "string", description: "Industry in English (e.g. 'Transportation', 'Insurance')" },
        companySize: {
          oneOf: [
            { type: "string", description: "Single size code (A-I)" },
            { type: "array", items: { type: "string" }, description: "Multiple size codes" },
          ],
          description: "Company size codes: A=1-10..H=10001+",
        },
        count: { type: "integer", description: "Max results (default 25, max 100)" },
      },
    },
  },
  handler: async (input) => {
    const result = await searchPeople({
      keywords: input.keywords,
      company: input.company,
      location: input.location,
      industry: input.industry,
      companySize: input.companySize,
      count: input.count || 25,
    });
    // Flatten to essentials for the agent (keep token usage sane)
    const items = result.items || result.profiles || result.results || [];
    return {
      count: items.length,
      _warnings: result._warnings || [],
      profiles: items.slice(0, 50).map((p) => ({
        full_name: p.fullName || p.name || null,
        first_name: p.firstName || null,
        last_name: p.lastName || null,
        headline: p.headline || null,
        location: p.location || null,
        linkedin_url: p.profileUrl || p.linkedin_url || null,
        company: p.companyName || p.company || null,
      })),
    };
  },
};

const searchCompaniesTool = {
  definition: {
    name: "bereach_search_companies",
    description: `Search LinkedIn company pages by keywords. Returns company names + profile URLs. Use this to find target companies before searching for their decision-makers with bereach_search_people.`,
    input_schema: {
      type: "object",
      properties: {
        keywords: { type: "string", description: "Company name or sector keywords" },
        count: { type: "integer", description: "Max results (default 10)" },
      },
      required: ["keywords"],
    },
  },
  handler: async (input) => {
    const result = await searchCompanies(input.keywords, input.count || 10);
    const items = result.items || result.companies || result.results || [];
    return {
      count: items.length,
      companies: items.map((c) => ({
        name: c.name || null,
        profile_url: c.profileUrl || null,
        industry: c.industry || null,
        employee_count: c.employeeCount || null,
        description: (c.summary || c.description || "").slice(0, 200),
        location: c.headquarter || c.location || null,
      })),
    };
  },
};

const visitCompanyTool = {
  definition: {
    name: "bereach_visit_company",
    description: `Get detailed info about a LinkedIn company page. Returns description, size, sector, specialities, website, recent news. Use this to verify a company matches the ICP before searching for its people. Costs 1 BeReach credit.`,
    input_schema: {
      type: "object",
      properties: {
        company_url: { type: "string", description: "LinkedIn company page URL (e.g. https://www.linkedin.com/company/keolis/)" },
      },
      required: ["company_url"],
    },
  },
  handler: async (input) => {
    const result = await visitCompany(input.company_url);
    return {
      name: result.name || null,
      industry: result.industry || result.sector || null,
      employee_count: result.employeeCount || result.size || null,
      employee_range: result.employeeCountRange || null,
      description: (result.description || "").slice(0, 500),
      specialities: result.specialities || [],
      website: result.websiteUrl || null,
      headquarter: result.headquarter || result.location || null,
      founded: result.foundedOn ? result.foundedOn.year : null,
      follower_count: result.followerCount || null,
    };
  },
};

const collectLikersTool = {
  definition: {
    name: "bereach_collect_likers",
    description: `Collect people who liked a specific LinkedIn post. Returns up to 100 profiles. Useful to find people actively engaged with topics relevant to your ICP. Costs 1 BeReach credit.`,
    input_schema: {
      type: "object",
      properties: {
        post_url: { type: "string", description: "LinkedIn post URL" },
      },
      required: ["post_url"],
    },
  },
  handler: async (input) => {
    const result = await collectPostLikers(input.post_url);
    const items = result.items || result.likers || result.results || [];
    return {
      count: items.length,
      profiles: items.slice(0, 100).map((p) => ({
        full_name: p.fullName || p.name || null,
        headline: p.headline || null,
        linkedin_url: p.profileUrl || null,
        company: p.companyName || null,
      })),
    };
  },
};

const collectCommentsTool = {
  definition: {
    name: "bereach_collect_comments",
    description: `Collect people who commented on a specific LinkedIn post, with their comment text. Returns up to 100 profiles + comments. Costs 1 BeReach credit.`,
    input_schema: {
      type: "object",
      properties: {
        post_url: { type: "string", description: "LinkedIn post URL" },
      },
      required: ["post_url"],
    },
  },
  handler: async (input) => {
    const result = await collectPostComments(input.post_url);
    const items = result.items || result.comments || result.results || [];
    return {
      count: items.length,
      comments: items.slice(0, 100).map((c) => ({
        full_name: c.fullName || c.name || null,
        headline: c.headline || null,
        linkedin_url: c.profileUrl || null,
        company: c.companyName || null,
        comment_text: (c.text || c.comment || "").slice(0, 200),
      })),
    };
  },
};

// ═══════════════════════════════════════════════════════════
// QUALIFIER TOOLS — enrich profiles + emails, no search
// ═══════════════════════════════════════════════════════════

const visitProfileTool = {
  definition: {
    name: "bereach_visit_profile",
    description: `Get detailed LinkedIn profile data: full headline, current position, recent posts, recent comments. Costs 1 BeReach credit. Use this to enrich a candidate before qualifying.`,
    input_schema: {
      type: "object",
      properties: {
        profile_url: { type: "string", description: "LinkedIn profile URL" },
      },
      required: ["profile_url"],
    },
  },
  handler: async (input) => {
    const result = await visitProfile(input.profile_url, { includePosts: true, includeComments: true });
    return {
      full_name: result.fullName || result.name || null,
      headline: result.headline || null,
      location: result.location || null,
      company: result.companyName || null,
      company_url: result.companyUrl || null,
      connections: result.connectionsCount || null,
      recent_posts: (result.lastPosts || []).slice(0, 5).map((p) => ({
        text: (p.text || "").slice(0, 300),
        url: p.postUrl || null,
        likes: p.likesCount || 0,
        date: p.postedAt || null,
      })),
      recent_comments: (result.lastComments || []).slice(0, 5).map((c) => ({
        text: (c.text || "").slice(0, 200),
        target_post_author: c.targetPostAuthor || null,
      })),
    };
  },
};

const enrichEmailTool = {
  definition: {
    name: "fullenrich_email",
    description: `Find a prospect's professional email address via FullEnrich. Async: takes 30-60 seconds (polling). Costs 1 FullEnrich credit. Returns the email only if deliverable. Use this ONLY on candidates that passed the ICP checks — don't waste credits on unqualified leads.`,
    input_schema: {
      type: "object",
      properties: {
        linkedin_url: { type: "string", description: "LinkedIn profile URL" },
      },
      required: ["linkedin_url"],
    },
  },
  handler: async (input) => {
    const result = await enrichContactInfo(input.linkedin_url, null);
    if (!result) return { email: null, status: "not_found" };
    return {
      email: result.email || null,
      phone: result.phone || null,
      confidence: result.confidence || null,
      status: result.email ? "found" : "not_found",
    };
  },
};

// ═══════════════════════════════════════════════════════════
// TOOL SETS PER AGENT ROLE
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// DEDUP TOOL — batch URL check against known leads in DB
// ═══════════════════════════════════════════════════════════

const checkKnownLeadsTool = {
  definition: {
    name: "check_known_leads",
    description: `Batch-check a list of LinkedIn profile URLs against the leadgen DB. Returns which URLs are ALREADY in our pipeline (duplicates — do NOT propose them) and which are NEW (fair game).

Use this AFTER a search returns profiles, BEFORE committing them to your final candidate list. Free to call (no BeReach credits, just a DB query). Pass up to 50 URLs per call.

This replaces the old "check the known_leads list manually" instruction — now you HAVE a tool for it.`,
    input_schema: {
      type: "object",
      properties: {
        linkedin_urls: {
          type: "array",
          items: { type: "string" },
          description: "Array of LinkedIn profile URLs (up to 50)",
        },
      },
      required: ["linkedin_urls"],
    },
  },
  handler: async (input) => {
    const urls = Array.isArray(input.linkedin_urls) ? input.linkedin_urls.slice(0, 50) : [];
    if (urls.length === 0) return { known: [], new: [], total_checked: 0 };

    const canonicals = urls
      .map((u) => ({ original: u, canonical: canonicalizeLinkedInUrl(u) }))
      .filter((x) => x.canonical);

    if (canonicals.length === 0) return { known: [], new: urls, total_checked: urls.length };

    const { data, error } = await supabase
      .from("leads")
      .select("linkedin_url_canonical, status, metadata")
      .in("linkedin_url_canonical", canonicals.map((c) => c.canonical));

    if (error) {
      return { error: error.message, known: [], new: urls, total_checked: urls.length };
    }

    const knownSet = new Set((data || []).map((r) => r.linkedin_url_canonical));
    const known = [];
    const newOnes = [];
    for (const c of canonicals) {
      if (knownSet.has(c.canonical)) known.push(c.original);
      else newOnes.push(c.original);
    }

    return {
      total_checked: urls.length,
      known_count: known.length,
      new_count: newOnes.length,
      known,
      new: newOnes,
    };
  },
};

const RESEARCHER_TOOLS = [
  searchPeopleTool,
  searchCompaniesTool,
  visitCompanyTool,
  collectLikersTool,
  collectCommentsTool,
  checkKnownLeadsTool,
];

const QUALIFIER_TOOLS = [
  visitProfileTool,
  visitCompanyTool,
  enrichEmailTool,
];

const CHALLENGER_TOOLS = []; // No tools — pure reasoning

/**
 * Get tool definitions (for messages.create({ tools }))
 */
function getToolDefinitions(toolSet) {
  return toolSet.map((t) => t.definition);
}

/**
 * Get tool handlers map (for runAgent({ toolHandlers }))
 */
function getToolHandlers(toolSet) {
  const map = {};
  for (const t of toolSet) {
    map[t.definition.name] = t.handler;
  }
  return map;
}

module.exports = {
  RESEARCHER_TOOLS,
  QUALIFIER_TOOLS,
  CHALLENGER_TOOLS,
  getToolDefinitions,
  getToolHandlers,
};
