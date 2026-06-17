/**
 * ForexFactory USD Weekly News -> Discord Embed Bot
 * Playwright + Discord Webhook
 */

const { chromium } = require('playwright-extra');
const StealthPlugin = require('playwright-extra-plugin-stealth');
const fs = require('fs');
require('dotenv').config();

chromium.use(StealthPlugin());

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const CALENDAR_URL = 'https://www.forexfactory.com/calendar?week=this';

if (!DISCORD_WEBHOOK_URL) {
  console.error('Missing DISCORD_WEBHOOK_URL');
  process.exit(1);
}

async function gotoWithRetry(page, url, maxAttempts = 3) {
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Attempt ${attempt} of ${maxAttempts}...`);

      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 90000,
      });

      // Wait for calendar rows to actually appear in the DOM
      await page.waitForFunction(
        () => document.querySelectorAll('tr.calendar__row').length > 20,
        { timeout: 30000 }
      );

      const count = await page.locator('tr.calendar__row').count();
      console.log(`Found ${count} calendar rows`);

      return;
    } catch (err) {
      lastErr = err;
      console.warn(`Attempt ${attempt} failed: ${err.message}`);

      try {
        await page.screenshot({ path: `debug-attempt-${attempt}.png`, fullPage: true });
        fs.writeFileSync(`debug-attempt-${attempt}.html`, await page.content());
      } catch (debugErr) {
        console.error(`Failed to save debug files: ${debugErr.message}`);
      }

      if (attempt < maxAttempts) {
        await page.waitForTimeout(5000);
      }
    }
  }

  throw lastErr;
}

function formatPHT(dateStr, timeStr) {
  try {
    const currentYear = new Date().getFullYear();

    if (
      !dateStr ||
      !timeStr ||
      timeStr.toLowerCase().includes('all day') ||
      timeStr.toLowerCase().includes('tentative')
    ) {
      return `${dateStr} ${timeStr}`;
    }

    const parsed = new Date(`${dateStr} ${currentYear} ${timeStr} GMT-4`);

    return parsed.toLocaleString('en-PH', {
      timeZone: 'Asia/Manila',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return `${dateStr} ${timeStr}`;
  }
}

async function sendToDiscord(events) {
  const fetch = (await import('node-fetch')).default;

  const high = [];
  const medium = [];

  for (const e of events) {
    const when = formatPHT(e.date, e.time);
    const line = `📅 ${when}\n📊 ${e.event}`;

    if (e.impact === 'High') {
      high.push(line);
    } else if (e.impact === 'Medium') {
      medium.push(line);
    }
  }

  const embed = {
    title: '🇺🇸 USD Economic Calendar (Philippine Time)',
    description: 'Important USD news events for the week. All times shown in PHT (GMT+8).',
    color: 0xf1c40f,
    fields: [
      {
        name: '🔴 High Impact',
        value: high.length ? high.join('\n\n').slice(0, 1024) : 'No high impact events',
      },
      {
        name: '🟠 Medium Impact',
        value: medium.length ? medium.join('\n\n').slice(0, 1024) : 'No medium impact events',
      },
    ],
    footer: {
      text: 'ForexFactory • Times converted to Philippine Time',
    },
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} ${text}`);
  }
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  try {
    console.log('Opening ForexFactory...');

    await gotoWithRetry(page, CALENDAR_URL);
    await page.waitForTimeout(3000);

    const events = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tr.calendar__row')];
      const results = [];
      let currentDate = '';

      for (const row of rows) {
        const currency =
          row.querySelector('.calendar__currency')?.textContent?.trim() || '';

        if (currency !== 'USD') continue;

        const dateCell =
          row.querySelector('.calendar__date')?.textContent?.trim() || '';

        if (dateCell) {
          currentDate = dateCell;
        }

        const time =
          row.querySelector('.calendar__time')?.textContent?.trim() || '';

        const event =
          row.querySelector('.calendar__event-title')?.textContent?.trim() ||
          row.querySelector('.calendar__event')?.textContent?.trim() ||
          '';

        let impact = 'Low';
        const impactHtml =
          row.querySelector('.calendar__impact')?.innerHTML || '';

        if (impactHtml.toLowerCase().includes('high')) {
          impact = 'High';
        } else if (impactHtml.toLowerCase().includes('medium')) {
          impact = 'Medium';
        }

        results.push({ date: currentDate, time, event, impact });
      }

      return results;
    });

    console.log(`Found ${events.length} USD events`);

    if (!events.length) {
      throw new Error('No USD events found. Check debug screenshot and HTML.');
    }

    await sendToDiscord(events);
    console.log('Posted to Discord');
  } catch (err) {
    console.error(err);

    try {
      await page.screenshot({ path: 'fatal-error.png', fullPage: true });
      fs.writeFileSync('fatal-error.html', await page.content());
      console.log('Saved fatal-error.png and fatal-error.html');
    } catch (debugErr) {
      console.error(debugErr);
    }

    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
