/**
 * Task E: WhatsApp J+14 template creation.
 * Runs daily at 10h30 Mon-Fri.
 * Selects leads at J+14 (7 days after email or 14 days after invitation),
 * generates personalized WhatsApp template body via Claude Sonnet,
 * and creates a unique Meta template per lead via MessagingMe API.
 */

const { supabase } = require("../lib/supabase");
const { createWhatsAppTemplate } = require("../lib/messagingme");
const { isSuppressed } = require("../lib/suppression");
const { generateWhatsAppBody } = require("../lib/message-generator");
const { log } = require("../lib/logger");

module.exports = async function taskEWhatsapp(runId) {
  await log(runId, "task-e-whatsapp", "info", "Task E started: WhatsApp J+14 template creation");

  try {
    // Calculate cutoff dates
    var now = new Date();
    var sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    var fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Query leads eligible for WhatsApp J+14
    // Two paths: email_sent leads at J+7 after email, or invitation_sent leads at J+14
    var { data: emailLeads, error: err1 } = await supabase
      .from("leads")
      .select("*")
      .eq("status", "email_sent")
      .lte("email_sent_at", sevenDaysAgo)
      .is("whatsapp_template_created_at", null)
      .not("phone", "is", null)
      .in("tier", ["hot", "warm"]);

    var { data: invitationLeads, error: err2 } = await supabase
      .from("leads")
      .select("*")
      .eq("status", "invitation_sent")
      .lte("invitation_sent_at", fourteenDaysAgo)
      .is("whatsapp_template_created_at", null)
      .not("phone", "is", null)
      .in("tier", ["hot", "warm"]);

    if (err1) {
      await log(runId, "task-e-whatsapp", "error", "Failed to query email leads: " + err1.message);
    }
    if (err2) {
      await log(runId, "task-e-whatsapp", "error", "Failed to query invitation leads: " + err2.message);
    }

    // Merge and deduplicate by lead ID
    var allLeads = [].concat(emailLeads || [], invitationLeads || []);
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
        var body = await generateWhatsAppBody(lead);
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

        await log(runId, "task-e-whatsapp", "info", "Template created for " + lead.full_name + ": " + templateName);
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
