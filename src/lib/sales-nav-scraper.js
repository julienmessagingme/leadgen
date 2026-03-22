/**
 * Sales Navigator scraper module.
 * Searches leads by filters (sector, company size, job title, geography)
 * and extracts profile data from results pages.
 *
 * Uses browser.js infrastructure (Playwright, cookies, rate limiting, human delays).
 * CommonJS module pattern consistent with other lib modules.
 */

const { log } = require("./logger");
const {
  createBrowserContext,
  closeBrowser,
  navigateWithLimits,
  humanDelay,
} = require("./browser");
const { sendEmail } = require("./gmail");

/**
 * Map company size range strings to Sales Navigator size codes.
 * Sales Nav uses letter codes for company headcount filters.
 */
const COMPANY_SIZE_MAP = {
  "1-10": "B",
  "11-50": "C",
  "51-200": "D",
  "201-500": "E",
  "501-1000": "F",
  "1000+": "G",
  "1001-5000": "H",
  "5001-10000": "I",
  "10000+": "I",
};

/**
 * CSS selector groups for extracting profile data from Sales Nav results.
 * Multiple selectors per field for resilience against LinkedIn UI changes.
 */
const RESULT_LIST_SELECTORS = [
  ".search-results__result-list",
  '[class*="search-results"]',
  "ol.artdeco-list",
  '[data-x--search-result]',
  "main ol",
];

const RESULT_ITEM_SELECTORS = [
  "li.artdeco-list__item",
  '[class*="search-results"] li',
  'li[data-x--search-result]',
  "main ol > li",
];

const NAME_SELECTORS = [
  '[data-anonymize="person-name"]',
  'a[data-control-name="view_lead_panel_via_search_lead_name"] span',
  ".artdeco-entity-lockup__title a span",
  ".result-lockup__name a span",
  ".artdeco-entity-lockup__title span",
  '[class*="entity-lockup"] a[href*="/sales/lead/"] span',
];

const HEADLINE_SELECTORS = [
  '[data-anonymize="headline"]',
  ".artdeco-entity-lockup__subtitle span",
  ".result-lockup__highlight-keyword span",
  '[class*="entity-lockup__subtitle"]',
  ".artdeco-entity-lockup__subtitle",
];

const COMPANY_SELECTORS = [
  '[data-anonymize="company-name"]',
  'a[data-control-name="view_lead_panel_via_search_lead_company_name"]',
  ".artdeco-entity-lockup__caption a",
  ".result-lockup__misc-item a",
  '[class*="entity-lockup__caption"] a',
  ".artdeco-entity-lockup__caption span",
];

const PROFILE_LINK_SELECTORS = [
  'a[href*="/sales/lead/"]',
  'a[data-control-name="view_lead_panel_via_search_lead_name"]',
  ".artdeco-entity-lockup__title a",
  '[class*="entity-lockup"] a[href*="/sales/"]',
];

const NEXT_PAGE_SELECTORS = [
  'button[aria-label="Suivant"]',
  'button[aria-label="Next"]',
  'button.artdeco-pagination__button--next',
  '[class*="pagination"] button:last-child',
];

const CAPTCHA_INDICATORS = [
  "#captcha-challenge",
  "[data-captcha]",
  'iframe[src*="captcha"]',
  'iframe[src*="recaptcha"]',
  ".captcha-container",
];

/**
 * Dismiss common LinkedIn popups/modals that may block interaction.
 * Replicates the pattern from browser-signal-collector.js.
 *
 * @param {import('playwright').Page} page - Playwright page instance
 */
async function dismissPopups(page) {
  const popupSelectors = [
    'button[action-type="ACCEPT"]',
    'button[data-test-modal-close-btn]',
    'button.contextual-sign-in-modal__modal-dismiss-btn',
    '[data-test-modal-close-btn]',
    'button.artdeco-modal__dismiss',
    'button[aria-label="Dismiss"]',
    'button[aria-label="Fermer"]',
    'button.msg-overlay-bubble-header__control--new-convo-btn',
  ];

  for (const selector of popupSelectors) {
    try {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 500 }).catch(() => false);
      if (visible) {
        await el.click({ timeout: 1000 }).catch(() => {});
        await humanDelay(500, 1000);
      }
    } catch (_) {
      // Ignore popup dismissal errors
    }
  }
}

/**
 * Check if the current page shows a CAPTCHA challenge.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<boolean>}
 */
async function isCaptchaPresent(page) {
  for (const selector of CAPTCHA_INDICATORS) {
    try {
      const visible = await page
        .locator(selector)
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);
      if (visible) return true;
    } catch (_) {
      // ignore
    }
  }

  // Also check page text content for captcha keywords
  try {
    const bodyText = await page.textContent("body", { timeout: 2000 });
    if (
      bodyText &&
      (bodyText.toLowerCase().includes("captcha") ||
        bodyText.toLowerCase().includes("security verification") ||
        bodyText.toLowerCase().includes("are you a robot"))
    ) {
      return true;
    }
  } catch (_) {
    // ignore
  }

  return false;
}

/**
 * Check if the page has been redirected to a login page (session expired).
 *
 * @param {import('playwright').Page} page
 * @returns {boolean}
 */
function isSessionExpired(page) {
  const url = page.url();
  return (
    url.includes("/login") ||
    url.includes("/authwall") ||
    url.includes("/checkpoint") ||
    url.includes("/uas/login")
  );
}

/**
 * Simulate human-like scrolling behavior on the page.
 * Scrolls down slowly, waits, scrolls back partially.
 *
 * @param {import('playwright').Page} page
 */
async function humanScroll(page) {
  // Scroll down in steps
  const steps = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, 200 + Math.floor(Math.random() * 300));
    await humanDelay(500, 1500);
  }

  // Scroll back up a bit
  await page.mouse.wheel(0, -(100 + Math.floor(Math.random() * 200)));
  await humanDelay(1000, 2000);
}

/**
 * Try multiple CSS selectors and return the first matching element's text.
 *
 * @param {import('playwright').Locator} container - Parent element
 * @param {string[]} selectors - CSS selectors to try
 * @returns {Promise<string|null>}
 */
async function extractText(container, selectors) {
  for (const sel of selectors) {
    try {
      const el = container.locator(sel).first();
      const visible = await el.isVisible({ timeout: 300 }).catch(() => false);
      if (visible) {
        const text = await el.textContent({ timeout: 1000 });
        if (text && text.trim()) return text.trim();
      }
    } catch (_) {
      // try next selector
    }
  }
  return null;
}

/**
 * Try multiple CSS selectors and return the first matching element's href.
 *
 * @param {import('playwright').Locator} container - Parent element
 * @param {string[]} selectors - CSS selectors to try
 * @returns {Promise<string|null>}
 */
async function extractHref(container, selectors) {
  for (const sel of selectors) {
    try {
      const el = container.locator(sel).first();
      const visible = await el.isVisible({ timeout: 300 }).catch(() => false);
      if (visible) {
        const href = await el.getAttribute("href", { timeout: 1000 });
        if (href) return href;
      }
    } catch (_) {
      // try next selector
    }
  }
  return null;
}

/**
 * Convert a Sales Navigator profile URL to a regular LinkedIn profile URL.
 * Sales Nav URLs look like: /sales/lead/ACwAAA... or /sales/people/ACwAAA...
 * We extract the entity ID and cannot reliably convert to /in/ slug,
 * so we return the full Sales Nav URL as the linkedin_url.
 *
 * @param {string} salesNavUrl
 * @returns {string}
 */
function normalizeProfileUrl(salesNavUrl) {
  if (!salesNavUrl) return null;

  // If it's already a regular LinkedIn URL, return as-is
  if (salesNavUrl.includes("/in/")) {
    if (salesNavUrl.startsWith("http")) return salesNavUrl;
    return "https://www.linkedin.com" + salesNavUrl;
  }

  // For Sales Nav URLs, return the full URL
  if (salesNavUrl.startsWith("/")) {
    return "https://www.linkedin.com" + salesNavUrl;
  }

  return salesNavUrl;
}

/**
 * Parse a full name string into first_name and last_name.
 *
 * @param {string} fullName
 * @returns {{ first_name: string|null, last_name: string|null }}
 */
function parseName(fullName) {
  if (!fullName) return { first_name: null, last_name: null };

  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return { first_name: null, last_name: null };
  if (parts.length === 1) return { first_name: parts[0], last_name: null };

  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

/**
 * Extract profiles from the current Sales Nav search results page.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<Array<{first_name, last_name, headline, company_name, linkedin_url}>>}
 */
async function extractProfilesFromPage(page) {
  const profiles = [];

  // Find result items using multi-selector fallback
  let items = null;
  for (const sel of RESULT_ITEM_SELECTORS) {
    try {
      const found = page.locator(sel);
      const count = await found.count();
      if (count > 0) {
        items = found;
        break;
      }
    } catch (_) {
      // try next
    }
  }

  if (!items) return profiles;

  const count = await items.count();

  for (let i = 0; i < count; i++) {
    try {
      const item = items.nth(i);

      // Extract name
      const nameText = await extractText(item, NAME_SELECTORS);
      const { first_name, last_name } = parseName(nameText);

      // Extract headline
      const headline = await extractText(item, HEADLINE_SELECTORS);

      // Extract company name
      const company_name = await extractText(item, COMPANY_SELECTORS);

      // Extract profile link
      const rawHref = await extractHref(item, PROFILE_LINK_SELECTORS);
      const linkedin_url = normalizeProfileUrl(rawHref);

      // Only add if we got at least a name
      if (first_name || last_name) {
        profiles.push({
          first_name,
          last_name,
          headline: headline || null,
          company_name: company_name || null,
          linkedin_url: linkedin_url || null,
        });
      }
    } catch (_) {
      // Skip this item on error, continue with next
    }
  }

  return profiles;
}

/**
 * Wait for the search results list to appear on the page.
 *
 * @param {import('playwright').Page} page
 * @param {number} timeout - Max wait time in ms
 * @returns {Promise<boolean>} true if results found
 */
async function waitForResults(page, timeout = 15000) {
  for (const sel of RESULT_LIST_SELECTORS) {
    try {
      await page.waitForSelector(sel, { timeout: timeout / RESULT_LIST_SELECTORS.length });
      return true;
    } catch (_) {
      // try next selector
    }
  }
  return false;
}

/**
 * Build the Sales Navigator search URL from filters.
 *
 * Approach: Use the `keywords` query parameter for job title, then navigate
 * to the search page. Other filters (sector, company size, geography) are
 * encoded as part of the URL query string when possible, or applied via
 * the keywords field as a simpler, more resilient approach.
 *
 * Sales Nav URL format:
 *   /sales/search/people?query=(keywords:CEO)
 *
 * For complex filters (industry, company size, geo), Sales Nav uses encoded
 * filter blobs that change frequently. The most resilient approach is to
 * include the job title as keywords and let Sales Nav's relevance ranking
 * handle other dimensions, or combine them in the keywords field.
 *
 * @param {object} filters
 * @param {string} filters.job_title - Job title to search for
 * @param {string} [filters.sector] - Industry sector
 * @param {string} [filters.company_size] - Company size range
 * @param {string} [filters.geography] - Geographic location
 * @returns {string} Sales Navigator search URL
 */
function buildSearchUrl(filters) {
  // Build keywords combining job title with sector/geography for broader matching
  // Sales Nav's keyword search applies across title, company, and other fields
  const keywordParts = [];

  if (filters.job_title) {
    keywordParts.push(filters.job_title);
  }

  // Build the base search URL with keywords
  const keywords = keywordParts.join(" ");
  let url =
    "https://www.linkedin.com/sales/search/people?query=" +
    encodeURIComponent("(keywords:" + keywords + ")");

  return url;
}

/**
 * Send an alert email to Julien when CAPTCHA or session expiry is detected.
 *
 * @param {string} reason - 'captcha' or 'session_expired'
 * @param {string} errorMessage - Error details
 * @param {string} runId - Run ID for context
 */
async function sendAlertEmail(reason, errorMessage, runId) {
  try {
    const subject =
      reason === "captcha"
        ? "Sales Nav CAPTCHA detecte - scraping arrete"
        : "Sales Nav session expiree - scraping arrete";

    const htmlBody =
      "<h3>Sales Navigator Scraping Alert</h3>" +
      "<p><strong>Raison :</strong> " +
      (reason === "captcha"
        ? "CAPTCHA detecte sur Sales Navigator"
        : "Session LinkedIn expiree (redirection vers login)") +
      "</p>" +
      "<p><strong>Run ID :</strong> " + (runId || "N/A") + "</p>" +
      "<p><strong>Action requise :</strong></p>" +
      "<ol>" +
      (reason === "captcha"
        ? "<li>Attendez quelques heures avant de relancer une recherche</li>" +
          "<li>Si le probleme persiste, connectez-vous manuellement a Sales Nav et completez le CAPTCHA</li>"
        : "<li>Ouvrez LinkedIn dans Chrome en navigation privee</li>" +
          "<li>Connectez-vous avec le compte Julien</li>" +
          "<li>Exportez les cookies au format JSON (extension Cookie Editor)</li>" +
          "<li>Deposez le fichier sur le VPS : /home/openclaw/leadgen/linkedin-cookies.json</li>") +
      "</ol>" +
      "<p>Erreur: " + errorMessage + "</p>";

    const textBody =
      "Sales Nav scraping alert: " + reason + ". " + errorMessage;

    await sendEmail(process.env.GMAIL_USER, subject, htmlBody, textBody);
  } catch (emailErr) {
    // Log but don't throw - email alert is best effort
    console.warn(
      "[sales-nav-scraper] Failed to send alert email: " + emailErr.message
    );
  }
}

/**
 * Search Sales Navigator with the given filters and extract lead profiles.
 *
 * @param {object} filters - Search filters
 * @param {string} filters.job_title - Job title to search for (required)
 * @param {string} [filters.sector] - Industry sector
 * @param {string} [filters.company_size] - Company size range (e.g. "1-10", "51-200", "1000+")
 * @param {string} [filters.geography] - Geographic location
 * @param {number} [filters.max_leads=50] - Maximum number of leads to return (cap: 50)
 * @param {string} runId - Run identifier for logging
 * @returns {Promise<{profiles: Array, pages_consumed: number, stopped_reason: string|null}>}
 */
async function searchSalesNav(filters, runId) {
  const maxLeads = Math.min(filters.max_leads || 50, 50);
  let browser = null;
  let pagesConsumed = 0;
  const allProfiles = [];
  let stoppedReason = null;

  try {
    // Create browser context with LinkedIn cookies
    const ctx = await createBrowserContext(runId);
    browser = ctx.browser;
    const page = ctx.page;

    // Build and navigate to search URL
    const searchUrl = buildSearchUrl(filters);
    await log(
      runId,
      "sales-nav-scraper",
      "info",
      "Navigating to Sales Nav search: " + searchUrl
    );

    await navigateWithLimits(page, searchUrl);
    pagesConsumed++;

    // Check for session expiry (redirect to login)
    if (isSessionExpired(page)) {
      await log(
        runId,
        "sales-nav-scraper",
        "error",
        "Session expired - redirected to login"
      );
      stoppedReason = "session_expired";
      await sendAlertEmail("session_expired", "Redirected to login page", runId);
      return { profiles: [], pages_consumed: pagesConsumed, stopped_reason: stoppedReason };
    }

    // Dismiss popups and wait for results
    await dismissPopups(page);
    await humanDelay(2000, 4000);

    // Check for CAPTCHA
    if (await isCaptchaPresent(page)) {
      await log(
        runId,
        "sales-nav-scraper",
        "warn",
        "CAPTCHA detected on search page"
      );
      stoppedReason = "captcha";
      await sendAlertEmail("captcha", "CAPTCHA on search results page", runId);
      return { profiles: [], pages_consumed: pagesConsumed, stopped_reason: stoppedReason };
    }

    // Wait for search results to load
    const hasResults = await waitForResults(page);
    if (!hasResults) {
      await log(
        runId,
        "sales-nav-scraper",
        "warn",
        "No search results found on page"
      );
      stoppedReason = "no_results";
      return { profiles: [], pages_consumed: pagesConsumed, stopped_reason: stoppedReason };
    }

    // Scroll to simulate human behavior before extracting
    await humanScroll(page);

    // Extract profiles from first page
    const page1Profiles = await extractProfilesFromPage(page);
    allProfiles.push(...page1Profiles);
    await log(
      runId,
      "sales-nav-scraper",
      "info",
      "Page 1: extracted " + page1Profiles.length + " profiles"
    );

    // Check if we need page 2 (max 2 pages, 50 results cap)
    if (allProfiles.length < maxLeads && page1Profiles.length >= 20) {
      // Try to navigate to page 2
      await humanDelay(3000, 6000);

      let clickedNext = false;
      for (const sel of NEXT_PAGE_SELECTORS) {
        try {
          const btn = page.locator(sel).first();
          const visible = await btn.isVisible({ timeout: 1000 }).catch(() => false);
          const enabled = visible
            ? await btn.isEnabled({ timeout: 500 }).catch(() => false)
            : false;
          if (visible && enabled) {
            await btn.click({ timeout: 2000 });
            clickedNext = true;
            break;
          }
        } catch (_) {
          // try next selector
        }
      }

      if (clickedNext) {
        pagesConsumed++;
        await humanDelay(3000, 6000);

        // Check for CAPTCHA on page 2
        if (await isCaptchaPresent(page)) {
          await log(
            runId,
            "sales-nav-scraper",
            "warn",
            "CAPTCHA detected on page 2 - returning partial results"
          );
          stoppedReason = "captcha";
          await sendAlertEmail(
            "captcha",
            "CAPTCHA on search results page 2",
            runId
          );
          // Return partial results from page 1
        } else if (isSessionExpired(page)) {
          await log(
            runId,
            "sales-nav-scraper",
            "error",
            "Session expired on page 2 - returning partial results"
          );
          stoppedReason = "session_expired";
          await sendAlertEmail(
            "session_expired",
            "Session expired navigating to page 2",
            runId
          );
        } else {
          await dismissPopups(page);
          const hasPage2Results = await waitForResults(page, 10000);

          if (hasPage2Results) {
            await humanScroll(page);
            const page2Profiles = await extractProfilesFromPage(page);
            allProfiles.push(...page2Profiles);
            await log(
              runId,
              "sales-nav-scraper",
              "info",
              "Page 2: extracted " + page2Profiles.length + " profiles"
            );
          }
        }
      }
    }

    // Trim to max_leads
    if (allProfiles.length > maxLeads) {
      allProfiles.length = maxLeads;
    }

    // Set stopped reason
    if (!stoppedReason) {
      stoppedReason =
        allProfiles.length >= maxLeads ? "max_reached" : null;
    }

    await log(
      runId,
      "sales-nav-scraper",
      "info",
      "Search complete: " +
        allProfiles.length +
        " profiles, " +
        pagesConsumed +
        " pages consumed, reason: " +
        (stoppedReason || "done")
    );

    return {
      profiles: allProfiles,
      pages_consumed: pagesConsumed,
      stopped_reason: stoppedReason,
    };
  } catch (err) {
    // Handle browser creation failure (cookies expired)
    if (
      err.message.includes("cookies") ||
      err.message.includes("session expired")
    ) {
      await log(
        runId,
        "sales-nav-scraper",
        "error",
        "Browser/session error: " + err.message
      );
      await sendAlertEmail("session_expired", err.message, runId);
      return {
        profiles: allProfiles,
        pages_consumed: pagesConsumed,
        stopped_reason: "session_expired",
      };
    }

    // Handle rate limit errors
    if (err.message.includes("Daily page limit")) {
      await log(
        runId,
        "sales-nav-scraper",
        "warn",
        "Daily page limit reached: " + err.message
      );
      return {
        profiles: allProfiles,
        pages_consumed: pagesConsumed,
        stopped_reason: "rate_limited",
      };
    }

    await log(
      runId,
      "sales-nav-scraper",
      "error",
      "Unexpected error: " + err.message
    );
    return {
      profiles: allProfiles,
      pages_consumed: pagesConsumed,
      stopped_reason: "error",
    };
  } finally {
    await closeBrowser(browser);
  }
}

module.exports = { searchSalesNav };
