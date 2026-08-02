/**
 * SchoolPad fees history extractor — Sweep A (fee + transport + cancelled receipts).
 *
 * Mirrors EXACTLY the manual flow that produced the first 12,723 records, so output is
 * byte-identical in format: per session, run the full-session "Print Student Receipt" grid
 * (type=any, include cancelled, no class filter — authoritative & uncapped), collect every
 * receipt's print id, and pull each print_view/<id> (the only place head-wise amounts + cycles
 * live). Parser is identical to the validated browser parser.
 *
 * Robustness the manual run lacked: auto re-login on session expiry, no MCP 30s cap, and an
 * incremental watermark so a weekly re-run only pulls receipts newer than last time.
 *
 * USAGE
 *   SP_USER=nikhil.agrawal SP_PASS='***' node scripts/fees-migration/extract-schoolpad.js \
 *       [--sessions 7,8,9] [--incremental] [--headed]
 *   Sessions: 2021-22=7 2022-23=8 2023-24=9 2024-25=10 2025-26=11 2026-27=12 (default: all).
 *   --incremental  : skip receipt ids <= the manifest watermark for that year (weekly re-run).
 *   (Never commit the password. Pass via env.)
 *
 * OUTPUT  out/A-<yyyy-yyyy>.ndjson (one receipt per line) + state/manifest.json (watermarks).
 *   Raw out/ is gitignored (student PII); only the manifest (counts+watermarks) is committed.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://dbpasn.schoolpad.in';
const DIR = __dirname;
const OUT = path.join(DIR, 'out');
const MANIFEST = path.join(DIR, 'state', 'manifest.json');
const YEARS = { 7: '2021-2022', 8: '2022-2023', 9: '2023-2024', 10: '2024-2025', 11: '2025-2026', 12: '2026-2027' };

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
const USER = process.env.SP_USER, PASS = process.env.SP_PASS;
if (!USER || !PASS) { console.error('Set SP_USER and SP_PASS env vars.'); process.exit(1); }
const SESSIONS = String(arg('sessions', '7,8,9,10,11,12')).split(',').map((s) => s.trim());
const INCREMENTAL = !!arg('incremental', false);
const HEADED = !!arg('headed', false);
fs.mkdirSync(OUT, { recursive: true });

const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const readManifest = () => JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const writeManifest = (m) => fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));

// SchoolPad is behind Cloudflare; a fresh page shows a "Just a moment" JS challenge that a
// HEADED real browser clears on its own within a few seconds. Wait for the login form to appear.
async function waitForLoginForm(page, secs = 40) {
  for (let i = 0; i < secs; i++) { if (await page.evaluate(() => !!document.querySelector('#txtUsername')).catch(() => false)) return true; await page.waitForTimeout(1000); }
  return false;
}
async function doLogin(page) {
  await page.goto(BASE + '/loginManager/load', { waitUntil: 'domcontentloaded' });
  if (!(await waitForLoginForm(page))) throw new Error('login form never appeared (Cloudflare challenge did not clear — run headed)');
  await page.fill('#txtUsername', USER);
  await page.fill('#txtPassword', PASS);
  await page.evaluate(() => { const b = [...document.querySelectorAll('button,input[type=submit],input[type=button]')].find((x) => /submit/i.test(x.innerText || x.value)); b && b.click(); });
  await page.waitForTimeout(3000);
}
async function login(page) {
  await doLogin(page);
  await page.goto(BASE + '/printStudentReceipt/displayGrid', { waitUntil: 'domcontentloaded' });
  if (/loginManager/.test(page.url()) || !(await page.evaluate(() => !!document.querySelector('#sessionHeader')).catch(() => false))) {
    await page.waitForTimeout(1500); await doLogin(page);
    await page.goto(BASE + '/printStudentReceipt/displayGrid', { waitUntil: 'domcontentloaded' });
  }
}
async function ensureAuth(page) {
  const ok = await page.evaluate(() => !!document.querySelector('#sessionHeader')).catch(() => false);
  if (!ok || /loginManager/.test(page.url())) { console.log('  (re-login)'); await login(page); await page.goto(BASE + '/printStudentReceipt/displayGrid', { waitUntil: 'domcontentloaded' }); }
}

async function setSession(page, sid) {
  await page.goto(BASE + '/printStudentReceipt/displayGrid', { waitUntil: 'domcontentloaded' });
  await ensureAuth(page);
  await page.evaluate((s) => { const el = document.querySelector('#sessionHeader'); el.value = s; el.dispatchEvent(new Event('change', { bubbles: true })); }, sid);
  await page.waitForTimeout(2500);
  await page.goto(BASE + '/printStudentReceipt/displayGrid', { waitUntil: 'domcontentloaded' });
  const cur = await page.evaluate(() => document.querySelector('#sessionHeader').value);
  if (cur !== String(sid)) throw new Error('session not set: wanted ' + sid + ' got ' + cur);
}

async function runFullQuery(page) {
  await page.evaluate(() => {
    document.querySelector('#stuRegNos').value = '';
    document.querySelector('#classId').value = '';
    const t = document.querySelector('#typeOfReceipt'); if (t) t.value = 'any';
    const cb = document.querySelector('#cancelledBit'); if (cb) cb.value = '1';
    const fd = document.querySelector('#fromDate'); if (fd) fd.value = '';
    const td = document.querySelector('#toDate'); if (td) td.value = '';
    document.querySelector('#showDetailsBtn').click();
  });
  // wait until the grid finishes rendering (Found N Rows appears and count stops growing)
  await page.waitForFunction(() => /Found\s+\d+\s+Rows/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const ids = new Set();
    document.querySelectorAll('tr').forEach((tr) => { if (!/\b(FR|TR)-\d+-\d+-\d+\b/.test(tr.innerText)) return; const ps = Array.from(tr.querySelectorAll('span,a')).find((e) => /^Print$/.test(e.innerText.trim())); const m = (((ps && ps.getAttribute('onclick')) || '').match(/print\(\[(\d+)\]/) || [])[1]; if (m) ids.add(m); });
    const found = (document.body.innerText.match(/Found\s+(\d+)\s+Rows/) || [])[1];
    return { ids: [...ids], found: found ? +found : null };
  });
}

// EXACT parser (identical to the validated browser __parse) — runs in page context.
async function fetchBatch(page, ids, conc) {
  return page.evaluate(async ({ ids, conc, base }) => {
    const num = (x) => x == null ? null : Number(String(x).replace(/[(),\-\s]/g, '')) * (/\(-\)|-/.test(x) ? -1 : 1);
    const parse = (html, id) => {
      const cancelled = /CANCELLED/i.test(html);
      const parent = html.split(/OFFICE COPY/)[0] || html;
      const d = new DOMParser().parseFromString(parent, 'text/html');
      const t = d.body.innerText || ''; const g = (re) => { const m = t.match(re); return m ? m[1].trim() : null; };
      const lines = []; let due = null, paid = null, bal = null, conc2 = null;
      d.querySelectorAll('tr').forEach((tr) => { const td = tr.querySelectorAll('td'); if (td.length !== 2) return; const a = td[0].innerText.trim(), b = td[1].innerText.trim();
        if (/^Total Due$/i.test(a)) due = b; else if (/^Total$/i.test(a)) paid = b; else if (/^Balance$/i.test(a)) bal = b;
        else if (/^Concessions?$/i.test(a)) { conc2 = b; lines.push({ head: 'Concession', amount: num(b), isConcession: true }); }
        else if (/^\(?-?\)?\s*[\d,]+(\.\d+)?$/.test(b) && a && a.length < 60 && !/^Last Paid/.test(a)) lines.push({ head: a, amount: num(b), isConcession: false }); });
      const no = g(/No:\s*([A-Z]+-[\d-]+)/);
      return { legacyReceiptNo: no, internalId: Number(id), type: no && no.startsWith('TR') ? 'transport' : 'fee', date: g(/Date\s*:\s*([\d-]+)/), admissionNo: g(/Admission No\s*:?\s*([^\n]+)/), studentName: g(/Student Name\s*:?\s*([^\n]+)/), fatherName: g(/Father Name\s*:?\s*([^\n]+)/), motherName: g(/Mother Name\s*:?\s*([^\n]+)/), className: g(/Class\s*:?\s*([^\n]+)/), cycles: (g(/Fee Cycle\s*:?\s*([^\n]+)/) || '').split(',').map((c) => c.trim()).filter(Boolean), paymentMode: g(/Payment-Mode\s*:?\s*([^\n]+)/), remarks: (g(/Remarks\s*:?\s*([^\n]+)/) || '').replace(/^---$/, ''), totalDue: num(due), totalPaid: num(paid), balance: num(bal), concessionTotal: num(conc2), cancelled, lines };
    };
    const one = async (id) => { try { const r = await fetch(base + '/printStudentReceipt/print_view/' + id, { credentials: 'include' }); const h = await r.text(); if (!/Admission No/i.test(h)) return { internalId: Number(id), empty: true }; return parse(h, id); } catch (e) { return { internalId: Number(id), error: String(e).slice(0, 60) }; } };
    const out = [];
    for (let i = 0; i < ids.length; i += conc) out.push(...await Promise.all(ids.slice(i, i + conc).map(one)));
    return out;
  }, { ids, conc, base: BASE });
}

(async () => {
  // Headed by default — Cloudflare blocks headless. Pass --headless to force (will likely fail the challenge).
  const browser = await chromium.launch({ headless: HEADED === 'headless' });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
  const page = await ctx.newPage();
  await login(page);
  console.log('logged in.');

  for (const sid of SESSIONS) {
    const year = YEARS[sid] || sid;
    console.log(`\n=== ${year} (session ${sid}) ===`);
    await setSession(page, sid);
    const { ids, found } = await runFullQuery(page);
    console.log(`  grid: found=${found}, ids=${ids.length}`);

    const manifest = readManifest();
    const prev = manifest.sweeps.A_receipts[year] || {};
    const watermark = INCREMENTAL ? (prev.watermark || 0) : 0;
    const todo = ids.map(Number).filter((id) => id > watermark).map(String);
    console.log(`  to fetch: ${todo.length}${INCREMENTAL ? ` (incremental, > wm ${watermark})` : ''}`);

    const outFile = path.join(OUT, `A-${year}.ndjson`);
    // incremental appends; full run rewrites
    const existing = INCREMENTAL && fs.existsSync(outFile) ? fs.readFileSync(outFile, 'utf8') : '';
    const stream = fs.createWriteStream(outFile, { flags: INCREMENTAL ? 'a' : 'w' });
    let done = 0, maxId = watermark, err = 0;
    for (let i = 0; i < todo.length; i += 400) {
      await ensureAuth(page);
      const recs = await fetchBatch(page, todo.slice(i, i + 400), 8);
      for (const r of recs) { stream.write(JSON.stringify(r) + '\n'); done++; if (r.error || r.empty) err++; if (r.internalId > maxId) maxId = r.internalId; }
      console.log(`    ${Math.min(i + 400, todo.length)}/${todo.length} (errors ${err})`);
    }
    await new Promise((res) => stream.end(res));

    const m2 = readManifest();
    const priorCount = INCREMENTAL ? (prev.count || 0) : 0;
    m2.sweeps.A_receipts[year] = { watermark: maxId, count: priorCount + done - err, errors: err, gridFound: found, file: `A-${year}.ndjson`, partial: false, lastRun: nowIso() };
    m2.runs.push({ sweep: 'A', year, fetched: done, watermark: maxId, incremental: INCREMENTAL, at: nowIso() });
    writeManifest(m2);
    console.log(`  wrote ${done} (errors ${err}) -> A-${year}.ndjson | watermark=${maxId}`);
  }

  await browser.close();
  console.log('\nSweep A complete.');
})().catch((e) => { console.error(e); process.exit(1); });
