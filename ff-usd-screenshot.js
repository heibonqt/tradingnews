/**
 * ForexFactory USD Weekly News -> Discord Embed Bot
 * Playwright + Discord Webhook
 */

const { chromium } = require('playwright');
const fs = require('fs');
require('dotenv').config();

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
        waitUntil: 'networkidle',
        timeout: 60000,
      });

      await page.waitForFunction(
        () => {
          return document.querySelectorAll('tr.calendar__row').length > 20;
        },
        { timeout: 30000 }
      );

      const count = await page.locator('tr.calendar__row').count();
      console.log(`Found ${count} calendar rows`);

      return;
    } catch (err) {
      lastErr = err;

      console.warn(`Attempt ${attempt} failed: ${err.message}`);

      try {
        await page.screenshot({
          path: `debug-attempt-${attempt}.png`,
          fullPage: true,
        });

        fs.writeFileSync(
          `debug-attempt-${attempt}.html`,
          await page.content()
        );
      } catch (debugErr) {
        console.error(
          `Failed to save debug files: ${debugErr.message}`
        );
      }

      if (attempt < maxAttempts) {
        await page.waitForTimeout(5000);
      }
    }
  }

  throw lastErr;
}

async function sendToDiscord(events) {
  const fetch = (await import('node-fetch')).default;

  const high = [];
  const medium = [];
  const low = [];

  for (const e of events) {
    const line = `${e.date} ${e.time} — ${e.event}`;

    if (e.impact === 'High') {
      high.push(line);
    } else if (e.impact === 'Medium') {
      medium.push(line);
    } else {
      low.push(line);
    }
  }

  const embed = {
    title: '📅 USD News This Week',
    description:
      'ForexFactory weekly USD economic calendar summary',
    color: 0xf1c40f,
    fields: [
      {
        name: '🔴 High Impact',
        value: high.length
          ? high.slice(0, 20).join('\n')
          : 'No high impact events',
      },
      {
        name: '🟠 Medium Impact',
        value: medium.length
          ? medium.slice(0, 20).join('\n')
          : 'No medium impact events',
      },
      {
        name: '🟡 Low Impact',
        value: low.length
          ? low.slice(0, 20).join('\n')
          : 'No low impact events',
      },
    ],
    footer: {
      text: 'ForexFactory USD Weekly Calendar',
    },
    timestamp: new Date().toISOString(),
  };

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      embeds: [embed],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Discord webhook failed: ${response.status} ${text}`
    );
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
    viewport: {
      width: 1920,
      height: 1080,
    },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  try {
    console.log('Opening ForexFactory...');

    await gotoWithRetry(page, CALENDAR_URL);

    await page.waitForTimeout(5000);

    const events = await page.evaluate(() => {
      const rows = [
        ...document.querySelectorAll('tr.calendar__row'),
      ];

      const results = [];

      let currentDate = '';

      for (const row of rows) {
        const currency =
          row
            .querySelector('.calendar__currency')
            ?.textContent?.trim() || '';

        if (currency !== 'USD') continue;

        const dateCell =
          row
            .querySelector('.calendar__date')
            ?.textContent?.trim() || '';

        if (dateCell) {
          currentDate = dateCell;
        }

        const time =
          row
            .querySelector('.calendar__time')
            ?.textContent?.trim() || '';

        const event =
          row
            .querySelector('.calendar__event-title')
            ?.textContent?.trim() ||
          row
            .querySelector('.calendar__event')
            ?.textContent?.trim() ||
          '';

        let impact = 'Low';

        const impactHtml =
          row.querySelector('.calendar__impact')
            ?.innerHTML || '';

        if (
          impactHtml.toLowerCase().includes('high')
        ) {
          impact = 'High';
        } else if (
          impactHtml.toLowerCase().includes('medium')
        ) {
          impact = 'Medium';
        }

        results.push({
          date: currentDate,
          time,
          event,
          impact,
        });
      }

      return results;
    });

    console.log(`Found ${events.length} USD events`);

    if (!events.length) {
      throw new Error(
        'No USD events found. Check debug screenshot and HTML.'
      );
    }

    await sendToDiscord(events);

    console.log('Posted to Discord');
  } catch (err) {
    console.error(err);

    try {
      await page.screenshot({
        path: 'fatal-error.png',
        fullPage: true,
      });

      fs.writeFileSync(
        'fatal-error.html',
        await page.content()
      );

      console.log(
        'Saved fatal-error.png and fatal-error.html'
      );
    } catch (debugErr) {
      console.error(debugErr);
    }

    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
