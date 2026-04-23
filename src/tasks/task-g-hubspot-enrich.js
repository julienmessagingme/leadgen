/**
 * Task G — daily HubSpot contact enrichment via BeReach.
 * Runs Mon-Sat 07h40 (after Task A at 07h30), consumes the daily budget
 * configured in global_settings.task_g_daily_budget (default 200 credits).
 *
 * Strategy :
 *   - Pull HubSpot contacts where company OR jobtitle is missing
 *   - Skip contacts in hubspot_enrichment_attempts whose last attempt is
 *     too recent (matched = never, no_match = 30d, ambiguous = 7d)
 *   - For each candidate :
 *       1. Determine companyHint :
 *            - if contact has `company` already → use it (more precise than domain)
 *            - else derive from email domain base (e.g. leetchi.com → "Leetchi")
 *       2. searchPeople({ currentCompany: companyHint, keywords: firstname }) — 1 cr
 *       3. Filter results by name containing both firstname AND lastname
 *          - 0 match → record no_match, move on
 *          - 1 match → use it
 *          - >1 → exact-concat match (firstnamelastname), else ambiguous
 *       4. Update HubSpot : only write missing props (company, jobtitle,
 *          hs_linkedin_url) — never overwrite
 *       5. Record attempt in hubspot_enrichment_attempts
 *
 * See docs/plans/2026-04-22-hubspot-enrichment-cron-design.md
 */

const { supabase } = require("../lib/supabase");
const { searchPeople } = require("../lib/bereach");
const { log } = require("../lib/logger");
const hubspot = require("@hubspot/api-client");

const TASK_NAME = "task-g-hubspot-enrich";
const DEFAULT_BUDGET = 200;

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.fr", "yahoo.com", "yahoo.fr",
  "outlook.com", "outlook.fr", "live.fr", "live.com", "orange.fr", "free.fr",
  "wanadoo.fr", "laposte.net", "sfr.fr", "bbox.fr", "icloud.com", "me.com",
  "aol.com", "protonmail.com", "proton.me",
]);

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function nameContains(itemName, firstname, lastname) {
  const n = norm(itemName);
  return n.includes(norm(firstname)) && n.includes(norm(lastname));
}

function nameIsExactConcat(itemName, firstname, lastname) {
  return norm(itemName) === norm(firstname) + norm(lastname)
      || norm(itemName) === norm(lastname) + norm(firstname);
}

function getHubspotClient() {
  return new hubspot.Client({ accessToken: process.env.HUBSPOT_TOKEN });
}

/**
 * Read daily budget from global_settings (fallback to DEFAULT_BUDGET).
 */
async function loadBudget() {
  try {
    const { data, error } = await supabase
      .from("global_settings")
      .select("value")
      .eq("key", "task_g_daily_budget")
      .maybeSingle();
    if (error || !data) return DEFAULT_BUDGET;
    const v = typeof data.value === "number" ? data.value : parseInt(String(data.value), 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_BUDGET;
  } catch (_e) {
    return DEFAULT_BUDGET;
  }
}

/**
 * Fetch HubSpot contacts missing company or jobtitle, skipping those that
 * were attempted too recently.
 */
async function fetchCandidates(maxContacts) {
  const client = getHubspotClient();
  const now = Date.now();
  const THIRTY_DAYS = 30 * 86400 * 1000;
  const SEVEN_DAYS = 7 * 86400 * 1000;

  // Load prior attempts to filter client-side (Supabase → attempt map)
  const { data: prior } = await supabase
    .from("hubspot_enrichment_attempts")
    .select("contact_id, attempted_at, result");
  const skipSet = new Set();
  for (const a of (prior || [])) {
    const age = now - new Date(a.attempted_at).getTime();
    if (a.result === "matched") skipSet.add(a.contact_id); // permanent
    else if (a.result === "no_match" && age < THIRTY_DAYS) skipSet.add(a.contact_id);
    else if (a.result === "ambiguous" && age < SEVEN_DAYS) skipSet.add(a.contact_id);
    else if (a.result === "skipped" && age < SEVEN_DAYS) skipSet.add(a.contact_id);
  }

  const out = [];
  let after = undefined;
  while (out.length < maxContacts) {
    const resp = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [
        { filters: [{ propertyName: "company", operator: "NOT_HAS_PROPERTY" }] },
        { filters: [{ propertyName: "jobtitle", operator: "NOT_HAS_PROPERTY" }] },
      ],
      properties: ["email", "firstname", "lastname", "company", "jobtitle", "hs_linkedin_url"],
      sorts: [{ propertyName: "lastmodifieddate", direction: "DESCENDING" }],
      limit: 100,
      after,
    });
    for (const c of (resp.results || [])) {
      if (!skipSet.has(c.id)) out.push(c);
      if (out.length >= maxContacts) break;
    }
    if (!resp.paging || !resp.paging.next) break;
    after = resp.paging.next.after;
  }
  return out;
}

async function recordAttempt(contactId, result, matchedUrl, headline) {
  try {
    await supabase.from("hubspot_enrichment_attempts").upsert({
      contact_id: contactId,
      attempted_at: new Date().toISOString(),
      result: result,
      matched_url: matchedUrl || null,
      headline: headline || null,
    }, { onConflict: "contact_id" });
  } catch (err) {
    console.warn("[task-g] recordAttempt failed:", err.message);
  }
}

module.exports = async function taskGHubspotEnrich(runId) {
  const BUDGET = await loadBudget();
  await log(runId, TASK_NAME, "info", "Task G started — daily HubSpot enrichment", { budget: BUDGET });

  // safety cap on contacts fetched : 3x budget (plenty given ~30% match rate)
  const candidates = await fetchCandidates(Math.max(BUDGET * 3, 300));
  await log(runId, TASK_NAME, "info", "Fetched " + candidates.length + " candidates");

  if (candidates.length === 0) {
    await log(runId, TASK_NAME, "info", "No candidates — nothing to enrich");
    return;
  }

  const client = getHubspotClient();
  let creditsSpent = 0;
  const s = { processed: 0, matched: 0, no_match: 0, ambiguous: 0, skipped: 0, updated: 0, errors: 0 };

  for (const c of candidates) {
    if (creditsSpent >= BUDGET) break;
    const p = c.properties || {};
    const firstname = (p.firstname || "").trim();
    const lastname = (p.lastname || "").trim();
    const email = (p.email || "").trim();
    const curCompany = (p.company || "").trim();
    const curJobtitle = (p.jobtitle || "").trim();
    const curLinkedinUrl = (p.hs_linkedin_url || "").trim();

    s.processed++;

    if (!firstname || !lastname) {
      await recordAttempt(c.id, "skipped", null, null);
      s.skipped++;
      continue;
    }

    // Build companyHint : prefer existing HubSpot company, else email domain base
    let companyHint = curCompany;
    if (!companyHint && email) {
      const domain = (email.split("@")[1] || "").toLowerCase();
      if (domain && !PERSONAL_DOMAINS.has(domain)) {
        companyHint = domain.split(".")[0] || "";
      }
    }
    if (!companyHint) {
      await recordAttempt(c.id, "skipped", null, null);
      s.skipped++;
      continue;
    }

    let chosen = null;
    try {
      const sr = await searchPeople({ currentCompany: companyHint, keywords: firstname });
      creditsSpent += 1;

      const items = (sr && sr.items) || [];
      const contains = items.filter(it => nameContains(it.name, firstname, lastname));

      if (contains.length === 0) {
        await recordAttempt(c.id, "no_match", null, null);
        s.no_match++;
        continue;
      }
      if (contains.length === 1) {
        chosen = contains[0];
      } else {
        const exact = contains.filter(it => nameIsExactConcat(it.name, firstname, lastname));
        if (exact.length === 1) {
          chosen = exact[0];
        } else {
          await recordAttempt(c.id, "ambiguous", null, null);
          s.ambiguous++;
          continue;
        }
      }
    } catch (err) {
      s.errors++;
      await log(runId, TASK_NAME, "warn", "search failed for " + c.id + ": " + err.message, { contact_id: c.id });
      continue;
    }

    if (!chosen) continue;
    const extractedHeadline = chosen.headline || "";
    const chosenUrl = chosen.profileUrl || null;

    const upd = {};
    if (!curCompany && companyHint) upd.company = capitalize(companyHint);
    if (!curJobtitle && extractedHeadline) upd.jobtitle = extractedHeadline;
    if (!curLinkedinUrl && chosenUrl) upd.hs_linkedin_url = chosenUrl;

    if (Object.keys(upd).length === 0) {
      // Matched but nothing to fill (contact already complete — rare)
      await recordAttempt(c.id, "matched", chosenUrl, extractedHeadline);
      s.matched++;
      continue;
    }

    try {
      await client.crm.contacts.basicApi.update(c.id, { properties: upd });
      s.updated++;
      s.matched++;
      await recordAttempt(c.id, "matched", chosenUrl, extractedHeadline);
    } catch (upErr) {
      s.errors++;
      await log(runId, TASK_NAME, "warn", "update failed for " + c.id + ": " + upErr.message, { contact_id: c.id });
    }
  }

  await log(runId, TASK_NAME, "info",
    "Task G done : " + s.matched + " matched / " + s.no_match + " no-match / " + s.ambiguous + " ambiguous / " + s.errors + " errors — " + creditsSpent + "/" + BUDGET + " credits",
    { stats: s, creditsSpent, budget: BUDGET });
};
