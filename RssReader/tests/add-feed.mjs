import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8080/';
const R = (n, ok, d) => console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`);

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1680, height: 1000 } });
await p.goto(URL, { waitUntil: 'networkidle' });
await p.waitForTimeout(5000);

const openWizard = async () => {
  if (!(await p.locator('.fl-manage-title', { hasText: 'Add feed' }).count())) {
    await p.locator('.fl-btn', { hasText: 'Add feed' }).first().click();
    await p.waitForTimeout(1500);
  }
};
const validate = async (url) => {
  await openWizard();
  const box = p.locator('.fl-url-input input');
  await box.fill(url);
  await box.press('Tab');
  await p.waitForTimeout(600);
  await p.locator('.fl-btn', { hasText: 'Validate feed' }).click();
  await p.waitForTimeout(9000);
  const err = (await p.locator('.fl-field-error').innerText().catch(() => '')).trim();
  const det = (await p.locator('.fl-detected-text').innerText().catch(() => '')).trim();
  return { err, det };
};

// --- 1. a URL that is NOT a feed (301 -> marketing page) --------------------
{
  const { err, det } = await validate('https://blog.mendix.com/feed/');
  R('add feed: a non-feed URL is rejected with a reason', err.length > 0 && det === '',
    `error="${err}" detected="${det}"`);
  await p.screenshot({ path: 'shots/20-validate-notafeed.png' });
}

// --- 2. an unreachable host -------------------------------------------------
{
  const { err, det } = await validate('https://this-host-does-not-exist-42.example/feed.xml');
  R('add feed: an unreachable host is rejected', err.length > 0 && det === '',
    `error="${err}"`);
}

// --- 3. a real feed ---------------------------------------------------------
const feedsBefore = await p.locator('.fl-feedrow').count();
{
  const { err, det } = await validate('https://www.smashingmagazine.com/feed/');
  R('add feed: a real feed validates with its own title and item count',
    err === '' && /·/.test(det) && !/24 items · updated 2h ago/.test(det), `detected="${det}"`);
  await p.screenshot({ path: 'shots/21-validate-real.png' });
}

// --- 4. duplicate detection -------------------------------------------------
{
  await p.locator('.fl-btn', { hasText: 'Add feed' }).last().click();
  await p.waitForTimeout(6000);
  const feedsAfter = await p.locator('.fl-feedrow').count();
  R('add feed: already-subscribed feed is not duplicated', feedsAfter === feedsBefore,
    `feeds ${feedsBefore} -> ${feedsAfter} (Smashing was already in the sidebar)`);
}

// --- 5. a genuinely new feed, fetched on confirm ----------------------------
{
  const before = await p.locator('.fl-feedrow').count();
  const { err, det } = await validate('https://lobste.rs/rss');
  R('add feed: new feed validates', err === '', `detected="${det}"`);
  if (!err) {
    await p.locator('.fl-btn', { hasText: 'Add feed' }).last().click();
    await p.waitForTimeout(12000);
    const after = await p.locator('.fl-feedrow').count();
    const names = await p.locator('.fl-feedrow-name').allInnerTexts();
    const added = names[names.length - 1].trim();
    const unread = await p.locator('.fl-feedrow').last().locator('.fl-feedrow-unread').innerText().catch(() => '0');
    R('add feed: new feed is named from its own <title>, not the URL',
      after === before + 1 && !added.startsWith('http'), `feeds ${before} -> ${after}, named "${added}"`);
    R('add feed: articles are fetched on confirm', parseInt(unread, 10) > 0,
      `${unread} unread on the new feed`);
    await p.screenshot({ path: 'shots/22-added.png' });
  }
}

// --- 6. entity decoding -----------------------------------------------------
{
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForTimeout(4000);
  const titles = await p.locator('.fl-row-title').allInnerTexts();
  const leaks = titles.filter((t) => /&#x?[0-9A-Fa-f]+;|&[a-z]+;/.test(t));
  R('fetch: no raw HTML entities leak into titles', leaks.length === 0,
    leaks.length ? leaks.slice(0, 3).join(' | ') : `${titles.length} titles clean`);
}

await b.close();
