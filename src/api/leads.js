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
 * POST /:id/reject-message -- Discard draft, put lead back to connected
 */
router.post("/:id/reject-message", async (req, res) => {
  try {
    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, status, metadata")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "message_pending") return res.status(400).json({ error: "Lead is not in message_pending status" });

    const updatedMetadata = Object.assign({}, lead.metadata || {});
    delete updatedMetadata.draft_message;
    delete updatedMetadata.draft_run_id;
    delete updatedMetadata.draft_generated_at;

    await supabase
      .from("leads")
      .update({ status: "disqualified", metadata: updatedMetadata })
      .eq("id", lead.id);

    res.json({ ok: true });
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

    const messageId = await sendEmail(email, subject, body);

    const updatedMetadata = Object.assign({}, lead.metadata || {}, {
      email_subject: subject,
      email_message_id: messageId,
      draft_email_subject: null,
      draft_email_body: null,
      draft_email_to: null,
      draft_email_run_id: null,
      draft_email_generated_at: null,
    });

    await supabase
      .from("leads")
      .update({
        status: "email_sent",
        email_sent_at: new Date().toISOString(),
        metadata: updatedMetadata,
      })
      .eq("id", lead.id);

    res.json({ ok: true, email, subject });
  } catch (err) {
    console.error("POST /leads/:id/approve-email error:", err.message);
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
 * POST /:id/reject-email -- Discard email draft, revert to previous status
 */
router.post("/:id/reject-email", async (req, res) => {
  try {
    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, status, metadata")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "email_pending") return res.status(400).json({ error: "Lead is not in email_pending status" });

    const updatedMetadata = Object.assign({}, lead.metadata || {});
    updatedMetadata.skip_email = true;
    const revertStatus = updatedMetadata.pre_email_status || "invitation_sent";
    delete updatedMetadata.draft_email_subject;
    delete updatedMetadata.draft_email_body;
    delete updatedMetadata.draft_email_to;
    delete updatedMetadata.draft_email_run_id;
    delete updatedMetadata.draft_email_generated_at;
    delete updatedMetadata.pre_email_status;

    // Revert to previous status (invitation_sent or messaged)
    await supabase
      .from("leads")
      .update({ status: revertStatus, metadata: updatedMetadata })
      .eq("id", lead.id);

    res.json({ ok: true });
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
 * POST /:id/reject-reinvite -- Julien rejects a re-invitation.
 * Disqualifies the lead.
 */
router.post("/:id/reject-reinvite", async (req, res) => {
  try {
    const { data: lead, error: fetchErr } = await supabase
      .from("leads")
      .select("id, status, metadata")
      .eq("id", req.params.id)
      .single();

    if (fetchErr || !lead) return res.status(404).json({ error: "Lead not found" });
    if (lead.status !== "reinvite_pending") return res.status(400).json({ error: "Lead is not in reinvite_pending status" });

    var metadata = Object.assign({}, lead.metadata || {});
    delete metadata.draft_invitation_note;
    delete metadata.draft_reinvite_run_id;
    delete metadata.draft_reinvite_generated_at;

    await supabase
      .from("leads")
      .update({ status: "disqualified", metadata: metadata })
      .eq("id", lead.id);

    res.json({ ok: true, action: "disqualified" });
  } catch (err) {
    console.error("POST /leads/:id/reject-reinvite error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
