/**
 * Task F: InMail briefing WhatsApp to Julien.
 * Runs daily at 08h30 Mon-Fri.
 * Selects top 3 leads with ICP score >= 80, generates InMail drafts
 * via Claude Sonnet, formats a briefing, and sends to Julien's WhatsApp.
 */

const { supabase } = require("../lib/supabase");
const { sendWhatsAppByUserId } = require("../lib/messagingme");
const { generateInMail } = require("../lib/message-generator");
const { log } = require("../lib/logger");

module.exports = async function taskFBriefing(runId) {
  await log(runId, "task-f-briefing", "info", "Task F started: InMail briefing for Julien");

  try {
    // Check JULIEN_WHATSAPP_PHONE is configured
    var julienPhone = process.env.JULIEN_WHATSAPP_PHONE;
    if (!julienPhone) {
      await log(runId, "task-f-briefing", "error", "JULIEN_WHATSAPP_PHONE not set, cannot send briefing");
      return;
    }

    // INMAIL-01: Select top 3 leads with score >= 80
    var { data: leads, error } = await supabase
      .from("leads")
      .select("*")
      .gte("icp_score", 80)
      .in("status", ["prospected", "invitation_sent", "new", "enriched", "scored"])
      .order("icp_score", { ascending: false })
      .limit(3);

    if (error) {
      await log(runId, "task-f-briefing", "error", "Failed to query leads: " + error.message);
      return;
    }

    if (!leads || leads.length === 0) {
      await log(runId, "task-f-briefing", "info", "No hot leads for briefing (none with score >= 80)");
      return;
    }

    await log(runId, "task-f-briefing", "info", "Found " + leads.length + " leads for InMail briefing");

    // INMAIL-02: Generate InMail for each lead
    var briefingEntries = [];
    for (var i = 0; i < leads.length; i++) {
      var lead = leads[i];
      try {
        var inmail = await generateInMail(lead);
        if (!inmail) {
          await log(runId, "task-f-briefing", "warn", "InMail generation returned null for " + lead.full_name);
          continue;
        }

        briefingEntries.push({
          lead: lead,
          inmail: inmail,
        });
      } catch (err) {
        await log(runId, "task-f-briefing", "error", "InMail generation failed for " + lead.full_name + ": " + err.message);
      }
    }

    // Edge case: all generations failed
    if (briefingEntries.length === 0) {
      await log(runId, "task-f-briefing", "warn", "All InMail generations failed, skipping WhatsApp send");
      return;
    }

    // Format briefing text
    var today = new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" });
    var briefingText = "BRIEFING INMAIL DU " + today + "\n";

    for (var j = 0; j < briefingEntries.length; j++) {
      var entry = briefingEntries[j];
      var l = entry.lead;
      var im = entry.inmail;

      briefingText += "\n" + (j + 1) + ". " + (l.full_name || "inconnu") + " - " + (l.headline || "N/A") + "\n";
      briefingText += "   Entreprise: " + (l.company_name || "inconnue") + "\n";
      briefingText += "   Score: " + (l.icp_score || "N/A") + " | Signal: " + (l.signal_source || l.signal_type || "inconnu") + "\n";
      briefingText += "\n";
      briefingText += "   Objet: " + im.subject + "\n";
      briefingText += "   ---\n";
      briefingText += "   " + im.body.replace(/\n/g, "\n   ") + "\n";
      briefingText += "   ---\n";
      briefingText += "   Profil: " + (l.linkedin_url || "N/A") + "\n";
    }

    // INMAIL-03: Send briefing to Julien via WhatsApp
    try {
      var namespace = process.env.MESSAGINGME_TEMPLATE_NAMESPACE || "default";
      await sendWhatsAppByUserId(julienPhone, namespace, "daily_leadgen_briefing", "fr", { body: [briefingText] });
      await log(runId, "task-f-briefing", "info", "Briefing sent to Julien via WhatsApp (" + briefingEntries.length + " leads)");
    } catch (sendErr) {
      // Fallback: log the full briefing to Supabase so Julien can still access it
      await log(runId, "task-f-briefing", "warn",
        "WhatsApp send failed (" + sendErr.message + "), logging briefing as fallback");
      await log(runId, "task-f-briefing", "info", "BRIEFING FALLBACK:\n" + briefingText);
    }

    await log(runId, "task-f-briefing", "info", "Task F complete: " + briefingEntries.length + " InMail drafts in briefing");
  } catch (err) {
    await log(runId, "task-f-briefing", "error", "Task F failed: " + err.message);
  }
};
