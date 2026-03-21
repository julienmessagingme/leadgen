/**
 * Task F: InMail briefing email to Julien.
 * Runs daily at 08h30 Mon-Fri.
 * Selects top 3 leads with ICP score >= 80, generates InMail drafts
 * via Claude Sonnet, formats a briefing, and sends to Julien via Gmail SMTP.
 */

const { supabase } = require("../lib/supabase");
const { sendEmail } = require("../lib/gmail");
const { generateInMail } = require("../lib/message-generator");
const { log } = require("../lib/logger");

module.exports = async function taskFBriefing(runId) {
  await log(runId, "task-f-briefing", "info", "Task F started: InMail briefing for Julien");

  try {
    // Check GMAIL_USER is configured for self-send
    var gmailUser = process.env.GMAIL_USER;
    if (!gmailUser) {
      await log(runId, "task-f-briefing", "error", "GMAIL_USER not set, cannot send briefing");
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

    // INMAIL-03: Send briefing to Julien via email (self-send)
    try {
      var htmlBody = "<pre style=\"font-family: monospace; white-space: pre-wrap;\">" + briefingText.replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</pre>";
      var subject = "Briefing InMail du " + new Date().toLocaleDateString("fr-FR", { timeZone: "Europe/Paris" }) + " (" + briefingEntries.length + " leads)";
      await sendEmail(gmailUser, subject, htmlBody, briefingText);
      await log(runId, "task-f-briefing", "info", "Briefing sent to Julien via email (" + briefingEntries.length + " leads)");
    } catch (sendErr) {
      // Fallback: log the full briefing to Supabase so Julien can still access it
      await log(runId, "task-f-briefing", "warn",
        "Email send failed (" + sendErr.message + "), logging briefing as fallback");
      await log(runId, "task-f-briefing", "info", "BRIEFING FALLBACK:\n" + briefingText);
    }

    await log(runId, "task-f-briefing", "info", "Task F complete: " + briefingEntries.length + " InMail drafts in briefing");
  } catch (err) {
    await log(runId, "task-f-briefing", "error", "Task F failed: " + err.message);
  }
};
