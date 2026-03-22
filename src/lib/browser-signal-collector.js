/**
 * Browser-based signal collector using Playwright.
 * Scrapes likers/commenters from competitor_page and influencer LinkedIn pages.
 * Collects post authors from keyword search and decision-makers from job search.
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
const { sendEmail } = require("./gmail");

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
 * Receives an already-created page from the orchestrator (collectAllBrowserSignals).
 *
 * @param {import('playwright').Page} page - Playwright page (browser already created)
 * @param {string} runId - UUID for this pipeline run
 * @returns {Promise<Array>} All collected signal objects with source_origin: "browser"
 */
async function collectBrowserPageSignals(page, runId) {
  // Load active watchlist entries for browser-compatible source types
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

  const allSignals = [];

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

  return allSignals;
}

/**
 * Format a raw extracted profile into a signal object.
 * Shared helper for keyword and job signal formatters.
 *
 * @param {object} profile - { name, headline, profileUrl }
 * @param {string} signalType - e.g. "post", "job"
 * @param {string} signalCategory - e.g. "sujet", "job"
 * @param {string} signalSource - Human-readable source label
 * @param {string|null} sequenceId - Sequence ID from watchlist
 * @returns {object} Formatted signal object
 */
function formatBrowserSignal(profile, signalType, signalCategory, signalSource, sequenceId) {
  var firstName = null;
  var lastName = null;

  if (profile.name) {
    var parts = profile.name.trim().split(/\s+/);
    firstName = parts[0] || null;
    lastName = parts.slice(1).join(" ") || null;
  }

  return {
    linkedin_url: profile.profileUrl || null,
    first_name: firstName,
    last_name: lastName,
    headline: profile.headline || null,
    company_name: null,
    signal_type: signalType,
    signal_category: signalCategory,
    signal_source: signalSource,
    signal_date: new Date().toISOString(),
    sequence_id: sequenceId || null,
    source_origin: "browser",
  };
}

/**
 * Collect signals from LinkedIn post search by keyword.
 * Searches for posts matching each active keyword watchlist entry,
 * extracts post authors (name, headline, profile URL) from the
 * first page of search results only (conserves 100-page budget).
 *
 * @param {import('playwright').Page} page - Playwright page (browser already created)
 * @param {string} runId - Current run ID for logging
 * @returns {Promise<Array>} Formatted signal objects
 */
async function collectBrowserKeywordSignals(page, runId) {
  var allSignals = [];

  // Load keyword watchlist entries
  var { data: sources, error } = await supabase
    .from("watchlist")
    .select("id, source_type, source_label, keywords, sequence_id")
    .eq("source_type", "keyword")
    .eq("is_active", true);

  if (error) {
    await log(runId, "browser-signal-collector", "error",
      "Failed to load keyword watchlist: " + error.message);
    return [];
  }

  if (!sources || sources.length === 0) {
    await log(runId, "browser-signal-collector", "info",
      "No active keyword sources in watchlist");
    return [];
  }

  await log(runId, "browser-signal-collector", "info",
    "Keyword post search: " + sources.length + " source(s) to process");

  for (var i = 0; i < sources.length; i++) {
    var source = sources[i];
    try {
      var searchUrl = "https://www.linkedin.com/search/results/content/?keywords=" +
        encodeURIComponent(source.keywords);

      await navigateWithLimits(page, searchUrl);
      await dismissPopups(page);

      // Wait for search results to load
      await page.waitForSelector(
        '.search-results-container, .reusable-search__entity-result-list, [data-chameleon-result-urn]',
        { timeout: 10000 }
      ).catch(function () {
        // Fallback: wait a bit and continue anyway
      });

      await humanDelay(1000, 2000);

      // Extract post authors from search result cards on first page only
      // LinkedIn post search results show author name, headline, and profile link
      // CSS selectors validated against current LinkedIn UI (March 2026):
      //   - .reusable-search__result-container: search result card wrapper
      //   - .update-components-actor: post author block in feed-style results
      //   - a[href*="/in/"]: profile link for personal profiles
      var authors = await page.evaluate(function () {
        var results = [];

        // Try multiple selector strategies for post search results
        var cards = document.querySelectorAll(
          '.reusable-search__result-container, .entity-result, [data-chameleon-result-urn]'
        );

        if (cards.length === 0) {
          // Fallback: look for feed-type post containers in search
          cards = document.querySelectorAll(
            '.feed-shared-update-v2, .update-components-actor'
          );
        }

        cards.forEach(function (card) {
          try {
            // Find author link - typically contains /in/ profile URL
            var authorLink = card.querySelector(
              'a[href*="/in/"], .update-components-actor__meta-link, .app-aware-link[href*="/in/"]'
            );
            if (!authorLink) return;

            var profileUrl = authorLink.href || "";
            // Clean URL - extract just the /in/username part
            var match = profileUrl.match(/linkedin\.com\/in\/[^/?]+/);
            profileUrl = match ? "https://www." + match[0] : profileUrl;

            // Get name from the link or nearby element
            var nameEl = card.querySelector(
              '.update-components-actor__name .visually-hidden, ' +
              '.entity-result__title-text a span[aria-hidden="true"], ' +
              '.update-components-actor__title .visually-hidden'
            ) || authorLink.querySelector('span[aria-hidden="true"]') || authorLink;
            var name = (nameEl.textContent || "").trim();

            // Get headline
            var headlineEl = card.querySelector(
              '.update-components-actor__description, ' +
              '.entity-result__primary-subtitle, ' +
              '.update-components-actor__subtitle'
            );
            var headline = headlineEl ? headlineEl.textContent.trim() : null;

            // Skip company posts (no /in/ profile URL) and posts without clear author
            if (name && profileUrl.indexOf("/in/") !== -1) {
              results.push({
                name: name,
                headline: headline,
                profileUrl: profileUrl,
              });
            }
          } catch (_) {
            // Skip this card on error
          }
        });

        return results;
      });

      // Deduplicate by profile URL within this batch
      var seen = {};
      var uniqueAuthors = [];
      for (var j = 0; j < authors.length; j++) {
        var key = authors[j].profileUrl;
        if (key && !seen[key]) {
          seen[key] = true;
          uniqueAuthors.push(authors[j]);
        }
      }

      var signalSource = source.source_label || source.keywords;

      for (var k = 0; k < uniqueAuthors.length; k++) {
        allSignals.push(formatBrowserSignal(
          uniqueAuthors[k], "post", "sujet", signalSource, source.sequence_id
        ));
      }

      await log(runId, "browser-signal-collector", "info",
        "Keyword '" + source.keywords + "': " + uniqueAuthors.length + " authors extracted");

    } catch (err) {
      if (err.message && err.message.indexOf("Daily page limit") !== -1) {
        await log(runId, "browser-signal-collector", "warn",
          "Rate limit reached during keyword search - stopping with partial results");
        break;
      }
      await log(runId, "browser-signal-collector", "error",
        "Keyword source '" + (source.source_label || source.keywords) + "' failed: " + err.message);
    }
  }

  await log(runId, "browser-signal-collector", "info",
    "Keyword post search complete: " + allSignals.length + " total signals");

  return allSignals;
}

/**
 * Collect signals from LinkedIn Jobs search by job keyword.
 * For each active job_keyword watchlist entry:
 *   1. Search LinkedIn Jobs for the keyword
 *   2. Extract company names from first page of job results
 *   3. For top 3 companies, search for CX/digital decision-makers via post search
 *   4. Return formatted signals with signal_type:"job"
 *
 * Uses the post-search approach to find decision-makers,
 * mirroring the Bereach collectJobSignals strategy in signal-collector.js.
 *
 * @param {import('playwright').Page} page - Playwright page (browser already created)
 * @param {string} runId - Current run ID for logging
 * @returns {Promise<Array>} Formatted signal objects
 */
async function collectBrowserJobSignals(page, runId) {
  var allSignals = [];

  // Load job_keyword watchlist entries
  var { data: sources, error } = await supabase
    .from("watchlist")
    .select("id, source_type, source_label, keywords, sequence_id")
    .eq("source_type", "job_keyword")
    .eq("is_active", true);

  if (error) {
    await log(runId, "browser-signal-collector", "error",
      "Failed to load job_keyword watchlist: " + error.message);
    return [];
  }

  if (!sources || sources.length === 0) {
    await log(runId, "browser-signal-collector", "info",
      "No active job_keyword sources in watchlist");
    return [];
  }

  await log(runId, "browser-signal-collector", "info",
    "Job keyword search: " + sources.length + " source(s) to process");

  for (var i = 0; i < sources.length; i++) {
    var source = sources[i];
    try {
      // Step 1: Search LinkedIn Jobs
      var jobSearchUrl = "https://www.linkedin.com/jobs/search/?keywords=" +
        encodeURIComponent(source.keywords);

      await navigateWithLimits(page, jobSearchUrl);
      await dismissPopups(page);

      // Wait for job results to load
      await page.waitForSelector(
        '.jobs-search-results-list, .jobs-search__results-list, .scaffold-layout__list-container',
        { timeout: 10000 }
      ).catch(function () {
        // Continue anyway
      });

      await humanDelay(1000, 2000);

      // Step 2: Extract company names and job titles from first page
      // LinkedIn Jobs search: each job card shows company name and job title
      var jobResults = await page.evaluate(function () {
        var jobs = [];

        // Job card selectors (multiple strategies)
        var cards = document.querySelectorAll(
          '.job-card-container, .jobs-search-results__list-item, .scaffold-layout__list-item, [data-job-id]'
        );

        if (cards.length === 0) {
          // Fallback selectors
          cards = document.querySelectorAll(
            '.base-card, .result-card, li[class*="jobs-search"]'
          );
        }

        cards.forEach(function (card) {
          try {
            // Company name - typically in a subtitle or secondary text element
            var companyEl = card.querySelector(
              '.job-card-container__primary-description, ' +
              '.base-search-card__subtitle, ' +
              '.artdeco-entity-lockup__subtitle, ' +
              'a[data-tracking-control-name*="company"], ' +
              '.job-card-container__company-name'
            );
            var companyName = companyEl ? companyEl.textContent.trim() : null;

            // Job title
            var titleEl = card.querySelector(
              '.job-card-list__title, ' +
              '.base-search-card__title, ' +
              '.artdeco-entity-lockup__title, ' +
              'a[class*="job-card-list__title"]'
            );
            var jobTitle = titleEl ? titleEl.textContent.trim() : null;

            if (companyName) {
              jobs.push({
                companyName: companyName,
                jobTitle: jobTitle || "unknown",
              });
            }
          } catch (_) {
            // Skip this card
          }
        });

        return jobs;
      });

      // Deduplicate companies and take top 3 to conserve page budget
      var seenCompanies = {};
      var uniqueJobs = [];
      for (var j = 0; j < jobResults.length; j++) {
        var cn = jobResults[j].companyName.toLowerCase();
        if (!seenCompanies[cn] && uniqueJobs.length < 3) {
          seenCompanies[cn] = true;
          uniqueJobs.push(jobResults[j]);
        }
      }

      await log(runId, "browser-signal-collector", "info",
        "Job keyword '" + source.keywords + "': " + jobResults.length +
        " jobs found, processing top " + uniqueJobs.length + " companies");

      // Step 3: For each company, search for decision-makers via post search
      // Uses the alternative approach: search LinkedIn posts for company + decision-maker titles
      for (var k = 0; k < uniqueJobs.length; k++) {
        var job = uniqueJobs[k];
        try {
          // Decision-maker search query (mirrors Bereach strategy)
          var dmQuery = '"' + job.companyName + '" (directeur experience client OR head of CX OR directeur digital OR chief digital officer OR VP customer experience OR responsable experience client)';
          var dmSearchUrl = "https://www.linkedin.com/search/results/content/?keywords=" +
            encodeURIComponent(dmQuery);

          await navigateWithLimits(page, dmSearchUrl);
          await dismissPopups(page);

          await page.waitForSelector(
            '.search-results-container, .reusable-search__entity-result-list, [data-chameleon-result-urn]',
            { timeout: 10000 }
          ).catch(function () {
            // Continue anyway
          });

          await humanDelay(1000, 2000);

          // Extract post authors who might be decision-makers at this company
          var dmAuthors = await page.evaluate(function (targetCompany) {
            var results = [];
            var cards = document.querySelectorAll(
              '.reusable-search__result-container, .entity-result, [data-chameleon-result-urn], .feed-shared-update-v2, .update-components-actor'
            );

            cards.forEach(function (card) {
              try {
                var authorLink = card.querySelector(
                  'a[href*="/in/"], .update-components-actor__meta-link, .app-aware-link[href*="/in/"]'
                );
                if (!authorLink) return;

                var profileUrl = authorLink.href || "";
                var match = profileUrl.match(/linkedin\.com\/in\/[^/?]+/);
                profileUrl = match ? "https://www." + match[0] : profileUrl;

                var nameEl = card.querySelector(
                  '.update-components-actor__name .visually-hidden, ' +
                  '.entity-result__title-text a span[aria-hidden="true"], ' +
                  '.update-components-actor__title .visually-hidden'
                ) || authorLink.querySelector('span[aria-hidden="true"]') || authorLink;
                var name = (nameEl.textContent || "").trim();

                var headlineEl = card.querySelector(
                  '.update-components-actor__description, ' +
                  '.entity-result__primary-subtitle, ' +
                  '.update-components-actor__subtitle'
                );
                var headline = headlineEl ? headlineEl.textContent.trim() : null;

                // Check if headline mentions the target company
                var headlineLower = (headline || "").toLowerCase();
                var companyLower = targetCompany.toLowerCase();
                var isMatch = headlineLower.indexOf(companyLower) !== -1;

                if (name && profileUrl.indexOf("/in/") !== -1 && isMatch) {
                  results.push({
                    name: name,
                    headline: headline,
                    profileUrl: profileUrl,
                  });
                }
              } catch (_) {
                // Skip
              }
            });

            return results;
          }, job.companyName);

          if (dmAuthors.length === 0) {
            await log(runId, "browser-signal-collector", "info",
              "No decision-maker found for " + job.companyName);
            continue;
          }

          // Format decision-maker signals
          var signalSource = (source.source_label || "job") + " | " + job.jobTitle + " @ " + job.companyName;

          for (var m = 0; m < dmAuthors.length; m++) {
            allSignals.push(formatBrowserSignal(
              dmAuthors[m], "job", "job", signalSource, source.sequence_id
            ));
          }

          await log(runId, "browser-signal-collector", "info",
            "Company '" + job.companyName + "': " + dmAuthors.length + " decision-maker(s) found");

        } catch (err) {
          if (err.message && err.message.indexOf("Daily page limit") !== -1) {
            await log(runId, "browser-signal-collector", "warn",
              "Rate limit reached during job DM search - stopping with partial results");
            return allSignals;
          }
          await log(runId, "browser-signal-collector", "error",
            "Decision-maker lookup failed for " + job.companyName + ": " + err.message);
        }
      }

    } catch (err) {
      if (err.message && err.message.indexOf("Daily page limit") !== -1) {
        await log(runId, "browser-signal-collector", "warn",
          "Rate limit reached during job search - stopping with partial results");
        break;
      }
      await log(runId, "browser-signal-collector", "error",
        "Job source '" + (source.source_label || source.keywords) + "' failed: " + err.message);
    }
  }

  await log(runId, "browser-signal-collector", "info",
    "Job keyword search complete: " + allSignals.length + " total signals");

  return allSignals;
}

/**
 * Orchestrate all browser-based signal collection.
 * Creates a single browser context, runs all 3 scrapers sequentially,
 * and returns merged signals with stats.
 *
 * If browser creation fails (cookies expired), sends an email alert
 * to Julien and returns empty results without throwing.
 *
 * @param {string} runId - UUID for this pipeline run
 * @returns {Promise<{signals: Array, stats: object}>} Signals and collection stats
 */
async function collectAllBrowserSignals(runId) {
  var stats = {
    competitor_page: 0,
    influencer: 0,
    keyword: 0,
    job_keyword: 0,
    pages_consumed: 0,
    errors: 0,
  };

  // Create browser context - if fails (cookies expired), send email alert
  var browser, page;
  var startPageCount = getPageCount().count;

  try {
    var ctx = await createBrowserContext(runId);
    browser = ctx.browser;
    page = ctx.page;
  } catch (err) {
    await log(runId, "browser-signal-collector", "error",
      "Browser creation failed (cookies expired?): " + err.message);

    // Send email alert to Julien about cookie expiry
    try {
      await sendEmail(
        process.env.GMAIL_USER,
        "LinkedIn cookies expires - browser scraping desactive",
        "<h3>LinkedIn cookies expirees</h3>" +
        "<p>Le browser scraping est desactive car les cookies LinkedIn ont expire.</p>" +
        "<p><strong>Action requise :</strong></p>" +
        "<ol>" +
        "<li>Ouvrez LinkedIn dans Chrome en navigation privee</li>" +
        "<li>Connectez-vous avec le compte Julien</li>" +
        "<li>Exportez les cookies au format JSON (extension Cookie Editor)</li>" +
        "<li>Deposez le fichier sur le VPS : /home/openclaw/leadgen/linkedin-cookies.json</li>" +
        "</ol>" +
        "<p>Erreur: " + err.message + "</p>",
        "LinkedIn cookies expirees - action requise pour reactiver le browser scraping."
      );
      await log(runId, "browser-signal-collector", "info",
        "Cookie expiry email alert sent to Julien");
    } catch (emailErr) {
      await log(runId, "browser-signal-collector", "warn",
        "Failed to send cookie expiry email alert: " + emailErr.message);
    }

    return { signals: [], stats: { ...stats, error: "cookies_expired" } };
  }

  var allSignals = [];

  try {
    // 1. Collect competitor_page + influencer signals
    try {
      var pageSignals = await collectBrowserPageSignals(page, runId);
      allSignals = allSignals.concat(pageSignals);
      // Count by signal category
      for (var p = 0; p < pageSignals.length; p++) {
        if (pageSignals[p].signal_category === "concurrent") {
          stats.competitor_page++;
        } else {
          stats.influencer++;
        }
      }
    } catch (err) {
      await log(runId, "browser-signal-collector", "error",
        "Page signal collection failed: " + err.message);
      stats.errors++;
    }

    // 2. Collect keyword signals
    try {
      var keywordSignals = await collectBrowserKeywordSignals(page, runId);
      allSignals = allSignals.concat(keywordSignals);
      stats.keyword = keywordSignals.length;
    } catch (err) {
      await log(runId, "browser-signal-collector", "error",
        "Keyword signal collection failed: " + err.message);
      stats.errors++;
    }

    // 3. Collect job_keyword signals
    try {
      var jobSignals = await collectBrowserJobSignals(page, runId);
      allSignals = allSignals.concat(jobSignals);
      stats.job_keyword = jobSignals.length;
    } catch (err) {
      await log(runId, "browser-signal-collector", "error",
        "Job signal collection failed: " + err.message);
      stats.errors++;
    }

  } finally {
    // Always close browser
    await closeBrowser(browser);
  }

  stats.pages_consumed = getPageCount().count - startPageCount;

  await log(runId, "browser-signal-collector", "info",
    "Browser collection complete: " + allSignals.length + " signals. " +
    "competitor_page=" + stats.competitor_page + " influencer=" + stats.influencer +
    " keyword=" + stats.keyword + " job_keyword=" + stats.job_keyword +
    " pages=" + stats.pages_consumed + " errors=" + stats.errors);

  return { signals: allSignals, stats: stats };
}

module.exports = {
  collectBrowserPageSignals,
  collectBrowserKeywordSignals,
  collectBrowserJobSignals,
  collectAllBrowserSignals,
};
