/**
 * Task Agent Cold — orchestrates the multi-agent cold prospecting pipeline.
 *
 * Called on-demand from the dashboard (POST /api/cold-outreach/run-today)
 * or from a future cron trigger. NOT part of the daily Task A/B/C/D schedule.
 *
 * Pipeline:
 *   1. RESEARCHER (Sonnet + BeReach search tools) → 30-50 raw candidates
 *   2. QUALIFIER  (Sonnet + BeReach enrich tools) → ~10-15 qualified leads
 *   3. CHALLENGER (Sonnet, no tools)              → 8-10 final A-tier leads
 *   4. PERSIST    (code, no LLM)                  → cold_outreach_runs + leads
 */

const crypto = require("crypto");
const { supabase } = require("../lib/supabase");
const { runAgent } = require("../lib/agent-loop");
const { RESEARCHER_TOOLS, QUALIFIER_TOOLS, CHALLENGER_TOOLS, getToolDefinitions, getToolHandlers } = require("../lib/agent-tools");
const { RESEARCHER_PROMPT, QUALIFIER_PROMPT, CHALLENGER_PROMPT } = require("../lib/agent-prompts");
const { canonicalizeLinkedInUrl } = require("../lib/url-utils");
const { log } = require("../lib/logger");
const { enrichAllCandidates } = require("../lib/agent-enrichment");

/**
 * Load known leads from Supabase for dedup (same logic as dump-known-leads.sh
 * but live from DB instead of a JSON file).
 */
async function loadKnownLeads() {
  const urls = new Set();
  const emails = new Set();
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await supabase
      .from("leads")
      .select("linkedin_url_canonical, email")
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      if (row.linkedin_url_canonical) urls.add(row.linkedin_url_canonical);
      if (row.email) emails.add(row.email.toLowerCase());
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return { urls, emails, count: urls.size };
}

/**
 * Build a fallback candidate entry for leads that couldn't be processed by
 * the Qualifier (silent drops, batch failures). They enter the pipeline as
 * linkedin_only + weak_signal, ready for Task B (LinkedIn invitation).
 */
function fallbackCandidate(c, reason) {
  return {
    full_name: c.full_name,
    headline: c.headline,
    company: (c.enrichment && c.enrichment.company && c.enrichment.company.name) || c.company,
    company_sector: c.enrichment && c.enrichment.company && c.enrichment.company.sector,
    company_size: c.enrichment && c.enrichment.company && c.enrichment.company.size,
    company_location: (c.enrichment && c.enrichment.company && c.enrichment.company.location) || c.location,
    linkedin_url: c.linkedin_url,
    linkedin_url_canonical: c.linkedin_url_canonical,
    email: (c.enrichment && c.enrichment.email) || null,
    linkedin_only: !(c.enrichment && c.enrichment.email),
    weak_signal: true,
    icp_fit_reasoning: "Recovered from Qualifier (" + reason + "). Rôle + secteur plausibles à la lecture.",
    angle_of_approach: "Fallback : angle à affiner manuellement ou invitation LinkedIn sans note (Task B).",
    signal_found: null,
    enrichment: c.enrichment || null,
    _recovered: true,
  };
}

/**
 * Extract JSON from the agent's final text response.
 * Handles ```json blocks, raw JSON, AND truncated JSON (e.g. when the LLM
 * hits maxTokens mid-array). For truncated output we recover individual
 * candidate objects by scanning the raw text.
 */
function extractJson(text) {
  if (!text) return null;

  // 1. Try to extract from ```json ... ``` block (closing fence present)
  const fenced = text.match(/```json\s*([\s\S]*?)```/);
  let raw = fenced ? fenced[1].trim() : text.trim();

  // If no closing fence, strip the opening ```json marker if present
  if (!fenced) raw = raw.replace(/^```(?:json)?\s*/i, "").trim();

  // 2. Try parsing as-is
  try { return JSON.parse(raw); } catch (_e1) {}

  // 3. Try the first { ... } block (greedy)
  const braceMatch = raw.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch (_e2) {}
  }

  // 4. Truncation recovery: scan the raw text for individual candidate /
  //    qualified_lead / validated objects and reconstruct the array manually.
  //    Works when the LLM emitted a well-formed list of sub-objects but the
  //    enclosing array or final brace got cut off by maxTokens.
  const objects = extractTopLevelObjects(raw);
  if (objects.length > 0) {
    // Best-effort: figure out which key the objects belong to based on context.
    const key = raw.includes("\"qualified_leads\"") ? "qualified_leads"
      : raw.includes("\"validated\"") ? "validated"
      : "candidates";
    return { [key]: objects, _recovered_from_truncation: true };
  }

  return null;
}

/**
 * Scan text for JSON object literals containing a linkedin_url and try to parse
 * each one. Works regardless of nesting depth (candidates live at depth 2
 * inside { "candidates": [ ... ] }). Tolerates truncated final object.
 */
function extractTopLevelObjects(text) {
  const out = [];
  // Anchor on "linkedin_url" — every candidate object contains one. For each
  // match, scan backwards to find the opening '{' of its enclosing object,
  // then scan forward to find the matching '}'.
  const anchor = /"linkedin_url"\s*:/g;
  let m;
  const seen = new Set();
  while ((m = anchor.exec(text)) !== null) {
    // m.index points at the opening '"' of "linkedin_url". Start backward
    // scanning ONE char before so we don't immediately flip into inString.
    const anchorIdx = Math.max(0, m.index - 1);
    const start = findEnclosingOpenBrace(text, anchorIdx);
    if (start < 0 || seen.has(start)) continue;
    seen.add(start);
    // Scan forward for the matching close brace
    const end = findMatchingCloseBrace(text, start);
    if (end < 0) continue; // truncated — skip
    const slice = text.slice(start, end + 1);
    try {
      const parsed = JSON.parse(slice);
      if (parsed && (parsed.linkedin_url || parsed.full_name)) {
        out.push(parsed);
      }
    } catch (_e) { /* malformed, skip */ }
  }
  return out;
}

function findEnclosingOpenBrace(text, from) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = from; i >= 0; i--) {
    const ch = text[i];
    // Backward string detection is tricky — approximate with a simple quote toggle
    if (ch === '"' && (i === 0 || text[i - 1] !== "\\")) inString = !inString;
    if (inString) continue;
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

function findMatchingCloseBrace(text, openIdx) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Main orchestrator.
 *
 * @param {object} brief - { theme, geo, exclusions, target_count, notes }
 * @param {string} runId - UUID
 * @returns {object} { run_id, leads_inserted, phases }
 */
async function runAgentCold(brief, runId) {
  if (!runId) runId = crypto.randomUUID();
  const startTime = Date.now();

  await log(runId, "agent-cold", "info",
    "Starting agent cold pipeline — theme: " + (brief.theme || "unspecified"));

  // Insert the run row IMMEDIATELY with status='running' so the dashboard can
  // display "en cours" and any mid-pipeline crash leaves a visible failed row.
  const { data: runRowEarly, error: earlyErr } = await supabase
    .from("cold_outreach_runs")
    .insert({
      run_date: new Date().toISOString().slice(0, 10),
      agent_name: "agent-cold-v1",
      credits_used: 0,
      leads_count: 0,
      status: "running",
      phase: "researcher",
      brief: brief,
      metadata: { brief, phases: {}, run_notes: brief.theme || "agent cold run" },
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (earlyErr) {
    await log(runId, "agent-cold", "error", "Failed to create run row: " + earlyErr.message);
    throw new Error("Failed to create run row: " + earlyErr.message);
  }

  const dbRunId = runRowEarly.id;

  try {
    return await _runAgentColdPipeline(brief, runId, dbRunId, startTime);
  } catch (err) {
    console.error("[agent-cold] pipeline error (marking run failed):", err.message);
    await log(runId, "agent-cold", "error", "Pipeline threw: " + err.message);
    try {
      await supabase.from("cold_outreach_runs")
        .update({
          status: "failed",
          error_message: (err.message || String(err)).slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", dbRunId);
    } catch (_e) { /* best-effort */ }
    throw err;
  }
}

async function _runAgentColdPipeline(brief, runId, dbRunId, startTime) {

  const updateRun = async (patch) => {
    try {
      await supabase.from("cold_outreach_runs")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", dbRunId);
    } catch (_e) { /* non-blocking */ }
  };

  // Load known leads for dedup
  const known = await loadKnownLeads();
  await log(runId, "agent-cold", "info", "Loaded " + known.count + " known leads for dedup");

  // Load case studies (real client results) — injected into every agent prompt
  // so they can cite concrete proof points and match angles by sector.
  let caseStudiesBlock = "";
  try {
    const { data: cases } = await supabase
      .from("case_studies")
      .select("client_name, sector, metric_label, metric_value, description")
      .eq("is_active", true);
    if (cases && cases.length > 0) {
      caseStudiesBlock = "\n\n## CAS CLIENTS RÉELS (à citer quand le secteur matche)\n" +
        cases.map((c) =>
          "- **" + c.client_name + "** (" + c.sector + ") — " +
          c.metric_label + " : " + c.metric_value +
          (c.description ? ". " + c.description.slice(0, 200) : "")
        ).join("\n");
      await log(runId, "agent-cold", "info", "Loaded " + cases.length + " case studies for agent context");
    }
  } catch (_e) { /* fail-open */ }

  const phases = {};

  // ═══════════════════════════════════════════════════════════════
  // PHASE 1 — RESEARCHER
  // ═══════════════════════════════════════════════════════════════
  const researcherBrief = [
    "BRIEF DU JOUR :",
    "Thème / cible : " + (brief.theme || "à déterminer"),
    brief.geo ? "Géographie : " + brief.geo : "Géographie : France (défaut)",
    brief.exclusions ? "Exclusions spécifiques : " + brief.exclusions : "",
    "Objectif : trouver 30-50 candidats bruts (PERSONNES décisionnaires, pas des entreprises).",
    "",
    "DEDUP — " + known.count + " LinkedIn URLs sont DÉJÀ dans notre pipeline et doivent être exclues.",
    "Utilise l'outil **check_known_leads** (batch jusqu'à 50 URLs) pour filtrer tes candidats avant de les rendre. Gratuit, aucun crédit BeReach.",
    "",
    "Budget BeReach pour ta phase : max 150 crédits.",
    caseStudiesBlock,
  ].filter(Boolean).join("\n");

  await log(runId, "agent-cold", "info", "Phase 1: RESEARCHER starting (Gemini Flash)");
  const researcherResult = await runAgent({
    systemPrompt: RESEARCHER_PROMPT,
    userMessage: researcherBrief,
    tools: getToolDefinitions(RESEARCHER_TOOLS),
    toolHandlers: getToolHandlers(RESEARCHER_TOOLS),
    provider: "gemini",
    model: "gemini-2.5-flash",
    maxTokens: 16384,
    maxIterations: 40,
    runId,
    agentName: "researcher",
  });

  const researcherOutput = extractJson(researcherResult.finalText);
  const rawCandidates = (researcherOutput && researcherOutput.candidates) || [];

  // Debug: when the output is empty or unparseable, log what Gemini actually
  // returned so we can diagnose on the next run instead of flying blind.
  if (rawCandidates.length === 0) {
    const sample = (researcherResult.finalText || "").slice(0, 1500);
    await log(runId, "researcher", "warn",
      "Researcher returned 0 candidates. JSON parsed: " + (researcherOutput ? "yes" : "no") +
      ". finalText sample (first 1500 chars): " + sample);
  }

  // Dedup against known leads
  const dedupedCandidates = rawCandidates.filter((c) => {
    if (!c.linkedin_url) return false;
    const canonical = canonicalizeLinkedInUrl(c.linkedin_url);
    if (!canonical) return false;
    if (known.urls.has(canonical)) return false;
    c.linkedin_url_canonical = canonical;
    return true;
  });

  phases.researcher = {
    raw_count: rawCandidates.length,
    deduped_count: dedupedCandidates.length,
    tool_calls: researcherResult.toolCalls.length,
    iterations: researcherResult.iterations,
    input_tokens: researcherResult.inputTokens,
    output_tokens: researcherResult.outputTokens,
    notes: researcherOutput ? researcherOutput.notes : null,
    // Checkpoint: persist the full deduped list so a Phase 2+ crash doesn't
    // lose the Researcher's work. Compact shape to stay JSONB-friendly.
    output: dedupedCandidates.map((c) => ({
      full_name: c.full_name,
      headline: c.headline,
      company: c.company,
      linkedin_url: c.linkedin_url,
      linkedin_url_canonical: c.linkedin_url_canonical,
      location: c.location,
      selection_reason: c.selection_reason,
    })),
  };

  await log(runId, "agent-cold", "info",
    "Phase 1 done: " + rawCandidates.length + " raw → " + dedupedCandidates.length + " after dedup. " +
    researcherResult.toolCalls.length + " tool calls, " + researcherResult.iterations + " iterations.");

  if (dedupedCandidates.length === 0) {
    await log(runId, "agent-cold", "warn", "No candidates after dedup — aborting pipeline");
    await updateRun({ status: "failed", phase: "researcher", error_message: "No candidates after dedup", metadata: { brief, phases } });
    return { run_id: dbRunId, leads_inserted: 0, phases };
  }

  // Phase 1 checkpoint persisted before we touch BeReach/FullEnrich
  await updateRun({ phase: "qualifier", metadata: { brief, phases } });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2a — ENRICHMENT (deterministic, Node async)
  // ═══════════════════════════════════════════════════════════════
  //
  // Every candidate gets visitProfile + visitCompany + fullenrich email in
  // parallel (concurrency=3 to respect BeReach rate limits). Predictable
  // cost (3 credits BeReach + 1 FullEnrich per candidate). Can't hang —
  // if a specific call times out or 429s, only that field is null.
  const enrichStartMs = Date.now();
  let enrichResult;
  try {
    enrichResult = await enrichAllCandidates(dedupedCandidates, { runId, concurrency: 3 });
  } catch (err) {
    await log(runId, "agent-cold", "error", "Enrichment phase threw: " + err.message);
    throw err;
  }
  const enrichedCandidates = enrichResult.enriched;
  phases.enrichment = {
    ...enrichResult.stats,
    // Checkpoint: persist enriched candidates so a Qualifier crash doesn't
    // waste the BeReach/FullEnrich credits we just burnt.
    output: enrichedCandidates.map((c) => ({
      full_name: c.full_name,
      linkedin_url: c.linkedin_url,
      email: c.enrichment && c.enrichment.email,
      email_status: c.enrichment && c.enrichment.email_status,
      has_profile: !!(c.enrichment && c.enrichment.profile),
      has_company: !!(c.enrichment && c.enrichment.company),
    })),
  };
  await updateRun({ phase: "qualifier", metadata: { brief, phases } });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2b — QUALIFIER (pure-text agent, no tools)
  // ═══════════════════════════════════════════════════════════════
  //
  // The Qualifier now receives PRE-ENRICHED data and has NO tools. It just
  // applies the 5 checks and outputs qualified/rejected arrays. No hang
  // possible (single LLM call, no tool loops). Batched to keep input size
  // reasonable (each batch = ~15 enriched candidates ≈ 5-8K tokens).
  const BATCH_SIZE = 15;
  const batches = [];
  for (let i = 0; i < enrichedCandidates.length; i += BATCH_SIZE) {
    batches.push(enrichedCandidates.slice(i, i + BATCH_SIZE));
  }

  await log(runId, "agent-cold", "info",
    "Phase 2b: QUALIFIER starting with " + enrichedCandidates.length + " pre-enriched candidates " +
    "in " + batches.length + " batch(es) of up to " + BATCH_SIZE + " (Gemini Flash, no tools)");

  const qualifiedLeads = [];
  const rejectedArray = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalIterations = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    // Compact the batch for the prompt — only fields the Qualifier needs
    const compactBatch = batch.map((c, idx) => ({
      idx: (b * BATCH_SIZE) + idx,
      full_name: c.full_name,
      headline: c.headline,
      company: (c.enrichment && c.enrichment.company && c.enrichment.company.name) || c.company,
      company_sector: c.enrichment && c.enrichment.company && c.enrichment.company.sector,
      company_size: c.enrichment && c.enrichment.company && c.enrichment.company.size,
      company_location: c.enrichment && c.enrichment.company && c.enrichment.company.location,
      company_description: c.enrichment && c.enrichment.company && c.enrichment.company.description,
      profile_summary: c.enrichment && c.enrichment.profile && c.enrichment.profile.summary,
      recent_posts: c.enrichment && c.enrichment.profile && c.enrichment.profile.recent_posts,
      experience: c.enrichment && c.enrichment.profile && c.enrichment.profile.experience,
      linkedin_url: c.linkedin_url,
      location: c.location,
      email: c.enrichment && c.enrichment.email,
      email_status: c.enrichment && c.enrichment.email_status,
    }));

    const qualifierInput = [
      "BRIEF DU JOUR : " + (brief.theme || ""),
      brief.geo ? "Géo : " + brief.geo : "",
      "",
      "CANDIDATS PRÉ-ENRICHIS (lot " + (b + 1) + "/" + batches.length + ", " + batch.length + " candidats) :",
      "Les données de profil, entreprise et email sont déjà là. Tu N'AS PAS D'OUTILS. Tu appliques juste les 5 checks et tu rends un JSON.",
      "",
      JSON.stringify(compactBatch, null, 2),
      "",
      caseStudiesBlock,
      "",
      "Rends ta réponse finale au format JSON : {\"qualified_leads\": [...], \"rejected\": [...]}. Chaque candidat d'entrée DOIT apparaître EXACTEMENT UNE FOIS dans qualified_leads OU rejected. Quand tu construis l'angle_of_approach, cite le cas client le plus pertinent par secteur si il y en a un.",
    ].filter(Boolean).join("\n");

    let batchResult;
    try {
      batchResult = await runAgent({
        systemPrompt: QUALIFIER_PROMPT,
        userMessage: qualifierInput,
        tools: [], // pure text, no tools → can't hang on tool calls
        toolHandlers: {},
        provider: "gemini",
        model: "gemini-2.5-flash",
        maxTokens: 16384,
        maxIterations: 2, // pure-text, no loops
        runId,
        agentName: "qualifier",
      });
    } catch (err) {
      await log(runId, "agent-cold", "error",
        "Qualifier batch " + (b + 1) + " failed: " + err.message.slice(0, 100) +
        ". Recovering " + batch.length + " as linkedin_only.");
      batch.forEach((c) => {
        qualifiedLeads.push(fallbackCandidate(c, "Qualifier batch " + (b + 1) + " failed (" + err.message.slice(0, 60) + ")"));
      });
      continue;
    }

    totalInputTokens += batchResult.inputTokens || 0;
    totalOutputTokens += batchResult.outputTokens || 0;
    totalIterations += batchResult.iterations;

    const batchOutput = extractJson(batchResult.finalText);
    const batchQualified = (batchOutput && batchOutput.qualified_leads) || [];
    const batchRejected = (batchOutput && batchOutput.rejected) || [];

    // Exhaustivity guard per batch
    const accountedInBatch = new Set();
    [...batchQualified, ...batchRejected].forEach((l) => {
      if (l.linkedin_url) accountedInBatch.add(canonicalizeLinkedInUrl(l.linkedin_url));
      if (l.full_name) accountedInBatch.add("name:" + String(l.full_name).toLowerCase().trim());
    });
    const batchDropped = batch.filter((c) => {
      const byUrl = accountedInBatch.has(canonicalizeLinkedInUrl(c.linkedin_url));
      const byName = c.full_name && accountedInBatch.has("name:" + String(c.full_name).toLowerCase().trim());
      return !byUrl && !byName;
    });
    batchDropped.forEach((c) => batchQualified.push(fallbackCandidate(c, "silent drop by Qualifier")));

    qualifiedLeads.push(...batchQualified);
    rejectedArray.push(...batchRejected);

    await log(runId, "agent-cold", "info",
      "Qualifier batch " + (b + 1) + " done: " + batchQualified.length + " qualified, " +
      batchRejected.length + " rejected, " + batchDropped.length + " recovered.");
  }

  const qualifierOutput = { qualified_leads: qualifiedLeads, rejected: rejectedArray };

  phases.qualifier = {
    qualified_count: qualifiedLeads.length,
    rejected_count: rejectedArray.length,
    rejected: rejectedArray.slice(0, 50),
    iterations: totalIterations,
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    // Checkpoint
    output: qualifiedLeads.map((l) => ({
      full_name: l.full_name, linkedin_url: l.linkedin_url,
      email: l.email, linkedin_only: l.linkedin_only, weak_signal: l.weak_signal,
    })),
  };
  await updateRun({ phase: "challenger", metadata: { brief, phases } });

  await log(runId, "agent-cold", "info",
    "Phase 2 done: " + qualifiedLeads.length + " qualified, " + rejectedArray.length + " rejected.");

  if (qualifiedLeads.length === 0) {
    await log(runId, "agent-cold", "warn", "No leads qualified — aborting pipeline");
    await updateRun({ status: "failed", phase: "qualifier", error_message: "No leads passed qualifier checks", metadata: { brief, phases } });
    return { run_id: dbRunId, leads_inserted: 0, phases };
  }

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3 — CHALLENGER (permissive mode)
  // ═══════════════════════════════════════════════════════════════
  const challengerInput = [
    "BRIEF DU JOUR : " + (brief.theme || ""),
    "",
    "LEADS QUALIFIÉS (" + qualifiedLeads.length + ") :",
    "",
    JSON.stringify(qualifiedLeads, null, 2),
    "",
    "Julien préfère trop de leads à pas assez. Ajuste la confidence (low/medium/high), ne rejette que les leads CLAIREMENT hors ICP.",
    caseStudiesBlock,
  ].join("\n");

  // Challenger uses Claude Sonnet — this is the ONE phase where reasoning
  // quality matters most (critical judgement on lead strength). Flash would
  // be too weak for nuanced argumentation.
  await log(runId, "agent-cold", "info", "Phase 3: CHALLENGER starting with " + qualifiedLeads.length + " leads (Claude Sonnet)");
  const challengerResult = await runAgent({
    systemPrompt: CHALLENGER_PROMPT,
    userMessage: challengerInput,
    tools: [],
    toolHandlers: {},
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    maxTokens: 4096,
    maxIterations: 1,
    runId,
    agentName: "challenger",
  });

  const challengerOutput = extractJson(challengerResult.finalText);
  const validatedNames = new Set(
    ((challengerOutput && challengerOutput.validated) || [])
      .filter((v) => v.verdict === "KEEP")
      .map((v) => v.full_name)
  );

  // Filter qualified leads to only keep the challenger-validated ones
  const finalLeads = qualifiedLeads.filter((l) => validatedNames.has(l.full_name));

  phases.challenger = {
    kept: finalLeads.length,
    dropped: qualifiedLeads.length - finalLeads.length,
    input_tokens: challengerResult.inputTokens,
    output_tokens: challengerResult.outputTokens,
    summary: challengerOutput ? challengerOutput.summary : null,
    // Checkpoint: the names kept — allows resuming Phase 4 persist from the qualifier checkpoint
    kept_names: Array.from(validatedNames),
  };
  await updateRun({ phase: "persist", metadata: { brief, phases } });

  await log(runId, "agent-cold", "info",
    "Phase 3 done: " + finalLeads.length + " kept, " + (qualifiedLeads.length - finalLeads.length) + " dropped.");

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4 — PERSIST
  // ═══════════════════════════════════════════════════════════════
  await log(runId, "agent-cold", "info", "Phase 4: PERSIST — inserting " + finalLeads.length + " leads");
  await updateRun({ phase: "persist", metadata: { brief, phases } });

  // Credit estimate: Researcher's BeReach tool calls (~2 credits each) +
  // deterministic enrichment (2 BeReach + 1 FullEnrich per candidate enriched)
  const enrichedCount = (phases.enrichment && phases.enrichment.total) || 0;
  const totalCreditsEstimate =
    (phases.researcher.tool_calls || 0) * 2 +
    enrichedCount * 3;

  // Re-use the run row we created at the start of the pipeline
  const runRow = { id: dbRunId };

  // Insert leads
  let inserted = 0;
  for (const lead of finalLeads) {
    const canonical = canonicalizeLinkedInUrl(lead.linkedin_url);
    if (!canonical) continue;

    // Final dedup check (in case another run inserted this lead while we were working)
    const { data: existing } = await supabase
      .from("leads")
      .select("id")
      .eq("linkedin_url_canonical", canonical)
      .limit(1);
    if (existing && existing.length > 0) continue;

    const fullName = String(lead.full_name || "").trim();
    const parts = fullName.split(/\s+/);

    const { error: insErr } = await supabase.from("leads").insert({
      linkedin_url: lead.linkedin_url,
      linkedin_url_canonical: canonical,
      full_name: fullName || null,
      first_name: parts[0] || null,
      last_name: parts.length > 1 ? parts.slice(1).join(" ") : null,
      headline: lead.headline || null,
      email: lead.email || null,
      company_name: lead.company || null,
      company_sector: lead.company_sector || null,
      company_size: lead.company_size || null,
      company_location: lead.company_location || null,
      status: "scored",
      signal_type: "cold_search",
      signal_category: "cold_outbound",
      signal_source: lead.linkedin_only ? "agent_cold_v1_linkedin_only" : "agent_cold_v1",
      signal_date: new Date().toISOString(),
      icp_score: 70, // Agent-qualified leads start at warm minimum
      tier: "warm",
      metadata: {
        cold_run_id: runRow.id,
        cold_outbound: true,
        agent_name: "agent-cold-v1",
        linkedin_only: !!lead.linkedin_only,
        icp_fit_reasoning: lead.icp_fit_reasoning || null,
        angle_of_approach: lead.angle_of_approach || null,
        enrichment: lead.enrichment || null,
        signal_found: lead.signal_found || null,
      },
    });

    if (!insErr) inserted++;
  }

  await log(runId, "agent-cold", "info",
    "Phase 4 done: " + inserted + "/" + finalLeads.length + " leads inserted. " +
    "Run #" + runRow.id + ". Total duration: " + Math.round((Date.now() - startTime) / 1000) + "s.");

  // Finalize the run row with the summary
  await updateRun({
    status: "completed",
    phase: "persist",
    credits_used: totalCreditsEstimate,
    leads_count: inserted,
    metadata: {
      brief,
      phases,
      duration_ms: Date.now() - startTime,
      run_notes: brief.theme || "agent cold run",
    },
  });

  return {
    run_id: runRow.id,
    leads_inserted: inserted,
    phases,
    duration_ms: Date.now() - startTime,
  };
}

module.exports = { runAgentCold };
