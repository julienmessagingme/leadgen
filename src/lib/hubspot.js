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
  if (!email) return { found: false, contactId: null, props: {} };

  try {
    const client = getClient();
    if (!client) return { found: false, contactId: null, props: {} };

    // Same reasoning as findPhoneInHubspot: retry on 429 so a burst doesn't
    // push us into wrong decisions (e.g. "contact doesn't exist, create it"
    // when it actually does).
    // Props returned are enough to drive the merge logic in
    // logEmailToHubspot (no extra getById call needed).
    const response = await withHubspotRetry(() => client.crm.contacts.searchApi.doSearch({
      filterGroups: [{
        filters: [
          { propertyName: "email", operator: "EQ", value: email },
        ],
      }],
      properties: ["email", "firstname", "lastname", "company", "jobtitle", "hubspot_owner_id"],
      limit: 1,
    }));

    if (response.total > 0) {
      return {
        found: true,
        contactId: response.results[0].id,
        props: response.results[0].properties || {},
      };
    }
    return { found: false, contactId: null, props: {} };
  } catch (err) {
    console.error("HubSpot email check failed (after retries):", err.message);
    return { found: false, contactId: null, props: {} };
  }
}

/**
 * Log an outbound email to HubSpot as a CRM "emails" engagement associated
 * with the recipient contact. If the contact does not exist, it is created
 * with the lead's info (firstname, lastname, company, jobtitle, owner=Julien).
 * If it exists, missing props are enriched (company, jobtitle, owner — but
 * NEVER overwrites an existing owner per Julien's rule).
 *
 * Non-blocking from the caller's point of view : wrap in try/catch at the
 * call site and discard the promise. Failure here must not block the send.
 *
 * @param {object} lead - full lead row (needs email, first_name/last_name/full_name, company_name, headline)
 * @param {object} opts - { subject, body }
 * @returns {Promise<{contactId, emailId, createdContact}|null>}
 */
async function logEmailToHubspot(lead, opts) {
  if (!lead || !lead.email) {
    console.warn("[hubspot-log] skipped — no email on lead", lead && lead.id);
    return null;
  }
  var subject = (opts && opts.subject) || "";
  var body = (opts && opts.body) || "";

  try {
    var client = getClient();
    if (!client) return null;

    var ownerId = process.env.HUBSPOT_DEFAULT_OWNER_ID || null;
    var fromEmail = process.env.GMAIL_USER || "";

    // Derive firstname/lastname from full_name if first_name/last_name missing
    var firstName = lead.first_name || "";
    var lastName = lead.last_name || "";
    if ((!firstName || !lastName) && lead.full_name) {
      var parts = String(lead.full_name).trim().split(/\s+/);
      if (!firstName) firstName = parts[0] || "";
      if (!lastName) lastName = parts.slice(1).join(" ") || "";
    }

    // ── Step 1: search by email (enhanced — also returns props)
    var search = await existsInHubspotByEmail(lead.email);
    var contactId = search.contactId;
    var createdContact = false;

    // ── Step 2A: contact NOT found → create
    //   NOTE: notes_last_contacted is a READ-ONLY property in HubSpot — it's
    //   auto-managed and updated whenever we log an engagement (email/call/
    //   meeting). Trying to set it returns READ_ONLY_VALUE 400. We rely on
    //   HubSpot's auto-update when we create the email engagement at step 3.
    if (!search.found) {
      var createProps = { email: lead.email };
      if (firstName) createProps.firstname = firstName;
      if (lastName) createProps.lastname = lastName;
      if (lead.company_name) createProps.company = lead.company_name;
      if (lead.headline) createProps.jobtitle = lead.headline;
      if (ownerId) createProps.hubspot_owner_id = ownerId;

      var created = await withHubspotRetry(() => client.crm.contacts.basicApi.create({
        properties: createProps,
      }));
      contactId = created.id;
      createdContact = true;
    } else {
      // ── Step 2B: contact exists → enrich missing props only.
      //   (last-contact date is auto-bumped by HubSpot when engagement is logged)
      var currentProps = search.props || {};
      var toUpdate = {};

      // Owner: set Julien ONLY if no owner at all. Never overwrite.
      if (!currentProps.hubspot_owner_id && ownerId) {
        toUpdate.hubspot_owner_id = ownerId;
      }
      if (!currentProps.company && lead.company_name) {
        toUpdate.company = lead.company_name;
      }
      if (!currentProps.jobtitle && lead.headline) {
        toUpdate.jobtitle = lead.headline;
      }

      if (Object.keys(toUpdate).length > 0) {
        try {
          await withHubspotRetry(() => client.crm.contacts.basicApi.update(contactId, {
            properties: toUpdate,
          }));
        } catch (updErr) {
          console.warn("[hubspot-log] contact update failed:", updErr.message);
          // Continue — we still want to log the email engagement.
        }
      }
    }

    if (!contactId) {
      console.warn("[hubspot-log] no contactId after create/search — aborting");
      return null;
    }

    // ── Step 3: create the email engagement
    //   HubSpot requires from/to to go through hs_email_headers (JSON string),
    //   NOT as individual hs_email_from_email / hs_email_to_email props
    //   (which are derived from hs_email_headers and rejected as "invalid"
    //   if set directly).
    var headerFromName = "Julien Dumas";
    var headerToFirstName = firstName || "";
    var headerToLastName = lastName || "";
    var hsHeaders = {
      from: {
        email: fromEmail || "",
        firstName: "Julien",
        lastName: "Dumas",
      },
      to: [{
        email: lead.email,
        firstName: headerToFirstName,
        lastName: headerToLastName,
      }],
    };

    var emailProps = {
      hs_timestamp: Date.now().toString(),
      hs_email_subject: subject,
      hs_email_html: body,
      hs_email_status: "SENT",
      hs_email_direction: "EMAIL", // outbound sent from us
      hs_email_headers: JSON.stringify(hsHeaders),
    };
    if (ownerId) emailProps.hubspot_owner_id = ownerId;

    var emailObj = await withHubspotRetry(() => client.crm.objects.emails.basicApi.create({
      properties: emailProps,
    }));

    // ── Step 4: associate email ↔ contact (HubSpot-defined: email→contact = 198)
    try {
      await withHubspotRetry(() => client.crm.associations.v4.basicApi.create(
        "emails", emailObj.id,
        "contacts", contactId,
        [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 198 }]
      ));
    } catch (assocErr) {
      console.warn("[hubspot-log] association email→contact failed:", assocErr.message);
      // Engagement exists but floats — Julien can still see it in HubSpot activity.
    }

    return {
      contactId: contactId,
      emailId: emailObj.id,
      createdContact: createdContact,
    };
  } catch (err) {
    console.warn("[hubspot-log] failed for lead " + lead.id + ":", err.message);
    return null;
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
 * Retry a HubSpot call through the concurrency limiter, with exponential
 * backoff on 429 (secondly rate-limit). The secondly policy typically
 * clears within 1-2 seconds, so 3 tries spaced 1s/2s/4s is enough to ride
 * through a burst without paying downstream (e.g. FullEnrich 10 credits).
 *
 * Non-429 errors bubble up immediately — no point retrying a 403 or 500.
 */
async function withHubspotRetry(fn, attempts = 3) {
  let lastErr = null;
  for (let i = 0; i < attempts; i++) {
    try {
      return await hubspotLimit(fn);
    } catch (err) {
      const code = err && (err.code || (err.response && err.response.status));
      const isRateLimited = code === 429 || /ratelimit|rate limit|too many/i.test((err && err.message) || "");
      if (!isRateLimited || i === attempts - 1) throw err;
      const delayMs = 1000 * Math.pow(2, i); // 1s, 2s, 4s
      await new Promise((r) => setTimeout(r, delayMs));
      lastErr = err;
    }
  }
  throw lastErr || new Error("withHubspotRetry: exhausted");
}

/**
 * Find a contact's phone number in HubSpot. Tries by email first (most
 * reliable), falls back to firstname+lastname (+ optional company) if we
 * don't have an email. Used before hitting FullEnrich (10 credits) to see
 * if we already have the phone in CRM for free.
 *
 * Retries on HubSpot 429 up to 3 times (spaced 1/2/4 s) — without this,
 * a secondly rate-limit burst drops us straight to FullEnrich for a
 * contact we already own in CRM, paying 10 credits for nothing.
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
      response = await withHubspotRetry(() => client.crm.contacts.searchApi.doSearch({
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
      response = await withHubspotRetry(() => client.crm.contacts.searchApi.doSearch({
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
    console.warn("findPhoneInHubspot failed (after retries):", err.message);
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
      "company", "jobtitle", "website", "lifecyclestage", "hs_lead_status",
      "hubspot_owner_id"];
    const properties = {};
    for (const k of allowed) {
      const v = input[k];
      if (v !== undefined && v !== null && v !== "") {
        properties[k] = String(v).slice(0, 500); // HubSpot max for most fields
      }
    }
    // Default lifecycle / lead status so the contact isn't a dangling ghost
    if (!properties.lifecyclestage) properties.lifecyclestage = "lead";
    // Default owner — contacts created by our automation should be assigned
    // to Julien by default so they land in his HubSpot views. Overridable
    // via input.hubspot_owner_id if a caller needs a different owner.
    if (!properties.hubspot_owner_id && process.env.HUBSPOT_DEFAULT_OWNER_ID) {
      properties.hubspot_owner_id = process.env.HUBSPOT_DEFAULT_OWNER_ID;
    }

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
  logEmailToHubspot,
};
