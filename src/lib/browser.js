/**
 * Browser manager with Playwright.
 * Launches Chromium headless, imports LinkedIn cookies from JSON,
 * validates session, and blocks actions if cookies are expired.
 *
 * Uses CommonJS pattern consistent with other lib modules.
 */

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const { log } = require("./logger");

// --- Rate limiting: daily page counter (in-memory, resets on restart) ---
let pageCount = 0;
let pageCountDate = null;

const DAILY_PAGE_LIMIT = 100;

/**
 * Reset the daily counter if the date (Europe/Paris) has changed.
 */
function resetDailyCounterIfNeeded() {
  const today = new Date().toLocaleDateString("fr-FR", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // Convert DD/MM/YYYY to YYYY-MM-DD for consistency
  const parts = today.split("/");
  const todayISO = parts[2] + "-" + parts[1] + "-" + parts[0];
  if (pageCountDate !== todayISO) {
    pageCount = 0;
    pageCountDate = todayISO;
  }
}

/**
 * Navigate to a URL with rate limiting and human delay.
 * Blocks navigation if daily page limit (100/day) is reached.
 *
 * @param {import('playwright').Page} page - Playwright page instance
 * @param {string} url - URL to navigate to
 * @param {object} options - Extra options passed to page.goto
 * @returns {Promise<import('playwright').Response|null>} Navigation response
 * @throws {Error} If daily page limit reached
 */
async function navigateWithLimits(page, url, options = {}) {
  resetDailyCounterIfNeeded();

  if (pageCount >= DAILY_PAGE_LIMIT) {
    console.warn("[browser] Daily page limit reached (100/day) - navigation blocked");
    throw new Error("Daily page limit reached (100/day) - navigation blocked");
  }

  await humanDelay();

  const response = await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
    ...options,
  });

  pageCount++;

  return response;
}

/**
 * Wait a random delay to simulate human behavior.
 *
 * @param {number} minMs - Minimum delay in milliseconds (default 3000)
 * @param {number} maxMs - Maximum delay in milliseconds (default 8000)
 */
async function humanDelay(minMs = 3000, maxMs = 8000) {
  const delay = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

/**
 * Get the current page count state.
 *
 * @returns {{ count: number, limit: number, date: string|null }}
 */
function getPageCount() {
  return { count: pageCount, limit: DAILY_PAGE_LIMIT, date: pageCountDate };
}

/** Default path to LinkedIn cookies file (relative to project root) */
const DEFAULT_COOKIES_PATH = path.resolve(
  __dirname,
  "../../linkedin-cookies.json"
);

/**
 * Anti-detection browser context options.
 * Minimal stealth: realistic user-agent, viewport, locale, timezone.
 * No stealth plugin needed for volume < 100/day.
 */
const BROWSER_CONTEXT_OPTIONS = {
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  viewport: { width: 1920, height: 1080 },
  locale: "fr-FR",
  timezoneId: "Europe/Paris",
};

/**
 * Create a browser context with LinkedIn cookies loaded.
 * Validates the session before returning. If session is invalid
 * (cookies expired or missing), logs an error and throws.
 *
 * @param {string|null} runId - Optional run ID for logging
 * @returns {Promise<{browser: import('playwright').Browser, context: import('playwright').BrowserContext, page: import('playwright').Page}>}
 * @throws {Error} If LinkedIn session is expired or invalid
 */
async function createBrowserContext(runId = null) {
  const cookiesPath =
    process.env.LINKEDIN_COOKIES_PATH || DEFAULT_COOKIES_PATH;

  // Read and parse cookies
  let cookies;
  try {
    const raw = fs.readFileSync(cookiesPath, "utf-8");
    cookies = JSON.parse(raw);
  } catch (err) {
    const msg = "Failed to read LinkedIn cookies from " + cookiesPath + ": " + err.message;
    if (runId) {
      await log(runId, "browser", "error", msg);
    }
    throw new Error(msg);
  }

  if (!Array.isArray(cookies) || cookies.length === 0) {
    const msg = "LinkedIn cookies file is empty or invalid: " + cookiesPath;
    if (runId) {
      await log(runId, "browser", "error", msg);
    }
    throw new Error(msg);
  }

  // Launch browser
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(BROWSER_CONTEXT_OPTIONS);

  // Add cookies to context
  await context.addCookies(cookies);

  // Validate session
  const valid = await validateSession(context);
  if (!valid) {
    await browser.close();
    const msg = "LinkedIn session expired - browser actions blocked";
    if (runId) {
      await log(runId, "browser", "error", msg);
    }
    throw new Error(msg);
  }

  const page = await context.newPage();
  return { browser, context, page };
}

/**
 * Validate LinkedIn session by navigating to the feed.
 * Checks that the URL does not redirect to /login and that
 * feed content elements are present.
 *
 * @param {import('playwright').BrowserContext} context - Browser context with cookies
 * @returns {Promise<boolean>} true if session is valid, false otherwise
 */
async function validateSession(context) {
  const page = await context.newPage();
  try {
    await page.goto("https://www.linkedin.com/feed/", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    const url = page.url();
    if (url.includes("/login") || url.includes("/authwall")) {
      return false;
    }

    // Check for feed content indicators
    const hasFeed = await page
      .locator(".feed-shared-update-v2, [data-urn]")
      .first()
      .waitFor({ timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    return hasFeed;
  } catch (err) {
    // Navigation timeout or other error = session invalid
    return false;
  } finally {
    await page.close();
  }
}

/**
 * Close the browser instance cleanly.
 *
 * @param {import('playwright').Browser} browser - Browser instance to close
 */
async function closeBrowser(browser) {
  if (browser) {
    await browser.close();
  }
}

module.exports = {
  createBrowserContext,
  closeBrowser,
  validateSession,
  navigateWithLimits,
  humanDelay,
  getPageCount,
};
