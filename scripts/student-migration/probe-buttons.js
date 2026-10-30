/** Inspect the Print/Excel buttons + the generate JS, to find which control serializes the full
 * form (studentStatus/columns) vs. the saved-report quick-generate (reportId only). */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const BASE = 'https://dbpasn.schoolpad.in';
const URL = BASE + '/studentReport/display';
const USER_DATA = path.join(__dirname, '..', 'exam-migration', '.browser');

(async () => {
  const ctx = await chromium.launchPersistentContext(USER_DATA, { headless: false, channel: 'chrome', viewport: null, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 90; i++) { if (await page.evaluate(() => !!document.querySelector('select[name=sessionHeader]')).catch(() => false)) break; await page.waitForTimeout(2000); }
  // session 12
  await page.evaluate(() => { const el = document.querySelector('select[name=sessionHeader]'); el.value = '12'; el.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(el).trigger('change'); });
  await page.waitForTimeout(2000);
  await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(1800);
  await page.evaluate(() => { const s = document.querySelector('select[name=txtReportName]'); s.value = '84'; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); });
  await page.waitForTimeout(2000);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=button],a')].find((x) => /select\s*classes/i.test((x.value || x.textContent || ''))); if (b) b.click(); });
  await page.waitForFunction(() => !!document.querySelector('select[name=studentStatus]'), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);

  // dump every Print/Excel button: visibility, onclick, enclosing form id/action
  const btns = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button,input[type=button],input[type=submit],a')].filter((b) => /^\s*(excel|print)\s*$/i.test((b.value || b.textContent || '')));
    return els.map((b, i) => {
      const r = b.getBoundingClientRect();
      const form = b.closest('form');
      return { i, label: (b.value || b.textContent || '').trim(), tag: b.tagName, id: b.id || '', name: b.name || '', onclick: (b.getAttribute('onclick') || '').slice(0, 160), visible: !!(r.width && r.height), formId: form ? (form.id || form.getAttribute('name') || '') : 'NO-FORM', formAction: form ? (form.action || '').replace(location.origin, '') : '' };
    });
  });
  console.log('Print/Excel buttons:');
  for (const b of btns) console.log('  ', JSON.stringify(b));

  // find generateReport-related JS functions in page scripts
  const js = await page.evaluate(() => {
    const scripts = [...document.querySelectorAll('script')].map((s) => s.textContent || '').join('\n');
    const idx = scripts.indexOf('generateReport');
    const hits = [];
    let from = 0;
    for (let k = 0; k < 6; k++) { const p = scripts.indexOf('generateReport', from); if (p === -1) break; hits.push(scripts.slice(Math.max(0, p - 120), p + 220).replace(/\s+/g, ' ')); from = p + 10; }
    // also look for the submit function that posts the form
    const subIdx = scripts.search(/function\s+\w*[Gg]enerate\w*\s*\(/);
    return { hits, around: subIdx > -1 ? scripts.slice(subIdx, subIdx + 400).replace(/\s+/g, ' ') : '' };
  });
  fs.writeFileSync(path.join(__dirname, 'out', 'generate-js.txt'), JSON.stringify(js, null, 2));
  console.log('\ngenerateReport JS hits:');
  js.hits.forEach((h, i) => console.log(`  [${i}] ${h}`));
  console.log('\ngenerate fn:', js.around.slice(0, 400));

  await ctx.close();
})().catch((e) => { console.error(String(e).slice(0, 500)); process.exit(1); });
