/**
 * Task E: WhatsApp J+14 template creation.
 * Runs daily at 10h30 Mon-Sat.
 *
 * Selects leads eligible for WhatsApp at J+14 (the LATEST email sent, 1st or followup).
 * Two paths:
 *   - email_followup_sent leads at 14 days after email_followup_sent_at (priority)
 *   - email_sent leads at 14 days after email_sent_at (AND no pending followup)
 *   - invitation_sent/messaged leads at 14 days after invitation_sent_at (legacy fallback)
 *
 * Generates a personalized WhatsApp template body via Claude Sonnet,
 * and creates a unique Meta template per lead via MessagingMe API.
 */

const { supabase } = require("../lib/supabase");
const { createWhatsAppTemplate } = require("../lib/messagingme");
const { isSuppressed } = require("../lib/suppression");
const { generateWhatsAppBody, isColdLead, loadTemplates } = require("../lib/message-generator");
const { log } = require("../lib/logger");

module.exports = async function taskEWhatsapp(runId) {
  await log(runId, "task-e-whatsapp", "info", "Task E started: WhatsApp J+14 template creation");

  try {
    // Calculate cutoff dates
    var now = new Date();
    var fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    var selectCols = "id, full_name, first_name, last_name, linkedin_url, phone, headline, company_name, signal_type, signal_category, signal_source, signal_detail, metadata, email, icp_score, tier, location, company_location, company_size, company_sector, seniority_years, connections_count";

    // Path 1 (priority): leads whose followup email was sent >= 14 days ago
    var { data: followupLeads, error: err0 } = await supabase
      .from("leads")
      .select(selectCols)
      .eq("status", "email_followup_sent")
      .lte("email_followup_sent_at", fourteenDaysAgo)
      .is("whatsapp_template_created_at", null)
      .not("phone", "is", null)
      .in("tier", ["hot", "warm", "cold"])
      .limit(50);

    // Path 2: leads whose 1st email was sent >= 14 days ago AND no followup was ever sent
    // (skip if a followup is pending — wait for it to be approved or rejected)
    var { data: emailLeads, error: err1 } = await supabase
      .from("leads")
      .select(selectCols)
      .eq("status", "email_sent")
      .lte("email_sent_at", fourteenDaysAgo)
      .is("email_followup_sent_at", null)
      .is("whatsapp_template_created_at", null)
      .not("phone", "is", null)
      .in("tier", ["hot", "warm", "cold"])
      .limit(50);

    // Path 3 (legacy): leads that never got an email, still in invitation phase at J+14
    var { data: invitationLeads, error: err2 } = await supabase
      .from("leads")
      .select(selectCols)
      .in("status", ["invitation_sent", "messaged"])
      .or("invitation_sent_at.lte." + fourteenDaysAgo + ",follow_up_sent_at.lte." + fourteenDaysAgo)
      .is("whatsapp_template_created_at", null)
      .not("phone", "is", null)
      .in("tier", ["hot", "warm", "cold"])
      .limit(50);

    if (err0) {
      await log(runId, "task-e-whatsapp", "error", "Failed to query followup leads: " + err0.message);
    }
    if (err1) {
      await log(runId, "task-e-whatsapp", "error", "Failed to query email leads: " + err1.message);
    }
    if (err2) {
      await log(runId, "task-e-whatsapp", "error", "Failed to query invitation leads: " + err2.message);
    }

    // Merge and deduplicate by lead ID (priority order: followup > email > invitation)
    var allLeads = [].concat(followupLeads || [], emailLeads || [], invitationLeads || []);
    var seen = {};
    var leads = [];
    for (var i = 0; i < allLeads.length; i++) {
      if (!seen[allLeads[i].id]) {
        seen[allLeads[i].id] = true;
        leads.push(allLeads[i]);
      }
    }

    if (leads.length === 0) {
      await log(runId, "task-e-whatsapp", "info", "No leads eligible for WhatsApp J+14");
      return;
    }

    await log(runId, "task-e-whatsapp", "info", "Found " + leads.length + " leads for WhatsApp J+14");

    // Cache templates once before lead loop (PERF-08)
    var templates = await loadTemplates();

    var created = 0;
    var skipped = 0;

    for (var j = 0; j < leads.length; j++) {
      var lead = leads[j];
      try {
        // Check suppression list
        if (await isSuppressed(lead.email, lead.linkedin_url)) {
          await log(runId, "task-e-whatsapp", "info", "Lead suppressed: " + lead.full_name);
          skipped++;
          continue;
        }

        // WA-05: Generate WhatsApp body via Claude Sonnet
        var body = await generateWhatsAppBody(lead, templates);
        if (!body) {
          await log(runId, "task-e-whatsapp", "warn", "WhatsApp body generation returned null for " + lead.full_name);
          skipped++;
          continue;
        }

        // WA-01: Create unique template name
        var templateName = "leadgen_" + lead.id.substring(0, 8) + "_" + Date.now();

        // Create template via MessagingMe API
        var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme";
        await createWhatsAppTemplate(templateName, body, calendlyUrl);

        // Update lead metadata with template info
        var metadata = Object.assign({}, lead.metadata || {}, {
          template_name: templateName,
          template_created_at: new Date().toISOString(),
          template_status: "pending",
        });

        await supabase
          .from("leads")
          .update({
            whatsapp_template_created_at: new Date().toISOString(),
            metadata: metadata,
          })
          .eq("id", lead.id);

        var isCold = isColdLead(lead);
        await log(runId, "task-e-whatsapp", "info", "Template created for " + lead.full_name + ": " + templateName + (isCold ? " (cold)" : ""));
        created++;
      } catch (err) {
        await log(runId, "task-e-whatsapp", "error", "Failed for " + lead.full_name + ": " + err.message);
        skipped++;
      }
    }

    await log(runId, "task-e-whatsapp", "info",
      "Task E complete: " + created + " templates created, " + skipped + " skipped");
  } catch (err) {
    await log(runId, "task-e-whatsapp", "error", "Task E failed: " + err.message);
  }
};
