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

/**
 * Check if a contact exists in HubSpot by first name, last name, and optional company.
 * Fails open: returns { found: false, contactId: null } on any error.
 *
 * @param {string} firstName
 * @param {string} lastName
 * @param {string|null} companyName
 * @returns {Promise<{found: boolean, contactId: string|null}>}
 */
async function existsInHubspot(firstName, lastName, companyName) {
  if (!firstName || !lastName) return { found: false, contactId: null };

  try {
    const client = getClient();
    if (!client) return { found: false, contactId: null };

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

    if (response.total > 0) {
      return { found: true, contactId: response.results[0].id };
    }
    return { found: false, contactId: null };
  } catch (err) {
    console.error("HubSpot check failed:", err.message);
    return { found: false, contactId: null };
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

module.exports = { existsInHubspot, existsInHubspotByEmail };
