/**
 * Widget-free fallback extractor (used for 2022-23 / session 8, where the consolidated report's
 * subject multiselect won't open). Drives the enterMarks page's plain AJAX:
 *   getSubjectsCustomRole(classId) -> subjects
 *   getTestTypeOptions(termId,classId,subjectId,selectedType=1) -> test types
 *   getList(classId,subId,termId,testId,student_status=3) -> per-student marks + assMax
 * All via in-page fetch (credentials:include) — no bootstrap-multiselect widgets involved.
 * Writes normalized rows straight to out/marks-<year>.ndjson (+ .csv), same schema as parse-exam.
 *
 * USAGE  node scripts/exam-migration/extract-getlist.js [--sessions 8]
 *   Log in once in the window (Turnstile); session persists in the shared .browser profile.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://dbpasn.schoolpad.in';
const EM = BASE + '/enterMarks/displayGrid';
const DIR = __dirname;
const OUT = path.join(DIR, 'out');
const USER_DATA = path.join(DIR, '.browser');
const YEARS = { 7: '2021-2022', 8: '2022-2023', 9: '2023-2024', 10: '2024-2025', 11: '2025-2026', 12: '2026-2027' };
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
const SESSIONS = String(arg('sessions', '8')).split(',').map((s) => s.trim());
const SUFFIX = arg('suffix', '') === true || !arg('suffix', '') ? '' : String(arg('suffix', '')); // e.g. "-verify" to avoid clobbering
fs.mkdirSync(OUT, { recursive: true });

const opts = (html) => [...String(html).matchAll(/<option value=['"]?([^'">]+)['"]?[^>]*>([\s\S]*?)<\/option>/gi)].map((m) => ({ v: m[1].trim(), t: m[2].replace(/<[^>]+>/g, '').trim() })).filter((o) => o.v && !/^-+select/i.test(o.v) && !/select/i.test(o.t) && o.v !== '');
const num = (s) => { const m = String(s).match(/-?\d+(?:\.\d+)?/); return m ? Number(m[0]) : null; };

// parse one getList JSON response -> [{rowId, admNo, name, mark, absent}], and assMax
function parseGetList(json) {
  let o; try { o = JSON.parse(String(json).replace(/^﻿/, '').trim()); } catch (e) { return null; }
  const html = o.html || '';
  const assMax = num((html.match(/name=['"]?assMax['"]?[^>]*value=['"]?([^'"\s>]+)/i) || [])[1]);
  // students: grid-one rows id='highlight_tr_<rowId>' with tds [#, adm, name]
  const students = {};
  for (const m of html.matchAll(/id='highlight_tr_(\d+)'>([\s\S]*?)<\/tr>/gi)) {
    const tds = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((x) => x[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    students[m[1]] = { admNo: tds[1] || '', name: tds[2] || '' };
  }
  // marks: grid-two inputs name='total[<rowId>]' value='<mark>'
  const rows = [];
  for (const m of html.matchAll(/name='total\[(\d+)\]'[^>]*value=['"]?([^'"\s>]*)/gi)) {
    const st = students[m[1]]; if (!st) continue;
    const raw = m[2].trim();
    const absent = /AB|NA|^A$/i.test(raw) ? 1 : 0;
    rows.push({ admNo: st.admNo, name: st.name, mark: raw === '' ? null : num(raw), absent, hasValue: raw !== '' });
  }
  return { assMax, rows };
}

async function setSession(page, sid) {
  await page.goto(EM, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!document.querySelector('select[name=sessionHeader]'), null, { timeout: 60000 }).catch(() => {});
  await page.evaluate((s) => { const el = document.querySelector('select[name=sessionHeader]'); el.value = s; el.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(el).trigger('change'); }, sid);
  await page.waitForTimeout(2500);
  await page.goto(EM, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => { const c = document.querySelector('select[name=selectClass]'); return c && c.options.length > 1; }, null, { timeout: 25000 }).catch(() => {});
}
async function ensureLogin(page) {
  await page.goto(EM, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 150; i++) { if (await page.evaluate(() => !!document.querySelector('select[name=sessionHeader]')).catch(() => false)) return; if (i === 0) console.log('\n  >>> Log in (solve Turnstile) in the window. Waiting...\n'); await page.waitForTimeout(2000); }
  throw new Error('not logged in');
}
// in-page fetch helper
const post = (page, url, body) => page.evaluate(async ({ url, body }) => { const r = await fetch(url, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' }, body }); return r.text(); }, { url, body });

// Term IDs differ per session and only appear in the #termId select after a class+subject is
// chosen in the UI. Discover them once per session by driving the first class that yields terms.
async function discoverTerms(page, classes) {
  for (const c of classes) {
    if (/dummy/i.test(c.t)) continue;
    await page.evaluate((v) => { const s = document.querySelector('select[name=selectClass]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); }, c.v);
    const okS = await page.waitForFunction(() => { const s = document.querySelector('select[name=subjectId]'); return s && [...s.options].some((o) => o.value && !/select/i.test(o.value)); }, null, { timeout: 12000 }).then(() => true).catch(() => false);
    if (!okS) continue;
    const firstSub = await page.evaluate(() => { const s = document.querySelector('select[name=subjectId]'); const o = [...s.options].find((o) => o.value && !/select/i.test(o.value)); return o ? o.value : null; });
    if (!firstSub) continue;
    await page.evaluate((v) => { const s = document.querySelector('select[name=subjectId]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(s).trigger('change'); }, firstSub);
    const okT = await page.waitForFunction(() => { const t = document.querySelector('select[name=termId]'); return t && [...t.options].some((o) => o.value); }, null, { timeout: 12000 }).then(() => true).catch(() => false);
    if (!okT) continue;
    const terms = await page.evaluate(() => [...document.querySelector('select[name=termId]').options].map((o) => ({ v: o.value, t: (o.textContent || '').trim() })).filter((o) => o.v));
    if (terms.length) return terms;
  }
  return [];
}

(async () => {
  const ctx = await chromium.launchPersistentContext(USER_DATA, { headless: false, channel: 'chrome', viewport: null, ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'] });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => d.accept().catch(() => {}));
  await ensureLogin(page);
  console.log('logged in.');

  for (const sid of SESSIONS) {
    const year = YEARS[sid] || sid;
    console.log(`\n=== ${year} (session ${sid}) ===`);
    await setSession(page, sid);
    const classes = await page.evaluate(() => [...document.querySelector('select[name=selectClass]').options].map((o) => ({ v: o.value, t: (o.textContent || '').trim() })).filter((o) => o.v));
    const terms = await discoverTerms(page, classes);
    console.log('  term ids this session:', JSON.stringify(terms));
    if (!terms.length) { console.log('  no terms found -> skipping session'); continue; }
    const recs = [];
    for (const cls of classes) {
      if (/dummy/i.test(cls.t)) continue;
      const subjHtml = await post(page, BASE + '/enterMarks/getSubjectsCustomRole/', 'classId=' + cls.v);
      const subjects = opts(subjHtml);
      if (!subjects.length) { console.log(`  ${cls.t}: no subjects (skip)`); continue; }
      let classRows = 0;
      for (const sub of subjects) {
        for (const term of terms) {
          const ttHtml = await post(page, BASE + '/enterMarks/getTestTypeOptions', `termId=${term.v}&classId=${cls.v}&subjectId=${sub.v}&selectedType=1`);
          const tests = opts(ttHtml);
          for (const test of tests) {
            const body = `classId=${cls.v}&subId=${sub.v}&termId=${term.v}&testId=${test.v}&regNo=&masterId=&sortBy=1&student_status=3&tagId=`;
            const gl = await post(page, BASE + '/enterMarks/getList', body);
            const parsed = parseGetList(gl);
            if (!parsed) continue;
            for (const r of parsed.rows) {
              if (!r.hasValue && !r.absent) continue;      // skip students with no mark for this test
              recs.push({ year, className: cls.t, admissionNo: r.admNo, studentName: r.name, rollNo: '', subject: sub.t, term: term.t, testType: test.t, maxMarks: parsed.assMax, mark: r.mark, absent: r.absent });
              classRows++;
            }
          }
        }
      }
      console.log(`  ${cls.t}: ${subjects.length} subj -> ${classRows} marks`);
    }
    // write per-year (merge-safe filename distinct from consolidated output)
    const base = path.join(OUT, `marks-${year}${SUFFIX}`);
    fs.writeFileSync(base + '.ndjson', recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
    const cols = ['className', 'admissionNo', 'studentName', 'rollNo', 'subject', 'term', 'testType', 'maxMarks', 'mark', 'absent'];
    const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    fs.writeFileSync(base + '.csv', [cols.join(','), ...recs.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n');
    console.log(`  wrote ${recs.length} -> marks-${year}.ndjson + .csv`);
  }
  await ctx.close();
  console.log('\nFallback extraction complete.');
})().catch((e) => { console.error(e); process.exit(1); });
