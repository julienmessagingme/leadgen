#!/usr/bin/env node
/**
 * Enrich HubSpot contacts missing company or jobtitle via BeReach.
 *
 * TEST RUN : spends up to --budget credits (default 200), reports a bilan at
 * end. No cron, no persistence beyond HubSpot property updates.
 *
 * WINNING FORMULA (discovered 22/04) :
 *   searchPeople({ currentCompany: <domainBase>, keywords: <firstname> })
 *   → returns up to 10 matches per page, each with profileUrl + headline
 *   → 1 credit, no need for visitProfile since headline = jobtitle
 *
 * Flow per contact :
 *   1. Skip if personal email (gmail/hotmail) or no email — domain is the
 *      only way to disambiguate and BeReach can't resolve personal domains
 *      to a LinkedIn company.
 *   2. Extract domainBase from email (e.g. leetchi.com → "Leetchi").
 *   3. searchPeople({ currentCompany: domainBase, keywords: firstname })
 *      — 1 credit
 *   4. Filter items where name contains both firstname AND lastname.
 *   5. If 0 → skip (no match).
 *      If 1 → accept.
 *      If >1 → try exact concat match "firstname lastname". Sinon ambiguous.
 *   6. Update HubSpot (only missing props) :
 *        - company (if missing) = domainBase capitalized
 *        - jobtitle (if missing) = chosen.headline
 *        - hs_linkedin_url (if missing) = chosen.profileUrl
 *
 * Usage :
 *   node scripts/enrich-hubspot-contacts.js                 # 200 cr, default
 *   node scripts/enrich-hubspot-contacts.js --budget 300    # override
 *   node scripts/enrich-hubspot-contacts.js --dry           # no updates, just scan
 */

require("dotenv").config({ quiet: true });
const hubspot = require("@hubspot/api-client");
const { searchPeople } = require("../src/lib/bereach");

const BUDGET_IDX = process.argv.indexOf("--budget");
const BUDGET = BUDGET_IDX >= 0 ? parseInt(process.argv[BUDGET_IDX + 1], 10) : 200;
const DRY = process.argv.includes("--dry");

const client = new hubspot.Client({ accessToken: process.env.HUBSPOT_TOKEN });

const PERSONAL_DOMAINS = new Set([
  "gmail.com", "hotmail.com", "hotmail.fr", "yahoo.com", "yahoo.fr",
  "outlook.com", "outlook.fr", "live.fr", "live.com", "orange.fr", "free.fr",
  "wanadoo.fr", "laposte.net", "sfr.fr", "bbox.fr", "icloud.com", "me.com",
  "aol.com", "protonmail.com", "proton.me",
]);

function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }

function domainBaseFromEmail(email) {
  if (!email) return "";
  const domain = (email.split("@")[1] || "").toLowerCase();
  if (!domain || PERSONAL_DOMAINS.has(domain)) return "";
  return domain.split(".")[0] || "";
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

async function fetchCandidates(maxContacts) {
  const out = [];
  let after = undefined;
  while (out.length < maxContacts) {
    const resp = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [
        { filters: [{ propertyName: "company", operator: "NOT_HAS_PROPERTY" }] },
        { filters: [{ propertyName: "jobtitle", operator: "NOT_HAS_PROPERTY" }] },
      ],
      properties: ["email", "firstname", "lastname", "company", "jobtitle", "hs_linkedin_url"],
      limit: 100,
      after,
    });
    for (const c of resp.results || []) {
      out.push(c);
      if (out.length >= maxContacts) break;
    }
    if (!resp.paging || !resp.paging.next) break;
    after = resp.paging.next.after;
  }
  return out;
}

async function main() {
  console.log(`== HubSpot contact enrichment (TEST run) ==`);
  console.log(`Budget: ${BUDGET} BeReach credits${DRY ? " (DRY — no HubSpot writes)" : ""}\n`);

  const candidates = await fetchCandidates(400);
  console.log(`Fetched ${candidates.length} contacts missing company or jobtitle.\n`);

  let creditsSpent = 0;
  const s = {
    processed: 0,
    skipped_no_name: 0,
    skipped_no_email: 0,
    skipped_personal_email: 0,
    searched: 0,
    no_match: 0,
    ambiguous: 0,
    matched: 0,
    hubspot_updated: 0,
    updated_company: 0,
    updated_jobtitle: 0,
    updated_linkedin_url: 0,
    errors: 0,
  };

  for (const c of candidates) {
    if (creditsSpent >= BUDGET) {
      console.log(`\n[budget-stop] reached ${BUDGET} credits (processed ${s.processed})`);
      break;
    }

    const p = c.properties || {};
    const firstname = p.firstname || "";
    const lastname = p.lastname || "";
    const email = p.email || "";
    const linkedinUrl = p.hs_linkedin_url || "";
    const curCompany = p.company || "";
    const curJobtitle = p.jobtitle || "";
    const tag = `[${c.id}] ${firstname} ${lastname}`;

    s.processed++;

    if (!firstname || !lastname) { s.skipped_no_name++; continue; }
    if (!email) { s.skipped_no_email++; continue; }

    const domain = (email.split("@")[1] || "").toLowerCase();
    if (PERSONAL_DOMAINS.has(domain)) { s.skipped_personal_email++; continue; }

    const domainBase = domainBaseFromEmail(email);
    if (!domainBase) { s.skipped_personal_email++; continue; }

    let chosen = null;
    try {
      s.searched++;
      const sr = await searchPeople({ currentCompany: domainBase, keywords: firstname });
      creditsSpent += 1;

      const items = (sr && sr.items) || [];

      // Filter items whose `name` contains both firstname and lastname
      const contains = items.filter(it => nameContains(it.name, firstname, lastname));

      if (contains.length === 0) {
        s.no_match++;
        console.log(`${tag} @${domainBase} — no match (${items.length} items returned, ${sr.paging && sr.paging.total} total) | cr ${creditsSpent}/${BUDGET}`);
        continue;
      }

      if (contains.length === 1) {
        chosen = contains[0];
      } else {
        // Tighter: exact concat match
        const exact = contains.filter(it => nameIsExactConcat(it.name, firstname, lastname));
        if (exact.length === 1) {
          chosen = exact[0];
        } else {
          s.ambiguous++;
          console.log(`${tag} @${domainBase} — ${contains.length} matches, ${exact.length} exact-concat → skip`);
          continue;
        }
      }
    } catch (err) {
      s.errors++;
      console.error(`${tag} — ERR: ${err.message.slice(0, 200)}`);
      continue;
    }

    if (!chosen) continue;
    s.matched++;

    const extractedHeadline = chosen.headline || "";
    const chosenUrl = chosen.profileUrl || null;
    const companyGuess = capitalize(domainBase);

    const upd = {};
    if (!curCompany && companyGuess) { upd.company = companyGuess; s.updated_company++; }
    if (!curJobtitle && extractedHeadline) { upd.jobtitle = extractedHeadline; s.updated_jobtitle++; }
    if (!linkedinUrl && chosenUrl) { upd.hs_linkedin_url = chosenUrl; s.updated_linkedin_url++; }

    if (Object.keys(upd).length === 0) continue;

    if (DRY) {
      console.log(`${tag} → would update: ${JSON.stringify(upd)} | cr ${creditsSpent}/${BUDGET}`);
      s.hubspot_updated++;
    } else {
      try {
        await client.crm.contacts.basicApi.update(c.id, { properties: upd });
        s.hubspot_updated++;
        console.log(`${tag} → ${Object.keys(upd).join(", ")} | headline: "${extractedHeadline.slice(0, 50)}" | cr ${creditsSpent}/${BUDGET}`);
      } catch (upErr) {
        s.errors++;
        console.error(`${tag} — update-err: ${upErr.message.slice(0, 200)}`);
      }
    }
  }

  console.log("\n──── BILAN ────");
  console.log(JSON.stringify(s, null, 2));
  console.log(`\nCrédits BeReach consommés : ${creditsSpent}/${BUDGET}`);
  console.log(`Contacts HubSpot mis à jour : ${s.hubspot_updated}`);
  console.log(`  → company   : ${s.updated_company}`);
  console.log(`  → jobtitle  : ${s.updated_jobtitle}`);
  console.log(`  → linkedin  : ${s.updated_linkedin_url}`);
}

main().then(() => process.exit(0)).catch(e => { console.error("FATAL:", e.stack || e.message); process.exit(1); });
