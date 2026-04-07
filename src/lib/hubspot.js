/**
 * HubSpot CRM contact search for dedup.
 * Checks whether a contact already exists in HubSpot by name + company.
 * Fails open: returns { found: false } on any error so the pipeline is not blocked.
 */

const hubspot = require("@hubspot/api-client");

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

    const owner = await client.crm.owners.ownersApi.getById(ownerId);
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

    const response = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters }],
      properties: ["firstname", "lastname", "company", "hs_marketable_status", "hubspot_owner_id"],
      limit: 1,
    });

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

    const response = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [{
        filters: [
          { propertyName: "email", operator: "EQ", value: email },
        ],
      }],
      properties: ["email", "firstname", "lastname"],
      limit: 1,
    });

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

    const response = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters }],
      properties: ["email", "firstname", "lastname", "company"],
      limit: 1,
    });

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

    var response = await client.crm.objects.emails.searchApi.doSearch({
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
    });

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

module.exports = { existsInHubspot, existsInHubspotByEmail, findEmailInHubspot, getLastEmail };
