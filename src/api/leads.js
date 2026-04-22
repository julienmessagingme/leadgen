const { Router } = require("express");
const crypto = require("crypto");
const authMiddleware = require("./middleware");
const { supabase } = require("../lib/supabase");

const router = Router();
router.use(authMiddleware);

const PII_NULLS = {
  email: null,
  first_name: null,
  last_name: null,
  full_name: null,
  phone: null,
  linkedin_url: null,
  headline: null,
};

const VALID_SORTS = ["icp_score", "created_at", "signal_date", "status", "scored_at", "invitation_sent_at"];

/**
 * Fetch case_studies by IDs, separate pitch directives (mode='override_pitch')
 * from regular client cases, mutate lead.metadata to inject them properly:
 *   - _pitch_directive: full description of the first override_pitch case (not truncated)
 *   - _pitch_mode_active: true if any override_pitch case selected
 *   - _additional_case_studies: formatted strings for regular cases (truncated 500 chars)
 *
 * The directive block is consumed by buildLeadContext as a top-level prompt
 * section. The case studies list is consumed by rule 3 of email templates.
 *
 * @returns {Promise<{pitchModeActive: boolean, rawIds: Array, selectedCount: number}>}
 */
async function injectSelectedCases(lead, rawIds) {
  const { data: allCases } = await supabase
    .from("case_studies")
    .select("*")
    .eq("is_active", true);
  const selectedCases = (allCases || []).filter((c) =>
    rawIds.includes(c.id) || rawIds.includes(String(c.id))
  );
  if (selectedCases.length === 0) return { pitchModeActive: false, selectedCount: 0 };

  const pitchCases = selectedCases.filter((c) => c.mode === "override_pitch");
  const regularCases = selectedCases.filter((c) => c.mode !== "override_pitch");
  const pitchModeActive = pitchCases.length > 0;

  lead.metadata = Object.assign({}, lead.metadata || {}, {
    _pitch_mode_active: pitchModeActive,
    _pitch_directive: pitchModeActive ? pitchCases[0].description : null,
    _additional_case_studies: regularCases.map((c) =>
      c.client_name + " (" + c.sector + ") — " + c.metric_label + " : " + c.metric_value +
      (c.description ? ". " + c.description.slice(0, 500) : "")
    ),
  });

  return { pitchModeActive, selectedCount: selectedCases.length };
}

/**
 * Strip the temporary prompt-injection fields from a metadata object before
 * persisting it to Supabase. These are only useful at generation time.
 */
function cleanCaseInjection(metadata) {
  delete metadata._additional_case_studies;
  delete metadata._pitch_mode_active;
  delete metadata._pitch_directive;
}

/**
 * Strip HTML tags and normalize whitespace — used to convert email HTML
 * bodies to the plain-text representation we archive for few-shot prompts.
 */
function htmlToPlain(html) {
  if (!html) return "";
  return String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Archive a sent message to sent_messages_archive if Julien edited it
 * relative to the AI draft. Unedited sends carry no learning signal and
 * are skipped. Non-fatal — a failure here does NOT break the send flow.
 *
 * @param {object} lead   — full lead row (needs company_sector, tier, signal_category)
 * @param {string} channel — 'linkedin_message' | 'email_first' | 'email_followup'
 * @param {string} finalText — plain-text version of what was actually sent
 * @param {string} aiDraft — plain-text version of the original AI draft
 * @param {string} lang — 'fr' | 'en'
 */
async function archiveIfEdited(lead, channel, finalText, aiDraft, lang) {
  try {
    if (!finalText || !aiDraft) return;
    const cleanFinal = String(finalText).trim();
    const cleanDraft = String(aiDraft).trim();
    if (!cleanFinal || cleanFinal === cleanDraft) return; // unedited, skip

    const meta = lead.metadata || {};
    await supabase.from("sent_messages_archive").insert({
      lead_id: lead.id,
      channel: channel,
      final_text: cleanFinal,
      ai_draft: cleanDraft,
      lead_sector: lead.company_sector || null,
      lead_tier: lead.tier || null,
      lead_signal_category: lead.signal_category || null,
      pitch_mode_used: meta.pitch_mode_used === true,
      lang: lang || "fr",
    });
  } catch (err) {
    console.warn("[archive] sent_messages_archive insert failed:", err.message);
  }
}

/**
 * ISO-8601 date validation helper.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/;
function isValidDate(str) {
  return ISO_DATE_RE.test(str) && !isNaN(Date.parse(str));
}

/**
 * Sanitize search term: remove ALL PostgREST special characters.
 */
function sanitizeSearch(term) {
  return term.replace(/[.,()!<>%\\:"']/g, "").trim().slice(0, 100);
}

/**
 * GET / -- List leads with filtering, sorting, pagination
 */
router.get("/", async (req, res) => {
  try {
    const {
      status,
      tier,
      source,
      search,
      sort = "icp_score",
      order = "desc",
      limit: limitStr = "200",
      offset: offsetStr = "0",
      paused,
      campaign_id,
    } = req.query;

    const limit = Math.min(Math.max(parseInt(limitStr, 10) || 200, 1), 500);
    const offset = Math.max(parseInt(offsetStr, 10) || 0, 0);

    if (!VALID_SORTS.includes(sort)) {
      return res.status(400).json({ error: `Invalid sort field. Allowed: ${VALID_SORTS.join(", ")}` });
    }

    let query = supabase
      .from("leads")
      .select("*", { count: "exact" });

    // Status filter
    if (status) {
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
      query = query.in("status", statuses);
    } else {
      // Exclude disqualified by default
      query = query.neq("status", "disqualified");
    }

    // Tier filter
    if (tier) {
      query = query.eq("tier", tier);
    }

    // Source filter (signal_category)
    if (source) {
      query = query.eq("signal_category", source);
    }

    // Search filter (table has first_name + last_name, not full_name)
    if (search) {
      const term = sanitizeSearch(search);
      if (term) {
        query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,company_name.ilike.%${term}%`);
      }
    }

    // Paused filter (metadata->is_paused)
    if (paused === "true") {
      query = query.eq("metadata->>is_paused", "true");
    } else if (paused === "false") {
      query = query.or("metadata->>is_paused.is.null,metadata->>is_paused.neq.true");
    }

    // Campaign filter (metadata->campaign_id)
    if (campaign_id) {
      query = query.eq("metadata->>campaign_id", String(campaign_id));
    }

    // Sort and paginate
    query = query.order(sort, { ascending: order === "asc" });
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      console.error("Leads GET / supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    res.json({ leads: data, total: count });
  } catch (err) {
    console.error("Leads GET / error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /export -- CSV export with filters
 */
router.get("/export", async (req, res) => {
  try {
    const { status, tier, source, search, date_from, date_to } = req.query;

    let query = supabase
      .from("leads")
      .select("first_name, last_name, email, linkedin_url, icp_score, tier, status, company_name, created_at");

    // Status filter
    if (status) {
      const statuses = status.split(",").map((s) => s.trim()).filter(Boolean);
      query = query.in("status", statuses);
    }

    // Tier filter
    if (tier) {
      query = query.eq("tier", tier);
    }

    // Source filter (signal_category)
    if (source) {
      query = query.eq("signal_category", source);
    }

    // Search filter
    if (search) {
      const term = sanitizeSearch(search);
      if (term) {
        query = query.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,company_name.ilike.%${term}%`);
      }
    }

    // Validate date params
    if (date_from && !isValidDate(date_from)) {
      return res.status(400).json({ error: "Invalid date_from format" });
    }
    if (date_to && !isValidDate(date_to)) {
      return res.status(400).json({ error: "Invalid date_to format" });
    }

    // Date range filters
    if (date_from) {
      query = query.gte("created_at", date_from);
    }
    if (date_to) {
      query = query.lte("created_at", date_to);
    }

    query = query.order("created_at", { ascending: false }).limit(10000);

    const { data, error } = await query;

    if (error) {
      console.error("Leads GET /export supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    // Build CSV
    const headers = "Nom,Prenom,Email,LinkedIn,Entreprise,Score ICP,Tier,Statut,Date";

    function escapeCSV(v) {
      if (v === null || v === undefined) return '""';
      return '"' + String(v).replace(/"/g, '""') + '"';
    }

    const rows = (data || []).map((row) =>
      [
        escapeCSV(row.last_name),
        escapeCSV(row.first_name),
        escapeCSV(row.email),
        escapeCSV(row.linkedin_url),
        escapeCSV(row.company_name),
        escapeCSV(row.icp_score),
        escapeCSV(row.tier),
        escapeCSV(row.status),
        escapeCSV(row.created_at),
      ].join(",")
    );

    const csv = "\uFEFF" + headers + "\n" + rows.join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="leads-export.csv"');
    res.send(csv);
  } catch (err) {
    console.error("Leads GET /export error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /:id -- Single lead detail
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return res.status(404).json({ error: "Lead not found" });
      }
      console.error("Leads GET /:id supabase error:", error.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    res.json(data);
  } catch (err) {
    console.error("Leads GET /:id error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * PATCH /:id/action -- Individual lead action (pause/resume/exclude/convert_from_hubspot)
 */
router.patch("/:id/action", async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!["pause", "resume", "exclude", "convert_from_hubspot"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Allowed: pause, resume, exclude, convert_from_hubspot" });
    }

    // Fetch current lead
    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr) {
      if (fetchErr.code === "PGRST116") {
        return res.status(404).json({ error: "Lead not found" });
      }
      console.error("Leads PATCH /:id/action fetch error:", fetchErr.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    const metadata = lead.metadata || {};

    if (action === "pause") {
      metadata.is_paused = true;
      metadata.paused_at = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ metadata })
        .eq("id", id);

      if (updateErr) {
        console.error("Leads PATCH /:id/action pause error:", updateErr.message);
        return res.status(500).json({ error: "Internal server error" });
      }
      return res.json({ ok: true, action: "paused" });
    }

    if (action === "resume") {
      delete metadata.is_paused;
      delete metadata.paused_at;

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ metadata })
        .eq("id", id);

      if (updateErr) {
        console.error("Leads PATCH /:id/action resume error:", updateErr.message);
        return res.status(500).json({ error: "Internal server error" });
      }
      return res.json({ ok: true, action: "resumed" });
    }

    if (action === "exclude") {
      metadata.excluded_at = new Date().toISOString();
      metadata.excluded_reason = "manual_rgpd";

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ status: "disqualified", metadata, ...PII_NULLS })
        .eq("id", id);

      if (updateErr) {
        console.error("Leads PATCH /:id/action exclude error:", updateErr.message);
        return res.status(500).json({ error: "Internal server error" });
      }

      // Insert suppression hashes
      const hashes = [];
      if (lead.email) {
        hashes.push({
          hashed_value: crypto.createHash("sha256").update(lead.email.toLowerCase()).digest("hex"),
          source: "email",
        });
      }
      if (lead.linkedin_url) {
        hashes.push({
          hashed_value: crypto.createHash("sha256").update(lead.linkedin_url.toLowerCase()).digest("hex"),
          source: "linkedin",
        });
      }

      if (hashes.length > 0) {
        await supabase
          .from("suppression_list")
          .upsert(hashes, { onConflict: "hashed_value" });
      }

      return res.json({ ok: true, action: "excluded" });
    }

    if (action === "convert_from_hubspot") {
      metadata.converted_from_hubspot = true;
      metadata.converted_at = new Date().toISOString();

      const { error: updateErr } = await supabase
        .from("leads")
        .update({ status: "new", metadata })
        .eq("id", id);

      if (updateErr) {
        console.error("Leads PATCH /:id/action convert error:", updateErr.message);
        return res.status(500).json({ error: "Internal server error" });
      }
      return res.json({ ok: true, action: "converted" });
    }
  } catch (err) {
    console.error("Leads PATCH /:id/action error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /bulk-action -- Bulk lead actions
 */
router.post("/bulk-action", async (req, res) => {
  try {
    const { ids, action } = req.body;

    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
      return res.status(400).json({ error: "ids must be an array of 1-100 elements" });
    }

    if (!["pause", "resume", "exclude"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Allowed: pause, resume, exclude" });
    }

    // Fetch all leads by IDs (only columns needed for bulk actions)
    const { data: leads, error: fetchErr } = await supabase
      .from("leads")
      .select("id, email, linkedin_url, metadata")
      .in("id", ids);

    if (fetchErr) {
      console.error("Leads POST /bulk-action fetch error:", fetchErr.message);
      return res.status(500).json({ error: "Internal server error" });
    }

    let processed = 0;

    for (const lead of leads) {
      const metadata = lead.metadata || {};

      if (action === "pause") {
        metadata.is_paused = true;
        metadata.paused_at = new Date().toISOString();
        const { error } = await supabase
          .from("leads")
          .update({ metadata })
          .eq("id", lead.id);
        if (!error) processed++;
      } else if (action === "resume") {
        delete metadata.is_paused;
        delete metadata.paused_at;
        const { error } = await supabase
          .from("leads")
          .update({ metadata })
          .eq("id", lead.id);
        if (!error) processed++;
      } else if (action === "exclude") {
        metadata.excluded_at = new Date().toISOString();
        metadata.excluded_reason = "manual_rgpd";
        const { error } = await supabase
          .from("leads")
          .update({ status: "disqualified", metadata, ...PII_NULLS })
          .eq("id", lead.id);

        if (!error) {
          const hashes = [];
          if (lead.email) {
            hashes.push({
              hashed_value: crypto.createHash("sha256").update(lead.email.toLowerCase()).digest("hex"),
              source: "email",
            });
          }
          if (lead.linkedin_url) {
            hashes.push({
              hashed_value: crypto.createHash("sha256").update(lead.linkedin_url.toLowerCase()).digest("hex"),
              source: "linkedin",
            });
          }
          if (hashes.length > 0) {
            await supabase
              .from("suppression_list")
              .upsert(hashes, { onConflict: "hashed_value" });
          }
          processed++;
        }
      }
    }

    res.json({ ok: true, processed });
  } catch (err) {
    console.error("Leads POST /bulk-action error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /:id/approve-message -- Send approved draft message via BeReach
 * Body: { message: "..." } (optional — uses draft_message if not provided)
 */
router.post("/:id/approve-message", async (req, res) => {
  try {
    const { sendMessage } = require("../lib/bereach");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "message_pending") return res.status(400).json({ error: "Lead is not in message_pending status" });

    const message = (req.body.message || "").trim() || lead.metadata?.draft_message;
    if (!message) return res.status(400).json({ error: "No message to send" });

    // Archive BEFORE we send + null-out the draft (we need draft for the diff)
    const aiDraft = lead.metadata?.draft_message;
    const archiveLang = (lead.metadata?.forced_lang || (message.startsWith("Hi ") ? "en" : "fr"));
    await archiveIfEdited(lead, "linkedin_message", message, aiDraft, archiveLang);

    await sendMessage(lead.linkedin_url, message);

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      follow_up_message: message,
      follow_up_run_id: lead.metadata?.draft_run_id || null,
      draft_message: null,
    });

    await supabase
      .from("leads")
      .update({
        status: "messaged",
        follow_up_sent_at: new Date().toISOString(),
        metadata: updatedMetadata,
      })
      .eq("id", lead.id);

    res.json({ ok: true, message });
  } catch (err) {
    console.error("POST /leads/:id/approve-message error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/reject-message -- Delete the lead and add to RGPD suppression list.
 * The suppression entry prevents re-contacting if the person signals again.
 */
router.post("/:id/reject-message", async (req, res) => {
  try {
    const { addToSuppressionList } = require("../lib/suppression");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, status, full_name, linkedin_url, email")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "message_pending") return res.status(400).json({ error: "Lead is not in message_pending status" });

    // Add to suppression list BEFORE delete (so we have the data)
    await addToSuppressionList({
      email: lead.email,
      linkedinUrl: lead.linkedin_url,
      reason: "rejected_message",
    });

    const { error: delErr } = await supabase.from("leads").delete().eq("id", lead.id);
    if (delErr) return res.status(500).json({ error: "Delete failed: " + delErr.message });

    console.log("Lead deleted + suppressed via reject-message:", lead.full_name || lead.id);
    res.json({ ok: true, deleted: true, suppressed: true });
  } catch (err) {
    console.error("POST /leads/:id/reject-message error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/approve-email -- Send approved email draft via Gmail SMTP
 * Body: { subject: "...", body: "..." } (optional — uses draft if not provided)
 */
router.post("/:id/approve-email", async (req, res) => {
  try {
    const { sendEmail } = require("../lib/gmail");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_pending") return res.status(400).json({ error: "Lead is not in email_pending status" });

    const email = lead.metadata?.draft_email_to || lead.email;
    if (!email) return res.status(400).json({ error: "No email address" });

    const subject = (req.body.subject || "").trim() || lead.metadata?.draft_email_subject;
    const body = (req.body.body || "").trim() || lead.metadata?.draft_email_body;
    if (!subject || !body) return res.status(400).json({ error: "No email content to send" });

    // Archive BEFORE send + draft nullification (we need the draft for diff)
    const aiBodyDraft = lead.metadata?.draft_email_body;
    if (aiBodyDraft) {
      const archiveLang = (lead.metadata?.forced_lang || "fr");
      await archiveIfEdited(
        lead, "email_first",
        htmlToPlain(body), htmlToPlain(aiBodyDraft), archiveLang
      );
    }

    // Inject click + open tracking before sending (1st email)
    const { injectTracking } = require("../lib/tracking");
    const trackedBody = injectTracking(body, lead.id, "email_1");

    const messageId = await sendEmail(email, subject, trackedBody);

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      email_subject: subject,
      email_body: body,              // archive the sent body so the UI can show it later (accordion in /email-followups)
      email_message_id: messageId,
      draft_email_subject: null,
      draft_email_body: null,
      draft_email_to: null,
      draft_email_run_id: null,
      draft_email_generated_at: null,
    });

    // CRITICAL: email is already sent. If DB update fails, do NOT return 500
    // (would cause duplicate send on retry). Return success with warning.
    const { error: updateErr } = await supabase
      .from("leads")
      .update({
        status: "email_sent",
        email_sent_at: new Date().toISOString(),
        metadata: updatedMetadata,
      })
      .eq("id", lead.id);

    if (updateErr) {
      console.error("CRITICAL: email sent to " + email + " (messageId " + messageId + ") but DB update failed:", updateErr.message);
      return res.json({
        ok: true,
        email,
        subject,
        warning: "Email sent but DB update failed: " + updateErr.message + ". Check Gmail Sent folder before re-approving.",
      });
    }

    res.json({ ok: true, email, subject });

    // ── Fire-and-forget : log to HubSpot AFTER the HTTP response.
    // Non-blocking — the send is already done, HubSpot failure must not
    // surface to the user. Result is written back to lead.metadata async.
    logEmailToHubspotAsync(lead, { subject, body }, email);
  } catch (err) {
    console.error("POST /leads/:id/approve-email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Internal helper — run HubSpot logging asynchronously after an email send,
 * then persist the resulting contact_id + logged_at flags into lead.metadata.
 * All errors are swallowed (non-fatal).
 */
async function logEmailToHubspotAsync(lead, opts, emailTo) {
  try {
    const { logEmailToHubspot } = require("../lib/hubspot");
    // Make sure the logger has the up-to-date recipient email (may not be on lead row yet)
    const leadForLog = Object.assign({}, lead, emailTo ? { email: emailTo } : {});
    const result = await logEmailToHubspot(leadForLog, opts);
    if (!result) return;

    // Refetch current metadata to avoid overwriting fields set in parallel
    const { data: fresh } = await supabase.from("leads").select("metadata").eq("id", lead.id).single();
    const curMeta = (fresh && fresh.metadata) || {};
    const newMeta = Object.assign({}, curMeta, {
      hubspot_contact_id: result.contactId,
      hubspot_email_id: result.emailId,
      hubspot_logged_at: new Date().toISOString(),
      hubspot_contact_created: result.createdContact || false,
    });
    await supabase.from("leads").update({ metadata: newMeta }).eq("id", lead.id);
  } catch (err) {
    console.warn("[hubspot-log-async] failed for lead " + lead.id + ":", err.message);
  }
}

/**
 * POST /:id/regenerate-message -- Regenerate LinkedIn follow-up draft.
 * Body: { lang?: "fr" | "en", case_study_ids?: [1, 22, ...] }
 *
 * If any attached case has mode='override_pitch' (e.g. 'MessagingMe — hard'),
 * the generator switches to SYSTEM_PITCH (cabinet pitch, 5-6 phrases, CTA)
 * instead of the default short peer-to-peer tone.
 */
router.post("/:id/regenerate-message", async (req, res) => {
  try {
    const { generateFollowUpMessage, loadTemplates } = require("../lib/message-generator");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "message_pending") return res.status(400).json({ error: "Lead is not in message_pending status" });

    const lang = req.body.lang === "en" ? "en" : (req.body.lang === "fr" ? "fr" : "fr");

    // Override language detection by temporarily injecting a location hint
    const originalLocation = lead.location;
    lead.location = lang === "en" ? "New York, US" : "Paris, France";

    // Attach selected case studies — separate pitch directives from client cases
    const rawIds = req.body && req.body.case_study_ids;
    let pitchModeActive = false;
    if (Array.isArray(rawIds) && rawIds.length > 0) {
      const injected = await injectSelectedCases(lead, rawIds);
      pitchModeActive = injected.pitchModeActive;
    }

    const templates = await loadTemplates();
    const message = await generateFollowUpMessage(lead, templates);

    lead.location = originalLocation; // restore

    if (!message) return res.status(500).json({ error: "Failed to generate message" });

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      draft_message: message,
      draft_generated_at: new Date().toISOString(),
      forced_lang: lang,
      regenerated_with_cases: Array.isArray(rawIds) ? rawIds : undefined,
      pitch_mode_used: pitchModeActive || undefined,
    });
    cleanCaseInjection(updatedMetadata);

    await supabase
      .from("leads")
      .update({ metadata: updatedMetadata })
      .eq("id", lead.id);

    res.json({ ok: true, lang, message, pitch_mode: pitchModeActive });
  } catch (err) {
    console.error("POST /leads/:id/regenerate-message error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/regenerate-email -- Regenerate email draft with forced language
 * and optional case studies to inject into the prompt.
 * Body: { lang?: "fr" | "en", case_study_ids?: [1, 5, 12] }
 */
router.post("/:id/regenerate-email", async (req, res) => {
  try {
    const { generateEmail, loadTemplates } = require("../lib/message-generator");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_pending") return res.status(400).json({ error: "Lead is not in email_pending status" });

    const lang = req.body.lang === "en" ? "en" : (req.body.lang === "fr" ? "fr" : null);

    // Override language detection if lang is explicitly forced
    const originalLocation = lead.location;
    if (lang) {
      lead.location = lang === "en" ? "New York, US" : "Paris, France";
    }

    // Inject case studies (separate pitch directive from regular cases)
    const rawIds = req.body && req.body.case_study_ids;
    let pitchModeActive = false;
    if (Array.isArray(rawIds) && rawIds.length > 0) {
      const injected = await injectSelectedCases(lead, rawIds);
      pitchModeActive = injected.pitchModeActive;
    }

    const templates = await loadTemplates();
    const emailContent = await generateEmail(lead, templates);

    if (lang) lead.location = originalLocation; // restore

    if (!emailContent) return res.status(500).json({ error: "Failed to generate email" });

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      draft_email_subject: emailContent.subject,
      draft_email_body: emailContent.body,
      draft_email_generated_at: new Date().toISOString(),
      forced_lang: lang || undefined,
      regenerated_with_cases: Array.isArray(rawIds) ? rawIds : undefined,
      pitch_mode_used: pitchModeActive || undefined,
    });
    cleanCaseInjection(updatedMetadata);

    await supabase
      .from("leads")
      .update({ metadata: updatedMetadata })
      .eq("id", lead.id);

    res.json({ ok: true, lang, subject: emailContent.subject, with_cases: Array.isArray(rawIds) ? rawIds.length : 0 });
  } catch (err) {
    console.error("POST /leads/:id/regenerate-email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/reject-email -- Delete the lead and add to RGPD suppression list.
 * The suppression entry prevents re-contacting if the person signals again.
 */
router.post("/:id/reject-email", async (req, res) => {
  try {
    const { addToSuppressionList } = require("../lib/suppression");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, status, full_name, linkedin_url, email")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_pending") return res.status(400).json({ error: "Lead is not in email_pending status" });

    // Add to suppression list BEFORE delete
    await addToSuppressionList({
      email: lead.email,
      linkedinUrl: lead.linkedin_url,
      reason: "rejected_email",
    });

    const { error: delErr } = await supabase.from("leads").delete().eq("id", lead.id);
    if (delErr) return res.status(500).json({ error: "Delete failed: " + delErr.message });

    console.log("Lead deleted + suppressed via reject-email:", lead.full_name || lead.id);
    res.json({ ok: true, deleted: true, suppressed: true });
  } catch (err) {
    console.error("POST /leads/:id/reject-email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/mark-connected -- Manual: Julien confirms invitation was accepted.
 * Marks as connected, enriches, generates draft message → status message_pending.
 */
router.post("/:id/mark-connected", async (req, res) => {
  try {
    const { enrichLead } = require("../lib/enrichment");
    const { generateFollowUpMessage, loadTemplates } = require("../lib/message-generator");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "invitation_sent") return res.status(400).json({ error: "Lead is not in invitation_sent status" });

    await supabase.from("leads").update({
      status: "connected",
      connected_at: new Date().toISOString(),
    }).eq("id", lead.id);

    // Enrich with fresh profile + company data
    let enrichedLead = { ...lead, status: "connected" };
    try {
      enrichedLead = await enrichLead(enrichedLead, "manual-connect");
      await supabase.from("leads").update({
        location: enrichedLead.location || lead.location,
        company_name: enrichedLead.company_name || lead.company_name,
        company_size: enrichedLead.company_size || lead.company_size,
        company_sector: enrichedLead.company_sector || lead.company_sector,
        company_location: enrichedLead.company_location || lead.company_location,
        email: enrichedLead.email || lead.email,
        seniority_years: enrichedLead.seniority_years || lead.seniority_years,
        connections_count: enrichedLead.connections_count || lead.connections_count,
        metadata: enrichedLead.metadata,
      }).eq("id", lead.id);
    } catch (enrichErr) {
      console.warn("mark-connected: enrichment failed for", lead.full_name, enrichErr.message);
    }

    const templates = await loadTemplates();
    const message = await generateFollowUpMessage(enrichedLead, templates);
    if (!message) return res.status(500).json({ error: "Failed to generate message" });

    const updatedMetadata = Object.assign({}, enrichedLead.metadata || {}, {
      draft_message: message,
      draft_run_id: "manual-connect-" + Date.now(),
      draft_generated_at: new Date().toISOString(),
    });

    await supabase.from("leads").update({
      status: "message_pending",
      metadata: updatedMetadata,
    }).eq("id", lead.id);

    res.json({ ok: true, message });
  } catch (err) {
    console.error("POST /leads/:id/mark-connected error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/approve-reinvite -- Julien approves a re-invitation with note.
 * Sends the invitation via BeReach with the draft note, resets to invitation_sent.
 */
router.post("/:id/approve-reinvite", async (req, res) => {
  try {
    const { connectProfile } = require("../lib/bereach");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "reinvite_pending") return res.status(400).json({ error: "Lead is not in reinvite_pending status" });

    var note = (lead.metadata && lead.metadata.draft_invitation_note) || null;
    if (!note) return res.status(400).json({ error: "No draft invitation note found" });

    // Allow Julien to override the note from the request body
    if (req.body && req.body.note) {
      note = req.body.note;
    }

    // Send invitation via BeReach with note
    await connectProfile(lead.linkedin_url, note);

    var metadata = Object.assign({}, lead.metadata || {});
    metadata.reinvite_count = (metadata.reinvite_count || 0) + 1;
    metadata.reinvite_note = note;
    metadata.reinvite_sent_at = new Date().toISOString();
    delete metadata.draft_invitation_note;
    delete metadata.draft_reinvite_run_id;
    delete metadata.draft_reinvite_generated_at;

    await supabase
      .from("leads")
      .update({
        status: "invitation_sent",
        invitation_sent_at: new Date().toISOString(),
        metadata: metadata,
      })
      .eq("id", lead.id);

    res.json({ ok: true, note: note });
  } catch (err) {
    console.error("POST /leads/:id/approve-reinvite error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/reject-reinvite -- Delete the lead and add to RGPD suppression list.
 * The suppression entry prevents re-contacting if the person signals again.
 */
router.post("/:id/reject-reinvite", async (req, res) => {
  try {
    const { addToSuppressionList } = require("../lib/suppression");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, status, full_name, linkedin_url, email")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "reinvite_pending") return res.status(400).json({ error: "Lead is not in reinvite_pending status" });

    // Add to suppression list BEFORE delete
    await addToSuppressionList({
      email: lead.email,
      linkedinUrl: lead.linkedin_url,
      reason: "rejected_reinvite",
    });

    const { error: delErr } = await supabase.from("leads").delete().eq("id", lead.id);
    if (delErr) return res.status(500).json({ error: "Delete failed: " + delErr.message });

    console.log("Lead deleted + suppressed via reject-reinvite:", lead.full_name || lead.id);
    res.json({ ok: true, deleted: true, suppressed: true });
  } catch (err) {
    console.error("POST /leads/:id/reject-reinvite error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id/hubspot-email -- Fetch the last email for a HubSpot contact.
 * Returns on-demand (not cached) to always show the latest.
 */
router.get("/:id/hubspot-email", async (req, res) => {
  try {
    const { getLastEmail } = require("../lib/hubspot");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, metadata")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });

    var contactId = lead.metadata && lead.metadata.hubspot_contact_id;
    if (!contactId) return res.json({ email: null, reason: "no_hubspot_contact_id" });

    var email = await getLastEmail(contactId);
    res.json({ email: email });
  } catch (err) {
    console.error("GET /leads/:id/hubspot-email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/generate-whapi-draft — generate a personal-WhatsApp draft via
 * Sonnet using SYSTEM_WHAPI (short, self-introduction allowed). Stored in
 * metadata.draft_whapi_text for the UI to pre-fill the editor.
 *
 * Response: 200 { ok: true, text }
 */
router.post("/:id/generate-whapi-draft", async (req, res) => {
  try {
    const { generateWhapiMessage } = require("../lib/message-generator");
    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (fetchErr || !lead) return res.status(404).json({ error: "lead_not_found" });

    const text = await generateWhapiMessage(lead);
    if (!text) return res.status(502).json({ error: "generation_failed" });

    const updatedMeta = Object.assign({}, lead.metadata || {}, {
      draft_whapi_text: text,
      draft_whapi_generated_at: new Date().toISOString(),
    });
    await supabase.from("leads").update({ metadata: updatedMeta }).eq("id", lead.id);

    res.json({ ok: true, text });
  } catch (err) {
    console.error("POST /leads/:id/generate-whapi-draft error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/send-whapi-text — envoi personnel via Whapi Cloud.
 *
 * Body: { text: string }
 *
 * - Daily cap : 15 envois/jour (Whapi Starter trial = 150/5j, marge de securite
 *   + evite le ban Meta sur volume). Compteur base sur sent_messages_archive.
 * - Archive l envoi dans sent_messages_archive (channel='whapi_text') pour
 *   que le prochain draft Sonnet apprenne du ton de Julien (few-shot).
 *
 * Responses :
 *   200 { ok: true, message_id, phone_used }
 *   400 { error: 'missing_text' | 'missing_phone' }
 *   429 { error: 'daily_cap_reached', cap: 15 }
 *   502 { error: 'whapi_send_failed', detail }
 */
router.post("/:id/send-whapi-text", async (req, res) => {
  try {
    const { sendWhapiText, normalizePhone } = require("../lib/whapi");

    const text = (req.body && req.body.text ? String(req.body.text) : "").trim();
    if (!text) return res.status(400).json({ error: "missing_text" });

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (fetchErr || !lead) return res.status(404).json({ error: "lead_not_found" });

    const e164 = normalizePhone(lead.phone);
    if (!e164) return res.status(400).json({ error: "missing_phone" });

    // Daily cap check
    const DAILY_CAP = 15;
    const todayIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const { count: sentToday } = await supabase
      .from("sent_messages_archive")
      .select("*", { count: "exact", head: true })
      .eq("channel", "whapi_text")
      .gte("sent_at", todayIso);
    if ((sentToday || 0) >= DAILY_CAP) {
      return res.status(429).json({ error: "daily_cap_reached", cap: DAILY_CAP, sent_today: sentToday });
    }

    // Send
    const result = await sendWhapiText(e164, text);

    // Archive (always — whatever edit state, we want the learning signal)
    const aiDraft = lead.metadata && lead.metadata.draft_whapi_text;
    try {
      await supabase.from("sent_messages_archive").insert({
        lead_id: lead.id,
        channel: "whapi_text",
        final_text: text,
        ai_draft: aiDraft || null,
        lead_sector: lead.company_sector || null,
        lead_tier: lead.tier || null,
        lead_signal_category: lead.signal_category || null,
        pitch_mode_used: false,
        lang: "fr",
      });
    } catch (archErr) {
      console.warn("[archive] whapi_text insert failed:", archErr.message);
    }

    // Update lead metadata
    const updatedMeta = Object.assign({}, lead.metadata || {}, {
      whapi_sent_at: new Date().toISOString(),
      whapi_message_id: result.messageId,
      draft_whapi_text: null,
      draft_whapi_generated_at: null,
    });
    await supabase.from("leads").update({ metadata: updatedMeta }).eq("id", lead.id);

    res.json({ ok: true, message_id: result.messageId, phone_used: e164 });
  } catch (err) {
    console.error("POST /leads/:id/send-whapi-text error:", err.message);
    if (err.status) {
      return res.status(502).json({ error: "whapi_send_failed", detail: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/find-phone — recherche le numero WhatsApp via FullEnrich (10 credits).
 * Utilise dans l'onglet "Sans email" : Julien clique par lead pour decider en
 * connaissance de cause si ca vaut la depense, puis clique "Envoyer WhatsApp"
 * (endpoint /send-whatsapp standard) si le numero est trouve.
 *
 * - Trouve → update leads.phone + status = 'whatsapp_ready' + metadata.phone_found_at
 * - Non trouve → status = 'disqualified' + metadata.disqualified_reason = 'no_phone'
 *
 * Response:
 *   200 { ok: true, phone, status: 'whatsapp_ready' }
 *   200 { ok: false, status: 'disqualified', reason: 'no_phone' }
 *   404 { error: 'lead_not_found' }
 *   400 { error: 'missing_linkedin_url' }
 *   503 { error: 'fullenrich_not_configured' }
 */
router.post("/:id/find-phone", async (req, res) => {
  try {
    const { enrichPhone } = require("../lib/fullenrich");

    if (!process.env.FULLENRICH_API_KEY) {
      return res.status(503).json({ error: "fullenrich_not_configured" });
    }

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (fetchErr || !lead) return res.status(404).json({ error: "lead_not_found" });
    if (!lead.linkedin_url) return res.status(400).json({ error: "missing_linkedin_url" });

    const result = await enrichPhone(lead.linkedin_url, null);
    const phone = result && result.phone ? result.phone : null;

    if (phone) {
      const updatedMeta = Object.assign({}, lead.metadata || {}, {
        phone_found_at: new Date().toISOString(),
        phone_lookup_credits: (result && result.credits) || 10,
        phone_source: "fullenrich",
      });
      await supabase
        .from("leads")
        .update({ phone: phone, status: "whatsapp_ready", metadata: updatedMeta })
        .eq("id", lead.id);
      return res.json({ ok: true, phone: phone, status: "whatsapp_ready", credits: (result && result.credits) || 10 });
    }

    // Not found — archive lead so it stops polluting the list
    const deadMeta = Object.assign({}, lead.metadata || {}, {
      phone_lookup_failed_at: new Date().toISOString(),
      disqualified_reason: "no_phone",
    });
    await supabase
      .from("leads")
      .update({ status: "disqualified", metadata: deadMeta })
      .eq("id", lead.id);
    return res.json({ ok: false, status: "disqualified", reason: "no_phone" });
  } catch (err) {
    console.error("POST /leads/:id/find-phone error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/send-whatsapp — trigger the WhatsApp sub-flow for this lead.
 *
 * Flow:
 *   1. Resolve phone: body.manual_phone (if Julien typed it in the fallback
 *      modal) → existing lead.phone → FullEnrich phones lookup (10 credits).
 *   2. If still no phone → 404 { error: "phone_required" }. Frontend opens
 *      the manual-phone modal.
 *   3. findOrCreateSubscriber on uChat → get user_id.
 *   4. sendSubFlowByUserId(user_id, WHATSAPP_DEFAULT_SUB_FLOW). That
 *      subflow contains the Meta-approved carousel template + the tracking
 *      tag Julien configured in uChat.
 *   5. Mark lead: whatsapp_sent_at = now, metadata.whatsapp_* populated.
 *
 * The dashboard then displays a "↳ WhatsApp envoyé" sub-row under the lead
 * in /email-tracking, and updates live when the webhook POSTs delivery
 * status updates.
 *
 * Body: { manual_phone?: string }
 * Response:
 *   200 { ok, phone_used, user_id, created_subscriber, sub_flow_ns, enriched_phone }
 *   404 { error: "phone_required", reason: "enrich_empty" | "no_linkedin_url" }
 *   409 { error: "whatsapp_already_sent" } — whatsapp_sent_at already set
 *   502 { error: "uchat_failed", detail }
 */
router.post("/:id/send-whatsapp", async (req, res) => {
  try {
    const { enrichPhone } = require("../lib/fullenrich");
    const { findOrCreateSubscriber, sendSubFlowByUserId } = require("../lib/messagingme");

    const subFlowNs = process.env.WHATSAPP_DEFAULT_SUB_FLOW;
    if (!subFlowNs) {
      return res.status(503).json({ error: "whatsapp_not_configured", detail: "WHATSAPP_DEFAULT_SUB_FLOW env var missing" });
    }

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });

    // Guard (pre-check): terminal statuses don't get WhatsApp. The UI already
    // hides the button, but a direct API call / stale tab would bypass that.
    const terminal = ["replied", "meeting_booked", "disqualified"];
    if (terminal.includes(lead.status)) {
      return res.status(409).json({ error: "lead_terminal", status: lead.status });
    }

    // Guard (pre-check): obvious already-sent case, saves a DB roundtrip on
    // stale-UI double clicks. The real anti-race is the atomic reserve below.
    if (lead.whatsapp_sent_at) {
      return res.status(409).json({ error: "whatsapp_already_sent", sent_at: lead.whatsapp_sent_at });
    }

    // Normalize phone helper.
    // Accepts: "+33…", "33…" (raw E.164), "0033…" (international 00 prefix),
    //          "0633921577" (FR national), with optional whitespace/dashes.
    // Returns canonical "+XXXXXXXX" for uChat/WhatsApp.
    function normalize(p) {
      if (!p) return null;
      const s = String(p).replace(/[\s\-().]/g, "");
      if (!s) return null;
      if (s.startsWith("+")) return s;
      // International prefix "00" (e.g. "0033633921577") → +33633921577
      if (s.startsWith("00") && s.length >= 5) return "+" + s.slice(2);
      // French national mobile (10 digits starting with 0) — the most common
      // paste case from HubSpot and the manual-entry modal. Map 0X… → +33X….
      if (/^0\d{9}$/.test(s)) return "+33" + s.slice(1);
      // Otherwise treat as raw international digits and prefix +.
      if (/^\d+$/.test(s)) return "+" + s;
      return s;
    }

    // 1. Resolve phone — priority ladder, cheap sources first:
    //    manual > lead.phone > HubSpot > FullEnrich (10 credits)
    // The normalize() call uniforms the format regardless of source.
    const manualPhone = req.body && req.body.manual_phone ? normalize(req.body.manual_phone) : null;
    let phone = manualPhone || normalize(lead.phone);
    let phoneSource = manualPhone ? "manual" : (phone ? "stored" : null);

    // Try HubSpot before burning FullEnrich credits.
    if (!phone) {
      try {
        const { findPhoneInHubspot, setPhoneInHubspot } = require("../lib/hubspot");
        const hsPhone = await findPhoneInHubspot({
          email: lead.email,
          firstName: lead.first_name,
          lastName: lead.last_name,
          companyName: lead.company_name,
        });
        if (hsPhone && hsPhone.phone) {
          const normalized = normalize(hsPhone.phone);
          phone = normalized;
          phoneSource = "hubspot_" + hsPhone.source;

          // If the HubSpot stored value is not canonical E.164 (common case:
          // "06 33 92 15 77"), rewrite it in place so future lookups + Meta
          // sends don't choke on the format. Same field, overwrite allowed.
          if (normalized && normalized !== hsPhone.phone) {
            const targetField = hsPhone.source === "phone" ? "phone" : "mobilephone";
            setPhoneInHubspot(hsPhone.contactId, normalized, { field: targetField, overwrite: true })
              .then((ok) => {
                if (ok) console.log("[send-whatsapp] HubSpot phone reformatted on contact " + hsPhone.contactId + " (" + targetField + "): " + hsPhone.phone + " → " + normalized);
              })
              .catch((e) => console.warn("[send-whatsapp] HubSpot reformat failed:", e.message));
            // Note: fire-and-forget; we don't block the WhatsApp send on this.
          }
        }
      } catch (hsErr) {
        console.warn("[send-whatsapp] HubSpot phone lookup threw:", hsErr.message);
        // fail-open: just continue to FullEnrich
      }
    }

    if (!phone) {
      if (!lead.linkedin_url) {
        return res.status(404).json({ error: "phone_required", reason: "no_linkedin_url" });
      }

      // Daily cap on FullEnrich phone enrichments — each costs 10 credits and
      // Julien agreed to a 50-credits/day ceiling (~5 clicks). Count recent
      // FullEnrich-sourced sends in the last 24h.
      const FULLENRICH_PHONE_DAILY_CAP = 5;
      const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { count: enrichedToday } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("metadata->>whatsapp_send_source", "fullenrich")
        .gte("whatsapp_sent_at", cutoff);
      if ((enrichedToday || 0) >= FULLENRICH_PHONE_DAILY_CAP) {
        return res.status(429).json({
          error: "fullenrich_daily_cap",
          detail: "Already " + enrichedToday + " phone enrichments in the last 24h (cap: " + FULLENRICH_PHONE_DAILY_CAP + "). Send a manual phone or wait.",
        });
      }

      const enriched = await enrichPhone(lead.linkedin_url, null);
      if (enriched && enriched.phone) {
        phone = normalize(enriched.phone);
        phoneSource = "fullenrich";

        // We just spent 10 credits — don't lose the data. If the lead is in
        // HubSpot, write the phone back on its contact. If it isn't, create
        // the contact with everything we know (email, name, phone, company,
        // headline). That way Julien's CRM accretes value instead of us
        // re-paying FullEnrich for the same lead later.
        if (lead.email) {
          try {
            const { existsInHubspotByEmail, setPhoneInHubspot, createContactInHubspot } = require("../lib/hubspot");
            const hs = await existsInHubspotByEmail(lead.email);
            let hubspotContactId = null;
            let hubspotAction = null;

            if (hs.found && hs.contactId) {
              hubspotContactId = hs.contactId;
              const pushed = await setPhoneInHubspot(hs.contactId, phone);
              hubspotAction = pushed ? "updated" : "skipped_existing_phone";
            } else {
              const created = await createContactInHubspot({
                email: lead.email,
                firstname: lead.first_name,
                lastname: lead.last_name,
                mobilephone: phone,
                company: lead.company_name,
                jobtitle: lead.headline,
                website: lead.company_linkedin_url || undefined,
              });
              if (created && created.contactId) {
                hubspotContactId = created.contactId;
                hubspotAction = created.created ? "created" : "conflict_resolved";
              }
            }

            if (hubspotContactId) {
              console.log("[send-whatsapp] HubSpot " + hubspotAction + " lead_id=" + lead.id + " contact_id=" + hubspotContactId);
              // Persist the contact id on the lead for future lookups.
              // Note: this update is idempotent — we'll overwrite later in the
              // main patch (`patch.metadata`), but we set it here so it's in
              // place even if the main update then fails.
              const nextMeta = Object.assign({}, lead.metadata || {}, {
                hubspot_contact_id: hubspotContactId,
                hubspot_phone_write_action: hubspotAction,
                hubspot_phone_write_at: new Date().toISOString(),
              });
              lead.metadata = nextMeta;
            }
          } catch (hsErr) {
            console.warn("[send-whatsapp] HubSpot write-back failed:", hsErr.message);
          }
        }
      }
    }

    if (!phone) {
      return res.status(404).json({ error: "phone_required", reason: "enrich_empty" });
    }

    // 2. ATOMIC RESERVE — close the double-click / double-render race.
    // We mark whatsapp_sent_at=NOW *before* hitting uChat, conditional on
    // whatsapp_sent_at being still null. If another request already reserved
    // this lead, the update affects 0 rows and we return 409 without calling
    // uChat. If uChat later fails, we rollback by clearing whatsapp_sent_at.
    const reservedAt = new Date().toISOString();
    const { data: reserveResult, error: reserveErr } = await supabase
      .from("leads")
      .update({ whatsapp_sent_at: reservedAt })
      .eq("id", lead.id)
      .is("whatsapp_sent_at", null)
      .select("id");
    if (reserveErr) {
      console.error("[send-whatsapp] atomic reserve failed:", reserveErr.message);
      return res.status(500).json({ error: "reserve_failed", detail: reserveErr.message });
    }
    if (!reserveResult || reserveResult.length === 0) {
      return res.status(409).json({ error: "whatsapp_already_sent_race" });
    }

    async function rollback(reason) {
      const { error: rbErr } = await supabase
        .from("leads")
        .update({ whatsapp_sent_at: null })
        .eq("id", lead.id)
        .eq("whatsapp_sent_at", reservedAt); // only undo OUR reservation
      if (rbErr) console.error("[send-whatsapp] rollback failed (" + reason + "):", rbErr.message);
    }

    // 3. Upsert uChat subscriber
    let subscriber, created;
    try {
      const result = await findOrCreateSubscriber(phone, {
        first_name: lead.first_name || null,
        last_name: lead.last_name || null,
        email: lead.email || null,
      });
      subscriber = result.subscriber;
      created = result.created;
    } catch (uchatErr) {
      console.error("[send-whatsapp] uChat subscriber failed:", uchatErr.message);
      await rollback("subscriber_fail");
      return res.status(502).json({ error: "uchat_failed", step: "subscriber", detail: uchatErr.message });
    }

    const userId = subscriber.user_id;
    const userNs = subscriber.user_ns;

    // 4. Trigger the sub-flow (carousel template + tracking tag)
    let flowResponse;
    try {
      flowResponse = await sendSubFlowByUserId(userId, subFlowNs);
    } catch (flowErr) {
      console.error("[send-whatsapp] sub-flow send failed:", flowErr.message);
      await rollback("subflow_fail");
      return res.status(502).json({ error: "uchat_failed", step: "sub_flow", detail: flowErr.message });
    }

    // 5. Persist metadata + phone (the reservation already set whatsapp_sent_at)
    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      whatsapp_user_id: userId,
      whatsapp_user_ns: userNs,
      whatsapp_sub_flow_ns: subFlowNs,
      whatsapp_status: "sent",
      whatsapp_send_source: phoneSource, // manual | stored | hubspot_mobile | hubspot_phone | hubspot_calculated | fullenrich
      whatsapp_uchat_response: flowResponse,
    });
    const patch = { metadata: updatedMetadata };
    if (phone !== lead.phone) patch.phone = phone;

    const { error: updErr } = await supabase
      .from("leads")
      .update(patch)
      .eq("id", lead.id);
    if (updErr) {
      // WhatsApp IS sent via uChat and the lead IS marked whatsapp_sent_at
      // (from the atomic reserve). The only thing missing is the metadata
      // enrichment — not safe to rollback the reserve (would mask the send
      // from the webhook's phone lookup). Log loudly so Julien can re-hydrate
      // the metadata manually if he cares about the tracking detail.
      console.error("[send-whatsapp] CRITICAL: uChat sent, reserve held, but metadata update failed:", updErr.message, "lead_id=" + lead.id);
      return res.status(200).json({
        ok: true,
        warning: "WhatsApp sent and reserved but metadata update failed: " + updErr.message,
        phone_used: phone,
        user_id: userId,
        sub_flow_ns: subFlowNs,
      });
    }

    res.json({
      ok: true,
      phone_used: phone,
      phone_source: phoneSource,
      user_id: userId,
      created_subscriber: created,
      sub_flow_ns: subFlowNs,
    });
  } catch (err) {
    console.error("POST /leads/:id/send-whatsapp error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id/first-email — fetch the subject + archived HTML body of the first
 * email that was actually sent to this lead. Used by the /email-followups
 * accordion to let Julien reread the initial mail before picking a case study
 * for the follow-up.
 *
 * Response: { subject, body, sent_at, message_id, body_archived }
 *   - body is non-null only for mails approved AFTER the archival fix (see
 *     approve-email); older mails have body_archived=false and body=null.
 */
router.get("/:id/first-email", async (req, res) => {
  try {
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, metadata, email_sent_at")
      .eq("id", req.params.id)
      .single();
    if (error || !lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.email_sent_at) return res.status(404).json({ error: "No first email on this lead" });

    const md = lead.metadata || {};
    res.json({
      subject: md.email_subject || null,
      body: md.email_body || null,
      sent_at: lead.email_sent_at,
      message_id: md.email_message_id || null,
      body_archived: Boolean(md.email_body),
    });
  } catch (err) {
    console.error("GET /leads/:id/first-email error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /:id/followup-email — same contract as /first-email but for the J+14
 * follow-up mail (metadata.followup_subject / followup_body). Used by the
 * accordion in /email-tracking to let Julien reread what actually went out.
 */
router.get("/:id/followup-email", async (req, res) => {
  try {
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id, metadata, email_followup_sent_at")
      .eq("id", req.params.id)
      .single();
    if (error || !lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.email_followup_sent_at) return res.status(404).json({ error: "No follow-up email on this lead" });

    const md = lead.metadata || {};
    res.json({
      subject: md.followup_subject || null,
      body: md.followup_body || null,
      sent_at: lead.email_followup_sent_at,
      message_id: md.followup_message_id || null,
      body_archived: Boolean(md.followup_body),
    });
  } catch (err) {
    console.error("GET /leads/:id/followup-email error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /:id/reject-followup — Julien doesn't want to send any follow-up for
 * this lead. We don't change the lead's status (it's still in email_sent and
 * could reply anytime), we just flag metadata.followup_rejected_at so it
 * disappears from the "Cas à valider" queue. Reversible: clearing the flag
 * puts the lead back in the queue if it's still inside the J-3..J-21 window.
 */
router.post("/:id/reject-followup", async (req, res) => {
  try {
    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, status, metadata")
      .eq("id", req.params.id)
      .single();
    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      followup_rejected_at: new Date().toISOString(),
      followup_rejected_reason: req.body && req.body.reason ? String(req.body.reason).slice(0, 200) : null,
    });

    const { error: updErr } = await supabase
      .from("leads")
      .update({ metadata: updatedMetadata })
      .eq("id", lead.id);
    if (updErr) {
      console.error("POST /leads/:id/reject-followup update error:", updErr.message);
      return res.status(500).json({ error: "Failed to flag lead" });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("POST /leads/:id/reject-followup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/generate-followup-now -- Generate a follow-up email draft on demand.
 *
 * Use case: Julien sees in /email-tracking that a prospect opened the first
 * email. He doesn't want to wait J+14 for Task F to kick in — he wants a draft
 * ready to send right now, using the same "cite a case study + different angle"
 * Sonnet flow. This endpoint mirrors Task F but for a single lead.
 *
 * Preconditions:
 *   - lead exists, has email_sent_at (a first email went out)
 *   - lead has no email_followup_sent_at (no follow-up already sent)
 *   - lead is not in replied/meeting_booked/disqualified status
 *
 * If a draft already exists (status=email_followup_pending), we overwrite it
 * with a fresh Sonnet pass.
 *
 * The resulting draft lands in /messages-draft under the "Relances mail" tab.
 */
router.post("/:id/generate-followup-now", async (req, res) => {
  try {
    const { generateFollowupEmail, loadTemplates } = require("../lib/message-generator");
    const { loadCaseStudies, pickCaseStudyForLead } = require("../tasks/task-f-email-followup");
    const { refreshLeadForFollowup } = require("../lib/lead-refresh");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.email_sent_at) {
      return res.status(400).json({ error: "No first email was sent — nothing to follow up on" });
    }
    if (lead.email_followup_sent_at) {
      return res.status(409).json({ error: "A follow-up email has already been sent to this lead" });
    }
    const terminal = ["replied", "meeting_booked", "disqualified"];
    if (terminal.includes(lead.status)) {
      return res.status(409).json({ error: "Lead status is terminal (" + lead.status + "), follow-up not applicable" });
    }
    if (!lead.email && !(lead.metadata && lead.metadata.draft_email_to)) {
      return res.status(400).json({ error: "Lead has no email address" });
    }

    // Refresh the LinkedIn data right before asking Sonnet — gives the LLM the
    // freshest view of the prospect (new posts since first contact) and the
    // company (latest description, specialities, size). Up to 2 BeReach credits.
    // Degrades gracefully: if BeReach is down or the URLs are missing, we
    // generate from stale data and surface the skip reason.
    let refreshSummary = null;
    try {
      const refreshed = await refreshLeadForFollowup(lead);
      refreshSummary = refreshed.summary;
      // Persist the freshened metadata on the lead right away. Sonnet then
      // reads from `lead` directly (we mutate the in-memory copy below).
      const { data: savedLead, error: saveErr } = await supabase
        .from("leads")
        .update(refreshed.patch)
        .eq("id", lead.id)
        .select()
        .single();
      if (!saveErr && savedLead) {
        // Replace the in-memory lead so generateFollowupEmail sees fresh data
        Object.assign(lead, savedLead);
      }
    } catch (refreshErr) {
      console.warn("[generate-followup-now] refresh failed, falling back to stored data:", refreshErr.message);
      refreshSummary = { profile_refreshed: false, company_refreshed: false, skipped: ["fatal:" + refreshErr.message] };
    }

    const [templates, caseStudies] = await Promise.all([loadTemplates(), loadCaseStudies()]);

    // Case study selection — supports MULTIPLE case studies:
    //   - body.case_study_ids = [1, 5, 6] → Julien picked several in the UI
    //   - body.case_study_id = integer → legacy single pick (backward compat)
    //   - body.case_study_id = null / "none" → Julien asked Sonnet to stay generic
    //   - body absent / undefined → fallback to sector-matching (Task F's behavior)
    let caseStudy = null;       // primary (for generateFollowupEmail signature compat)
    let additionalCases = [];   // extras injected into the prompt context
    const rawIds = req.body && req.body.case_study_ids;
    const rawCaseId = req.body && req.body.case_study_id;

    let pitchModeActive = false;

    if (Array.isArray(rawIds) && rawIds.length > 0) {
      // Multi-select mode — delegate to injectSelectedCases which handles
      // pitch-mode override (directive vs. regular cases).
      const validIds = rawIds.filter((rid) => rid !== "none" && rid !== null && Number.isInteger(Number.parseInt(rid, 10)));
      if (validIds.length > 0) {
        const injected = await injectSelectedCases(lead, validIds);
        pitchModeActive = injected.pitchModeActive;
        // In pitch mode, caseStudy stays null (directive drives the pitch).
        // In regular mode, pick the 1st regular case as the primary.
        if (!pitchModeActive) {
          const regularCases = caseStudies.filter((c) =>
            validIds.includes(c.id) || validIds.includes(String(c.id))
          ).filter((c) => c.mode !== "override_pitch");
          if (regularCases.length > 0) caseStudy = regularCases[0];
        }
      }
    } else if (rawCaseId === null || rawCaseId === "none") {
      caseStudy = null;
    } else if (rawCaseId !== undefined && rawCaseId !== "") {
      const parsed = Number.parseInt(rawCaseId, 10);
      if (!Number.isInteger(parsed)) {
        return res.status(400).json({ error: "case_study_id must be an integer, null, or 'none'" });
      }
      caseStudy = caseStudies.find((c) => c.id === parsed) || null;
      if (!caseStudy) {
        return res.status(404).json({ error: "Case study " + parsed + " not found or inactive" });
      }
    } else {
      caseStudy = pickCaseStudyForLead(lead, caseStudies);
    }

    const emailContent = await generateFollowupEmail(lead, templates, caseStudy);
    if (!emailContent || !emailContent.subject || !emailContent.body) {
      return res.status(502).json({ error: "Follow-up generation failed (Sonnet returned empty)" });
    }

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      draft_followup_subject: emailContent.subject,
      draft_followup_body: emailContent.body,
      draft_followup_to: lead.email,
      draft_followup_generated_at: new Date().toISOString(),
      draft_followup_case_id: caseStudy ? caseStudy.id : null,
      draft_followup_source: "manual_fast",
      pitch_mode_used: pitchModeActive || undefined,
    });
    cleanCaseInjection(updatedMetadata);

    const { error: updErr } = await supabase
      .from("leads")
      .update({
        status: "email_followup_pending",
        metadata: updatedMetadata,
      })
      .eq("id", lead.id);

    if (updErr) {
      console.error("POST /leads/:id/generate-followup-now update error:", updErr.message);
      return res.status(500).json({ error: "Failed to persist draft" });
    }

    res.json({
      ok: true,
      subject: emailContent.subject,
      body: emailContent.body,
      refresh: refreshSummary,
    });
  } catch (err) {
    console.error("POST /leads/:id/generate-followup-now error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/approve-email-followup -- Send the followup email as a reply-in-thread.
 * Uses the original email's messageId to thread the conversation.
 * Injects click+open tracking before sending.
 */
router.post("/:id/approve-email-followup", async (req, res) => {
  try {
    const { sendEmail } = require("../lib/gmail");
    const { injectTracking } = require("../lib/tracking");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_followup_pending") {
      return res.status(400).json({ error: "Lead is not in email_followup_pending status" });
    }

    const email = lead.metadata?.draft_followup_to || lead.email;
    if (!email) return res.status(400).json({ error: "No email address" });

    let subject = (req.body.subject || "").trim() || lead.metadata?.draft_followup_subject;
    const body = (req.body.body || "").trim() || lead.metadata?.draft_followup_body;
    if (!subject || !body) return res.status(400).json({ error: "No email content to send" });

    // Archive BEFORE the send — captures Julien's edits vs. the AI draft
    const aiBodyDraft = lead.metadata?.draft_followup_body;
    if (aiBodyDraft) {
      const archiveLang = (lead.metadata?.forced_lang || "fr");
      await archiveIfEdited(
        lead, "email_followup",
        htmlToPlain(body), htmlToPlain(aiBodyDraft), archiveLang
      );
    }

    // Prefix with "Re: " if not already present — Gmail will thread it with the original
    if (!/^re\s*:/i.test(subject)) {
      subject = "Re: " + subject;
    }

    // Inject click + open tracking before sending
    const trackedBody = injectTracking(body, lead.id, "email_followup");

    // Reply in thread via Nodemailer inReplyTo/references headers
    const inReplyTo = lead.metadata?.email_message_id || null;
    const messageId = await sendEmail(email, subject, trackedBody, null, {
      inReplyTo: inReplyTo,
      references: inReplyTo,
    });

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      followup_subject: subject,
      followup_body: body,           // same rationale as email_body on approve-email: keep sent copy for UI preview
      followup_message_id: messageId,
      draft_followup_subject: null,
      draft_followup_body: null,
      draft_followup_to: null,
      draft_followup_run_id: null,
      draft_followup_generated_at: null,
    });

    // CRITICAL: the email is already sent at this point. If the DB update fails,
    // we must NOT return a 500 that the UI would interpret as "try again" — that
    // would duplicate the send. Instead, log loudly and return success with a warning flag.
    const { error: updateErr } = await supabase
      .from("leads")
      .update({
        status: "email_followup_sent",
        email_followup_sent_at: new Date().toISOString(),
        metadata: updatedMetadata,
      })
      .eq("id", lead.id);

    if (updateErr) {
      console.error("CRITICAL: followup email sent to " + email + " (messageId " + messageId + ") but DB update failed:", updateErr.message);
      // Return 200 with a warning — UI should refresh and the lead will still appear
      // in the validation queue. Julien should manually check Gmail before re-approving.
      return res.json({
        ok: true,
        email,
        subject,
        warning: "Email sent but DB update failed: " + updateErr.message + ". Check Gmail Sent folder before re-approving.",
      });
    }

    res.json({ ok: true, email, subject });

    // ── Fire-and-forget HubSpot logging (same pattern as approve-email)
    logEmailToHubspotAsync(lead, { subject, body }, email);
  } catch (err) {
    console.error("POST /leads/:id/approve-email-followup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/reject-email-followup -- Delete the lead + add to suppression list.
 * Same pattern as reject-email / reject-reinvite.
 */
router.post("/:id/reject-email-followup", async (req, res) => {
  try {
    const { addToSuppressionList } = require("../lib/suppression");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, status, full_name, linkedin_url, email")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_followup_pending") {
      return res.status(400).json({ error: "Lead is not in email_followup_pending status" });
    }

    await addToSuppressionList({
      email: lead.email,
      linkedinUrl: lead.linkedin_url,
      reason: "rejected_followup",
    });

    const { error: delErr } = await supabase.from("leads").delete().eq("id", lead.id);
    if (delErr) return res.status(500).json({ error: "Delete failed: " + delErr.message });

    console.log("Lead deleted + suppressed via reject-email-followup:", lead.full_name || lead.id);
    res.json({ ok: true, deleted: true, suppressed: true });
  } catch (err) {
    console.error("POST /leads/:id/reject-email-followup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/regenerate-email-followup -- Regenerate followup draft.
 * Body: { lang?: "fr" | "en", case_study_ids?: [1, 5, 12] }
 *
 * If case_study_ids is provided, the FIRST one becomes the "primary" case
 * cited with metric, and any extras go in metadata._additional_case_studies
 * so Sonnet has them for context. Without case_study_ids, we fall back to
 * the originally-picked case (metadata.draft_followup_case_id).
 */
router.post("/:id/regenerate-email-followup", async (req, res) => {
  try {
    const { generateFollowupEmail, loadTemplates } = require("../lib/message-generator");

    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_followup_pending") {
      return res.status(400).json({ error: "Lead is not in email_followup_pending status" });
    }

    const lang = req.body.lang === "en" ? "en" : (req.body.lang === "fr" ? "fr" : "fr");

    // Override language detection by temporarily injecting a location hint
    const originalLocation = lead.location;
    lead.location = lang === "en" ? "New York, US" : "Paris, France";

    // Case injection with pitch-mode detection.
    // - override_pitch case → populated via injectSelectedCases as
    //   _pitch_directive (full description) + _pitch_mode_active flag.
    // - regular cases → 1st one used as primary caseStudy parameter,
    //   extras fall into _additional_case_studies.
    // - No case_study_ids → fall back to the lead's original case.
    let caseStudy = null;
    const rawIds = req.body && req.body.case_study_ids;
    const hasOverride = Array.isArray(rawIds) && rawIds.length > 0;
    let pitchModeActive = false;

    if (hasOverride) {
      const injected = await injectSelectedCases(lead, rawIds);
      pitchModeActive = injected.pitchModeActive;
      // If any regular case was selected, re-fetch to pick the primary caseStudy
      // (the 1st regular case). In pitch mode, caseStudy stays null — the
      // directive handles the entire pitch.
      if (!pitchModeActive) {
        const { data: allCases } = await supabase
          .from("case_studies")
          .select("*")
          .eq("is_active", true);
        const regularCases = (allCases || []).filter((c) =>
          (rawIds.includes(c.id) || rawIds.includes(String(c.id))) && c.mode !== "override_pitch"
        );
        if (regularCases.length > 0) caseStudy = regularCases[0];
      }
    } else {
      // Fall back to the originally-picked case
      const caseId = lead.metadata?.draft_followup_case_id;
      if (caseId) {
        const { data: cs } = await supabase.from("case_studies").select("*").eq("id", caseId).single();
        caseStudy = cs;
      }
    }

    const templates = await loadTemplates();
    const emailContent = await generateFollowupEmail(lead, templates, caseStudy);

    lead.location = originalLocation; // restore

    if (!emailContent) return res.status(500).json({ error: "Failed to regenerate" });

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      draft_followup_subject: emailContent.subject,
      draft_followup_body: emailContent.body,
      draft_followup_generated_at: new Date().toISOString(),
      forced_lang: lang,
      draft_followup_case_id: hasOverride && caseStudy ? caseStudy.id : (lead.metadata?.draft_followup_case_id || null),
      regenerated_with_cases: hasOverride ? rawIds : undefined,
      pitch_mode_used: pitchModeActive || undefined,
    });
    cleanCaseInjection(updatedMetadata);

    await supabase.from("leads").update({ metadata: updatedMetadata }).eq("id", lead.id);
    res.json({
      ok: true,
      lang,
      subject: emailContent.subject,
      body: emailContent.body,
      with_cases: hasOverride ? rawIds.length : 0,
    });
  } catch (err) {
    console.error("POST /leads/:id/regenerate-email-followup error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /:id/email-events -- Return all click/open events for a lead (for engagement badges).
 */
router.get("/:id/email-events", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("email_events")
      .select("id, email_type, event_type, url_clicked, created_at")
      .eq("lead_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ events: data });
  } catch (err) {
    console.error("GET /leads/:id/email-events error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
