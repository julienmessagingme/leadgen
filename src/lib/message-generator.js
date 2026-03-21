/**
 * Claude Sonnet message generator for all outreach channels.
 * Uses anthropic.beta.messages.create with structured JSON output.
 * Returns null on error to let calling tasks decide fallback behavior.
 */

const { anthropic } = require("./anthropic");

const MODEL = "claude-sonnet-4-6-20250514";

/**
 * Generate a personalized LinkedIn invitation note.
 * @param {object} lead - Lead data
 * @returns {Promise<string|null>} Invitation note (max 280 chars) or null on error
 */
async function generateInvitationNote(lead) {
  try {
    var response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 256,
      messages: [{
        role: "user",
        content: "Tu es Julien Poupard, DG de MessagingMe. Redige une invitation LinkedIn personnalisee pour ce prospect.\n\n" +
          "Prospect: " + (lead.full_name || "inconnu") + "\n" +
          "Titre: " + (lead.headline || "inconnu") + "\n" +
          "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
          "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n\n" +
          "Regles:\n" +
          "- Reference au signal detecte\n" +
          "- Ton professionnel mais humain\n" +
          "- Max 280 caracteres STRICT\n" +
          "- Pas d'emojis, pas de pitch commercial\n" +
          "- Pas de guillemets autour du texte",
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              note: { type: "string" },
            },
            required: ["note"],
            additionalProperties: false,
          },
        },
      },
    });

    var result = JSON.parse(response.content[0].text);
    var note = result.note || "";

    // Hard limit: 280 chars
    if (note.length > 280) {
      note = note.substring(0, 277) + "...";
    }

    return note;
  } catch (err) {
    console.warn("generateInvitationNote failed:", err.message);
    return null;
  }
}

/**
 * Generate a LinkedIn follow-up message post-connection.
 * @param {object} lead - Lead data
 * @returns {Promise<string|null>} Follow-up message or null on error
 */
async function generateFollowUpMessage(lead) {
  try {
    var response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: "user",
        content: "Tu es Julien Poupard, DG de MessagingMe (plateforme de messaging WhatsApp/RCS pour entreprises). Redige un message de suivi LinkedIn post-connexion.\n\n" +
          "Prospect: " + (lead.full_name || "inconnu") + "\n" +
          "Titre: " + (lead.headline || "inconnu") + "\n" +
          "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
          "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n\n" +
          "Regles:\n" +
          "- Remercier pour la connexion\n" +
          "- Proposer un echange sur le sujet du signal\n" +
          "- Mentionner MessagingMe brievement\n" +
          "- 3 a 5 phrases max\n" +
          "- Ton naturel et direct",
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              message: { type: "string" },
            },
            required: ["message"],
            additionalProperties: false,
          },
        },
      },
    });

    var result = JSON.parse(response.content[0].text);
    return result.message || null;
  } catch (err) {
    console.warn("generateFollowUpMessage failed:", err.message);
    return null;
  }
}

/**
 * Generate an email (subject + HTML body) for J+7 follow-up.
 * @param {object} lead - Lead data
 * @returns {Promise<{subject: string, body: string}|null>} Email object or null on error
 */
async function generateEmail(lead) {
  try {
    var calendlyUrl = process.env.CALENDLY_URL || "https://calendly.com/julien-messagingme";

    var response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: "Tu es Julien Poupard, DG de MessagingMe. Redige un email de relance J+7 apres connexion LinkedIn.\n\n" +
          "Prospect: " + (lead.full_name || "inconnu") + "\n" +
          "Titre: " + (lead.headline || "inconnu") + "\n" +
          "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
          "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n" +
          "Email: " + (lead.email || "") + "\n\n" +
          "Regles:\n" +
          "- Objet accrocheur et court\n" +
          "- Corps en HTML simple (pas de CSS inline complexe)\n" +
          "- Reference a la connexion LinkedIn\n" +
          "- Proposition de valeur MessagingMe pour leur secteur\n" +
          "- CTA: lien Calendly " + calendlyUrl + "\n" +
          "- Signature: Julien Poupard, DG MessagingMe\n" +
          "- Ton professionnel mais personnel",
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              subject: { type: "string" },
              body: { type: "string" },
            },
            required: ["subject", "body"],
            additionalProperties: false,
          },
        },
      },
    });

    var result = JSON.parse(response.content[0].text);
    if (!result.subject || !result.body) return null;
    return { subject: result.subject, body: result.body };
  } catch (err) {
    console.warn("generateEmail failed:", err.message);
    return null;
  }
}

/**
 * Generate a WhatsApp message body.
 * @param {object} lead - Lead data
 * @returns {Promise<string|null>} WhatsApp body text or null on error
 */
async function generateWhatsAppBody(lead) {
  try {
    var response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 512,
      messages: [{
        role: "user",
        content: "Tu es Julien Poupard, DG de MessagingMe. Redige un message WhatsApp pour ce prospect.\n\n" +
          "Prospect: " + (lead.full_name || "inconnu") + "\n" +
          "Titre: " + (lead.headline || "inconnu") + "\n" +
          "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
          "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n\n" +
          "Regles:\n" +
          "- 3 a 4 lignes max\n" +
          "- Reference au signal et a l'echange LinkedIn\n" +
          "- Proposition de RDV via Calendly\n" +
          "- Ton direct et personnel\n" +
          "- Pas d'emojis excessifs",
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              body: { type: "string" },
            },
            required: ["body"],
            additionalProperties: false,
          },
        },
      },
    });

    var result = JSON.parse(response.content[0].text);
    return result.body || null;
  } catch (err) {
    console.warn("generateWhatsAppBody failed:", err.message);
    return null;
  }
}

/**
 * Generate a LinkedIn InMail (subject + body).
 * @param {object} lead - Lead data
 * @returns {Promise<{subject: string, body: string}|null>} InMail object or null on error
 */
async function generateInMail(lead) {
  try {
    var response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: "Tu es Julien Poupard, DG de MessagingMe (plateforme de messaging WhatsApp/RCS pour entreprises). Redige un InMail LinkedIn.\n\n" +
          "Prospect: " + (lead.full_name || "inconnu") + "\n" +
          "Titre: " + (lead.headline || "inconnu") + "\n" +
          "Entreprise: " + (lead.company_name || "inconnue") + "\n" +
          "Secteur: " + (lead.company_sector || "inconnu") + "\n" +
          "Signal detecte: " + (lead.signal_type || "inconnu") + " - " + (lead.signal_detail || "") + "\n\n" +
          "Regles:\n" +
          "- Objet percutant et court\n" +
          "- Corps: reference au signal, valeur MessagingMe pour leur secteur, CTA clair\n" +
          "- Ton professionnel\n" +
          "- 5 a 8 phrases max",
      }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              subject: { type: "string" },
              body: { type: "string" },
            },
            required: ["subject", "body"],
            additionalProperties: false,
          },
        },
      },
    });

    var result = JSON.parse(response.content[0].text);
    if (!result.subject || !result.body) return null;
    return { subject: result.subject, body: result.body };
  } catch (err) {
    console.warn("generateInMail failed:", err.message);
    return null;
  }
}

module.exports = {
  generateInvitationNote,
  generateFollowUpMessage,
  generateEmail,
  generateWhatsAppBody,
  generateInMail,
};
