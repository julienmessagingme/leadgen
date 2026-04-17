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
 * Extract JSON from the agent's final text response.
 * Handles ```json blocks and raw JSON.
 */
function extractJson(text) {
  if (!text) return null;
  // Try to extract from ```json ... ``` block
  const match = text.match(/```json\s*([\s\S]*?)```/);
  const raw = match ? match[1].trim() : text.trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Try to find the first { ... } block
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]); } catch (_e2) {}
    }
    return null;
  }
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
    maxTokens: 8192,
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
  };

  await log(runId, "agent-cold", "info",
    "Phase 1 done: " + rawCandidates.length + " raw → " + dedupedCandidates.length + " after dedup. " +
    researcherResult.toolCalls.length + " tool calls, " + researcherResult.iterations + " iterations.");

  if (dedupedCandidates.length === 0) {
    await log(runId, "agent-cold", "warn", "No candidates after dedup — aborting pipeline");
    await updateRun({ status: "failed", phase: "researcher", error_message: "No candidates after dedup", metadata: { brief, phases } });
    return { run_id: dbRunId, leads_inserted: 0, phases };
  }

  await updateRun({ phase: "qualifier", metadata: { brief, phases } });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2 — QUALIFIER
  // ═══════════════════════════════════════════════════════════════
  const qualifierInput = [
    "BRIEF DU JOUR : " + (brief.theme || ""),
    brief.geo ? "Géo : " + brief.geo : "",
    "",
    "CANDIDATS BRUTS DU CHERCHEUR (" + dedupedCandidates.length + ") :",
    "",
    JSON.stringify(dedupedCandidates, null, 2),
    "",
    "Applique les 5 checks sur chacun. Enrichis ceux qui passent les checks 1-3 avant de dépenser des crédits FullEnrich.",
    "Budget : ~100 crédits BeReach (visitProfile + visitCompany) + ~15 crédits FullEnrich (emails).",
    caseStudiesBlock,
    "",
    "Quand tu construis l'angle_of_approach, cite le cas client le plus pertinent par secteur si il y en a un. Exemple : si le lead est en assurance, cite Gan Prévoyance. Si transport, cite Keolis. Si aucun cas ne matche le secteur, mentionne le concept sans citer de client.",
  ].filter(Boolean).join("\n");

  await log(runId, "agent-cold", "info", "Phase 2: QUALIFIER starting with " + dedupedCandidates.length + " candidates (Gemini Flash)");
  const qualifierResult = await runAgent({
    systemPrompt: QUALIFIER_PROMPT,
    userMessage: qualifierInput,
    tools: getToolDefinitions(QUALIFIER_TOOLS),
    toolHandlers: getToolHandlers(QUALIFIER_TOOLS),
    provider: "gemini",
    model: "gemini-2.5-flash",
    maxTokens: 8192,
    maxIterations: 60,
    runId,
    agentName: "qualifier",
  });

  const qualifierOutput = extractJson(qualifierResult.finalText);
  const qualifiedLeads = (qualifierOutput && qualifierOutput.qualified_leads) || [];

  phases.qualifier = {
    qualified_count: qualifiedLeads.length,
    rejected_count: qualifierOutput ? (qualifierOutput.rejected || []).length : 0,
    tool_calls: qualifierResult.toolCalls.length,
    iterations: qualifierResult.iterations,
    input_tokens: qualifierResult.inputTokens,
    output_tokens: qualifierResult.outputTokens,
  };

  await log(runId, "agent-cold", "info",
    "Phase 2 done: " + qualifiedLeads.length + " qualified, " +
    (qualifierOutput ? (qualifierOutput.rejected || []).length : "?") + " rejected. " +
    qualifierResult.toolCalls.length + " tool calls.");

  if (qualifiedLeads.length === 0) {
    await log(runId, "agent-cold", "warn", "No leads qualified — aborting pipeline");
    await updateRun({ status: "failed", phase: "qualifier", error_message: "No leads passed qualifier checks", metadata: { brief, phases } });
    return { run_id: dbRunId, leads_inserted: 0, phases };
  }

  await updateRun({ phase: "challenger", metadata: { brief, phases } });

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3 — CHALLENGER
  // ═══════════════════════════════════════════════════════════════
  const challengerInput = [
    "BRIEF DU JOUR : " + (brief.theme || ""),
    "",
    "LEADS QUALIFIÉS (" + qualifiedLeads.length + ") :",
    "",
    JSON.stringify(qualifiedLeads, null, 2),
    "",
    "Challenge chaque lead. Sois dur. Julien préfère 6 leads A-tier que 10 leads B.",
    caseStudiesBlock,
    "",
    "Quand tu évalues l'angle d'approche, vérifie qu'il cite un cas client de référence pertinent (si un matche le secteur). Un angle sans preuve sectorielle est plus faible qu'un angle avec.",
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
  };

  await log(runId, "agent-cold", "info",
    "Phase 3 done: " + finalLeads.length + " kept, " + (qualifiedLeads.length - finalLeads.length) + " dropped.");

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4 — PERSIST
  // ═══════════════════════════════════════════════════════════════
  await log(runId, "agent-cold", "info", "Phase 4: PERSIST — inserting " + finalLeads.length + " leads");
  await updateRun({ phase: "persist", metadata: { brief, phases } });

  const totalCreditsEstimate =
    (phases.researcher.tool_calls || 0) * 2 +
    (phases.qualifier.tool_calls || 0) * 2;

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
