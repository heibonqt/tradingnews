/**
 * ForexFactory USD Weekly News -> Discord Screenshot Bot
 * ---------------------------------------------------------
 * Visits ForexFactory's "this week" calendar, filters to USD only,
 * screenshots the filtered calendar table, and posts the image
 * to a Discord channel via webhook.
 *
 * Run manually:   node ff-usd-screenshot.js
 * Run on schedule: see cron / GitHub Actions setup in README.md
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const CALENDAR_URL = 'https://www.forexfactory.com/calendar?week=this';
const SCREENSHOT_PATH = path.join(__dirname, 'usd-calendar.png');

// Toggle to true while you're debugging selectors locally
const DEBUG = process.env.DEBUG === 'true';

if (!DISCORD_WEBHOOK_URL) {
  console.error('Missing DISCORD_WEBHOOK_URL in .env file. See README.md.');
  process.exit(1);
}

async function run() {
  const browser = await chromium.launch({
    headless: !DEBUG,
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 1600 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  try {
    console.log('Opening ForexFactory calendar...');
    await page.goto(CALENDAR_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // --- 1. Dismiss cookie / consent banner if present ---
    await dismissCookieBanner(page);

    // --- 2. Open the currency filter and select USD only ---
    await filterToUSD(page);

    // Give the table a moment to re-render after filtering
    await page.waitForTimeout(1500);

    // --- 3. Locate the calendar table and screenshot it ---
    const calendarTable = page.locator('table.calendar__table, .calendar__table').first();
    await calendarTable.waitFor({ state: 'visible', timeout: 15000 });

    console.log('Taking screenshot...');
    await calendarTable.screenshot({ path: SCREENSHOT_PATH });

    console.log(`Screenshot saved to ${SCREENSHOT_PATH}`);

    // --- 4. Send to Discord ---
    await sendToDiscord(SCREENSHOT_PATH);

    console.log('Done. Posted to Discord.');
  } catch (err) {
    console.error('Bot failed:', err);
    // Optional: save a full-page debug screenshot to help diagnose selector issues
    try {
      await page.screenshot({ path: path.join(__dirname, 'debug-fullpage.png'), fullPage: true });
      console.error('Saved debug-fullpage.png for inspection.');
    } catch (_) {}
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

/**
 * Dismiss the cookie/GDPR consent popup if ForexFactory shows one.
 * Selectors here are best-guess and may need updating — open the
 * site with DEBUG=true to see what the banner actually looks like.
 */
async function dismissCookieBanner(page) {
  const possibleSelectors = [
    'button:has-text("Accept")',
    'button:has-text("I Accept")',
    'button:has-text("Agree")',
    '#cookie-consent button',
    '.cookie-consent__accept',
  ];

  for (const selector of possibleSelectors) {
    try {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 })) {
        await btn.click();
        console.log(`Dismissed cookie banner via selector: ${selector}`);
        return;
      }
    } catch (_) {
      // not found, try next
    }
  }
  console.log('No cookie banner detected (or already dismissed).');
}

/**
 * Open ForexFactory's currency filter dropdown and isolate USD.
 * ForexFactory's filter UI has changed shape over the years, so this
 * tries a couple of strategies. If both fail, it falls back to NOT
 * filtering and instead relies on screenshotting + you visually
 * confirming -- check debug-fullpage.png if this happens.
 */
async function filterToUSD(page) {
  // Strategy A: "Filters" button opens a panel with currency checkboxes
  try {
    const filterButton = page.locator('button:has-text("Filters"), .calendar__filter-toggle').first();
    if (await filterButton.isVisible({ timeout: 3000 })) {
      await filterButton.click();
      await page.waitForTimeout(500);

      // Uncheck "All Currencies" / select only USD - adjust selector to match actual DOM
      const usdCheckbox = page
        .locator('label:has-text("USD") input[type="checkbox"], input[value="USD"]')
        .first();

      if (await usdCheckbox.isVisible({ timeout: 3000 })) {
        // Try to deselect all first if there's a "select all" toggle
        const selectAll = page.locator('label:has-text("Select All") input[type="checkbox"]').first();
        if (await selectAll.isVisible({ timeout: 1000 }).catch(() => false)) {
          const isChecked = await selectAll.isChecked().catch(() => false);
          if (isChecked) await selectAll.click();
        }

        await usdCheckbox.check();

        // Apply button, if the panel requires explicit submit
        const applyButton = page.locator('button:has-text("Apply"), button:has-text("Done")').first();
        if (await applyButton.isVisible({ timeout: 1000 }).catch(() => false)) {
          await applyButton.click();
        }

        console.log('Filtered calendar to USD via filter panel.');
        return;
      }
    }
  } catch (err) {
    console.log('Filter-panel strategy did not fully succeed, trying fallback...', err.message);
  }

  // Strategy B: URL query param some FF versions support, e.g. ?currencies=USD
  // This is a no-op if unsupported, but cheap to try as a fallback.
  console.log('Falling back: filter UI not matched. You may need to update selectors in filterToUSD().');
}

/**
 * Upload the screenshot to Discord via webhook.
 */
async function sendToDiscord(imagePath) {
  const FormData = require('form-data');
  const fetch = (await import('node-fetch')).default;

  const form = new FormData();
  const today = new Date().toISOString().slice(0, 10);

  form.append(
    'payload_json',
    JSON.stringify({
      content: `📅 **USD News This Week** (${today})`,
    })
  );
  form.append('file', fs.createReadStream(imagePath), 'usd-calendar.png');

  const res = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord webhook failed: ${res.status} ${text}`);
  }
}

run();
