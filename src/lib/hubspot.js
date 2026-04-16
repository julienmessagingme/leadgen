/**
 * HubSpot CRM contact search for dedup.
 * Checks whether a contact already exists in HubSpot by name + company.
 * Fails open: returns { found: false } on any error so the pipeline is not blocked.
 */

const hubspot = require("@hubspot/api-client");
const pLimit = require("p-limit");

// Module-level concurrency limiter for all HubSpot SDK calls.
// HubSpot has a SECONDLY policy ~10 req/s; with concurrency=2 + sub-200ms
// calls we still saw sporadic bursts over the limit. Serialize to 1 to be
// safe — a Task A batch of 30 leads takes ~6s total, acceptable for a daily
// run. The throttle prevents silent fail-open (leads in CRM passed as "new").
const hubspotLimit = pLimit(1);

// Lazy-init client to avoid crash if HUBSPOT_TOKEN is not set at import time
let _client = null;

function getClient() {
  if (!_client) {
    const token = process.env.HUBSPOT_TOKEN;
    if (!token) {
      console.error("HUBSPOT_TOKEN is not set in environment -- HubSpot dedup disabled");
      return null;
    }
    _client = new hubspot.Client({ accessToken: token });
  }
  return _client;
}

/** In-memory cache for HubSpot owner names (they rarely change). */
var _ownerCache = {};

/**
 * Get a HubSpot owner's name by ID. Cached in memory.
 * @param {string} ownerId - HubSpot owner ID
 * @returns {Promise<string|null>} "FirstName LastName" or null
 */
async function getOwnerName(ownerId) {
  if (!ownerId) return null;
  if (_ownerCache[ownerId]) return _ownerCache[ownerId];

  try {
    const client = getClient();
    if (!client) return null;

    const owner = await hubspotLimit(() => client.crm.owners.ownersApi.getById(ownerId));
    var name = ((owner.firstName || "") + " " + (owner.lastName || "")).trim() || owner.email || null;
    if (name) _ownerCache[ownerId] = name;
    return name;
  } catch (err) {
    console.error("HubSpot getOwnerName failed for", ownerId, ":", err.message);
    return null;
  }
}

/**
 * Check if a contact exists in HubSpot by first name, last name, and optional company.
 * Returns marketing status and owner info if found.
 * Fails open: returns { found: false, contactId: null } on any error.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @param {string|null} companyName
 * @returns {Promise<{found: boolean, contactId: string|null, isMarketingContact: boolean|null, ownerName: string|null, ownerId: string|null}>}
 */
async function existsInHubspot(firstName, lastName, companyName) {
  if (!firstName || !lastName) return { found: false, contactId: null, isMarketingContact: null, ownerName: null, ownerId: null };

  try {
    const client = getClient();
    if (!client) return { found: false, contactId: null, isMarketingContact: null, ownerName: null, ownerId: null };

    const filters = [
      { propertyName: "firstname", operator: "EQ", value: firstName },
      { propertyName: "lastname", operator: "EQ", value: lastName },
    ];

    if (companyName) {
      filters.push({ propertyName: "company", operator: "EQ", value: companyName });
    }

    const response = await hubspotLimit(() => client.crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters }],
      properties: ["firstname", "lastname", "company", "hs_marketable_status", "hubspot_owner_id"],
      limit: 1,
    }));

    if (response.total > 0) {
      var props = response.results[0].properties || {};
      var ownerId = props.hubspot_owner_id || null;
      var ownerName = await getOwnerName(ownerId);
      var isMarketing = props.hs_marketable_status === "true" || props.hs_marketable_status === true;

      return {
        found: true,
        contactId: response.results[0].id,
        isMarketingContact: isMarketing,
        ownerName: ownerName,
        ownerId: ownerId,
      };
    }
    return { found: false, contactId: null, isMarketingContact: null, ownerName: null, ownerId: null };
  } catch (err) {
    console.error("HubSpot check failed:", err.message);
    return { found: false, contactId: null, isMarketingContact: null, ownerName: null, ownerId: null };
  }
}


/**
 * Check if a contact exists in HubSpot by email address.
 * Fails open: returns { found: false, contactId: null } on any error.
 *
 * @param {string} email - Email address to search
 * @returns {Promise<{found: boolean, contactId: string|null}>}
 */
async function existsInHubspotByEmail(email) {
  if (!email) return { found: false, contactId: null };

  try {
    const client = getClient();
    if (!client) return { found: false, contactId: null };

    const response = await hubspotLimit(() => client.crm.contacts.searchApi.doSearch({
      filterGroups: [{
        filters: [
          { propertyName: "email", operator: "EQ", value: email },
        ],
      }],
      properties: ["email", "firstname", "lastname"],
      limit: 1,
    }));

    if (response.total > 0) {
      return { found: true, contactId: response.results[0].id };
    }
    return { found: false, contactId: null };
  } catch (err) {
    console.error("HubSpot email check failed:", err.message);
    return { found: false, contactId: null };
  }
}

/**
 * Find a contact's email in HubSpot by first name, last name, and optional company.
 * Used to avoid calling Fullenrich when we already have the email in HubSpot.
 * Fails open: returns null on any error.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @param {string|null} companyName
 * @returns {Promise<string|null>} Email address or null
 */
async function findEmailInHubspot(firstName, lastName, companyName) {
  if (!firstName || !lastName) return null;

  try {
    const client = getClient();
    if (!client) return null;

    const filters = [
      { propertyName: "firstname", operator: "EQ", value: firstName },
      { propertyName: "lastname", operator: "EQ", value: lastName },
    ];

    if (companyName) {
      filters.push({ propertyName: "company", operator: "EQ", value: companyName });
    }

    const response = await hubspotLimit(() => client.crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters }],
      properties: ["email", "firstname", "lastname", "company"],
      limit: 1,
    }));

    if (response.total > 0 && response.results[0].properties.email) {
      return response.results[0].properties.email;
    }
    return null;
  } catch (err) {
    console.error("HubSpot findEmail failed:", err.message);
    return null;
  }
}

/**
 * Get the last email (sent or received) for a HubSpot contact.
 * Uses the email search API with association filter.
 * Returns { subject, body, direction, date, from, to } or null.
 * @param {string} contactId - HubSpot contact ID
 * @returns {Promise<object|null>}
 */
async function getLastEmail(contactId) {
  if (!contactId) return null;

  try {
    const client = getClient();
    if (!client) return null;

    var response = await hubspotLimit(() => client.crm.objects.emails.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: "associations.contact",
          operator: "EQ",
          value: contactId,
        }],
      }],
      properties: [
        "hs_email_subject", "hs_email_text",
        "hs_email_direction", "hs_timestamp",
        "hs_email_from_email", "hs_email_to_email",
      ],
      sorts: [{ propertyName: "hs_timestamp", direction: "DESCENDING" }],
      limit: 1,
    }));

    if (!response.results || response.results.length === 0) return null;

    var p = response.results[0].properties;
    return {
      subject: p.hs_email_subject || null,
      body: (p.hs_email_text || "").substring(0, 500),
      direction: p.hs_email_direction || null,
      date: p.hs_timestamp || null,
      from: p.hs_email_from_email || null,
      to: p.hs_email_to_email || null,
    };
  } catch (err) {
    console.error("HubSpot getLastEmail failed for contact", contactId, ":", err.message);
    return null;
  }
}

/**
 * Find a contact's phone number in HubSpot. Tries by email first (most
 * reliable), falls back to firstname+lastname (+ optional company) if we
 * don't have an email. Used before hitting FullEnrich (10 credits) to see
 * if we already have the phone in CRM for free.
 *
 * Returns { phone, source } where source is "mobile" | "phone" | null, or
 * null if nothing found. Prefers mobilephone over plain phone (more likely
 * to have WhatsApp).
 *
 * @param {object} args - { email?, firstName?, lastName?, companyName? }
 * @returns {Promise<{phone: string, source: string, contactId: string}|null>}
 */
async function findPhoneInHubspot(args) {
  const { email, firstName, lastName, companyName } = args || {};
  try {
    const client = getClient();
    if (!client) return null;

    const props = ["phone", "mobilephone", "hs_calculated_phone_number", "email", "firstname", "lastname"];
    let response;

    if (email) {
      response = await hubspotLimit(() => client.crm.contacts.searchApi.doSearch({
        filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
        properties: props,
        limit: 1,
      }));
    } else if (firstName && lastName) {
      const filters = [
        { propertyName: "firstname", operator: "EQ", value: firstName },
        { propertyName: "lastname", operator: "EQ", value: lastName },
      ];
      if (companyName) filters.push({ propertyName: "company", operator: "EQ", value: companyName });
      response = await hubspotLimit(() => client.crm.contacts.searchApi.doSearch({
        filterGroups: [{ filters }],
        properties: props,
        limit: 1,
      }));
    } else {
      return null;
    }

    if (!response || response.total === 0) return null;
    const contact = response.results[0];
    const p = contact.properties || {};
    // Prefer mobilephone (more likely WhatsApp-enabled) over plain phone.
    if (p.mobilephone && String(p.mobilephone).trim()) {
      return { phone: String(p.mobilephone).trim(), source: "mobile", contactId: contact.id };
    }
    if (p.phone && String(p.phone).trim()) {
      return { phone: String(p.phone).trim(), source: "phone", contactId: contact.id };
    }
    if (p.hs_calculated_phone_number && String(p.hs_calculated_phone_number).trim()) {
      return { phone: String(p.hs_calculated_phone_number).trim(), source: "calculated", contactId: contact.id };
    }
    return null;
  } catch (err) {
    console.warn("findPhoneInHubspot failed:", err.message);
    return null;
  }
}

/**
 * Push a phone number onto an existing HubSpot contact. Used after FullEnrich
 * found a number (10 credits spent) to avoid re-paying the next time the same
 * lead surfaces.
 *
 * Updates `mobilephone` by default (WhatsApp is typically on mobile) and does
 * NOT overwrite `phone` if the contact already has one (we assume the CRM's
 * existing phone is the pro/landline Julien has curated).
 *
 * Fails open: returns false on any error, never throws.
 *
 * @param {string} contactId - HubSpot contact ID
 * @param {string} phone     - E.164 phone (e.g. "+33680154151")
 * @param {object} [opts]    - { field?: "mobilephone"|"phone", overwrite?: bool }
 * @returns {Promise<boolean>} true if updated, false otherwise
 */
async function setPhoneInHubspot(contactId, phone, opts) {
  const field = (opts && opts.field) || "mobilephone";
  const overwrite = opts && opts.overwrite === true;

  if (!contactId || !phone) return false;
  try {
    const client = getClient();
    if (!client) return false;

    if (!overwrite) {
      // Don't clobber an existing value. Read first.
      const existing = await hubspotLimit(() =>
        client.crm.contacts.basicApi.getById(contactId, [field])
      );
      if (existing && existing.properties && existing.properties[field]) {
        return false; // already set, skip
      }
    }

    await hubspotLimit(() =>
      client.crm.contacts.basicApi.update(contactId, {
        properties: { [field]: phone },
      })
    );
    return true;
  } catch (err) {
    console.warn("setPhoneInHubspot failed:", err.message);
    return false;
  }
}

/**
 * Create a new HubSpot contact. Used right after FullEnrich finds a phone
 * for a lead that wasn't in CRM yet — Julien doesn't want to lose costly
 * data points and prefers creating the contact while we're at it.
 *
 * Only fills what we actually have. HubSpot requires `email` to identify the
 * contact. On 409 CONFLICT (email already taken — race with another create),
 * we return the existing contact id instead of failing.
 *
 * @param {object} input - { email (required), firstname?, lastname?, phone?,
 *                          mobilephone?, company?, jobtitle?, website?,
 *                          linkedinbio?, source? }
 * @returns {Promise<{contactId: string, created: boolean}|null>}
 */
async function createContactInHubspot(input) {
  if (!input || !input.email) return null;
  try {
    const client = getClient();
    if (!client) return null;

    // Whitelist properties we support. Skip empty/null values so we don't
    // wipe defaults or send "undefined" strings.
    const allowed = ["email", "firstname", "lastname", "phone", "mobilephone",
      "company", "jobtitle", "website", "lifecyclestage", "hs_lead_status"];
    const properties = {};
    for (const k of allowed) {
      const v = input[k];
      if (v !== undefined && v !== null && v !== "") {
        properties[k] = String(v).slice(0, 500); // HubSpot max for most fields
      }
    }
    // Default lifecycle / lead status so the contact isn't a dangling ghost
    if (!properties.lifecyclestage) properties.lifecyclestage = "lead";

    const resp = await hubspotLimit(() =>
      client.crm.contacts.basicApi.create({ properties })
    );
    return { contactId: resp.id, created: true };
  } catch (err) {
    // HubSpot returns 409 when the email is already used — resolve to the
    // existing id so the caller can still associate the lead with it.
    const code = err && err.code;
    const message = (err && err.message) || "";
    if (code === 409 || /already exists/i.test(message)) {
      try {
        const existing = await existsInHubspotByEmail(input.email);
        if (existing.found && existing.contactId) {
          return { contactId: existing.contactId, created: false };
        }
      } catch (_e) { /* fall through */ }
    }
    console.warn("createContactInHubspot failed:", message);
    return null;
  }
}

module.exports = {
  existsInHubspot,
  existsInHubspotByEmail,
  findEmailInHubspot,
  findPhoneInHubspot,
  setPhoneInHubspot,
  createContactInHubspot,
  getLastEmail,
};
