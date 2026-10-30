/** 2022-23 fallback probe: use the enterMarks page (plain dropdowns, no multiselect widgets).
 * Drive session 8 -> I-A -> first subject -> term -> test, then call getList and report whether
 * marks exist, plus the ids needed for a full sweep. */
const { chromium } = require('playwright');
const path = require('path');
const BASE = 'https://dbpasn.schoolpad.in';
const EM = BASE + '/enterMarks/displayGrid';
const USER_DATA = path.join(__dirname, '.browser');
const SID = process.env.SID || '8';
(async () => {
  const ctx = await chromium.launchPersistentContext(USER_DATA, { headless: false, channel: 'chrome', viewport: null, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  const reqs = [];
  page.on('request', (r) => { const u = r.url(); if (/enterMarks\/(getList|getTestTypeOptions|getSubjectsCustomRole|checkTestsMaster|getStudentsHtml)/i.test(u)) reqs.push({ u: u.replace(BASE, ''), post: (r.postData() || '').slice(0, 200) }); });

  await page.goto(EM, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.evaluate((s) => { const el = document.querySelector('#sessionHeader') || document.querySelector('select[name=sessionHeader]'); el.value = s; el.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(el).trigger('change'); }, SID);
  await page.waitForTimeout(2500); await page.goto(EM, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const c = document.querySelector('select[name=selectClass]'); return c && c.options.length > 1; }, null, { timeout: 25000 }).catch(() => {});

  const classes = await page.evaluate(() => [...document.querySelector('select[name=selectClass]').options].map((o) => ({ v: o.value, t: (o.textContent || '').trim() })).filter((o) => o.v));
  const ia = classes.find((c) => /^I-A$/i.test(c.t)) || classes[4] || classes[0];
  console.log('session', SID, 'classes:', classes.length, '| using', JSON.stringify(ia));

  // class -> subjects
  await page.evaluate((v) => { const s = document.querySelector('select[name=selectClass]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); }, ia.v);
  await page.waitForTimeout(2000);
  const subs = await page.evaluate(() => [...document.querySelector('select[name=subjectId]').options].map((o) => ({ v: o.value, t: (o.textContent || '').trim() })).filter((o) => o.v && !/select/i.test(o.v)));
  console.log('subjects:', JSON.stringify(subs));
  if (!subs.length) { console.log('NO SUBJECTS for session', SID, '-> no marks'); await ctx.close(); return; }
  const sub = subs[0];

  // subject -> terms
  await page.evaluate((v) => { const s = document.querySelector('select[name=subjectId]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); }, sub.v);
  await page.waitForTimeout(1500);
  const terms = await page.evaluate(() => [...document.querySelector('select[name=termId]').options].map((o) => ({ v: o.value, t: (o.textContent || '').trim() })).filter((o) => o.v));
  console.log('terms:', JSON.stringify(terms));
  if (!terms.length) { console.log('NO TERMS -> no marks structure'); await ctx.close(); return; }
  const term = terms[0];

  // term -> test types
  await page.evaluate((v) => { const s = document.querySelector('select[name=termId]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); }, term.v);
  await page.waitForTimeout(1500);
  const tests = await page.evaluate(() => { const s = document.querySelector('select[name=testId]'); return s ? [...s.options].map((o) => ({ v: o.value, t: (o.textContent || '').trim() })).filter((o) => o.v && !/select/i.test(o.v)) : []; });
  console.log('testTypes:', JSON.stringify(tests));
  if (!tests.length) { console.log('NO TEST TYPES'); await ctx.close(); return; }
  const test = tests[0];

  // call getList directly and check for non-empty marks
  const res = await page.evaluate(async ({ base, cid, sid2, tid, teid }) => {
    const body = `classId=${cid}&subId=${sid2}&termId=${tid}&testId=${teid}&regNo=&masterId=&sortBy=1&student_status=3&tagId=`;
    const r = await fetch(base + '/enterMarks/getList', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body });
    const t = await r.text(); let o; try { o = JSON.parse(t); } catch (e) { return { err: 'not json', head: t.slice(0, 120) }; }
    const html = o.html || '';
    const vals = [...html.matchAll(/name='total\[(\d+)\]'[^>]*value=['"]?([^'"\s>]*)/g)].map((m) => m[2]).filter((v) => v !== '');
    return { marksEntered: o.marksEntered, totalInputs: (html.match(/class='totalMarks'/g) || []).length, nonEmpty: vals.length, sample: vals.slice(0, 12) };
  }, { base: BASE, cid: ia.v, sid2: sub.v, tid: term.v, teid: test.v });
  console.log('\ngetList(', ia.t, '/', sub.t, '/', term.t, '/', test.t, ') =>', JSON.stringify(res));
  console.log('\n--- endpoints seen ---\n' + reqs.map((r) => `${r.u}  ${r.post}`).join('\n'));
  await ctx.close();
})().catch((e) => { console.error(String(e).slice(0, 200)); process.exit(1); });
