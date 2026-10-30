/** Probe the AD-HOC generate path: load saved report 84 (to tick all columns), click Select
 * Classes, then CLEAR the saved-report select + set studentStatus=5, and trigger Excel.
 * Capture the full generateReport body + whether the resulting file includes withdrawn students. */
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
  let body = null;
  page.on('request', (r) => { if (r.method() === 'POST' && /generateReport/i.test(r.url())) body = r.postData() || ''; });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 90; i++) { if (await page.evaluate(() => !!document.querySelector('select[name=sessionHeader]')).catch(() => false)) break; await page.waitForTimeout(2000); }
  await page.evaluate(() => { const el = document.querySelector('select[name=sessionHeader]'); el.value = '12'; el.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(el).trigger('change'); });
  await page.waitForTimeout(2500);
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(2000);

  // load saved report 84 to populate the form (all columns + classes machinery)
  await page.evaluate(() => { const s = document.querySelector('select[name=txtReportName]'); s.value = '84'; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=button],a')].find((x) => /select\s*classes/i.test((x.value || x.textContent || ''))); if (b) b.click(); });
  await page.waitForFunction(() => !!document.querySelector('select[name=studentStatus]'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const state = await page.evaluate(() => {
    // CLEAR the saved-report selection so the generate serializes the full form
    const rep = document.querySelector('select[name=txtReportName]');
    if (rep) { rep.value = ''; rep.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(rep).trigger('change'); }
    const set = (n, v) => { const s = document.querySelector(`select[name="${n}"]`); if (s) { s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); return s.value; } return 'MISSING'; };
    const stType = set('studentType', '2');
    const stStatus = set('studentStatus', '5');
    const sel = document.querySelector('select[name="findClassFilterNew[]"]'); let cls = 0;
    if (sel) { for (const o of sel.options) o.selected = true; sel.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(sel).trigger('change'); cls = [...sel.options].filter((o) => o.selected).length; }
    // count checked column checkboxes
    const checkedCols = [...document.querySelectorAll('input[type=checkbox]')].filter((c) => c.checked && c.name && /^[a-z]/i.test(c.name)).length;
    return { reportNameVal: rep ? rep.value : 'none', stType, stStatus, cls, checkedCols };
  });
  console.log('form state after clear+set:', JSON.stringify(state));

  const dlPromise = page.waitForEvent('download', { timeout: 60000 }).catch(() => null);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=button],input[type=submit],a')].find((x) => /^\s*excel\s*$/i.test((x.value || x.textContent || ''))); if (b) b.click(); });
  const dl = await dlPromise;
  let saved = null;
  if (dl) { saved = path.join(OUT, 'adhoc-test.csv'); await dl.saveAs(saved); }

  fs.writeFileSync(path.join(OUT, 'adhoc-body.txt'), body || '(none)');
  if (body) {
    const pairs = body.split('&').map((p) => { const i = p.indexOf('='); return [decodeURIComponent(p.slice(0, i)), decodeURIComponent(p.slice(i + 1))]; });
    const nonClass = pairs.filter(([k]) => !/classSelectedValues|^customData/i.test(k));
    console.log('\ngenerateReport body len:', body.length, '| params:', pairs.length, '| classVals:', pairs.filter(([k]) => /classSelectedValues/.test(k)).length);
    console.log('has studentStatus:', pairs.some(([k]) => k === 'studentStatus'), '| has studentType:', pairs.some(([k]) => k === 'studentType'), '| has reportId:', pairs.some(([k]) => k === 'reportId'));
    const sv = pairs.find(([k]) => k === 'studentStatus'); const ty = pairs.find(([k]) => k === 'studentType');
    console.log('studentStatus =', sv ? sv[1] : 'ABSENT', '| studentType =', ty ? ty[1] : 'ABSENT');
    console.log('\nfirst 40 non-class/customData params:');
    for (const [k, v] of nonClass.slice(0, 40)) console.log(`  ${k} = ${v}`);
  }

  if (saved) {
    const { parse } = require('csv-parse/sync');
    const raw = fs.readFileSync(saved, 'utf8');
    try {
      const recs = parse(raw.slice(raw.indexOf('"Sr. No."')), { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true });
      const byStatus = {}; let wd = 0;
      for (const r of recs) { const s = (r['Status'] || '').trim() || '(blank)'; byStatus[s] = (byStatus[s] || 0) + 1; if ((r['Date Of Withdrawal'] || '').replace(/-+/g, '').trim()) wd++; }
      console.log('\nadhoc-test.csv rows:', recs.length, '| byStatus:', JSON.stringify(byStatus), '| withdrawn:', wd);
    } catch (e) { console.log('parse error', e.message); }
  }

  console.log('\n(browser open 10s)');
  await page.waitForTimeout(10000);
  await ctx.close();
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
