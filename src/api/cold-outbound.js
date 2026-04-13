const crypto = require("crypto");
const { Router } = require("express");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");
const { searchPeople, visitProfile, sleep, checkLimits } = require("../lib/bereach");
const { canonicalizeLinkedInUrl } = require("../lib/url-utils");
const { existsInHubspot } = require("../lib/hubspot");
const { scorePrise } = require("../lib/cold-outbound-scoring");
const { enrichContactInfo } = require("../lib/fullenrich");
const { getAnthropicClient } = require("../lib/anthropic");
const { log } = require("../lib/logger");

const router = Router();
router.use(authMiddleware);

// ────────────────────────────────────────────────────────────
// POST /search -- Search LinkedIn people via BeReach + auto HubSpot/dedup
// ────────────────────────────────────────────────────────────

router.post("/search", async (req, res) => {
  try {
    var { job_title, company, sector, company_size, geography, max_leads } = req.body;

    if (!job_title || typeof job_title !== "string" || !job_title.trim()) {
      return res.status(400).json({ error: "job_title is required" });
    }
    var parsedMax = parseInt(max_leads, 10);
    if (!parsedMax || parsedMax < 1 || parsedMax > 50) parsedMax = 25;

    // Build BeReach search params — names are resolved to IDs inside searchPeople()
    var searchParams = { keywords: job_title.trim() };
    if (company && company.trim()) searchParams.currentCompany = company.trim();
    if (geography && geography.trim()) searchParams.location = geography.trim();
    if (sector && sector.trim()) searchParams.industry = sector.trim();
    if (company_size) searchParams.companySize = company_size;
    searchParams.count = parsedMax;

    // Track which resolutions failed so we can warn the user
    var warnings = [];

    var filters = {
      job_title: job_title.trim(),
      company: (company || "").trim() || null,
      sector: (sector || "").trim() || null,
      company_size: company_size || null,
      geography: (geography || "").trim() || null,
      max_leads: parsedMax,
    };

    // Credit budget check
    try {
      var limits = await checkLimits();
      var daily = limits && limits.daily;
      if (daily && daily.remaining !== undefined && daily.remaining < 5) {
        return res.status(429).json({ error: "Budget BeReach insuffisant (" + daily.remaining + " credits restants)" });
      }
    } catch (_limErr) { /* fail open */ }

    // Call BeReach (searchPeople resolves names → IDs, throws if company not found)
    var beReachResult;
    try {
      beReachResult = await searchPeople(searchParams);
      if (beReachResult._warnings) warnings = warnings.concat(beReachResult._warnings);
    } catch (beErr) {
      // If it's a resolution failure, return 422 with clear message
      if (beErr.warnings) {
        return res.status(422).json({ error: beErr.message, warnings: beErr.warnings });
      }
      return res.status(502).json({ error: "BeReach search failed: " + beErr.message });
    }

    // Normalize results from BeReach response
    var rawProfiles = beReachResult.items || beReachResult.profiles || beReachResult.results || [];
    if (!Array.isArray(rawProfiles)) rawProfiles = [];
    rawProfiles = rawProfiles.slice(0, parsedMax);

    // Normalize profile fields
    var normalized = rawProfiles.map(function (p, i) {
      var linkedinUrl = p.profileUrl || p.profile_url || p.url || p.linkedin_url || null;

      // Company: BeReach search doesn't return a company field.
      // Best-effort extraction from headline using reliable patterns only.
      // Filled properly at enrichment (visitProfile).
      var companyName = "";
      if (Array.isArray(p.currentPositions) && p.currentPositions.length > 0) {
        companyName = p.currentPositions[0].companyName || p.currentPositions[0].company || "";
      }
      if (!companyName && p.headline) {
        // Only use high-confidence patterns: "at Company", "chez Company", "@Company"
        var atMatch = p.headline.match(/\b(?:at|chez)\s+(.+?)(?:\s*[|·\-–—]|$)/i);
        var aroMatch = p.headline.match(/@\s*(.+?)(?:\s*[|·\-–—]|$)/);
        companyName = ((atMatch && atMatch[1]) || (aroMatch && aroMatch[1]) || "").trim();
      }

      return {
        index: i,
        linkedin_url: linkedinUrl,
        linkedin_url_canonical: canonicalizeLinkedInUrl(linkedinUrl),
        first_name: p.firstName || p.first_name || (p.name || "").split(" ")[0] || "",
        last_name: p.lastName || p.last_name || (p.name || "").split(" ").slice(1).join(" ") || "",
        headline: p.headline || p.title || null,
        company: companyName,
        location: p.location || null,
      };
    });

    // Batch dedup: single query for all canonical URLs
    var canonicals = normalized.map(function (n) { return n.linkedin_url_canonical; }).filter(Boolean);
    var dedupMap = {};
    if (canonicals.length > 0) {
      var { data: existingLeads } = await supabase
        .from("leads")
        .select("id, linkedin_url_canonical")
        .in("linkedin_url_canonical", canonicals);
      if (existingLeads) {
        existingLeads.forEach(function (l) { dedupMap[l.linkedin_url_canonical] = l.id; });
      }
    }

    // HubSpot checks (parallel, max 10 concurrent)
    var hsResults = await Promise.allSettled(
      normalized.map(function (n) {
        return existsInHubspot(n.first_name, n.last_name, n.company);
      })
    );

    // Build final results
    var results = normalized.map(function (n, i) {
      var hs = hsResults[i].status === "fulfilled" ? hsResults[i].value : { found: false, contactId: null, ownerName: null };
      var existingId = n.linkedin_url_canonical ? (dedupMap[n.linkedin_url_canonical] || null) : null;
      return {
        ...n,
        hubspot_found: hs.found,
        hubspot_contact_id: hs.contactId || null,
        hubspot_owner: hs.ownerName || null,
        already_in_pipeline: !!existingId,
        existing_lead_id: existingId,
        enriched: false,
        enrichment_data: null,
        prise_score: null,
        prise_reasoning: null,
        email: null,
        email_status: null,
        email_draft: null,
        added_to_pipeline: false,
        pipeline_lead_id: null,
      };
    });

    // Insert search record
    var { data: search, error: insertErr } = await supabase
      .from("cold_searches")
      .insert({
        filters: filters,
        status: "completed",
        leads_found: results.length,
        leads_enriched: 0,
        results: results,
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (insertErr) {
      console.error("Cold outbound POST /search insert error:", insertErr.message);
      return res.status(500).json({ error: "Failed to save search results" });
    }

    var response = { ...search };
    if (warnings.length > 0) response.warnings = warnings;
    res.status(201).json(response);
  } catch (err) {
    console.error("Cold outbound POST /search error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// GET /searches -- List search history (lightweight, no results)
// ────────────────────────────────────────────────────────────

router.get("/searches", async (req, res) => {
  try {
    var { data, error } = await supabase
      .from("cold_searches")
      .select("id, filters, status, leads_found, leads_enriched, created_at, completed_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Cold outbound GET /searches error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }
    res.json({ searches: data });
  } catch (err) {
    console.error("Cold outbound GET /searches error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// GET /searches/:id -- Single search with full results
// ────────────────────────────────────────────────────────────

router.get("/searches/:id", async (req, res) => {
  try {
    var { data: search, error } = await supabase
      .from("cold_searches")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (error || !search) {
      return res.status(404).json({ error: "Search not found" });
    }
    res.json(search);
  } catch (err) {
    console.error("Cold outbound GET /searches/:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// POST /searches/:id/enrich -- Enrich selected profiles (visitProfile + prise score)
// ────────────────────────────────────────────────────────────

router.post("/searches/:id/enrich", async (req, res) => {
  try {
    var { profile_indexes } = req.body;
    if (!Array.isArray(profile_indexes) || profile_indexes.length === 0) {
      return res.status(400).json({ error: "profile_indexes required (array of integers)" });
    }

    // Load search
    var { data: search, error: fetchErr } = await supabase
      .from("cold_searches")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !search) {
      return res.status(404).json({ error: "Search not found" });
    }

    var results = search.results || [];
    var enriched = 0;
    var errors = [];

    for (var idx of profile_indexes) {
      if (idx < 0 || idx >= results.length) continue;
      var profile = results[idx];
      if (profile.enriched) { enriched++; continue; } // Already enriched
      if (!profile.linkedin_url) { errors.push(idx); continue; }

      try {
        // visitProfile with posts (1 credit)
        var enrichData = await visitProfile(profile.linkedin_url, { includePosts: true });

        // Extract key data for prise scoring
        var priseInput = {
          first_name: profile.first_name,
          last_name: profile.last_name,
          headline: enrichData.headline || profile.headline,
          company: enrichData.company || profile.company,
          location: enrichData.location || profile.location,
          summary: enrichData.summary || enrichData.about || null,
          recent_posts: enrichData.posts || enrichData.recentPosts || [],
          connections_count: enrichData.connectionsCount || enrichData.connections_count || null,
        };

        // Score prise (Haiku)
        var priseResult = await scorePrise(priseInput);

        // Update result — fill company from enrichment if missing
        var enrichedCompany = enrichData.company || enrichData.companyName || enrichData.company_name || "";
        if (!enrichedCompany && Array.isArray(enrichData.experience) && enrichData.experience.length > 0) {
          enrichedCompany = enrichData.experience[0].companyName || enrichData.experience[0].company || "";
        }
        results[idx] = {
          ...profile,
          company: enrichedCompany || profile.company,
          enriched: true,
          enrichment_data: {
            summary: enrichData.summary || enrichData.about || null,
            experience: enrichData.experience || null,
            headline: enrichData.headline || null,
            company_description: enrichData.companyDescription || enrichData.company_description || null,
            posts: (enrichData.posts || enrichData.recentPosts || []).slice(0, 3).map(function (p) {
              return { text: (p.text || p.content || "").slice(0, 300), date: p.date || null };
            }),
            connections_count: enrichData.connectionsCount || enrichData.connections_count || null,
          },
          prise_score: priseResult.score,
          prise_reasoning: priseResult.reasoning,
        };
        enriched++;
      } catch (enrichErr) {
        console.error("Enrich error for index " + idx + ":", enrichErr.message);
        errors.push(idx);
      }

      // Rate limit between calls
      if (idx !== profile_indexes[profile_indexes.length - 1]) {
        await sleep(1500);
      }
    }

    // Re-fetch to avoid race condition, then merge our changes
    var { data: freshSearch } = await supabase
      .from("cold_searches").select("results").eq("id", req.params.id).single();
    var freshResults = (freshSearch && freshSearch.results) || results;
    for (var mergeIdx of profile_indexes) {
      if (mergeIdx >= 0 && mergeIdx < results.length && results[mergeIdx].enriched) {
        freshResults[mergeIdx] = results[mergeIdx];
      }
    }

    var { error: updateErr } = await supabase
      .from("cold_searches")
      .update({
        results: freshResults,
        leads_enriched: freshResults.filter(function (r) { return r.enriched; }).length,
      })
      .eq("id", req.params.id);

    if (updateErr) {
      console.error("Cold outbound enrich update error:", updateErr.message);
      return res.status(500).json({ error: "Failed to save enrichment results" });
    }

    res.json({
      ok: true,
      enriched: enriched,
      errors: errors,
      results: freshResults,
    });
  } catch (err) {
    console.error("Cold outbound POST /searches/:id/enrich error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// POST /searches/:id/to-pipeline -- Add selected leads to classic pipeline
// ────────────────────────────────────────────────────────────

router.post("/searches/:id/to-pipeline", async (req, res) => {
  try {
    var { profile_indexes } = req.body;
    if (!Array.isArray(profile_indexes) || profile_indexes.length === 0) {
      return res.status(400).json({ error: "profile_indexes required" });
    }

    var { data: search, error: fetchErr } = await supabase
      .from("cold_searches")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !search) {
      return res.status(404).json({ error: "Search not found" });
    }

    var results = search.results || [];
    var inserted = 0;
    var errors = [];

    for (var idx of profile_indexes) {
      if (idx < 0 || idx >= results.length) continue;
      var profile = results[idx];
      if (profile.added_to_pipeline) continue; // Already added
      if (!profile.linkedin_url_canonical) { errors.push(idx); continue; }

      try {
        var leadRow = {
          linkedin_url: profile.linkedin_url,
          linkedin_url_canonical: profile.linkedin_url_canonical,
          first_name: profile.first_name || null,
          last_name: profile.last_name || null,
          full_name: ((profile.first_name || "") + " " + (profile.last_name || "")).trim() || null,
          headline: profile.enriched ? (profile.enrichment_data?.headline || profile.headline) : profile.headline,
          company_name: profile.company || null,
          location: profile.location || null,
          status: profile.hubspot_found ? "hubspot_existing" : "new",
          signal_type: "cold_search",
          signal_category: "cold_outbound",
          signal_date: new Date().toISOString(),
          icp_score: profile.prise_score || 0,
          tier: (profile.prise_score || 0) >= 60 ? "warm" : "cold",
          metadata: {
            search_id: search.id,
            source_origin: "bereach_search",
            cold_outbound: true,
            prise_score: profile.prise_score,
            prise_reasoning: profile.prise_reasoning,
            hubspot_contact_id: profile.hubspot_contact_id || null,
          },
        };

        var { data: lead, error: upsertErr } = await supabase
          .from("leads")
          .upsert(leadRow, { onConflict: "linkedin_url_canonical" })
          .select("id")
          .single();

        if (upsertErr) {
          console.error("to-pipeline upsert error:", upsertErr.message);
          errors.push(idx);
          continue;
        }

        results[idx] = {
          ...profile,
          added_to_pipeline: true,
          pipeline_lead_id: lead.id,
        };
        inserted++;
      } catch (pipeErr) {
        console.error("to-pipeline error for index " + idx + ":", pipeErr.message);
        errors.push(idx);
      }
    }

    // Re-fetch to avoid race condition, merge our changes
    var { data: freshPipe } = await supabase
      .from("cold_searches").select("results").eq("id", req.params.id).single();
    var freshPipeResults = (freshPipe && freshPipe.results) || results;
    for (var mi of profile_indexes) {
      if (mi >= 0 && mi < results.length) freshPipeResults[mi] = results[mi];
    }
    await supabase
      .from("cold_searches")
      .update({ results: freshPipeResults })
      .eq("id", req.params.id);

    res.json({ ok: true, inserted: inserted, errors: errors, results: freshPipeResults });
  } catch (err) {
    console.error("Cold outbound POST /searches/:id/to-pipeline error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// POST /searches/:id/to-email -- FullEnrich + Sonnet email draft
// ────────────────────────────────────────────────────────────

router.post("/searches/:id/to-email", async (req, res) => {
  try {
    var { profile_indexes } = req.body;
    if (!Array.isArray(profile_indexes) || profile_indexes.length === 0) {
      return res.status(400).json({ error: "profile_indexes required" });
    }

    var { data: search, error: fetchErr } = await supabase
      .from("cold_searches")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !search) {
      return res.status(404).json({ error: "Search not found" });
    }

    var results = search.results || [];
    var processed = 0;
    var errors = [];
    var runId = crypto.randomUUID();

    for (var idx of profile_indexes) {
      if (idx < 0 || idx >= results.length) continue;
      var profile = results[idx];
      if (!profile.linkedin_url) { errors.push({ idx: idx, reason: "no_url" }); continue; }

      try {
        // Step 1: FullEnrich for email
        var enrichResult = await enrichContactInfo(profile.linkedin_url, runId);

        if (!enrichResult || !enrichResult.email) {
          results[idx] = { ...profile, email_status: "not_found" };
          errors.push({ idx: idx, reason: "no_email" });
          continue;
        }

        var email = enrichResult.email;

        // Step 2: Generate email draft with Sonnet
        var draft = await generateColdEmailDraft(profile, email);

        // Step 3: Insert lead with email_pending status
        var leadRow = {
          linkedin_url: profile.linkedin_url,
          linkedin_url_canonical: profile.linkedin_url_canonical,
          first_name: profile.first_name || null,
          last_name: profile.last_name || null,
          full_name: ((profile.first_name || "") + " " + (profile.last_name || "")).trim() || null,
          headline: profile.enriched ? (profile.enrichment_data?.headline || profile.headline) : profile.headline,
          company_name: profile.company || null,
          location: profile.location || null,
          email: email,
          status: "email_pending",
          signal_type: "cold_search",
          signal_category: "cold_outbound",
          signal_date: new Date().toISOString(),
          icp_score: profile.prise_score || 0,
          tier: (profile.prise_score || 0) >= 60 ? "warm" : "cold",
          metadata: {
            search_id: search.id,
            source_origin: "bereach_search",
            cold_outbound: true,
            email_status: "found",
            draft_email_subject: draft ? draft.subject : null,
            draft_email_body: draft ? draft.body : null,
          },
        };

        var { data: lead, error: upsertErr } = await supabase
          .from("leads")
          .upsert(leadRow, { onConflict: "linkedin_url_canonical" })
          .select("id")
          .single();

        if (upsertErr) {
          errors.push({ idx: idx, reason: "upsert_failed" });
          continue;
        }

        results[idx] = {
          ...profile,
          email: email,
          email_status: "found",
          email_draft: draft,
          added_to_pipeline: true,
          pipeline_lead_id: lead ? lead.id : null,
        };
        processed++;
      } catch (emailErr) {
        console.error("to-email error for index " + idx + ":", emailErr.message);
        errors.push({ idx: idx, reason: emailErr.message.slice(0, 100) });
      }
    }

    // Re-fetch to avoid race condition, merge our changes
    var { data: freshEmail } = await supabase
      .from("cold_searches").select("results").eq("id", req.params.id).single();
    var freshEmailResults = (freshEmail && freshEmail.results) || results;
    for (var ei of profile_indexes) {
      if (ei >= 0 && ei < results.length) freshEmailResults[ei] = results[ei];
    }
    await supabase
      .from("cold_searches")
      .update({ results: freshEmailResults })
      .eq("id", req.params.id);

    res.json({ ok: true, processed: processed, errors: errors, results: freshEmailResults });
  } catch (err) {
    console.error("Cold outbound POST /searches/:id/to-email error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// Helper: Generate cold email draft via Sonnet
// ────────────────────────────────────────────────────────────

async function generateColdEmailDraft(profile, email) {
  try {
    var client = getAnthropicClient();
    var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme/30min";

    var contextLines = [
      "Prospect: " + (profile.first_name || "") + " " + (profile.last_name || ""),
      "Titre: " + (profile.headline || "inconnu"),
      "Entreprise: " + (profile.company || "inconnue"),
      "Localisation: " + (profile.location || "inconnue"),
      "Email: " + email,
    ];

    if (profile.enrichment_data) {
      var ed = profile.enrichment_data;
      if (ed.summary) contextLines.push("Bio: " + ed.summary.slice(0, 300));
      if (ed.company_description) contextLines.push("Description entreprise: " + ed.company_description.slice(0, 200));
      if (ed.posts && ed.posts.length > 0) {
        contextLines.push("Publications recentes:");
        ed.posts.slice(0, 3).forEach(function (p, i) {
          contextLines.push("  Post " + (i + 1) + ": " + (p.text || "").slice(0, 200));
        });
      }
    }

    var systemPrompt = "Tu es Julien Dumas, expert en strategie conversationnelle et messaging (WhatsApp, RCS, SMS). Tu diriges MessagingMe (messagingme.fr)." +
      " Tu ecris un PREMIER email de prospection a froid a un prospect que tu ne connais pas." +
      " TON : Direct, naturel, pair a pair. Pas corporate, pas commercial. Vouvoiement." +
      " STRUCTURE : Objet court et intrigant (pas vendeur). Corps : 3-5 phrases. Commence par une observation sur le secteur/poste du prospect. Pose une question ouverte." +
      " INTERDICTIONS : 'je me permets', 'n hesitez pas', 'serait-il possible', 'MessagingMe', 'je tombe sur votre profil', 'j ai vu que', 'Chez MessagingMe'." +
      " JAMAIS de signature dans le body (elle est ajoutee automatiquement)." +
      " Reponds UNIQUEMENT en JSON: {\"subject\": \"...\", \"body\": \"<html>...</html>\"}";

    var resp = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: contextLines.join("\n") }],
    });

    var raw = resp.content[0].text.trim();
    raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    var jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    var parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.subject || !parsed.body) return null;

    // Add signature
    var signature = '<br><br>Julien Dumas<br>CEO MessagingMe<br><a href="https://www.messagingme.fr">www.messagingme.fr</a>' +
      '<br><br><a href="' + calendlyUrl + '" style="display:inline-block;padding:10px 20px;background-color:#4F46E5;color:#ffffff;text-decoration:none;border-radius:6px;font-size:14px;font-weight:600;">Programmer un echange</a>';

    parsed.body = parsed.body
      .replace(/<\/(body|html)>/i, signature + "</$1>")
      .replace(/(<br\s*\/?>){3,}/g, "<br><br>");

    if (!parsed.body.includes("messagingme.fr")) {
      parsed.body = parsed.body + signature;
    }

    return parsed;
  } catch (err) {
    console.error("generateColdEmailDraft error:", err.message);
    return null;
  }
}

module.exports = router;
