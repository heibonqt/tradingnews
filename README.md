# ForexFactory USD Weekly News → Discord Bot

Takes a screenshot of all **USD-related news for the current week** from
ForexFactory's calendar and posts it to a Discord channel via webhook,
every **Monday**.

---

## ⚠️ Important: you must test this locally first

ForexFactory's HTML/CSS structure can change without notice, and I (Claude)
could not load forexfactory.com from my own sandbox to verify selectors
against the live site. The script is built carefully against ForexFactory's
known calendar structure, but **you need to run it once locally with
`DEBUG=true` and visually confirm the cookie-banner and USD-filter steps
work**, before relying on the scheduled version. Instructions below.

---

## 1. Prerequisites

- [Node.js](https://nodejs.org/) v18 or newer installed
- A Discord server where you can create a webhook (need "Manage Webhooks"
  permission)

## 2. Get a Discord Webhook URL

1. In Discord, go to the channel you want the screenshot posted to.
2. Channel Settings → Integrations → Webhooks → **New Webhook**.
3. Name it (e.g. "ForexFactory Bot"), copy the **Webhook URL**.

## 3. Install

```bash
npm install
npx playwright install chromium
```

## 4. Configure

```bash
cp .env.example .env
```

Edit `.env` and paste your webhook URL:

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/xxxx/xxxx
```

## 5. Test locally (do this before scheduling!)

Run in debug mode first — this opens a visible browser window so you can
watch what happens and check whether the cookie banner / USD filter logic
actually matches the current site:

```bash
npm run debug
```

Watch for:
- Does a cookie banner appear, and does the script dismiss it correctly?
- Does the "Filters" panel open, and does it correctly select USD only?
- Does `usd-calendar.png` (saved in this folder) look right?

If the filter step fails, the script logs a warning and still takes a
screenshot — but it may show **all currencies**, not just USD. If that
happens:

1. Run `npm run debug` again, and when the browser pauses/opens, manually
   open dev tools (F12) on the live page.
2. Inspect the actual filter button / checkbox elements.
3. Update the selectors in `filterToUSD()` inside `ff-usd-screenshot.js` to
   match what you find — the function is heavily commented to make this
   easy.

Once it works visually, do a real test:

```bash
npm start
```

Check your Discord channel for the image.

## 6. Schedule it for every Monday

You have two easy options:

### Option A: GitHub Actions (free, no server needed)

1. Push this folder to a GitHub repo (can be private).
2. In the repo: Settings → Secrets and variables → Actions → **New repository secret**.
   - Name: `DISCORD_WEBHOOK_URL`
   - Value: your webhook URL
3. The included workflow at `.github/workflows/weekly-screenshot.yml` runs
   every Monday at 08:00 UTC automatically. Edit the `cron` line if you want
   a different time (use [crontab.guru](https://crontab.guru) to check).
4. You can also trigger it manually anytime via the "Actions" tab → select
   the workflow → "Run workflow".

### Option B: Your own machine / server / Raspberry Pi (cron)

```bash
crontab -e
```

Add (runs Monday at 8 AM server time):

```
0 8 * * 1 cd /full/path/to/ff-bot && /usr/bin/node ff-usd-screenshot.js >> bot.log 2>&1
```

## 7. Maintenance

ForexFactory occasionally changes its page layout. If the bot suddenly
stops filtering correctly or screenshots look wrong:

- Re-run `npm run debug` to see what changed.
- Check `debug-fullpage.png`, which is auto-saved if the script errors out
  partway through (also uploaded as a GitHub Actions artifact on failure).
- Update selectors in `filterToUSD()` and `dismissCookieBanner()`.

## Files

| File | Purpose |
|---|---|
| `ff-usd-screenshot.js` | Main bot script |
| `.env.example` | Template for your webhook URL secret |
| `.github/workflows/weekly-screenshot.yml` | Free weekly scheduler via GitHub Actions |
| `package.json` | Dependencies (Playwright, dotenv, etc.) |

## A note on terms of use

Automated, frequent scraping of ForexFactory may be against their Terms of
Service depending on volume/frequency. A once-a-week personal-use screenshot
is low-impact, but you're responsible for checking their current ToS and
using this respectfully (don't increase the frequency or share the scraped
output commercially).
