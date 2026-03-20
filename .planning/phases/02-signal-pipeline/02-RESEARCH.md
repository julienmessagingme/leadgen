# Phase 2: Signal Pipeline - Research

**Researched:** 2026-03-20
**Domain:** LinkedIn signal detection (BeReach API), profile/company enrichment, company news, ICP scoring (Claude Haiku), URL canonicalization, HubSpot dedup
**Confidence:** HIGH

## Summary

Phase 2 implements the core signal detection and lead qualification pipeline. Task A (07h30) orchestrates four signal sources via BeReach API: competitor page likers/commenters, keyword-based post authors, influencer engagement, and job postings. Each detected lead goes through URL canonicalization, Supabase dedup, and HubSpot dedup before insertion. Enrichment uses BeReach `/visit/linkedin/profile` and `/visit/linkedin/company` with 48h cache, plus OpenClaw browser for Sales Navigator data. Company news is gathered via web search with verifiable evidence stored in `lead_news_evidence`. Finally, Claude Haiku 4.5 scores each lead against ICP rules from Supabase, assigning hot/warm/cold tiers with signal category weights and freshness TTL.

The pipeline is entirely server-side Node.js (CommonJS), building on the Phase 1 scheduler skeleton. Task A placeholder in `src/tasks/task-a-signals.js` gets replaced with the full pipeline. The architecture should be modular: signal collection, dedup, enrichment, news, and scoring as separate modules in `src/lib/` that task-a orchestrates sequentially.

**Primary recommendation:** Build the pipeline as a linear flow inside task-a: collect signals -> dedup (canonical URL + HubSpot) -> enrich (BeReach profile + company with 48h cache) -> news evidence -> ICP score (Claude Haiku) -> filter cold -> insert. Each step is a separate module. Use a daily counter in `global_settings` to enforce the 50-lead cap.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SIG-01 | Surveiller pages LinkedIn concurrents (likers + commenters) | BeReach `/collect/linkedin/likes` + `/collect/linkedin/comments` endpoints; watchlist table source_type='competitor_page' |
| SIG-02 | Rechercher posts LinkedIn par mots-cles (auteurs = leads) | BeReach `/search/linkedin/posts` with keyword filters; extract post authors as leads |
| SIG-03 | Surveiller posts d'influenceurs (likers + commenters) | Same collect endpoints as SIG-01; watchlist source_type='influencer' |
| SIG-04 | Detecter offres d'emploi LinkedIn par mots-cles | BeReach `/search/linkedin/jobs` endpoint; find hiring company then search for CX/Digital decision-makers |
| SIG-05 | Canonicaliser URLs LinkedIn avant insertion | canonicalizeLinkedInUrl() function: lowercase, strip trailing slash, strip query params, normalize /in/ path |
| SIG-06 | Anti-doublon Supabase (skip si canonical URL existe) | SELECT on linkedin_url_canonical UNIQUE index before INSERT |
| SIG-07 | Anti-doublon HubSpot check (par nom + societe) | HubSpot CRM Search API POST /crm/v3/objects/contacts/search with firstname+lastname+company filters |
| SIG-08 | Limite max 50 nouveaux leads/jour | Daily counter in global_settings or logs count, checked before each insert |
| ENR-01 | Enrichir profil via BeReach /visit/linkedin/profile | BeReach POST /visit/linkedin/profile returns name, headline, email, company |
| ENR-02 | Enrichir societe via BeReach /visit/linkedin/company | BeReach POST /visit/linkedin/company returns size, sector, location |
| ENR-03 | Cache 48h sur appels BeReach profil | Check profile_last_fetched_at < now() - 48h before calling BeReach |
| ENR-04 | Sales Navigator via OpenClaw browser | OpenClaw loopback HTTP API for browser automation; navigate Sales Nav, extract seniority/alerts |
| ENR-05 | Actu entreprise multi-sources avec preuves anti-hallucination | Web search for company news, store source_url + published_at in lead_news_evidence table |
| ENR-06 | Enrichissement email/phone via Fullenrich | FullEnrich async API: submit LinkedIn URL, webhook/poll for results, filter by confidence |
| ICP-01 | Scoring via Claude Haiku avec prompt structure | Anthropic API with claude-haiku-4-5, structured output via output_config, score 0-100 + tier |
| ICP-02 | Regles ICP editables depuis Supabase | Read icp_rules table at scoring time; categories: titles, sectors, sizes, seniority, negatives |
| ICP-03 | Poids par categorie de signal | Signal weights from icp_rules seed: concurrent +25, influenceur +15, sujet +10, job +5 |
| ICP-04 | Freshness TTL (malus si signal ancien) | Freshness rules from icp_rules: warn 5d, malus 10d, skip 15d |
| ICP-05 | Filtrage cold : seuls hot/warm inseres | After scoring, discard tier='cold' leads before Supabase insert |
| ICP-06 | Bonus news score si preuve verifiable | Only add news bonus if lead_news_evidence has source_url + published_at < 6 months |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @anthropic-ai/sdk | latest (0.61+) | Claude Haiku API calls for ICP scoring | Official Anthropic SDK, supports structured outputs natively |
| @hubspot/api-client | 13.x | HubSpot contact dedup check | Official HubSpot SDK, typed CRM search API |
| node-fetch or built-in fetch | Node 20+ built-in | HTTP calls to BeReach, FullEnrich, OpenClaw | Node 20 has native fetch; no extra dependency needed |

### Supporting (already installed from Phase 1)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @supabase/supabase-js | 2.x | All database operations | Already installed, singleton in src/lib/supabase.js |
| dotenv | 16.x | Env var loading | Already installed |
| node-cron | 3.x | Scheduler | Already installed, task-a placeholder exists |

### New Dependencies
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @anthropic-ai/sdk | latest | Claude API structured output | ICP scoring module |
| @hubspot/api-client | 13.x | HubSpot CRM contact search | Dedup check before enrichment |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @anthropic-ai/sdk | Raw fetch to Anthropic API | SDK handles auth, retries, types; raw fetch is simpler but less robust |
| @hubspot/api-client | Raw fetch to HubSpot API | Only need search endpoint; raw fetch acceptable but SDK gives better error handling |
| OpenClaw browser | BeReach Sales Nav endpoints | BeReach has /search/linkedin/sales-nav but OpenClaw already planned for ENR-04 |

**Installation:**
```bash
# On VPS in /home/openclaw/leadgen/
npm install @anthropic-ai/sdk @hubspot/api-client
```

**New env vars needed in .env:**
```bash
ANTHROPIC_API_KEY=sk-ant-...
HUBSPOT_TOKEN=pat-eu1-...
BEREACH_API_KEY=brc_...
FULLENRICH_API_KEY=...
```

## Architecture Patterns

### Recommended Module Structure
```
src/
├── tasks/
│   └── task-a-signals.js          # Orchestrator: calls modules in sequence
├── lib/
│   ├── supabase.js                # (exists) Supabase client singleton
│   ├── logger.js                  # (exists) Structured logging
│   ├── suppression.js             # (exists) RGPD check
│   ├── run-context.js             # (exists) UUID generation
│   ├── bereach.js                 # NEW: BeReach API wrapper (all endpoints)
│   ├── hubspot.js                 # NEW: HubSpot dedup check
│   ├── anthropic.js               # NEW: Claude Haiku scoring
│   ├── fullenrich.js              # NEW: FullEnrich email enrichment
│   ├── openclaw-browser.js        # NEW: OpenClaw browser automation
│   ├── signal-collector.js        # NEW: Orchestrates 4 signal sources
│   ├── enrichment.js              # NEW: Profile + company enrichment
│   ├── news-evidence.js           # NEW: Company news with proof
│   ├── icp-scorer.js              # NEW: ICP scoring logic
│   ├── dedup.js                   # NEW: URL canonical + Supabase + HubSpot
│   └── url-utils.js               # NEW: LinkedIn URL canonicalization
└── ...
```

### Pattern 1: Task A Pipeline Orchestration
**What:** Task A runs a linear pipeline: collect -> dedup -> enrich -> news -> score -> filter -> insert
**When to use:** Every 07h30 execution
**Example:**
```javascript
// src/tasks/task-a-signals.js
const { log } = require('../lib/logger');
const { collectSignals } = require('../lib/signal-collector');
const { dedup } = require('../lib/dedup');
const { enrichLeads } = require('../lib/enrichment');
const { gatherNewsEvidence } = require('../lib/news-evidence');
const { scoreLead } = require('../lib/icp-scorer');
const { supabase } = require('../lib/supabase');

module.exports = async function taskASignals(runId) {
  // 1. Check daily lead count
  const todayCount = await getDailyLeadCount();
  if (todayCount >= 50) {
    await log(runId, 'task-a', 'info', 'Daily lead limit reached (50), skipping');
    return;
  }
  const remaining = 50 - todayCount;

  // 2. Collect raw signals from all sources
  const rawSignals = await collectSignals(runId);
  await log(runId, 'task-a', 'info', `Collected ${rawSignals.length} raw signals`);

  // 3. Dedup: canonical URL + Supabase + HubSpot
  const newSignals = await dedup(rawSignals, runId);
  await log(runId, 'task-a', 'info', `${newSignals.length} signals after dedup`);

  // 4. Limit to remaining daily quota
  const batch = newSignals.slice(0, remaining);

  // 5. Enrich + score + insert each lead
  for (const signal of batch) {
    try {
      const enriched = await enrichLeads(signal, runId);
      const news = await gatherNewsEvidence(enriched, runId);
      const scored = await scoreLead(enriched, news, runId);

      if (scored.tier === 'cold') {
        await log(runId, 'task-a', 'info', `Skipping cold lead: ${signal.linkedin_url}`);
        continue;
      }

      // Insert hot/warm lead
      await supabase.from('leads').insert(scored);
      await log(runId, 'task-a', 'info', `Inserted ${scored.tier} lead: ${scored.first_name} ${scored.last_name}`);
    } catch (err) {
      await log(runId, 'task-a', 'warn', `Failed to process signal: ${err.message}`, { url: signal.linkedin_url });
    }
  }
};
```

### Pattern 2: BeReach API Wrapper
**What:** Centralized wrapper for all BeReach API calls with auth, error handling, and rate awareness
**When to use:** All BeReach interactions
**Example:**
```javascript
// src/lib/bereach.js
const BEREACH_BASE = 'https://api.berea.ch';

async function bereach(endpoint, body = {}) {
  const res = await fetch(`${BEREACH_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.BEREACH_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`BeReach ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function collectPostLikers(postUrl) {
  return bereach('/collect/linkedin/likes', { url: postUrl });
}

async function collectPostCommenters(postUrl) {
  return bereach('/collect/linkedin/comments', { url: postUrl });
}

async function searchPostsByKeywords(keywords) {
  return bereach('/search/linkedin/posts', { keywords });
}

async function searchJobs(keywords) {
  return bereach('/search/linkedin/jobs', { keywords });
}

async function visitProfile(profileUrl) {
  return bereach('/visit/linkedin/profile', { url: profileUrl });
}

async function visitCompany(companyUrl) {
  return bereach('/visit/linkedin/company', { url: companyUrl });
}

async function checkLimits() {
  return bereach('/me/limits');
}

module.exports = {
  collectPostLikers, collectPostCommenters,
  searchPostsByKeywords, searchJobs,
  visitProfile, visitCompany, checkLimits
};
```

### Pattern 3: LinkedIn URL Canonicalization (SIG-05)
**What:** Normalize LinkedIn URLs to a single canonical form for dedup
**When to use:** Before every Supabase insert and dedup check
**Example:**
```javascript
// src/lib/url-utils.js
function canonicalizeLinkedInUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    // Lowercase host
    let path = parsed.pathname.toLowerCase();
    // Remove trailing slash
    path = path.replace(/\/+$/, '');
    // Remove locale prefix (e.g., /fr/in/name -> /in/name)
    path = path.replace(/^\/[a-z]{2}\/in\//, '/in/');
    // Strip query params and hash
    return `https://www.linkedin.com${path}`;
  } catch {
    // Fallback: basic normalization
    return url.toLowerCase()
      .replace(/\?.*$/, '')
      .replace(/#.*$/, '')
      .replace(/\/+$/, '');
  }
}

module.exports = { canonicalizeLinkedInUrl };
```

### Pattern 4: ICP Scoring with Claude Haiku Structured Output (ICP-01)
**What:** Use Claude Haiku 4.5 with structured JSON output to score leads against ICP rules
**When to use:** After enrichment, before insert
**Example:**
```javascript
// src/lib/icp-scorer.js
const Anthropic = require('@anthropic-ai/sdk');
const { supabase } = require('./supabase');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function scoreLead(lead, newsEvidence, runId) {
  // Load ICP rules from Supabase (cached per run)
  const { data: rules } = await supabase.from('icp_rules').select('*');

  const signalWeights = rules.find(r => r.category === 'signal_weights')?.rules || {};
  const freshnessRules = rules.find(r => r.category === 'freshness')?.rules || {};

  // Check freshness TTL
  const signalAge = daysSince(lead.signal_date);
  if (signalAge > (freshnessRules.skip_days || 15)) {
    return { ...lead, tier: 'cold', icp_score: 0 };
  }

  // Build scoring prompt
  const prompt = buildScoringPrompt(lead, newsEvidence, rules);

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            icp_score: { type: 'number', description: 'Score 0-100' },
            tier: { type: 'string', enum: ['hot', 'warm', 'cold'] },
            reasoning: { type: 'string', description: 'Brief explanation' },
          },
          required: ['icp_score', 'tier', 'reasoning'],
          additionalProperties: false,
        },
      },
    },
  });

  const scoring = JSON.parse(response.content[0].text);

  // Apply signal weight bonus
  const signalBonus = signalWeights[lead.signal_category] || 0;

  // Apply freshness malus
  let freshnessMalus = 0;
  if (signalAge > (freshnessRules.malus_days || 10)) freshnessMalus = -15;
  else if (signalAge > (freshnessRules.warn_days || 5)) freshnessMalus = -5;

  // Apply news bonus (ICP-06: only if verifiable proof)
  let newsBonus = 0;
  if (newsEvidence && newsEvidence.length > 0) {
    const recentNews = newsEvidence.filter(n =>
      n.source_url && n.published_at && daysSince(n.published_at) < 180
    );
    if (recentNews.length > 0) newsBonus = 10;
  }

  const finalScore = Math.min(100, Math.max(0,
    scoring.icp_score + signalBonus + freshnessMalus + newsBonus
  ));

  // Recalculate tier based on final score
  let tier;
  if (finalScore >= 70) tier = 'hot';
  else if (finalScore >= 40) tier = 'warm';
  else tier = 'cold';

  return {
    ...lead,
    icp_score: finalScore,
    tier,
    metadata: { ...lead.metadata, scoring_reasoning: scoring.reasoning },
  };
}

function daysSince(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

module.exports = { scoreLead };
```

### Pattern 5: HubSpot Dedup Check (SIG-07)
**What:** Search HubSpot contacts by name + company before enrichment
**When to use:** After signal collection, before enrichment
**Example:**
```javascript
// src/lib/hubspot.js
const hubspot = require('@hubspot/api-client');

const client = new hubspot.Client({ accessToken: process.env.HUBSPOT_TOKEN });

async function existsInHubspot(firstName, lastName, companyName) {
  if (!firstName || !lastName) return false;

  try {
    const filters = [
      { propertyName: 'firstname', operator: 'EQ', value: firstName },
      { propertyName: 'lastname', operator: 'EQ', value: lastName },
    ];
    if (companyName) {
      filters.push({ propertyName: 'company', operator: 'EQ', value: companyName });
    }

    const response = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters }],
      properties: ['firstname', 'lastname', 'company'],
      limit: 1,
    });

    return response.total > 0;
  } catch (err) {
    // Fail open: if HubSpot is down, don't block the pipeline
    console.error('HubSpot check failed:', err.message);
    return false;
  }
}

module.exports = { existsInHubspot };
```

### Pattern 6: 48h BeReach Cache (ENR-03)
**What:** Skip BeReach profile/company fetch if data is fresh (< 48h)
**When to use:** Before every BeReach /visit call
**Example:**
```javascript
// Inside enrichment.js
async function enrichProfile(lead, runId) {
  // Check cache: skip if fetched within 48h
  if (lead.profile_last_fetched_at) {
    const hoursSinceFetch = (Date.now() - new Date(lead.profile_last_fetched_at).getTime()) / 3600000;
    if (hoursSinceFetch < 48) {
      return lead; // Use cached data
    }
  }

  const profile = await visitProfile(lead.linkedin_url);
  return {
    ...lead,
    first_name: profile.firstName,
    last_name: profile.lastName,
    headline: profile.headline,
    email: profile.email,
    company_name: profile.company,
    profile_last_fetched_at: new Date().toISOString(),
  };
}
```

### Pattern 7: Company News with Anti-Hallucination Evidence (ENR-05)
**What:** Search for company news via web, store verifiable source URLs
**When to use:** After profile enrichment, before scoring
**Example:**
```javascript
// src/lib/news-evidence.js
const { supabase } = require('./supabase');

async function gatherNewsEvidence(lead, runId) {
  if (!lead.company_name) return [];

  // Use Google News RSS as free source
  const query = encodeURIComponent(`${lead.company_name} site:linkedin.com OR site:lesechos.fr OR site:bfmtv.com`);
  const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=fr&gl=FR&ceid=FR:fr`;

  try {
    const res = await fetch(rssUrl);
    const xml = await res.text();
    const articles = parseRssXml(xml).slice(0, 5); // Top 5 results

    const evidence = articles.map(a => ({
      lead_id: lead.id,
      source_url: a.link,
      source_title: a.title,
      summary: a.description?.substring(0, 500),
      published_at: a.pubDate ? new Date(a.pubDate).toISOString() : null,
      relevance_score: null, // Set by Claude during scoring
    }));

    // Insert evidence into lead_news_evidence
    if (evidence.length > 0) {
      await supabase.from('lead_news_evidence').insert(evidence);
    }

    return evidence;
  } catch (err) {
    // News enrichment is non-critical
    console.error('News evidence failed:', err.message);
    return [];
  }
}

// Simple RSS XML parser (no dependency needed)
function parseRssXml(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1];
    items.push({
      title: extractTag(item, 'title'),
      link: extractTag(item, 'link'),
      description: extractTag(item, 'description'),
      pubDate: extractTag(item, 'pubDate'),
    });
  }
  return items;
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, 's'));
  return match ? match[1].replace(/<!\[CDATA\[(.*?)\]\]>/s, '$1').trim() : null;
}

module.exports = { gatherNewsEvidence };
```

### Anti-Patterns to Avoid
- **Calling BeReach without checking /me/limits first:** Always verify remaining quota before batch operations to avoid account restrictions.
- **Storing news summaries without source_url:** The anti-hallucination requirement (ENR-05) means every news item MUST have a verifiable source_url. Never generate news from LLM without a URL.
- **Scoring leads without loading ICP rules from Supabase:** Rules must be read from the database every run (or cached per run), not hardcoded.
- **Inserting leads then scoring:** Score BEFORE insert. Cold leads should never touch the leads table.
- **Synchronous enrichment without error isolation:** Each lead's enrichment must be wrapped in try/catch so one failure does not crash the batch.
- **Ignoring BeReach rate limits:** Profile views are limited to 80/day (free) or 500/day (Sales Nav). A batch of 50 leads means 50 profile visits + 50 company visits = 100 calls. Check limits.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LinkedIn data extraction | Custom scraping/Puppeteer | BeReach API | Handles LinkedIn anti-bot, returns structured data, maintains session |
| Contact dedup in HubSpot | Manual API calls with fetch | @hubspot/api-client | Handles pagination, auth refresh, typed responses |
| LLM structured output | JSON.parse with regex cleanup | Anthropic structured outputs (output_config) | Guaranteed schema compliance, no parse errors |
| URL parsing/normalization | Regex-only approach | URL constructor + normalization rules | URL constructor handles edge cases (encoding, ports, relative paths) |
| RSS parsing | Full XML parser library | Simple regex extraction | Google News RSS is predictable; xml2js adds unnecessary dependency |
| Sales Navigator automation | Custom Puppeteer scripts | OpenClaw browser API | OpenClaw handles CDP, session management, anti-detection |

**Key insight:** BeReach is the linchpin -- it handles LinkedIn session management, rate limiting, and anti-detection. The pipeline's job is orchestrating the flow, not scraping.

## Common Pitfalls

### Pitfall 1: BeReach Rate Limits Exceeded
**What goes wrong:** LinkedIn account gets restricted because too many API calls in a short period.
**Why it happens:** 50 leads x (1 profile visit + 1 company visit) = 100 visits/day, close to the 80/day free-tier limit.
**How to avoid:** Call `/me/limits` at the start of task-a. Add delays between visits (1-3 seconds). Consider spreading enrichment across multiple runs if limits are tight.
**Warning signs:** 429 errors from BeReach, LinkedIn "unusual activity" warnings.

### Pitfall 2: HubSpot Search False Negatives
**What goes wrong:** A contact exists in HubSpot but the name search misses them (different spelling, accent, hyphenated name).
**Why it happens:** HubSpot search is exact match on properties. "Jean-Pierre Dupont" will not match "Jean Pierre Dupont".
**How to avoid:** Normalize names before comparison (lowercase, remove accents, handle hyphens). Accept that name-based dedup is fuzzy -- it catches most duplicates but not all. Phase 3 adds EMAIL-02 (email-based HubSpot check) as a second safety net.
**Warning signs:** Duplicate contacts appearing in both leadgen and HubSpot.

### Pitfall 3: Claude Haiku Scoring Inconsistency
**What goes wrong:** Same lead gets different scores on different days.
**Why it happens:** LLM outputs are non-deterministic. Temperature, prompt phrasing, and context window all affect output.
**How to avoid:** Use temperature=0 (not configurable in structured output mode, but scores are bounded by schema). Include clear numeric criteria in the prompt. Apply signal weights and freshness as deterministic post-processing, not in the prompt.
**Warning signs:** Leads flipping between hot/warm/cold across runs.

### Pitfall 4: Stale ICP Rules Cache
**What goes wrong:** Admin updates ICP rules in Supabase but task-a uses old values.
**Why it happens:** If rules are loaded once at module import time, they're cached for the process lifetime.
**How to avoid:** Load ICP rules at the START of each task-a execution (per-run, not per-process). Simple pattern: `const rules = await loadIcpRules()` at the top of the function.
**Warning signs:** Rule changes not taking effect until PM2 restart.

### Pitfall 5: Daily Lead Count Race Condition
**What goes wrong:** More than 50 leads inserted on the same day.
**Why it happens:** If task-a runs multiple times (manual trigger + cron), the count check and insert are not atomic.
**How to avoid:** Count leads with `created_at >= today 00:00 Europe/Paris` at the start AND decrement remaining after each insert. The 50-lead limit is a safety guardrail, not a hard constraint -- a few over is acceptable.
**Warning signs:** Daily counts exceeding 50 in logs.

### Pitfall 6: OpenClaw Browser Not Running
**What goes wrong:** ENR-04 (Sales Navigator enrichment) fails because OpenClaw is not started.
**Why it happens:** OpenClaw runs as a separate process/daemon. PM2 manages leadgen but not necessarily OpenClaw.
**How to avoid:** Check OpenClaw availability at task-a start. If not available, skip Sales Nav enrichment (non-critical -- BeReach profile data is sufficient for scoring). Log a warning.
**Warning signs:** ECONNREFUSED on localhost:18791.

### Pitfall 7: Google News RSS Returns Irrelevant Results
**What goes wrong:** Company news evidence contains articles about unrelated companies with similar names.
**Why it happens:** "Orange" the telecom vs "orange" the fruit. Short or generic company names cause noise.
**How to avoid:** Include company sector/industry in the search query. Limit to recent articles (< 6 months). The ICP-06 bonus only applies if evidence is verifiable -- irrelevant articles won't match and won't add bonus points.
**Warning signs:** lead_news_evidence full of unrelated articles.

## Code Examples

### Signal Collector Module
```javascript
// src/lib/signal-collector.js
const { supabase } = require('./supabase');
const bereach = require('./bereach');
const { log } = require('./logger');

async function collectSignals(runId) {
  // Load active watchlist entries
  const { data: sources } = await supabase
    .from('watchlist')
    .select('*')
    .eq('is_active', true);

  const signals = [];

  for (const source of sources) {
    try {
      switch (source.source_type) {
        case 'competitor_page':
          // SIG-01: Get likers + commenters from competitor's recent posts
          const posts = await bereach.collectPosts(source.source_url);
          for (const post of posts.slice(0, 3)) { // Last 3 posts
            const likers = await bereach.collectPostLikers(post.url);
            const commenters = await bereach.collectPostCommenters(post.url);
            signals.push(...formatSignals(likers, 'like', 'concurrent', source));
            signals.push(...formatSignals(commenters, 'comment', 'concurrent', source));
          }
          break;

        case 'influencer':
          // SIG-03: Same as competitor but different signal_category
          const influencerPosts = await bereach.collectPosts(source.source_url);
          for (const post of influencerPosts.slice(0, 3)) {
            const likers = await bereach.collectPostLikers(post.url);
            const commenters = await bereach.collectPostCommenters(post.url);
            signals.push(...formatSignals(likers, 'like', 'influenceur', source));
            signals.push(...formatSignals(commenters, 'comment', 'influenceur', source));
          }
          break;

        case 'keyword':
          // SIG-02: Search posts by keywords, authors are leads
          const keywordPosts = await bereach.searchPostsByKeywords(source.keywords);
          signals.push(...formatSignals(keywordPosts.map(p => p.author), 'post', 'sujet', source));
          break;

        case 'job_keyword':
          // SIG-04: Search jobs, then find CX/Digital decision-makers at that company
          const jobs = await bereach.searchJobs(source.keywords);
          signals.push(...formatJobSignals(jobs, source));
          break;
      }
    } catch (err) {
      await log(runId, 'signal-collector', 'warn',
        `Failed to collect from ${source.source_label}: ${err.message}`);
    }
  }

  return signals;
}

function formatSignals(profiles, signalType, signalCategory, source) {
  return profiles.map(p => ({
    linkedin_url: p.profileUrl || p.url,
    first_name: p.firstName || p.name?.split(' ')[0],
    last_name: p.lastName || p.name?.split(' ').slice(1).join(' '),
    headline: p.headline,
    signal_type: signalType,
    signal_category: signalCategory,
    signal_source: source.source_label,
    signal_date: new Date().toISOString(),
    sequence_id: source.sequence_id,
  }));
}

module.exports = { collectSignals };
```

### Dedup Module
```javascript
// src/lib/dedup.js
const { supabase } = require('./supabase');
const { existsInHubspot } = require('./hubspot');
const { canonicalizeLinkedInUrl } = require('./url-utils');
const { log } = require('./logger');

async function dedup(signals, runId) {
  const unique = [];
  const seenUrls = new Set();

  for (const signal of signals) {
    // Step 1: Canonicalize URL
    const canonical = canonicalizeLinkedInUrl(signal.linkedin_url);
    if (!canonical) continue;

    // Step 2: In-batch dedup
    if (seenUrls.has(canonical)) continue;
    seenUrls.add(canonical);

    // Step 3: Supabase dedup (SIG-06)
    const { data } = await supabase
      .from('leads')
      .select('id')
      .eq('linkedin_url_canonical', canonical)
      .limit(1);
    if (data && data.length > 0) continue;

    // Step 4: HubSpot dedup (SIG-07)
    if (signal.first_name && signal.last_name) {
      const inHubspot = await existsInHubspot(
        signal.first_name, signal.last_name, signal.company_name
      );
      if (inHubspot) {
        await log(runId, 'dedup', 'info',
          `Skipping ${signal.first_name} ${signal.last_name} - exists in HubSpot`);
        continue;
      }
    }

    unique.push({ ...signal, linkedin_url_canonical: canonical });
  }

  return unique;
}

module.exports = { dedup };
```

### ICP Scoring Prompt Builder
```javascript
// Inside src/lib/icp-scorer.js
function buildScoringPrompt(lead, newsEvidence, rules) {
  const titleRules = rules.find(r => r.category === 'titles')?.rules || {};
  const sectorRules = rules.find(r => r.category === 'sectors')?.rules || {};
  const sizeRules = rules.find(r => r.category === 'sizes')?.rules || {};
  const seniorityRules = rules.find(r => r.category === 'seniority')?.rules || {};

  return `Tu es un expert en qualification de leads B2B pour MessagingMe (plateforme conversationnelle).

Evalue ce lead selon les criteres ICP suivants:

## Lead
- Nom: ${lead.first_name} ${lead.last_name}
- Titre: ${lead.headline || 'inconnu'}
- Societe: ${lead.company_name || 'inconnue'}
- Taille societe: ${lead.company_size || 'inconnue'}
- Secteur: ${lead.company_sector || 'inconnu'}
- Localisation: ${lead.company_location || 'inconnue'}

## Criteres ICP
- Titres positifs: ${JSON.stringify(titleRules.positive || [])}
- Titres negatifs: ${JSON.stringify(titleRules.negative || [])}
- Secteurs cibles: ${JSON.stringify(sectorRules.positive || [])}
- Taille min/max: ${sizeRules.min || 50} - ${sizeRules.max || 10000} employes
- Anciennete min: ${seniorityRules.min_years || 2} ans

## Actualites entreprise
${newsEvidence?.length > 0
  ? newsEvidence.map(n => `- ${n.source_title} (${n.source_url})`).join('\n')
  : 'Aucune actualite trouvee'}

Attribue un score de 0 a 100 et un tier (hot >= 70, warm >= 40, cold < 40).
Explique brievement ton raisonnement.`;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Claude 3 Haiku (claude-3-haiku-20240307) | Claude Haiku 4.5 (claude-haiku-4-5) | Oct 2025 | Better reasoning, structured outputs GA, deprecation April 2026 |
| output_format parameter | output_config.format parameter | Late 2025 GA | No beta header needed, standard API parameter |
| Puppeteer for LinkedIn scraping | BeReach API | 2024-2025 | No browser maintenance, handles anti-detection, structured responses |
| Manual JSON.parse + prompt engineering | Structured outputs with JSON schema | Nov 2025 | Guaranteed valid JSON, no parse errors |
| Separate enrichment tools per provider | FullEnrich waterfall (20+ providers) | 2024-2025 | Single API call, highest coverage, confidence-based filtering |

**Deprecated/outdated:**
- `claude-3-haiku-20240307`: Scheduled for deprecation April 19, 2026. Use `claude-haiku-4-5` instead.
- `output_format` parameter: Replaced by `output_config.format`. Old parameter still works during transition.
- `anthropic-beta: structured-outputs-2025-11-13` header: No longer needed, structured outputs are GA.

## Open Questions

1. **BeReach API exact response schemas**
   - What we know: Endpoints exist for collect/likes, collect/comments, visit/profile, visit/company, search/posts, search/jobs
   - What's unclear: Exact field names in responses (e.g., is it `profileUrl` or `profile_url`? `firstName` or `first_name`?)
   - Recommendation: Make a test call to each endpoint during implementation and adapt field mappings. Build the wrapper to normalize response fields.

2. **BeReach API base URL**
   - What we know: Auth is Bearer token, endpoints are POST
   - What's unclear: Exact base URL (api.berea.ch? berea.ch/api? Something else?)
   - Recommendation: Check BeReach documentation/dashboard during implementation. May need to inspect network requests from the Chrome extension.

3. **OpenClaw cmdop import bug (from Phase 1)**
   - What we know: OpenClaw has a cmdop module import error preventing CLI from running
   - What's unclear: Whether this has been fixed upstream, or needs manual resolution
   - Recommendation: Try `pip install --upgrade openclaw` first. If still broken, ENR-04 (Sales Navigator) can be deferred -- BeReach profile data provides enough for ICP scoring. OpenClaw is a nice-to-have for seniority data.

4. **FullEnrich exact API flow**
   - What we know: Async API, submit enrichment request, get results via webhook (30-90s) or polling (5-10 min intervals)
   - What's unclear: Exact endpoint URLs, request body format for LinkedIn URL enrichment
   - Recommendation: Read FullEnrich docs at docs.fullenrich.com during implementation. ENR-06 is the last enrichment step and can be implemented separately.

5. **Google News RSS reliability for French companies**
   - What we know: Google News RSS is free and structured
   - What's unclear: How well it works for small/medium French companies, whether results are relevant
   - Recommendation: Test with a few known companies during implementation. If results are poor, consider adding LeBonBusiness, SocieteNinja, or similar French company news sources as fallbacks.

## Sources

### Primary (HIGH confidence)
- [BeReach API documentation](https://berea.ch/unofficial-linkedin-api) -- 26 endpoints, auth method, rate limits
- [Anthropic structured outputs docs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) -- output_config format, model support including Haiku 4.5
- [HubSpot API docs](https://developers.hubspot.com/docs/api-reference/legacy/crm-contacts-v1/post-contacts-v1-search-query) -- Contact search API
- [@hubspot/api-client npm](https://www.npmjs.com/package/@hubspot/api-client) -- v13.4.0, Node.js SDK
- [@anthropic-ai/sdk npm](https://www.npmjs.com/package/@anthropic-ai/sdk) -- Official SDK, latest version
- [OpenClaw browser docs](https://docs.openclaw.ai/tools/browser) -- Loopback HTTP API, CDP profiles, browser automation

### Secondary (MEDIUM confidence)
- [FullEnrich API docs](https://docs.fullenrich.com/api/v2/implement-in-product/getting-started) -- Async enrichment, webhook/polling, 30-90s response
- [Anthropic models overview](https://platform.claude.com/docs/en/about-claude/models/overview) -- claude-haiku-4-5 confirmed, $1/$5 per MTok
- Phase 1 summaries (01-01, 01-02, 01-03) -- Existing project structure, patterns, decisions

### Tertiary (LOW confidence)
- BeReach response field names -- Not documented in public pages, need API testing
- Google News RSS for French B2B companies -- Untested for this specific use case
- OpenClaw cmdop bug status -- May or may not be resolved in latest version

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- BeReach API endpoints verified, Anthropic SDK and structured outputs confirmed, HubSpot SDK documented
- Architecture: HIGH -- Pipeline pattern is straightforward linear flow, modules align with requirements
- Pitfalls: HIGH -- Rate limits, dedup edge cases, and caching patterns are well-understood
- BeReach response schemas: LOW -- Public docs show endpoints but not exact response field names
- OpenClaw integration: LOW -- cmdop bug unresolved, loopback API documented but not tested
- FullEnrich: MEDIUM -- API exists and is documented, but exact request format not verified

**Research date:** 2026-03-20
**Valid until:** 2026-04-05 (BeReach API may change; Claude Haiku 3 deprecation April 19)
