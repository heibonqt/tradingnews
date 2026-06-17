/**
 * ForexFactory USD Weekly News -> Discord Embed Bot
 */
const { chromium } = require('playwright');
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
      console.log("Attempt " + attempt + " of " + maxAttempts + "...");
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      // Give the page a moment to render its dynamic content
      await page.waitForSelector('tr.calendar__row', { timeout: 20000 });
      return;
    } catch (err) {
      lastErr = err;
      console.warn(
        "Attempt " + attempt + " failed: " + err.message
      );
      if (attempt < maxAttempts) {
        await page.waitForTimeout(5000);
      }
    }
  }
  throw lastErr;
}

async function run() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = await browser.newPage({
    viewport: { width: 1400, height: 1200 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
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
      for (const row of rows) {
        const currency =
          row.querySelector('.calendar__currency')?.textContent?.trim() || '';
        if (currency !== 'USD') continue;
        const date =
          row.querySelector('.calendar__date')?.textContent?.trim() || '';
        const time =
          row.querySelector('.calendar__time')?.textContent?.trim() || '';
        const event =
          row.querySelector('.calendar__event-title')?.textContent?.trim() ||
          row.querySelector('.calendar__event')?.textContent?.trim() ||
          '';
        let impact = 'Low';
        const impactCell =
          row.querySelector('.calendar__impact')?.innerHTML || '';
        if (
          impactCell.includes('High') ||
          impactCell.includes('high')
        ) {
          impact = 'High';
        } else if (
          impactCell.includes('Medium') ||
          impactCell.includes('medium')
        ) {
          impact = 'Medium';
        }
        results.push({
          date,
          time,
          event,
          impact,
        });
      }
      return results;
    });
    console.log("Found " + events.length + " USD events");
    await sendToDiscord(events);
    console.log('Posted to Discord');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
    try {
      await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
      console.log('Saved debug-screenshot.png');
    } catch (shotErr) {
      console.error('Could not save debug screenshot: ' + shotErr.message);
    }
  } finally {
    await browser.close();
  }
}
async function sendToDiscord(events) {
  const fetch = (await import('node-fetch')).default;
  const high = [];
  const medium = [];
  const low = [];
  for (const e of events) {
    const line = e.date + " " + e.time + " \u2014 " + e.event;
    if (e.impact === 'High') {
      high.push(line);
    } else if (e.impact === 'Medium') {
      medium.push(line);
    } else {
      low.push(line);
    }
  }
  const embed = {
    title: '\ud83d\udcc5 USD News This Week',
    description:
      'ForexFactory weekly USD economic calendar summary',
    color: 0xf1c40f,
    fields: [
      {
        name: '\ud83d\udd34 High Impact',
        value: high.length
          ? high.slice(0, 20).join('\n')
          : 'No high impact events',
      },
      {
        name: '\ud83d\udfe0 Medium Impact',
        value: medium.length
          ? medium.slice(0, 20).join('\n')
          : 'No medium impact events',
      },
      {
        name: '\ud83d\udfe1 Low Impact',
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
      "Discord webhook failed: " + response.status + " " + text
    );
  }
}
run();
