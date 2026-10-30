/**
 * Driver probe: take ONE session through the studentReport flow end-to-end and learn the
 * generate/Excel-export mechanism, so extract-students.js can generalise to all 6 sessions.
 *
 * Flow discovered from the UI:
 *   Step 1: pick Saved Report (txtReportName = 84 "data-sync-detalied-report")
 *           -> click "Select Classes"  (expands the criteria form + column checkboxes)
 *   Step 2: set studentType=2 (All Students), studentStatus=5 (All Students), select all classes
 *           -> click "Excel"  (download)
 *
 * We DON'T assume the export endpoint — we drive the real buttons and capture whatever happens
 * (download event OR a new-tab HTML table), logging all POSTs so we can see the mechanism.
 *
 * USAGE  node scripts/student-migration/drive-one.js [--sid 12]
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://dbpasn.schoolpad.in';
const URL = BASE + '/studentReport/display';
const USER_DATA = path.join(__dirname, '..', 'exam-migration', '.browser');
const OUT = path.join(__dirname, 'out');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : process.argv[i + 1]; };
const SID = String(arg('sid', '12'));
const SAVED_REPORT = '84'; // data-sync-detalied-report
fs.mkdirSync(OUT, { recursive: true });

const dump = (o) => JSON.stringify(o);

(async () => {
  const ctx = await chromium.launchPersistentContext(USER_DATA, {
    headless: false, channel: 'chrome', viewport: null, acceptDownloads: true,
    ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const posts = [];
  page.on('request', (r) => { if (r.method() === 'POST' && /studentReport/i.test(r.url())) posts.push({ u: r.url().replace(BASE, ''), body: (r.postData() || '').slice(0, 500) }); });

  // --- login / land on report ---
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => !!document.querySelector('select[name=sessionHeader]')).catch(() => false)) break;
    if (i === 0) console.log('\n  >>> Log in (Turnstile) if prompted...\n');
    await page.waitForTimeout(2000);
  }
  if (!/studentReport/i.test(page.url())) { await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(3000); }

  // --- set session ---
  await page.evaluate((s) => { const el = document.querySelector('select[name=sessionHeader]'); el.value = s; el.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(el).trigger('change'); }, SID);
  await page.waitForTimeout(2500);
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2500);
  console.log('session set to', SID, '| url', page.url());

  // --- Step 1: select saved report ---
  const hasReport = await page.evaluate((rid) => {
    const s = document.querySelector('select[name=txtReportName]');
    if (!s) return false;
    const has = [...s.options].some((o) => o.value === rid);
    if (has) { s.value = rid; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); }
    return has;
  }, SAVED_REPORT);
  console.log('saved report', SAVED_REPORT, 'present & selected:', hasReport);
  await page.waitForTimeout(2000);

  // --- click "Select Classes" ---
  const clickedSelectClasses = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button,input[type=button],a')].find((b) => /select\s*classes/i.test((b.value || b.textContent || '')));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log('clicked Select Classes:', clickedSelectClasses);
  await page.waitForTimeout(3000);

  // --- Step 2: set filters ---
  const filterSet = await page.evaluate(() => {
    const out = {};
    const setSel = (name, val) => { const s = document.querySelector(`select[name="${name}"]`); if (s) { s.value = val; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); out[name] = s.value; } else out[name] = 'MISSING'; };
    setSel('studentType', '2');     // All Students
    setSel('studentStatus', '5');   // All Students (active+inactive+withdrawn)
    return out;
  });
  console.log('filters set:', dump(filterSet));
  await page.waitForTimeout(1000);

  // --- select all classes (the class multiselect "Select all") ---
  const classPick = await page.evaluate(() => {
    // the class filter is findClassFilterNew[]; its multiselect has a "Select all" option
    const sel = document.querySelector('select[name="findClassFilterNew[]"]');
    let n = 0;
    if (sel) { for (const o of sel.options) { o.selected = true; n++; } sel.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(sel).trigger('change'); }
    // also try clicking a visible "Select all" checkbox in the first multiselect dropdown
    const selAll = [...document.querySelectorAll('.multiselect-all input, input.multiselect-all')][0];
    if (selAll && !selAll.checked) { selAll.click(); }
    return { classOptions: sel ? sel.options.length : 'no-select', selectedNow: sel ? [...sel.options].filter((o) => o.selected).length : 0 };
  });
  console.log('class pick:', dump(classPick));
  await page.waitForTimeout(1000);

  // --- snapshot the criteria form controls now visible ---
  const snap = await page.evaluate(() => {
    const sel = (n) => { const s = document.querySelector(`select[name="${n}"]`); return s ? { val: s.value, n: s.options.length } : null; };
    const btns = [...document.querySelectorAll('button,input[type=button],input[type=submit]')].map((b) => (b.value || b.textContent || '').trim()).filter((t) => /excel|print|generate|submit|show|search|report/i.test(t));
    return { studentType: sel('studentType'), studentStatus: sel('studentStatus'), buttons: btns };
  });
  console.log('criteria snapshot:', dump(snap));

  // --- click Excel, capture download OR popup ---
  console.log('\nclicking Excel...');
  let saved = null;
  const dlPromise = page.waitForEvent('download', { timeout: 45000 }).catch(() => null);
  const popupPromise = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button,input[type=button],input[type=submit],a')].find((b) => /^\s*excel\s*$/i.test((b.value || b.textContent || '')));
    if (btn) btn.click();
  });
  const dl = await dlPromise;
  if (dl) {
    const fn = path.join(OUT, `students-${SID}.xls`);
    await dl.saveAs(fn);
    saved = fn;
    console.log('download saved ->', fn, '| suggested:', dl.suggestedFilename());
  } else {
    console.log('no download event. checking popup/new tab...');
    const pop = await popupPromise;
    if (pop) {
      await pop.waitForLoadState('domcontentloaded').catch(() => {});
      const html = await pop.content();
      const fn = path.join(OUT, `students-${SID}-popup.html`);
      fs.writeFileSync(fn, html);
      saved = fn;
      console.log('popup HTML saved ->', fn, '| rows:', (html.match(/<tr/gi) || []).length);
    }
  }

  console.log('\n--- studentReport POSTs seen ---');
  for (const p of posts) console.log(`  ${p.u}\n    ${p.body}`);
  console.log('\nsaved:', saved);
  console.log('\n(browser open 20s)');
  await page.waitForTimeout(20000);
  await ctx.close();
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
