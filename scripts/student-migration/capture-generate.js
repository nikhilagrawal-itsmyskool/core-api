/** Capture the FULL generateReport POST body for report 84, then replay it via in-page fetch
 * with studentStatus forced to each value, counting rows + statuses — to find how to get
 * ALL students (active+inactive+withdrawn), not just the saved report's active-only set. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://dbpasn.schoolpad.in';
const URL = BASE + '/studentReport/display';
const USER_DATA = path.join(__dirname, '..', 'exam-migration', '.browser');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const ctx = await chromium.launchPersistentContext(USER_DATA, { headless: false, channel: 'chrome', viewport: null, acceptDownloads: true, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  let fullBody = null;
  page.on('request', (r) => { if (r.method() === 'POST' && /generateReport/i.test(r.url())) fullBody = r.postData() || ''; });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 90; i++) { if (await page.evaluate(() => !!document.querySelector('select[name=sessionHeader]')).catch(() => false)) break; await page.waitForTimeout(2000); }
  await page.evaluate(() => { const el = document.querySelector('select[name=sessionHeader]'); el.value = '12'; el.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(el).trigger('change'); });
  await page.waitForTimeout(2500);
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(2000);
  await page.evaluate(() => { const s = document.querySelector('select[name=txtReportName]'); s.value = '84'; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=button],a')].find((x) => /select\s*classes/i.test((x.value || x.textContent || ''))); if (b) b.click(); });
  await page.waitForFunction(() => !!document.querySelector('select[name=studentStatus]'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const set = (n, v) => { const s = document.querySelector(`select[name="${n}"]`); if (s) { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); } };
    set('studentType', '2'); set('studentStatus', '5');
    const sel = document.querySelector('select[name="findClassFilterNew[]"]'); if (sel) { for (const o of sel.options) o.selected = true; sel.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(sel).trigger('change'); }
  });
  await page.waitForTimeout(800);

  // trigger Excel to force a generateReport POST (download captured but we only want the body)
  const dlPromise = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=button],input[type=submit],a')].find((x) => /^\s*excel\s*$/i.test((x.value || x.textContent || ''))); if (b) b.click(); });
  await dlPromise;

  fs.writeFileSync(path.join(OUT, 'generate-body.txt'), fullBody || '(none captured)');
  console.log('full generateReport body length:', fullBody ? fullBody.length : 0);
  // show the non-class params (studentType/studentStatus etc.)
  if (fullBody) {
    const pairs = fullBody.split('&').map((p) => p.split('=')).map(([k, v]) => [decodeURIComponent(k), decodeURIComponent(v || '')]);
    const nonClass = pairs.filter(([k]) => !/classSelectedValues/i.test(k));
    console.log('\nnon-class params (' + nonClass.length + '):');
    for (const [k, v] of nonClass) console.log(`  ${k} = ${v}`);
    console.log('\nclassSelectedValues count:', pairs.filter(([k]) => /classSelectedValues/i.test(k)).length);
  }

  // Now replay generateReport via in-page fetch, overriding studentStatus, and count statuses
  async function replay(statusVal) {
    const body = (fullBody || '').split('&').map((p) => {
      const [k] = p.split('=');
      if (decodeURIComponent(k) === 'studentStatus') return 'studentStatus=' + statusVal;
      if (decodeURIComponent(k) === 'studentType') return 'studentType=2';
      return p;
    });
    // ensure studentStatus present
    if (!body.some((p) => /^studentStatus=/.test(p))) body.push('studentStatus=' + statusVal);
    const res = await page.evaluate(async ({ base, b }) => {
      const r = await fetch(base + '/studentReport/generateReport', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body: b });
      const t = await r.text();
      return { len: t.length, head: t.slice(0, 200) };
    }, { base: BASE, b: body.join('&') });
    return res;
  }
  for (const sv of ['5', '1', '6', '7', '3']) {
    const r = await replay(sv);
    const admCount = (r.head.match(/2K\d{2}/g) || []).length;
    console.log(`\nreplay studentStatus=${sv}: respLen=${r.len}`);
  }

  console.log('\n(browser open 10s)');
  await page.waitForTimeout(10000);
  await ctx.close();
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
