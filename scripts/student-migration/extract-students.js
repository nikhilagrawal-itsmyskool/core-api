/**
 * Full student extractor — pulls SchoolPad studentReport for ALL students
 * (studentType=2 "All Students", studentStatus=5 "All Students" = active+inactive+withdrawn)
 * across ALL 6 sessions, using the saved "data-sync-detalied-report" template (reportId 84)
 * so the columns match what modules/data-sync/scripts/sync-students-full.js expects.
 *
 * Output: out/students-<year>.csv  (the raw studentReport export; gitignored PII)
 * Reuses the exam-migration persistent-Chrome profile (Turnstile solved once).
 * Resumable: skips a year whose file already exists unless --force.
 *
 * USAGE  node scripts/student-migration/extract-students.js [--sessions 7,8,9,10,11,12] [--force]
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'https://dbpasn.schoolpad.in';
const URL = BASE + '/studentReport/display';
const USER_DATA = path.join(__dirname, '..', 'exam-migration', '.browser');
const OUT = path.join(__dirname, 'out');
const YEARS = { 7: '2021-22', 8: '2022-23', 9: '2023-24', 10: '2024-25', 11: '2025-26', 12: '2026-27' };
const SAVED_REPORT = '84'; // data-sync-detalied-report
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
const SESSIONS = String(arg('sessions', '7,8,9,10,11,12')).split(',').map((s) => s.trim());
const FORCE = !!arg('force', false);
fs.mkdirSync(OUT, { recursive: true });

async function ensureLogin(page) {
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 90; i++) {
    if (await page.evaluate(() => !!document.querySelector('select[name=sessionHeader]')).catch(() => false)) return;
    if (i === 0) console.log('\n  >>> Log in (solve Turnstile) in the window. Waiting...\n');
    await page.waitForTimeout(2000);
  }
  throw new Error('not logged in');
}

async function extractSession(page, ctx, sid) {
  const year = YEARS[sid] || sid;
  const outFile = path.join(OUT, `students-${year}.csv`);
  if (!FORCE && fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
    console.log(`  ${year}: already have ${path.basename(outFile)} (skip; --force to redo)`);
    return { year, skipped: true };
  }

  // set session, reload so the report page picks it up
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForFunction(() => !!document.querySelector('select[name=sessionHeader]'), null, { timeout: 30000 }).catch(() => {});
  await page.evaluate((s) => { const el = document.querySelector('select[name=sessionHeader]'); el.value = s; el.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(el).trigger('change'); }, sid);
  await page.waitForTimeout(2500);
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(2000);

  // Step 1: select saved report
  const hasReport = await page.evaluate((rid) => {
    const s = document.querySelector('select[name=txtReportName]');
    if (!s || ![...s.options].some((o) => o.value === rid)) return false;
    s.value = rid; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change');
    return true;
  }, SAVED_REPORT);
  if (!hasReport) throw new Error(`saved report ${SAVED_REPORT} not available for session ${sid}`);
  await page.waitForTimeout(2000);

  // click "Select Classes"
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=button],a')].find((x) => /select\s*classes/i.test((x.value || x.textContent || ''))); if (b) b.click(); });
  // wait for the criteria form (studentStatus select) to appear
  await page.waitForFunction(() => !!document.querySelector('select[name=studentStatus]'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // Step 2: filters — All Students (type) + All Students (status)
  const filters = await page.evaluate(() => {
    const setSel = (name, val) => { const s = document.querySelector(`select[name="${name}"]`); if (!s) return 'MISSING'; s.value = val; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); return s.value; };
    return { studentType: setSel('studentType', '2'), studentStatus: setSel('studentStatus', '5') };
  });
  await page.waitForTimeout(800);

  // select all classes
  const cls = await page.evaluate(() => {
    const sel = document.querySelector('select[name="findClassFilterNew[]"]');
    if (!sel) return { options: 'no-select', selected: 0 };
    for (const o of sel.options) o.selected = true;
    sel.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(sel).trigger('change');
    const selAll = document.querySelector('.multiselect-all input, input.multiselect-all');
    if (selAll && !selAll.checked) selAll.click();
    return { options: sel.options.length, selected: [...sel.options].filter((o) => o.selected).length };
  });
  await page.waitForTimeout(800);

  // click Excel, capture download
  const dlPromise = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=button],input[type=submit],a')].find((x) => /^\s*excel\s*$/i.test((x.value || x.textContent || ''))); if (b) b.click(); });
  const dl = await dlPromise;
  if (!dl) throw new Error('no Excel download for session ' + sid);
  await dl.saveAs(outFile);
  const lines = fs.readFileSync(outFile, 'utf8').split('\n').filter((l) => l.trim()).length;
  console.log(`  ${year}: classes ${cls.selected}/${cls.options} | filters ${JSON.stringify(filters)} | rows ~${lines - 1} -> ${path.basename(outFile)}`);
  return { year, rows: lines - 1 };
}

(async () => {
  const ctx = await chromium.launchPersistentContext(USER_DATA, {
    headless: false, channel: 'chrome', viewport: null, acceptDownloads: true,
    ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await ensureLogin(page);
  console.log('logged in. extracting sessions:', SESSIONS.join(', '));

  const summary = [];
  for (const sid of SESSIONS) {
    console.log(`\n=== ${YEARS[sid] || sid} (session ${sid}) ===`);
    try {
      summary.push(await extractSession(page, ctx, sid));
    } catch (e) {
      console.error(`  ERROR ${YEARS[sid] || sid}:`, String(e).slice(0, 200));
      summary.push({ year: YEARS[sid] || sid, error: String(e).slice(0, 120) });
    }
  }
  console.log('\n=== SUMMARY ===');
  for (const s of summary) console.log(' ', JSON.stringify(s));
  await ctx.close();
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
