import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';
import { basename } from 'path';

const APP = 'http://127.0.0.1:8080/';
const OUT = process.env.FL_OUT || '../docs/screenshots';
const FONTS = process.env.FL_FONTS || '/tmp/feedline-fonts';

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();

// Chromium has no outbound network in this sandbox, but curl does — so the
// IBM Plex files were fetched ahead of time and are served from disk here.
// Without this the screenshots fall back to system fonts.
await page.route('https://fonts.googleapis.com/**', (route) =>
  route.fulfill({ contentType: 'text/css', body: readFileSync(`${FONTS}/fonts.css`, 'utf8') }));
await page.route('https://fonts.gstatic.com/**', (route) => {
  const f = `${FONTS}/${basename(new URL(route.request().url()).pathname)}`;
  return existsSync(f)
    ? route.fulfill({ contentType: 'font/woff2', body: readFileSync(f) })
    : route.abort();
});

const settle = (ms = 1500) => page.waitForTimeout(ms);
const shot = async (name, clip) => {
  await page.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) });
  console.log('wrote', name);
};
const navrow = (l) => page.locator('.fl-navrow', { hasText: l });

await page.goto(APP, { waitUntil: 'networkidle', timeout: 90000 });
await page.evaluate(() => document.fonts.ready);
await settle(4000);

// --- stage some state so the counters and row states are not all identical ---
const rows = () => page.locator('.fl-row');
for (const i of [3, 6, 9]) { await rows().nth(i).click(); await settle(900); }   // read
await rows().nth(1).locator('.fl-iconbtn').first().click(); await settle(900);   // starred
await rows().nth(4).locator('.fl-iconbtn').first().click(); await settle(900);   // starred
await rows().nth(2).locator('.fl-iconbtn').nth(1).click();  await settle(900);   // read later

// hero: a seeded article, which has real body paragraphs rather than a stub
const hero = rows().filter({ hasText: 'The tag is the interface' }).first();
if (await hero.count()) { await hero.click(); } else { await rows().first().click(); }
await settle(2500);
await shot('01-reader');

// --- add feed, validated against a real feed --------------------------------
await page.locator('.fl-btn', { hasText: 'Add feed' }).first().click();
await settle(1500);
const url = page.locator('.fl-url-input input');
await url.fill('https://lobste.rs/rss');
await url.press('Tab');
await settle(600);
await page.locator('.fl-btn', { hasText: 'Validate feed' }).click();
await settle(9000);
await shot('03-add-feed');

// the failure path, which is the part worth showing
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await settle(4000);
await page.locator('.fl-btn', { hasText: 'Add feed' }).first().click();
await settle(1500);
await page.locator('.fl-url-input input').fill('https://blog.mendix.com/feed/');
await page.locator('.fl-url-input input').press('Tab');
await settle(600);
await page.locator('.fl-btn', { hasText: 'Validate feed' }).click();
await settle(9000);
await shot('04-add-feed-error');
await page.reload({ waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await settle(4000);

// --- manage feeds -----------------------------------------------------------
await page.locator('.fl-manage', { hasText: 'Manage feeds' }).click();
await settle(2500);
await shot('05-manage');
await page.locator('.fl-sheet-foot .fl-btn', { hasText: 'Close' }).click();
await settle(1500);

// --- tag sheet --------------------------------------------------------------
await rows().first().click();
await settle(1200);
await rows().first().locator('.fl-tag-add').click();
await settle(2500);
await shot('06-tag-sheet');
await page.locator('.fl-sheet-foot .fl-btn', { hasText: 'Done' }).click();
await settle(1500);

// --- a filtered view --------------------------------------------------------
await navrow('Starred').click();
await settle(2000);
await shot('02-starred');

await browser.close();
