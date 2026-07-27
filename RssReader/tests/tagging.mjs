import { chromium } from 'playwright';
const URL='http://127.0.0.1:8080/';
const R=(n,ok,d)=>console.log(`${ok?'PASS':'FAIL'}  ${n}${d?' — '+d:''}`);
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport:{width:1680,height:1000} });
await p.goto(URL,{waitUntil:'networkidle'}); await p.waitForTimeout(5000);

// an article with no tags at all
const row = p.locator('.fl-row').filter({ hasNot: p.locator('.fl-tag') }).first();
const title = (await row.locator('.fl-row-title').innerText()).trim();
const find = () => p.locator('.fl-row').filter({ hasText: title }).first();
const tagsOf = async () => (await find().locator('.fl-tag').allInnerTexts()).map(t=>t.trim().replace(/\s*×$/,''));
R('tagging: starting article has no tags', (await tagsOf()).length===0, `"${title.slice(0,40)}"`);

// attach an existing tag
await row.locator('.fl-tag-add').click(); await p.waitForTimeout(1800);
const opt = p.locator('.fl-taglist .fl-tagopt-label').first();
const name = (await opt.innerText()).trim();
await opt.click(); await p.waitForTimeout(1500);
// create a brand-new tag
const draft = p.locator('.fl-sheet-input input');
await draft.fill('probe-tag'); await draft.press('Tab'); await p.waitForTimeout(600);
await p.locator('.fl-sheet-input .fl-btn',{hasText:'Add'}).click(); await p.waitForTimeout(1800);
await p.locator('.fl-sheet-foot .fl-btn',{hasText:'Done'}).click(); await p.waitForTimeout(2500);

let t = await tagsOf();
R('tagging: existing tag attaches', t.includes(name), `[${t.join(', ')}]`);
R('tagging: new tag is created and attached', t.includes('probe-tag'), `[${t.join(', ')}]`);

// clicking the same option again should detach it
await find().locator('.fl-tag-add').click(); await p.waitForTimeout(1800);
await p.locator('.fl-taglist .fl-tagopt-label').filter({hasText:name}).first().click(); await p.waitForTimeout(1500);
await p.locator('.fl-sheet-foot .fl-btn',{hasText:'Done'}).click(); await p.waitForTimeout(2500);
t = await tagsOf();
R('tagging: clicking an attached tag detaches it', !t.includes(name) && t.includes('probe-tag'), `[${t.join(', ')}]`);

// the tag sheet's per-tag counts update
await find().locator('.fl-tag-add').click(); await p.waitForTimeout(1800);
const counts = await p.locator('.fl-tagopt-count').allInnerTexts();
R('tagging: tag sheet shows per-tag counts', counts.some(c=>/\d+ tagged/.test(c)), counts.slice(0,4).join(' | '));
await p.screenshot({path:'shots/23-tagsheet.png'});
await p.locator('.fl-sheet-foot .fl-btn',{hasText:'Done'}).click(); await p.waitForTimeout(1500);
await b.close();
