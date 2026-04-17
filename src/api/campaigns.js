/**
 * Campaigns API — unified bucket system across /cold-outbound and /cold-outreach.
 *
 * Invariant: exactly 3 rows with status='draft' at any time (slots 1/2/3).
 * When a draft is validated, email drafts are generated for each lead in the
 * bucket using:
 *   - AI Agent leads (lead_id set): generateColdEmail(lead, caseStudy) — complements
 *     the Challenger-stored angle_of_approach with the optional case study
 *   - Cold-outbound leads (cold_search_id set): FullEnrich email lookup +
 *     generateColdEmailDraft(profile, email, scenario, caseStudy) — upserts a lead
 *
 * After validation the campaign is archived (status='validated') and a fresh
 * draft row is inserted in the same slot.
 */

const { Router } = require("express");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");
const { generateColdEmail } = require("../lib/message-generator");

// We deliberately reuse the two helpers that already live in cold-outbound.js,
// so we don't duplicate the FullEnrich + Sonnet path. They are exported below.
let coldOutboundHelpers = null;
function getColdOutboundHelpers() {
  if (!coldOutboundHelpers) {
    coldOutboundHelpers = require("./cold-outbound")._helpers;
  }
  return coldOutboundHelpers;
}

const router = Router();
router.use(authMiddleware);

// ────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────

async function ensureThreeDraftSlots() {
  const { data: drafts } = await supabase
    .from("campaigns")
    .select("slot")
    .eq("status", "draft");
  const existingSlots = new Set((drafts || []).map((d) => d.slot));
  const missing = [1, 2, 3].filter((s) => !existingSlots.has(s));
  if (missing.length === 0) return;
  const rows = missing.map((slot) => ({ slot, name: "Campagne " + slot, status: "draft" }));
  await supabase.from("campaigns").insert(rows);
}

async function loadCampaignLeads(campaignIds) {
  if (!campaignIds || campaignIds.length === 0) return {};
  const { data: cls } = await supabase
    .from("campaign_leads")
    .select("*")
    .in("campaign_id", campaignIds)
    .order("added_at", { ascending: true });
  const byCampaign = {};
  (cls || []).forEach((cl) => {
    if (!byCampaign[cl.campaign_id]) byCampaign[cl.campaign_id] = [];
    byCampaign[cl.campaign_id].push(cl);
  });
  return byCampaign;
}

// ────────────────────────────────────────────────────────────
// GET /active — the 3 current draft campaigns with their leads
// ────────────────────────────────────────────────────────────

router.get("/active", async (req, res) => {
  try {
    await ensureThreeDraftSlots();

    const { data: drafts, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("status", "draft")
      .order("slot", { ascending: true });

    if (error) return res.status(500).json({ error: error.message });

    const ids = (drafts || []).map((d) => d.id);
    const leadsByCampaign = await loadCampaignLeads(ids);

    const campaigns = (drafts || []).map((d) => ({
      ...d,
      items: leadsByCampaign[d.id] || [],
    }));

    res.json({ campaigns });
  } catch (err) {
    console.error("[campaigns] GET /active error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// GET /validated — list archived campaigns for /messages-draft tab
// ────────────────────────────────────────────────────────────

router.get("/validated", async (req, res) => {
  try {
    const { data: rows, error } = await supabase
      .from("campaigns")
      .select("*, case_studies ( id, client_name, sector, metric_label, metric_value )")
      .eq("status", "validated")
      .order("validated_at", { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ error: error.message });

    const ids = (rows || []).map((r) => r.id);
    const leadsByCampaign = await loadCampaignLeads(ids);

    // Pull status of associated leads to compute counters (pending/approved/rejected).
    const leadIds = [];
    Object.values(leadsByCampaign).forEach((arr) => {
      arr.forEach((cl) => { if (cl.lead_id) leadIds.push(cl.lead_id); });
    });

    let statusById = {};
    if (leadIds.length > 0) {
      const { data: leadRows } = await supabase
        .from("leads")
        .select("id, status")
        .in("id", leadIds);
      (leadRows || []).forEach((l) => { statusById[l.id] = l.status; });
    }

    const campaigns = (rows || []).map((r) => {
      const items = leadsByCampaign[r.id] || [];
      let pending = 0, sent = 0, rejected = 0;
      items.forEach((cl) => {
        if (!cl.lead_id) return;
        const st = statusById[cl.lead_id];
        if (st === "email_pending") pending++;
        else if (st === "email_sent") sent++;
        else if (st === "disqualified") rejected++;
      });
      return {
        ...r,
        items_count: items.length,
        pending,
        sent,
        rejected,
      };
    });

    res.json({ campaigns });
  } catch (err) {
    console.error("[campaigns] GET /validated error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// GET /:id — full detail with leads + their current status
// ────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

    const { data: campaign, error } = await supabase
      .from("campaigns")
      .select("*, case_studies ( id, client_name, sector, metric_label, metric_value )")
      .eq("id", id)
      .single();
    if (error || !campaign) return res.status(404).json({ error: "Campaign not found" });

    const { data: items } = await supabase
      .from("campaign_leads")
      .select("*")
      .eq("campaign_id", id)
      .order("added_at", { ascending: true });

    const leadIds = (items || []).filter((i) => i.lead_id).map((i) => i.lead_id);
    let leadsById = {};
    if (leadIds.length > 0) {
      const { data: leadRows } = await supabase
        .from("leads")
        .select("id, full_name, email, status, metadata, headline, company_name")
        .in("id", leadIds);
      (leadRows || []).forEach((l) => { leadsById[l.id] = l; });
    }

    const enrichedItems = (items || []).map((it) => ({
      ...it,
      lead: it.lead_id ? leadsById[it.lead_id] || null : null,
    }));

    res.json({ campaign, items: enrichedItems });
  } catch (err) {
    console.error("[campaigns] GET /:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// POST /:id/rename
// ────────────────────────────────────────────────────────────

router.post("/:id/rename", async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const name = (req.body.name || "").trim();
    if (!Number.isInteger(id) || !name) return res.status(400).json({ error: "id + name required" });

    const { data, error } = await supabase
      .from("campaigns")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("status", "draft")
      .select()
      .single();

    if (error || !data) return res.status(404).json({ error: "Draft campaign not found" });
    res.json({ ok: true, campaign: data });
  } catch (err) {
    console.error("[campaigns] POST /:id/rename error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// POST /:id/add-lead — drag-drop source
//   body: { lead_id?, cold_search_id?, source_profile_index?, linkedin_url, profile_snapshot? }
// ────────────────────────────────────────────────────────────

router.post("/:id/add-lead", async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const { lead_id, cold_search_id, source_profile_index, linkedin_url, profile_snapshot } = req.body || {};
    if (!Number.isInteger(id) || !linkedin_url) {
      return res.status(400).json({ error: "id + linkedin_url required" });
    }
    if (!lead_id && !cold_search_id) {
      return res.status(400).json({ error: "lead_id or cold_search_id required" });
    }

    // Ensure campaign is still draft
    const { data: campaign } = await supabase
      .from("campaigns")
      .select("id, status")
      .eq("id", id)
      .single();
    if (!campaign || campaign.status !== "draft") {
      return res.status(400).json({ error: "Campaign not in draft state" });
    }

    // Remove this linkedin_url from OTHER draft campaigns (a profile only lives in one bucket)
    const { data: siblings } = await supabase
      .from("campaigns")
      .select("id")
      .eq("status", "draft")
      .neq("id", id);
    const siblingIds = (siblings || []).map((s) => s.id);
    if (siblingIds.length > 0) {
      await supabase
        .from("campaign_leads")
        .delete()
        .in("campaign_id", siblingIds)
        .eq("linkedin_url", linkedin_url);
    }

    const payload = {
      campaign_id: id,
      lead_id: lead_id || null,
      cold_search_id: cold_search_id || null,
      source_profile_index: source_profile_index != null ? source_profile_index : null,
      linkedin_url,
      profile_snapshot: profile_snapshot || {},
    };

    // Upsert (if the lead is already in this campaign, refresh the snapshot)
    const { error } = await supabase
      .from("campaign_leads")
      .upsert(payload, { onConflict: "campaign_id,linkedin_url" });

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    console.error("[campaigns] POST /:id/add-lead error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// DELETE /:id/leads — remove a lead from a bucket
//   body: { linkedin_url }
// ────────────────────────────────────────────────────────────

router.delete("/:id/leads", async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const { linkedin_url } = req.body || {};
    if (!Number.isInteger(id) || !linkedin_url) {
      return res.status(400).json({ error: "id + linkedin_url required" });
    }
    const { error } = await supabase
      .from("campaign_leads")
      .delete()
      .eq("campaign_id", id)
      .eq("linkedin_url", linkedin_url);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  } catch (err) {
    console.error("[campaigns] DELETE /:id/leads error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ────────────────────────────────────────────────────────────
// POST /:id/validate — generate drafts + archive + spawn fresh slot
//   body: { case_study_id?, scenario_index? }
// ────────────────────────────────────────────────────────────

router.post("/:id/validate", async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });

    const { case_study_id = null, scenario_index = null } = req.body || {};

    const { data: campaign, error: cErr } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", id)
      .single();
    if (cErr || !campaign) return res.status(404).json({ error: "Campaign not found" });
    if (campaign.status !== "draft") return res.status(400).json({ error: "Campaign already validated" });

    // Load leads in the campaign
    const { data: items, error: iErr } = await supabase
      .from("campaign_leads")
      .select("*")
      .eq("campaign_id", id);
    if (iErr) return res.status(500).json({ error: iErr.message });
    if (!items || items.length === 0) {
      return res.status(400).json({ error: "Cannot validate empty campaign" });
    }

    // Load case study if requested
    let caseStudy = null;
    if (case_study_id != null) {
      const { data: cs } = await supabase
        .from("case_studies")
        .select("*")
        .eq("id", case_study_id)
        .single();
      caseStudy = cs || null;
    }

    // Load scenario if requested
    let scenario = null;
    if (scenario_index != null) {
      const { data: setting } = await supabase
        .from("global_settings")
        .select("value")
        .eq("key", "cold_scenarios")
        .single();
      try {
        const all = setting && setting.value ? JSON.parse(setting.value) : [];
        if (all[scenario_index]) scenario = all[scenario_index];
      } catch (_e) {}
    }

    const helpers = getColdOutboundHelpers();

    const results = [];
    const campaignTag = { campaign_id: campaign.id, campaign_name: campaign.name, campaign_slot: campaign.slot };

    for (const it of items) {
      try {
        if (it.lead_id) {
          // AI Agent lead (already in DB) — use angle_of_approach + case study
          const { data: lead } = await supabase.from("leads").select("*").eq("id", it.lead_id).single();
          if (!lead) { results.push({ linkedin_url: it.linkedin_url, ok: false, reason: "lead_missing" }); continue; }
          if (!lead.email) { results.push({ linkedin_url: it.linkedin_url, ok: false, reason: "no_email" }); continue; }

          const email = await generateColdEmail(lead, caseStudy);
          if (!email) { results.push({ linkedin_url: it.linkedin_url, ok: false, reason: "generation_failed" }); continue; }

          const md = lead.metadata || {};
          const updatedMd = Object.assign({}, md, {
            draft_email_subject: email.subject,
            draft_email_body: email.body,
            draft_email_to: lead.email,
            draft_email_generated_at: new Date().toISOString(),
            draft_email_source: "campaign",
            campaign_id: campaignTag.campaign_id,
            campaign_name: campaignTag.campaign_name,
            campaign_slot: campaignTag.campaign_slot,
            campaign_case_study_id: case_study_id,
          });
          await supabase.from("leads").update({ status: "email_pending", metadata: updatedMd }).eq("id", lead.id);
          results.push({ linkedin_url: it.linkedin_url, ok: true, lead_id: lead.id });
        } else if (it.cold_search_id) {
          // Cold-outbound lead (not yet in `leads`) — FullEnrich + Sonnet + upsert
          const profile = it.profile_snapshot || {};
          const enrich = await helpers.enrichContactInfo(it.linkedin_url, campaign.id + "-" + Date.now());
          if (!enrich || !enrich.email) {
            results.push({ linkedin_url: it.linkedin_url, ok: false, reason: "no_email" });
            continue;
          }
          const draft = await helpers.generateColdEmailDraft(profile, enrich.email, scenario, caseStudy);
          if (!draft) {
            results.push({ linkedin_url: it.linkedin_url, ok: false, reason: "generation_failed" });
            continue;
          }

          const leadRow = {
            linkedin_url: it.linkedin_url,
            linkedin_url_canonical: profile.linkedin_url_canonical || it.linkedin_url,
            first_name: profile.first_name || null,
            last_name: profile.last_name || null,
            full_name: ((profile.first_name || "") + " " + (profile.last_name || "")).trim() || null,
            headline: profile.headline || null,
            company_name: profile.company || null,
            location: profile.location || null,
            email: enrich.email,
            status: "email_pending",
            signal_type: "cold_search",
            signal_category: "cold_outbound",
            signal_date: new Date().toISOString(),
            icp_score: Math.max(profile.prise_score || 0, 55),
            tier: "warm",
            metadata: {
              search_id: it.cold_search_id,
              source_origin: "bereach_search",
              cold_outbound: true,
              email_status: "found",
              draft_email_subject: draft.subject,
              draft_email_body: draft.body,
              draft_email_source: "campaign",
              campaign_id: campaignTag.campaign_id,
              campaign_name: campaignTag.campaign_name,
              campaign_slot: campaignTag.campaign_slot,
              campaign_case_study_id: case_study_id,
            },
          };

          const { data: upserted, error: upErr } = await supabase
            .from("leads")
            .upsert(leadRow, { onConflict: "linkedin_url_canonical" })
            .select("id")
            .single();

          if (upErr) {
            results.push({ linkedin_url: it.linkedin_url, ok: false, reason: "upsert_failed" });
            continue;
          }

          // Link the new lead_id back onto the campaign_leads row
          if (upserted && upserted.id) {
            await supabase
              .from("campaign_leads")
              .update({ lead_id: upserted.id })
              .eq("id", it.id);
          }

          results.push({ linkedin_url: it.linkedin_url, ok: true, lead_id: upserted ? upserted.id : null });
        } else {
          results.push({ linkedin_url: it.linkedin_url, ok: false, reason: "no_source" });
        }
      } catch (perErr) {
        console.error("[campaigns] validate item error:", perErr.message);
        results.push({ linkedin_url: it.linkedin_url, ok: false, reason: perErr.message.slice(0, 80) });
      }
    }

    // Archive the campaign
    await supabase
      .from("campaigns")
      .update({
        status: "validated",
        validated_at: new Date().toISOString(),
        case_study_id: case_study_id,
        scenario_index: scenario_index,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    // Spawn a fresh draft in the same slot
    await supabase.from("campaigns").insert({
      slot: campaign.slot,
      name: "Campagne " + campaign.slot,
      status: "draft",
    });

    const okCount = results.filter((r) => r.ok).length;
    res.json({ ok: true, generated: okCount, total: results.length, results });
  } catch (err) {
    console.error("[campaigns] POST /:id/validate error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
