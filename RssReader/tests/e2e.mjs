import { chromium } from 'playwright';

const URL = 'http://127.0.0.1:8080/';
const results = [];
let page, browser;

function rec(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function settle(ms = 1200) {
  await page.waitForTimeout(ms);
}

// Mendix renders listview rows as <li>; a "row" here is the styled container.
const rows = () => page.locator('.fl-row');
const navrow = (label) => page.locator('.fl-navrow', { hasText: label });

async function shot(name) {
  await page.screenshot({ path: `shots/${name}.png`, fullPage: false });
}

async function main() {
  // The installed playwright wants a newer browser build than the image ships;
  // point it at the pre-installed Chromium instead of downloading one.
  browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const ctx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  page = await ctx.newPage();
  const clientErrors = [];
  page.on('pageerror', (e) => clientErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') clientErrors.push(m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 90000 });
  await settle(4000);

  // ---- 1. shell renders -----------------------------------------------
  {
    const panes = await Promise.all([
      page.locator('.fl-sidebar').count(),
      page.locator('.fl-list-pane').count(),
      page.locator('.fl-detail').count(),
    ]);
    rec('shell: three panes render', panes.every((n) => n === 1), `sidebar/list/detail = ${panes.join('/')}`);
    await shot('01-initial');
  }

  // ---- 2. smart views --------------------------------------------------
  const countOf = async (label) =>
    parseInt((await navrow(label).locator('.fl-navrow-count').innerText()).trim() || '0', 10);

  const allCount = await countOf('All articles');
  const unreadCount = await countOf('Unread');
  rec('sidebar: counts populated', allCount > 0, `All=${allCount} Unread=${unreadCount}`);

  const initialRows = await rows().count();
  rec('list: articles render', initialRows > 0, `${initialRows} rows`);

  const PAGE = 20;  // Mendix listview page size; 'Load more' pages in the rest
  for (const [label, expect] of [['Unread', unreadCount], ['Starred', null], ['Read later', null], ['All articles', allCount]]) {
    await navrow(label).click();
    await settle();
    const n = await rows().count();
    const on = await navrow(label).evaluate((el) => el.className.includes('is-on'));
    const title = await page.locator('.fl-list-title').innerText();
    const ok = on && (expect === null || n === Math.min(expect, PAGE));
    rec(`view: ${label}`, ok, `title="${title}" rows=${n}${expect !== null ? ` expected=${expect}` : ''} active=${on}`);
  }

  // ---- 3. source-tag chips --------------------------------------------
  {
    const chips = page.locator('.fl-tagbar-chips .fl-chip');
    const nChips = await chips.count();
    const feedsBefore = await page.locator('.fl-feedrow').count();
    await chips.nth(1).click();
    await settle();
    const feedsAfter = await page.locator('.fl-feedrow').count();
    const chipOn = await chips.nth(1).evaluate((el) => el.className.includes('is-on'));
    rec('sidebar: source-tag chip filters feeds', chipOn && feedsAfter < feedsBefore && feedsAfter > 0,
      `${nChips} chips; feeds ${feedsBefore} -> ${feedsAfter}; chip active=${chipOn}`);
    await chips.nth(0).click();
    await settle();
    const restored = await page.locator('.fl-feedrow').count();
    rec('sidebar: "All" chip clears the filter', restored === feedsBefore, `feeds back to ${restored}`);
  }

  // ---- 4. feed selection ----------------------------------------------
  {
    const feed = page.locator('.fl-feedrow').first();
    const feedName = (await feed.locator('.fl-feedrow-name').innerText()).trim();
    await feed.click();
    await settle();
    const title = (await page.locator('.fl-list-title').innerText()).trim();
    const n = await rows().count();
    const srcNames = await page.locator('.fl-row-src').allInnerTexts();
    const allSame = srcNames.length > 0 && srcNames.every((s) => s.trim() === feedName);
    rec('sidebar: selecting a feed filters the list', title.includes(feedName) && allSame,
      `feed="${feedName}" title="${title}" rows=${n} allRowsFromFeed=${allSame}`);
    await shot('02-feed-selected');
    await navrow('All articles').click();
    await settle();
  }

  // ---- 5. search -------------------------------------------------------
  {
    const box = page.locator('.fl-search input');
    await box.fill('the');
    await box.press('Tab');
    await settle(1600);
    const n = await rows().count();
    const title = (await page.locator('.fl-list-title').innerText()).trim();
    rec('search: query filters the list', n > 0, `"the" -> ${n} rows; title="${title}"`);
    await box.fill('');
    await box.press('Tab');
    await settle(1600);
    const back = await rows().count();
    rec('search: clearing restores the list', back === Math.min(allCount, 20), `${back} rows (first page of ${allCount})`);
  }

  // ---- 6. open an article ---------------------------------------------
  {
    const before = await countOf('Unread');
    const row = page.locator('.fl-row.is-unread').first();
    const rowTitle = (await row.locator('.fl-row-title').innerText()).trim();
    await row.click();
    await settle(1500);
    const detailTitle = (await page.locator('.fl-detail-title, .fl-article-title').first().innerText().catch(() => '')).trim();
    const after = await countOf('Unread');
    rec('article: click opens it in the detail pane', detailTitle === rowTitle,
      `row="${rowTitle.slice(0, 40)}" detail="${detailTitle.slice(0, 40)}"`);
    rec('article: opening marks it read', after === before - 1, `unread ${before} -> ${after}`);
    await shot('03-article-open');
  }

  // ---- 7. star ---------------------------------------------------------
  {
    const starredBefore = await countOf('Starred');
    await page.locator('.fl-detail-bar .fl-btn', { hasText: 'Star' }).first().click();
    await settle();
    const starredAfter = await countOf('Starred');
    const nowOn = await page.locator('.fl-detail-bar .fl-btn.is-on').count();
    rec('article: Star from the detail bar', starredAfter === starredBefore + 1 && nowOn > 0,
      `starred ${starredBefore} -> ${starredAfter}`);
    // and back off again — it is a toggle
    await page.locator('.fl-detail-bar .fl-btn', { hasText: 'Starred' }).first().click();
    await settle();
    rec('article: Star toggles back off', (await countOf('Starred')) === starredBefore, 'unstarred');
    await page.locator('.fl-detail-bar .fl-btn', { hasText: 'Star' }).first().click();
    await settle();

    await navrow('Starred').click();
    await settle();
    const n = await rows().count();
    rec('view: Starred lists the starred article', n === starredAfter, `${n} rows`);
    // leave it unstarred so the row-level toggle below starts from a known state
    await rows().first().click(); await settle();
    await page.locator('.fl-detail-bar .fl-btn', { hasText: 'Starred' }).first().click();
    await settle();
    await navrow('All articles').click();
    await settle();
  }

  // ---- 8. read later ---------------------------------------------------
  {
    const savedBefore = await countOf('Read later');
    await page.locator('.fl-detail-bar .fl-btn', { hasText: 'Read later' }).first().click();
    await settle();
    const savedAfter = await countOf('Read later');
    rec('article: Read later from the detail bar', savedAfter === savedBefore + 1,
      `saved ${savedBefore} -> ${savedAfter}`);
    await navrow('Read later').click();
    await settle();
    rec('view: Read later lists the saved article', (await rows().count()) === savedAfter);
    await navrow('All articles').click();
    await settle();
  }

  // ---- 9. row-level star / save toggles --------------------------------
  {
    const starredBefore = await countOf('Starred');
    const row = page.locator('.fl-row').filter({ has: page.locator('.fl-iconbtn:not(.is-on)') }).first();
    await row.locator('.fl-iconbtn').first().click();
    await settle();
    const starredAfter = await countOf('Starred');
    rec('list row: star toggle', starredAfter === starredBefore + 1, `starred ${starredBefore} -> ${starredAfter}`);
  }

  // ---- 10. tagging ------------------------------------------------------
  {
    const row = page.locator('.fl-row').filter({ hasNot: page.locator('.fl-tag') }).first();
    const rowTitle = (await row.locator('.fl-row-title').innerText()).trim();
    const tagsBefore = await row.locator('.fl-tag').count();
    await row.locator('.fl-tag-add').click();
    await settle(1500);
    const sheetOpen = await page.locator('.fl-sheet-head', { hasText: 'Tag article' }).count();
    rec('tagging: "＋ tag" opens the tag sheet', sheetOpen > 0);
    await shot('04-tag-sheet');

    // attach an existing tag
    const opt = page.locator('.fl-taglist .fl-tagopt-label').first();
    const tagName = (await opt.innerText()).trim();
    await opt.click();
    await settle(1200);

    // add a brand-new tag
    const draft = page.locator('.fl-sheet-input input');
    await draft.fill('e2e-check-run');
    await draft.press('Tab');
    await settle(600);
    await page.locator('.fl-sheet-input .fl-btn', { hasText: 'Add' }).click();
    await settle(1500);

    await page.locator('.fl-sheet-foot .fl-btn', { hasText: 'Done' }).click();
    await settle(1800);

    const rowAfter = page.locator('.fl-row').filter({ hasText: rowTitle }).first();
    const tagTexts = (await rowAfter.locator('.fl-tag').allInnerTexts()).map((t) => t.trim());
    rec('tagging: existing tag attaches to the article', tagTexts.includes(tagName),
      `tags now: [${tagTexts.join(', ')}] (was ${tagsBefore})`);
    rec('tagging: new tag is created and attached', tagTexts.some((t) => t.startsWith('e2e-check')),
      `tags now: [${tagTexts.join(', ')}]`);
    await shot('05-after-tagging');
  }

  // ---- 11. add feed -----------------------------------------------------
  {
    const feedsBefore = await page.locator('.fl-feedrow').count();
    await page.locator('.fl-btn', { hasText: 'Add feed' }).first().click();
    await settle(1500);
    const open = await page.locator('.fl-manage-title', { hasText: 'Add feed' }).count();
    rec('add feed: wizard opens', open > 0);
    await shot('06-add-feed-step1');

    const url = page.locator('.fl-url-input input');
    await url.fill('https://lobste.rs/rss');
    await url.press('Tab');
    await settle(600);
    await page.locator('.fl-btn', { hasText: 'Validate feed' }).click();
    await settle(2500);

    const stepTwo = await page.locator('.fl-detected').isVisible().catch(() => false);
    const detected = stepTwo ? (await page.locator('.fl-detected-text').innerText()).trim() : '';
    rec('add feed: validate advances to step 2', stepTwo, `detected="${detected}"`);
    await shot('07-add-feed-step2');

    if (stepTwo) {
      await page.locator('.fl-btn', { hasText: 'Add feed' }).last().click();
      await settle(2500);
      const feedsAfter = await page.locator('.fl-feedrow').count();
      rec('add feed: new feed appears in the sidebar', feedsAfter === feedsBefore + 1,
        `feeds ${feedsBefore} -> ${feedsAfter}`);
      await shot('08-after-add-feed');
    } else {
      rec('add feed: new feed appears in the sidebar', false, 'blocked — never reached step 2');
    }
  }

  // ---- 12. manage feeds sheet -------------------------------------------
  {
    await page.locator('.fl-manage', { hasText: 'Manage feeds' }).click();
    await settle(1800);
    const open = await page.locator('.fl-manage-title', { hasText: 'Manage feeds & tags' }).count();
    const gridRows = await page.locator('.fl-grid-row').count();
    const headers = (await page.locator('.fl-grid-head > *').allInnerTexts()).map((t) => t.trim());
    rec('manage sheet: opens and lists every feed', open > 0 && gridRows > 0,
      `${gridRows} rows; columns=[${headers.join(', ')}]`);
    await shot('09-manage');
    await page.locator('.fl-sheet-foot .fl-btn', { hasText: 'Close' }).click();
    await settle(1500);
  }

  // ---- 13. shortcuts sheet ----------------------------------------------
  {
    await page.locator('.fl-btn--icon', { hasText: '?' }).click();
    await settle(1200);
    const keys = await page.locator('.fl-shortcut').count();
    rec('shortcuts sheet: opens with the key map', keys === 8, `${keys} shortcuts listed`);
    await page.locator('.fl-sheet-foot .fl-btn', { hasText: 'Close' }).click();
    await settle(1200);
  }

  // ---- 14. mark all read -------------------------------------------------
  {
    await page.locator('.fl-btn', { hasText: 'Mark all read' }).click();
    await settle(2500);
    const unread = await countOf('Unread');
    rec('list: Mark all read clears the unread count', unread === 0, `unread=${unread}`);
  }

  // ---- 15. refresh -------------------------------------------------------
  {
    const before = await countOf('All articles');
    await page.locator('.fl-btn', { hasText: 'Refresh' }).first().click();
    await settle(3000);
    // the fetch walks 10+ feeds over the network; give it room
    for (let i = 0; i < 40; i++) {
      const label = await page.locator('.fl-refresh-value').innerText().catch(() => '');
      if (/just now|ago|feeds/.test(label)) break;
      await settle(3000);
    }
    await settle(3000);
    const after = await countOf('All articles');
    const label = (await page.locator('.fl-refresh-value').innerText().catch(() => '')).trim();
    rec('refresh: fetch completes and reports', label.length > 0, `articles ${before} -> ${after}; last refresh="${label}"`);
    await shot('10-after-refresh');
  }

  // ---- 16. open original -------------------------------------------------
  {
    await navrow('All articles').click();
    await settle(1500);
    // Only fetched articles carry a Link; the seeded demo rows do not.
    // Intercept the outbound navigation rather than following it: most article
    // hosts are unreachable from this sandbox, and what matters is that the
    // right URL is requested, not that it loads.
    let requested = null;
    await page.route('**/*', (route) => {
      const u = route.request().url();
      if (!u.startsWith(URL) && route.request().isNavigationRequest()) {
        requested = u;
        return route.abort();
      }
      return route.continue();
    });
    for (let i = 0; i < 8 && !requested; i++) {
      await rows().nth(i).click();
      await settle(1200);
      const btn = page.locator('.fl-detail-bar .fl-btn', { hasText: 'Open original' });
      if (!(await btn.count())) continue;
      await btn.first().click().catch(() => {});
      await settle(2500);
    }
    await page.unroute('**/*');
    rec('detail: "Open original" opens the article URL', !!requested,
      requested ? `requested ${requested} (same tab — replaces the app)` : 'no row produced an external URL');
  }

  // ---- client-side errors --------------------------------------------------
  const realErrors = clientErrors.filter((e) => !/favicon|\.env|404|Failed to load resource/i.test(e));
  rec('no client-side JS errors', realErrors.length === 0,
    realErrors.length ? realErrors.slice(0, 3).join(' | ') : 'clean');

  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n===== ${results.length - failed.length}/${results.length} passed =====`);
  if (failed.length) {
    console.log('FAILURES:');
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail || ''}`);
  }
}

main().catch(async (e) => {
  console.error('HARNESS ERROR:', e.message);
  try { await page.screenshot({ path: 'shots/harness-error.png' }); } catch {}
  try { await browser.close(); } catch {}
  process.exit(1);
});
