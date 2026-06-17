```javascript
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

async function run() {
  const browser = await chromium.launch({
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1400, height: 1200 },
  });

  try {
    console.log('Opening ForexFactory...');

    await page.goto(CALENDAR_URL, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

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

    console.log(`Found ${events.length} USD events`);

    await sendToDiscord(events);

    console.log('Posted to Discord');
  } catch (err) {
    console.error(err);
    process.exitCode = 1;
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

run();
```
