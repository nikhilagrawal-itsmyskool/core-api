/** For each session, list the saved-report options (txtReportName) + the studentStatus options,
 * so we know which reportId (if any) to use per year and whether an all-students report exists. */
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'https://dbpasn.schoolpad.in';
const URL = BASE + '/studentReport/display';
const USER_DATA = path.join(__dirname, '..', 'exam-migration', '.browser');
const YEARS = { 7: '2021-22', 8: '2022-23', 9: '2023-24', 10: '2024-25', 11: '2025-26', 12: '2026-27' };

(async () => {
  const ctx = await chromium.launchPersistentContext(USER_DATA, { headless: false, channel: 'chrome', viewport: null, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  for (let i = 0; i < 90; i++) { if (await page.evaluate(() => !!document.querySelector('select[name=sessionHeader]')).catch(() => false)) break; await page.waitForTimeout(2000); }

  for (const sid of ['7', '8', '9', '10', '11', '12']) {
    await page.evaluate((s) => { const el = document.querySelector('select[name=sessionHeader]'); el.value = s; el.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(el).trigger('change'); }, sid);
    await page.waitForTimeout(2000);
    await page.goto(URL, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(1800);
    const info = await page.evaluate(() => {
      const rep = document.querySelector('select[name=txtReportName]');
      const reports = rep ? [...rep.options].map((o) => ({ v: o.value, t: (o.textContent || '').trim() })).filter((o) => o.v) : [];
      return { reports };
    });
    console.log(`session ${sid} (${YEARS[sid]}): reports = ${JSON.stringify(info.reports)}`);
  }
  await ctx.close();
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
