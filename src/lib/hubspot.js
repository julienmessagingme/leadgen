/**
 * HubSpot CRM contact search for dedup.
 * Checks whether a contact already exists in HubSpot by name + company.
 * Fails open: returns false on any error so the pipeline is not blocked.
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

/**
 * Check if a contact exists in HubSpot by first name, last name, and optional company.
 * Fails open: returns false on any error.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @param {string|null} companyName
 * @returns {Promise<boolean>} true if contact found in HubSpot
 */
async function existsInHubspot(firstName, lastName, companyName) {
  // Cannot search without a name
  if (!firstName || !lastName) return false;

  try {
    const client = getClient();
    if (!client) return false;

    const filters = [
      { propertyName: "firstname", operator: "EQ", value: firstName },
      { propertyName: "lastname", operator: "EQ", value: lastName },
    ];

    if (companyName) {
      filters.push({ propertyName: "company", operator: "EQ", value: companyName });
    }

    const response = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [{ filters }],
      properties: ["firstname", "lastname", "company"],
      limit: 1,
    });

    return response.total > 0;
  } catch (err) {
    // Fail open: if HubSpot is down or token invalid, do not block the pipeline
    console.error("HubSpot check failed:", err.message);
    return false;
  }
}


/**
 * Check if a contact exists in HubSpot by email address.
 * Fails open: returns false on any error.
 *
 * @param {string} email - Email address to search
 * @returns {Promise<boolean>} true if contact found in HubSpot
 */
async function existsInHubspotByEmail(email) {
  if (!email) return false;

  try {
    const client = getClient();
    if (!client) return false;

    const response = await client.crm.contacts.searchApi.doSearch({
      filterGroups: [{
        filters: [
          { propertyName: "email", operator: "EQ", value: email },
        ],
      }],
      properties: ["email", "firstname", "lastname"],
      limit: 1,
    });

    return response.total > 0;
  } catch (err) {
    console.error("HubSpot email check failed:", err.message);
    return false;
  }
}

module.exports = { existsInHubspot, existsInHubspotByEmail };
