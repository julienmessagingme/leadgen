/**
 * WhatsApp template approval polling.
 * Runs every 15 min (Mon-Fri 9h-18h).
 * Checks pending templates for approval/rejection/timeout,
 * sends WhatsApp on approval, alerts Julien on rejection or 24h timeout.
 */

const { supabase } = require("../lib/supabase");
const { listTemplates, syncTemplates, sendWhatsAppByUserId } = require("../lib/messagingme");
const { log } = require("../lib/logger");

module.exports = async function whatsappPoll(runId) {
  await log(runId, "whatsapp-poll", "info", "WhatsApp poll started: checking pending templates");

  try {
    // Query leads with pending templates
    var { data: leads, error } = await supabase
      .from("leads")
      .select("*")
      .not("whatsapp_template_created_at", "is", null)
      .filter("metadata->>template_status", "eq", "pending");

    if (error) {
      await log(runId, "whatsapp-poll", "error", "Failed to query pending leads: " + error.message);
      return;
    }

    if (!leads || leads.length === 0) {
      await log(runId, "whatsapp-poll", "info", "No pending templates to check");
      return;
    }

    await log(runId, "whatsapp-poll", "info", "Found " + leads.length + " pending templates to check");

    // WA-02: Sync templates with Meta to refresh statuses
    try {
      await syncTemplates();
      await log(runId, "whatsapp-poll", "info", "Templates synced with Meta");
    } catch (syncErr) {
      await log(runId, "whatsapp-poll", "warn", "Template sync failed, continuing with cached statuses: " + syncErr.message);
    }

    var sent = 0;
    var rejected = 0;
    var timedOut = 0;
    var stillPending = 0;

    for (var i = 0; i < leads.length; i++) {
      var lead = leads[i];
      var templateName = (lead.metadata || {}).template_name;

      if (!templateName) {
        await log(runId, "whatsapp-poll", "warn", "Lead " + lead.full_name + " has no template_name in metadata");
        continue;
      }

      try {
        // Check template status via MessagingMe API
        var templateResponse = await listTemplates(templateName);
        var templates = templateResponse.data || templateResponse.templates || templateResponse || [];
        if (!Array.isArray(templates)) {
          templates = [templates];
        }

        var template = null;
        for (var t = 0; t < templates.length; t++) {
          if (templates[t].name === templateName) {
            template = templates[t];
            break;
          }
        }

        var status = template ? (template.status || "").toUpperCase() : "UNKNOWN";

        if (status === "APPROVED") {
          // WA-03: Send WhatsApp message
          var namespace = template.namespace || process.env.MESSAGINGME_TEMPLATE_NAMESPACE || "default";
          await sendWhatsAppByUserId(lead.phone, namespace, templateName, "fr", {});

          // Update lead status
          var approvedMeta = Object.assign({}, lead.metadata || {}, {
            template_status: "approved",
          });

          await supabase
            .from("leads")
            .update({
              status: "whatsapp_sent",
              whatsapp_sent_at: new Date().toISOString(),
              metadata: approvedMeta,
            })
            .eq("id", lead.id);

          await log(runId, "whatsapp-poll", "info", "WhatsApp sent to " + lead.full_name + " via template " + templateName);
          sent++;

        } else if (status === "REJECTED") {
          // WA-04: Alert Julien about rejection
          await alertJulien(runId, "ALERTE: Template WhatsApp rejete pour " + lead.full_name + ". Raison possible: contenu non conforme Meta. Lead ID: " + lead.id);

          var rejectedMeta = Object.assign({}, lead.metadata || {}, {
            template_status: "rejected",
          });

          await supabase
            .from("leads")
            .update({ metadata: rejectedMeta })
            .eq("id", lead.id);

          await log(runId, "whatsapp-poll", "warn", "Template REJECTED for " + lead.full_name + ": " + templateName);
          rejected++;

        } else {
          // Still pending -- check for 24h timeout
          var createdAt = (lead.metadata || {}).template_created_at;
          var hoursSinceCreation = createdAt
            ? (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60)
            : 0;

          if (hoursSinceCreation > 24) {
            // WA-04: Timeout alert to Julien
            await alertJulien(runId, "ALERTE: Template WhatsApp en attente depuis 24h+ pour " + lead.full_name + ". Template: " + templateName + ". Lead ID: " + lead.id);

            var timeoutMeta = Object.assign({}, lead.metadata || {}, {
              template_status: "timeout",
            });

            await supabase
              .from("leads")
              .update({ metadata: timeoutMeta })
              .eq("id", lead.id);

            await log(runId, "whatsapp-poll", "warn", "Template TIMEOUT (24h+) for " + lead.full_name + ": " + templateName);
            timedOut++;
          } else {
            stillPending++;
          }
        }
      } catch (err) {
        await log(runId, "whatsapp-poll", "error", "Failed to process " + lead.full_name + ": " + err.message);
      }
    }

    await log(runId, "whatsapp-poll", "info",
      "Poll complete: " + sent + " sent, " + rejected + " rejected, " + timedOut + " timed out, " + stillPending + " still pending");
  } catch (err) {
    await log(runId, "whatsapp-poll", "error", "WhatsApp poll failed: " + err.message);
  }
};

/**
 * Send an alert to Julien via WhatsApp using a pre-approved utility template.
 * Falls back to logging if the template or phone is not configured.
 */
async function alertJulien(runId, message) {
  var phone = process.env.JULIEN_WHATSAPP_PHONE;
  if (!phone) {
    await log(runId, "whatsapp-poll", "warn", "JULIEN_WHATSAPP_PHONE not set, alert logged only: " + message);
    return;
  }

  try {
    var namespace = process.env.MESSAGINGME_TEMPLATE_NAMESPACE || "default";
    await sendWhatsAppByUserId(phone, namespace, "daily_leadgen_briefing", "fr", { body: [message] });
    await log(runId, "whatsapp-poll", "info", "Alert sent to Julien: " + message.substring(0, 80));
  } catch (err) {
    // Fallback: just log the alert if WhatsApp send fails
    await log(runId, "whatsapp-poll", "warn", "Failed to send WhatsApp alert to Julien, logged instead: " + message);
  }
}
