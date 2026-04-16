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
  } catch (err) {
    console.error("POST /leads/:id/approve-email error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/regenerate-message -- Regenerate LinkedIn follow-up draft with forced language
 * Body: { lang: "fr" | "en" }
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

    const lang = req.body.lang === "en" ? "en" : "fr";

    // Override language detection by temporarily injecting a location hint
    const originalLocation = lead.location;
    lead.location = lang === "en" ? "New York, US" : "Paris, France";

    const templates = await loadTemplates();
    const message = await generateFollowUpMessage(lead, templates);

    lead.location = originalLocation; // restore

    if (!message) return res.status(500).json({ error: "Failed to generate message" });

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      draft_message: message,
      draft_generated_at: new Date().toISOString(),
      forced_lang: lang,
    });

    await supabase
      .from("leads")
      .update({ metadata: updatedMetadata })
      .eq("id", lead.id);

    res.json({ ok: true, lang, message });
  } catch (err) {
    console.error("POST /leads/:id/regenerate-message error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /:id/regenerate-email -- Regenerate email draft with forced language
 * Body: { lang: "fr" | "en" }
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

    const lang = req.body.lang === "en" ? "en" : "fr";

    // Override language detection by temporarily injecting a location hint
    const originalLocation = lead.location;
    lead.location = lang === "en" ? "New York, US" : "Paris, France";

    const templates = await loadTemplates();
    const emailContent = await generateEmail(lead, templates);

    lead.location = originalLocation; // restore

    if (!emailContent) return res.status(500).json({ error: "Failed to generate email" });

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      draft_email_subject: emailContent.subject,
      draft_email_body: emailContent.body,
      draft_email_generated_at: new Date().toISOString(),
      forced_lang: lang,
    });

    await supabase
      .from("leads")
      .update({ metadata: updatedMetadata })
      .eq("id", lead.id);

    res.json({ ok: true, lang, subject: emailContent.subject });
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
    // Accepts: "+33…", "33…" (raw E.164), "0633921577" (FR national), with
    // optional whitespace/dashes. Returns canonical "+XXXXXXXX".
    function normalize(p) {
      if (!p) return null;
      const s = String(p).replace(/[\s\-().]/g, "");
      if (!s) return null;
      if (s.startsWith("+")) return s;
      // French national mobile (10 digits starting with 0) — the most common
      // paste case from the manual-entry modal. Map 0X… → +33X….
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
        const { findPhoneInHubspot } = require("../lib/hubspot");
        const hsPhone = await findPhoneInHubspot({
          email: lead.email,
          firstName: lead.first_name,
          lastName: lead.last_name,
          companyName: lead.company_name,
        });
        if (hsPhone && hsPhone.phone) {
          phone = normalize(hsPhone.phone);
          phoneSource = "hubspot_" + hsPhone.source; // hubspot_mobile / hubspot_phone / hubspot_calculated
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

        // Push the costly find back to HubSpot so we don't pay 10 credits again
        // next time. Only if we have an email to identify the contact, and only
        // if a HubSpot contact already exists (we don't proactively create CRM
        // contacts from here — that's Julien's curation workflow).
        if (lead.email) {
          try {
            const { existsInHubspotByEmail, setPhoneInHubspot } = require("../lib/hubspot");
            const hs = await existsInHubspotByEmail(lead.email);
            if (hs.found && hs.contactId) {
              const pushed = await setPhoneInHubspot(hs.contactId, phone);
              if (pushed) {
                console.log("[send-whatsapp] pushed phone back to HubSpot lead_id=" + lead.id + " contact_id=" + hs.contactId);
              }
            }
          } catch (hsErr) {
            console.warn("[send-whatsapp] HubSpot phone write-back failed:", hsErr.message);
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

    // Case study selection:
    //   - body.case_study_id = integer → Julien explicitly picked one in the UI (new flow)
    //   - body.case_study_id = null / "none" → Julien asked Sonnet to stay generic
    //   - body absent / undefined → fallback to sector-matching (Task F's behavior)
    let caseStudy = null;
    const rawCaseId = req.body && req.body.case_study_id;
    if (rawCaseId === null || rawCaseId === "none") {
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
    });

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
 * POST /:id/regenerate-email-followup -- Regenerate followup draft with forced language.
 * Body: { lang: "fr" | "en" }
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

    const lang = req.body.lang === "en" ? "en" : "fr";

    // Override language detection by temporarily injecting a location hint
    const originalLocation = lead.location;
    lead.location = lang === "en" ? "New York, US" : "Paris, France";

    // Re-fetch the same case study that was used originally (if any)
    let caseStudy = null;
    const caseId = lead.metadata?.draft_followup_case_id;
    if (caseId) {
      const { data: cs } = await supabase.from("case_studies").select("*").eq("id", caseId).single();
      caseStudy = cs;
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
    });

    await supabase.from("leads").update({ metadata: updatedMetadata }).eq("id", lead.id);
    res.json({ ok: true, lang, subject: emailContent.subject });
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
