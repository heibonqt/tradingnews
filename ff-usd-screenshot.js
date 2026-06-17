const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
require('dotenv').config();

chromium.use(StealthPlugin());

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const CALENDAR_URL = 'https://www.forexfactory.com/calendar?week=this';

if (!DISCORD_WEBHOOK_URL) {
  console.error('Missing DISCORD_WEBHOOK_URL');
  process.exit(1);
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
    viewport: { width: 1400, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  try {
    console.log('Opening ForexFactory...');

    await page.goto(CALENDAR_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 90000,
    });

    await page.waitForFunction(
      () => document.querySelectorAll('tr.calendar__row').length > 20,
      { timeout: 30000 }
    );

    await page.waitForTimeout(2000);

    const highImpactCount = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tr.calendar__row')];
      const keepRows = new Set();
      let lastDateRow = null;

      for (const row of rows) {
        // Track date rows regardless of currency
        const dateCell = row.querySelector('.calendar__date');
        if (dateCell && dateCell.textContent.trim().length > 1) {
          lastDateRow = row;
        }

        // Only care about USD
        const currency = row.querySelector('.calendar__currency')?.textContent?.trim();
        if (currency !== 'USD') continue;

        // Check impact via span title and className
        const impactSpan = row.querySelector('.calendar__impact span');
        const impactTitle = (impactSpan?.getAttribute('title') || '').toLowerCase();
        const impactClass = (impactSpan?.className || '').toLowerCase();

        const isHigh =
          impactTitle.includes('high') ||
          impactClass.includes('high');

        if (!isHigh) continue;

        keepRows.add(row);
        if (lastDateRow) keepRows.add(lastDateRow);
      }

      // Hide every row not in keepRows
      for (const row of rows) {
        if (!keepRows.has(row)) {
          row.style.display = 'none';
        }
      }

      // Hide all non-calendar UI clutter
      [
        '.site-header',
        '.site-nav',
        '.calendar__filters',
        '.calendar__toolbar',
        '.site-footer',
        '[class*="ad"]',
        '[id*="ad"]',
        '.promo',
        '.notice',
      ].forEach(sel =>
        document.querySelectorAll(sel).forEach(el => (el.style.display = 'none'))
      );

      return keepRows.size;
    });

    console.log(`Kept ${highImpactCount} rows (date headers + high impact USD events)`);

    if (highImpactCount === 0) {
      throw new Error('No high impact USD rows found. Check debug files.');
    }

    await page.waitForTimeout(500);

    const screenshotPath = 'high-impact-usd.png';

    const table = await page.$('.calendar__table, table.calendar, .calendar');
    if (!table) throw new Error('Calendar table element not found');

    await table.screenshot({ path: screenshotPath });
    console.log('Screenshot saved:', screenshotPath);

    await sendToDiscord(screenshotPath);
    console.log('Posted to Discord successfully');

  } catch (err) {
    console.error('Fatal error:', err);

    try {
      await page.screenshot({ path: 'fatal-error.png', fullPage: true });
      fs.writeFileSync('fatal-error.html', await page.content());
      console.log('Saved fatal-error.png and fatal-error.html');
    } catch (debugErr) {
      console.error('Failed to save debug files:', debugErr);
    }

    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function sendToDiscord(imagePath) {
  const fetch = (await import('node-fetch')).default;
  const FormData = (await import('form-data')).default;

  const form = new FormData();

  const payload = {
    embeds: [
      {
        title: '🇺🇸 USD High Impact News — This Week',
        description: 'All times shown in **ET (GMT-4)**. Convert to PHT: **add +12 hours**.',
        color: 0xe74c3c,
        image: { url: 'attachment://high-impact-usd.png' },
        footer: {
          text: 'ForexFactory • High Impact USD Events Only',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  form.append('payload_json', JSON.stringify(payload));
  form.append('file', fs.createReadStream(imagePath), {
    filename: 'high-impact-usd.png',
    contentType: 'image/png',
  });

  const response = await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} ${text}`);
  }
}

run();
