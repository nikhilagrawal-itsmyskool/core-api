/**
 * Read-only probe of SchoolPad studentReport/display (v2).
 * Navigate, wait for networkidle, screenshot, and dump the report grid's form controls
 * + any AJAX endpoints. Reuses the exam-migration logged-in Chrome profile.
 *
 * USAGE  node scripts/student-migration/probe-studentreport.js
 */
const { chromium } = require('playwright');
const path = require('path');

const BASE = 'https://dbpasn.schoolpad.in';
const URL = BASE + '/studentReport/display';
const USER_DATA = path.join(__dirname, '..', 'exam-migration', '.browser');
const SHOT = path.join(__dirname, 'studentreport.png');

(async () => {
  const ctx = await chromium.launchPersistentContext(USER_DATA, {
    headless: false, channel: 'chrome', viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));

  const reqs = [];
  page.on('request', (r) => {
    const u = r.url();
    if (/student|getList|displayGrid|export|print|grid/i.test(u)) {
      reqs.push({ m: r.method(), u: u.replace(BASE, ''), post: (r.postData() || '').slice(0, 300) });
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  console.log('after nav, url =', page.url());

  // If bounced, try navigating again (sometimes first hit warms session then redirects)
  if (!/studentReport/i.test(page.url())) {
    console.log('bounced; retrying navigation...');
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    console.log('after retry, url =', page.url());
  }

  await page.screenshot({ path: SHOT, fullPage: true }).catch((e) => console.log('screenshot failed', e.message));

  const form = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('select')].map((s) => ({
      name: s.name || s.id, n: s.options.length,
      opts: [...s.options].slice(0, 25).map((o) => ({ v: o.value, t: (o.textContent || '').trim() })),
    }));
    const radios = [...document.querySelectorAll('input[type=radio],input[type=checkbox]')].map((r) => ({
      name: r.name, val: r.value, checked: r.checked,
      label: (r.closest('label')?.textContent || r.parentElement?.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50),
    }));
    const btns = [...document.querySelectorAll('button,input[type=button],input[type=submit],a.btn')]
      .map((el) => ({ name: el.name || el.id || '', val: (el.value || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) }))
      .filter((x) => x.val && /export|print|search|generate|submit|excel|pdf|show|get|download|view/i.test(x.val));
    const headers = [...document.querySelectorAll('table thead th, table tr th')].map((th) => (th.textContent || '').trim().replace(/\s+/g, ' ')).slice(0, 50);
    const bodyRows = document.querySelectorAll('table tbody tr').length;
    return { selects, radios, btns, headers, bodyRows, title: document.title, url: location.href };
  });

  console.log('URL:', form.url, '| title:', form.title, '| tbody rows:', form.bodyRows);
  console.log('\n=== SELECTS ===');
  for (const s of form.selects) console.log(`  [${s.name}] (${s.n})`, JSON.stringify(s.opts.slice(0, 10)));
  console.log('\n=== RADIO/CHECKBOX (status filter?) ===');
  for (const r of form.radios) if (r.name || r.label) console.log('  ', JSON.stringify(r));
  console.log('\n=== BUTTONS (export/print/search) ===');
  for (const b of form.btns) console.log('  ', JSON.stringify(b));
  console.log('\n=== TABLE HEADERS ===');
  console.log('  ', JSON.stringify(form.headers));
  console.log('\n=== NETWORK ===');
  for (const r of reqs) console.log(`  ${r.m} ${r.u}  ${r.post}`);
  console.log('\nscreenshot ->', SHOT);

  console.log('\n(browser open 25s — click the status/all-students filter so I can see the control)');
  await page.waitForTimeout(25000);
  await ctx.close();
})().catch((e) => { console.error(String(e).slice(0, 400)); process.exit(1); });
