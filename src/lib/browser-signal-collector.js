/**
 * Browser-based signal collector using Playwright.
 * Scrapes likers/commenters from competitor_page and influencer LinkedIn pages.
 * Collects from the reactions popup first screen only (no scrolling).
 *
 * Uses browser.js infrastructure (Playwright, cookies, rate limiting, human delays).
 * CommonJS module pattern consistent with other lib modules.
 */

const { supabase } = require("./supabase");
const { log } = require("./logger");
const {
  createBrowserContext,
  closeBrowser,
  navigateWithLimits,
  humanDelay,
  getPageCount,
} = require("./browser");

/**
 * Dismiss common LinkedIn popups/modals that may block interaction.
 * Checks for cookie consent, "Sign in to continue", messaging overlays, etc.
 *
 * @param {import('playwright').Page} page - Playwright page instance
 */
async function dismissPopups(page) {
  const popupSelectors = [
    // Cookie consent accept button
    'button[action-type="ACCEPT"]',
    'button[data-test-modal-close-btn]',
    // "Sign in" / "Join" modals close button
    'button[data-tracking-control-name="public_jobs_contextual-sign-in-modal_modal_dismiss"]',
    'button.contextual-sign-in-modal__modal-dismiss-btn',
    '[data-test-modal-close-btn]',
    // Generic modal close
    'button.artdeco-modal__dismiss',
    'button[aria-label="Dismiss"]',
    'button[aria-label="Fermer"]',
    // Messaging overlay minimize
    'button.msg-overlay-bubble-header__control--new-convo-btn',
  ];

  for (const selector of popupSelectors) {
    try {
      const el = page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 500 }).catch(() => false);
      if (visible) {
        await el.click({ timeout: 1000 }).catch(() => {});
        await humanDelay(500, 1500);
      }
    } catch (_) {
      // Ignore - popup not present
    }
  }
}

/**
 * Extract profiles from a reactions popup/modal (first screen only, no scrolling).
 *
 * @param {import('playwright').Page} page - Playwright page instance
 * @returns {Promise<Array>} Array of { name, headline, profileUrl }
 */
async function extractProfilesFromPopup(page) {
  const profiles = [];

  // LinkedIn reactions modal: look for list items within the modal
  // Multiple selector strategies for resilience against LinkedIn UI changes
  const modalSelectors = [
    // Modern LinkedIn reactions modal
    '.social-details-reactors-modal',
    '[role="dialog"]',
    '.artdeco-modal',
  ];

  let modalFound = false;
  for (const sel of modalSelectors) {
    const modal = page.locator(sel).first();
    const visible = await modal.isVisible({ timeout: 2000 }).catch(() => false);
    if (visible) {
      modalFound = true;
      break;
    }
  }

  if (!modalFound) {
    return profiles;
  }

  // Extract individual reactor entries
  // LinkedIn typically shows reactors as list items with profile links
  const entrySelectors = [
    // Reactor list items in the modal
    '.social-details-reactors-modal .artdeco-list__item',
    '[role="dialog"] .artdeco-list__item',
    '.artdeco-modal .artdeco-list__item',
    // Alternative: entity results
    '.social-details-reactors-modal .entity-result',
    '[role="dialog"] .entity-result',
    // Fallback: any link to a profile within the modal
  ];

  let entries = null;
  for (const sel of entrySelectors) {
    const found = page.locator(sel);
    const count = await found.count().catch(() => 0);
    if (count > 0) {
      entries = found;
      break;
    }
  }

  if (!entries) {
    // Fallback: try to find profile links within any visible modal
    const fallbackEntries = page.locator('[role="dialog"] a[href*="/in/"]');
    const fallbackCount = await fallbackEntries.count().catch(() => 0);
    if (fallbackCount > 0) {
      for (let i = 0; i < fallbackCount; i++) {
        try {
          const link = fallbackEntries.nth(i);
          const href = await link.getAttribute("href");
          const nameEl = link.locator("span").first();
          const name = await nameEl.textContent().catch(() => null);
          if (href && name) {
            profiles.push({
              name: name.trim(),
              headline: null,
              profileUrl: href.startsWith("http") ? href : "https://www.linkedin.com" + href,
            });
          }
        } catch (_) {
          // Skip this entry
        }
      }
    }
    return profiles;
  }

  const entryCount = await entries.count();
  for (let i = 0; i < entryCount; i++) {
    try {
      const entry = entries.nth(i);

      // Extract profile URL
      const profileLink = entry.locator('a[href*="/in/"]').first();
      const href = await profileLink.getAttribute("href").catch(() => null);
      if (!href) continue;

      const profileUrl = href.startsWith("http")
        ? href.split("?")[0]
        : "https://www.linkedin.com" + href.split("?")[0];

      // Extract name - typically in a span inside the profile link or nearby
      const nameSelectors = [
        '.artdeco-entity-lockup__title span[aria-hidden="true"]',
        '.artdeco-entity-lockup__title',
        'span.entity-result__title-text',
        'a[href*="/in/"] span',
      ];
      let name = null;
      for (const nameSel of nameSelectors) {
        const nameEl = entry.locator(nameSel).first();
        name = await nameEl.textContent().catch(() => null);
        if (name && name.trim().length > 0) {
          name = name.trim();
          break;
        }
        name = null;
      }
      if (!name) continue;

      // Extract headline - subtitle element
      const headlineSelectors = [
        '.artdeco-entity-lockup__subtitle',
        '.entity-result__summary',
        '.artdeco-entity-lockup__caption',
      ];
      let headline = null;
      for (const headSel of headlineSelectors) {
        const headEl = entry.locator(headSel).first();
        headline = await headEl.textContent().catch(() => null);
        if (headline && headline.trim().length > 0) {
          headline = headline.trim();
          break;
        }
        headline = null;
      }

      profiles.push({ name, headline, profileUrl });
    } catch (_) {
      // Skip this entry on error
    }
  }

  return profiles;
}

/**
 * Collect signals from a single LinkedIn page (company or person).
 * Navigates to the page, finds recent posts, opens reaction popups,
 * extracts profiles from the first screen.
 *
 * @param {import('playwright').Page} page - Playwright page instance
 * @param {object} source - Watchlist source entry
 * @param {string} signalCategory - 'concurrent' or 'influenceur'
 * @param {string} runId - Current run ID
 * @returns {Promise<Array>} Formatted signal objects
 */
async function scrapeSourcePage(page, source, signalCategory, runId) {
  const signals = [];
  const sourceUrl = source.source_url;

  if (!sourceUrl) {
    await log(runId, "browser-signal", "warn",
      "Source has no source_url, skipping: " + (source.source_label || source.id));
    return signals;
  }

  // Navigate to the source's LinkedIn page
  await navigateWithLimits(page, sourceUrl);
  await dismissPopups(page);
  await humanDelay(2000, 4000);

  // Find recent posts on the page
  // LinkedIn company/person pages show posts in a feed section
  // CSS selectors for post containers (multiple strategies)
  const postSelectors = [
    // Company/person page feed posts
    '.feed-shared-update-v2',
    '[data-urn^="urn:li:activity"]',
    '.occludable-update',
    // Alternative containers
    '.profile-creator-shared-feed-update__mini-update',
  ];

  let postElements = null;
  for (const sel of postSelectors) {
    const found = page.locator(sel);
    const count = await found.count().catch(() => 0);
    if (count > 0) {
      postElements = found;
      break;
    }
  }

  if (!postElements) {
    await log(runId, "browser-signal", "debug",
      "No posts found on page: " + sourceUrl);
    return signals;
  }

  // Take first 2-3 recent posts
  const postCount = Math.min(await postElements.count(), 3);

  for (let postIdx = 0; postIdx < postCount; postIdx++) {
    try {
      const post = postElements.nth(postIdx);

      // Find and click the reactions count element
      // LinkedIn shows "X reactions" or "X likes" as a clickable element
      const reactionSelectors = [
        // Reactions count button/link
        'button.social-details-social-counts__reactions-count',
        'button[aria-label*="reaction"]',
        'button[aria-label*="Reaction"]',
        'span.social-details-social-counts__reactions-count',
        // Fallback: any clickable count area
        '.social-details-social-counts__count-value',
        'button[aria-label*="like"]',
        'button[aria-label*="j\'aime"]',
      ];

      let reactionsClicked = false;
      for (const reaSel of reactionSelectors) {
        try {
          const reactBtn = post.locator(reaSel).first();
          const visible = await reactBtn.isVisible({ timeout: 1500 }).catch(() => false);
          if (visible) {
            await reactBtn.click({ timeout: 3000 });
            reactionsClicked = true;
            break;
          }
        } catch (_) {
          // Try next selector
        }
      }

      if (!reactionsClicked) {
        // Post has 0 reactions or button not found - skip silently
        await log(runId, "browser-signal", "debug",
          "No reactions button found on post " + (postIdx + 1) + " of " + sourceUrl);
        continue;
      }

      // Wait for popup to appear
      await humanDelay(1500, 3000);
      await dismissPopups(page);

      // Extract profiles from the popup first screen
      const profiles = await extractProfilesFromPopup(page);

      // Close the popup
      const closeSelectors = [
        'button.artdeco-modal__dismiss',
        'button[aria-label="Dismiss"]',
        'button[aria-label="Fermer"]',
        '[data-test-modal-close-btn]',
      ];
      for (const closeSel of closeSelectors) {
        try {
          const closeBtn = page.locator(closeSel).first();
          const visible = await closeBtn.isVisible({ timeout: 1000 }).catch(() => false);
          if (visible) {
            await closeBtn.click({ timeout: 2000 });
            break;
          }
        } catch (_) {
          // Try next
        }
      }

      await humanDelay(1000, 2000);

      // Format profiles into signal objects
      for (const profile of profiles) {
        if (!profile.profileUrl) continue;

        const nameParts = (profile.name || "").trim().split(/\s+/);
        const firstName = nameParts[0] || null;
        const lastName = nameParts.slice(1).join(" ") || null;

        signals.push({
          linkedin_url: profile.profileUrl,
          first_name: firstName,
          last_name: lastName,
          headline: profile.headline || null,
          company_name: null,
          signal_type: "like",
          signal_category: signalCategory,
          signal_source: source.source_label || source.source_type,
          signal_date: new Date().toISOString(),
          sequence_id: source.sequence_id || null,
          source_origin: "browser",
        });
      }

      await log(runId, "browser-signal", "debug",
        "Post " + (postIdx + 1) + " of " + sourceUrl + ": " + profiles.length + " profiles extracted");

    } catch (err) {
      await log(runId, "browser-signal", "warn",
        "Error processing post " + (postIdx + 1) + " of " + sourceUrl + ": " + err.message);
    }
  }

  return signals;
}

/**
 * Collect browser-based signals from competitor_page and influencer sources.
 * Main entry point for browser signal collection.
 *
 * @param {string} runId - UUID for this pipeline run
 * @returns {Promise<Array>} All collected signal objects with source_origin: "browser"
 */
async function collectBrowserPageSignals(runId) {
  // 1. Load active watchlist entries for browser-compatible source types
  const { data: sources, error } = await supabase
    .from("watchlist")
    .select("id, source_type, source_label, source_url, keywords, sequence_id")
    .in("source_type", ["competitor_page", "influencer"])
    .eq("is_active", true);

  if (error) {
    await log(runId, "browser-signal", "error",
      "Failed to load watchlist: " + error.message);
    return [];
  }

  if (!sources || sources.length === 0) {
    await log(runId, "browser-signal", "info",
      "No active competitor_page/influencer sources in watchlist");
    return [];
  }

  await log(runId, "browser-signal", "info",
    "Loaded " + sources.length + " browser-compatible watchlist sources");

  // 2. Create browser context - if fails (cookies expired), return empty
  let browser, page;
  try {
    const ctx = await createBrowserContext(runId);
    browser = ctx.browser;
    page = ctx.page;
  } catch (err) {
    await log(runId, "browser-signal", "error",
      "Browser creation failed (cookies expired?): " + err.message);
    return [];
  }

  const allSignals = [];
  const startPageCount = getPageCount().count;

  try {
    // 3. Process each source
    for (let i = 0; i < sources.length; i++) {
      const source = sources[i];
      const signalCategory = source.source_type === "competitor_page"
        ? "concurrent"
        : "influenceur";

      try {
        const sourceSignals = await scrapeSourcePage(page, source, signalCategory, runId);

        await log(runId, "browser-signal", "info",
          "Source '" + (source.source_label || source.source_type) +
          "' collected " + sourceSignals.length + " signals via browser");

        allSignals.push(...sourceSignals);

      } catch (err) {
        // Check if rate limit reached
        if (err.message && err.message.includes("Daily page limit reached")) {
          await log(runId, "browser-signal", "warn",
            "Daily page limit reached - keeping " + allSignals.length +
            " partial results, stopping browser collection");
          break;
        }

        // Error isolation: one failing source does not crash collection
        await log(runId, "browser-signal", "error",
          "Source '" + (source.source_label || source.source_type) +
          "' failed: " + err.message);
      }

      // Human delay between sources
      if (i < sources.length - 1) {
        await humanDelay(3000, 6000);
      }
    }
  } finally {
    // 6. Always close browser
    await closeBrowser(browser);
  }

  // 7. Log summary
  const pagesConsumed = getPageCount().count - startPageCount;
  await log(runId, "browser-signal", "info",
    "Browser signal collection complete: " + allSignals.length +
    " signals from " + sources.length + " sources, " +
    pagesConsumed + " pages consumed");

  return allSignals;
}

module.exports = { collectBrowserPageSignals };
