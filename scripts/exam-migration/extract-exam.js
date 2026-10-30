/**
 * SchoolPad examination-marks extractor.
 *
 * Source of truth: the NON-CCE "Consolidated Marks Report" (reportType=Detailed). ONE report per
 * (class, session) returns EVERYTHING — every student (active + inactive), every subject, both
 * terms, and every test type per term (PT-I, Class Test, NB-I, SEA, Class Perf., Oral,
 * Half Yearly / PT-II, NB-II, Annual Exam, …) with raw mark + grade + max marks + absent markers.
 * So the whole school is ~24 classes x 5 sessions = ~120 downloads instead of ~13k per-test calls.
 *
 * We drive the page's own `generateRep(1)` (Excel) which emits an HTML <table> file; we save the
 * raw HTML verbatim. parse-exam.js turns it into normalized NDJSON. Keeping raw means we never
 * have to touch SchoolPad again once access ends.
 *
 * USAGE
 *   SP_USER=nikhil.agrawal SP_PASS='***' node scripts/exam-migration/extract-exam.js \
 *       [--sessions 11] [--max-classes 2] [--headless]
 *   Sessions: 2021-22=7 2022-23=8 2023-24=9 2024-25=10 2025-26=11  (12/2026-27 has NO marks).
 *   Default sessions = all five past years. --max-classes limits per session (for sampling).
 *   Headed by default (Cloudflare blocks headless). Never commit the password; pass via env.
 *
 * OUTPUT  out/raw/<year>/<classId>__<className>.html   (one Detailed report each)
 *         state/manifest.json                          (what was pulled, when, row counts)
 *   Raw out/ is gitignored (student PII).
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://dbpasn.schoolpad.in';
const REPORT = BASE + '/noncceConsolidatedMarksReport/displayGrid';
const DIR = __dirname;
const OUT = path.join(DIR, 'out');
const RAW = path.join(OUT, 'raw');
const MANIFEST = path.join(DIR, 'state', 'manifest.json');
const YEARS = { 7: '2021-2022', 8: '2022-2023', 9: '2023-2024', 10: '2024-2025', 11: '2025-2026', 12: '2026-2027' };

const arg = (n, d) => { const i = process.argv.indexOf('--' + n); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
// Credentials: env vars first, else a gitignored `.sp-creds` file (KEY=VALUE lines) so the
// password never has to be typed on the command line. Create it with:
//   printf 'SP_USER=nikhil.agrawal\nSP_PASS=yourpassword\n' > scripts/exam-migration/.sp-creds
function loadCreds() {
  let user = process.env.SP_USER, pass = process.env.SP_PASS;
  const f = path.join(DIR, '.sp-creds');
  if ((!user || !pass) && fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(SP_USER|SP_PASS)\s*=\s*(.*)\s*$/); if (!m) continue;
      if (m[1] === 'SP_USER') user = user || m[2]; else pass = pass || m[2];
    }
  }
  return { user, pass };
}
const { user: USER, pass: PASS } = loadCreds();
// Credentials are OPTIONAL now (only used to pre-fill the login form). The Cloudflare Turnstile
// means you log in by hand anyway; without creds you just type the username/password yourself.
if (!USER || !PASS) console.warn('Note: SP_USER/SP_PASS not set — you will type the login fields manually in the browser window.');
const SESSIONS = String(arg('sessions', '7,8,9,10,11')).split(',').map((s) => s.trim());
const MAX_CLASSES = Number(arg('max-classes', 0)) || 0;   // 0 = all
const ONLY_CLASSES = String(arg('classes', '') || '').split(',').map((s) => s.trim()).filter(Boolean); // classId filter
const ONLY_NAMES = String(arg('class-name', '') || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean); // className filter (exact, case-insensitive)
const FORCE = !!arg('force', false);                      // re-download even if already saved
fs.mkdirSync(RAW, { recursive: true });

const nowIso = () => new Date().toISOString().slice(0, 19) + 'Z';
const readManifest = () => (fs.existsSync(MANIFEST) ? JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) : { reports: {}, runs: [] });
const writeManifest = (m) => { fs.mkdirSync(path.dirname(MANIFEST), { recursive: true }); fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2)); };
const safe = (s) => String(s).replace(/[^A-Za-z0-9_-]+/g, '_');

// ---- auth ----
// SchoolPad's login page is protected by a Cloudflare Turnstile CAPTCHA, which cannot be scripted.
// So we run a PERSISTENT browser profile and have the human log in ONCE in the window (solve the
// Turnstile + Submit); the script then reuses that authenticated session (cookies persist in the
// profile dir across runs) to download every report automatically. If USER/PASS are available we
// pre-fill the fields so the human only needs to solve the Turnstile and click Submit.
async function waitForLoginForm(page, secs = 40) {
  for (let i = 0; i < secs; i++) { if (await page.evaluate(() => !!document.querySelector('#txtUsername')).catch(() => false)) return true; await page.waitForTimeout(1000); }
  return false;
}
// poll for the report form (#sessionHeader) — returns 'ok' | 'login' | 'timeout'.
async function waitReportReady(page, secs = 15) {
  for (let i = 0; i < secs; i++) {
    if (/loginManager/.test(page.url())) return 'login';
    if (await page.evaluate(() => !!document.querySelector('#sessionHeader')).catch(() => false)) return 'ok';
    await page.waitForTimeout(1000);
  }
  return 'timeout';
}
const MANUAL_TIMEOUT = Number(process.env.SP_LOGIN_TIMEOUT || 300); // seconds to wait for human login
async function interactiveLogin(page) {
  await page.goto(BASE + '/loginManager/load', { waitUntil: 'domcontentloaded' });
  await waitForLoginForm(page);
  if (USER && PASS) await page.evaluate(({ u, p }) => { const a = document.querySelector('#txtUsername'); const b = document.querySelector('#txtPassword'); if (a) a.value = u; if (b) b.value = p; }, { u: USER, p: PASS }).catch(() => {});
  console.log('\n  ============================================================');
  console.log('  ACTION REQUIRED — a browser window is open on the login page.');
  console.log('  Username/password are pre-filled. Solve the Cloudflare Turnstile');
  console.log('  ("I am human") and click Submit. Waiting up to ' + MANUAL_TIMEOUT + 's ...');
  console.log('  ============================================================\n');
  for (let i = 0; i < Math.ceil(MANUAL_TIMEOUT / 2); i++) {
    await page.waitForTimeout(2000);
    if (!/loginManager/.test(page.url())) {              // human submitted & got redirected
      await page.goto(REPORT, { waitUntil: 'domcontentloaded' });
      if ((await waitReportReady(page, 15)) === 'ok') { console.log('  login successful.\n'); return true; }
    }
  }
  throw new Error('manual login not completed within ' + MANUAL_TIMEOUT + 's');
}
// navigate to the report page; if not logged in (Turnstile/expiry), pause for a manual login.
async function gotoReport(page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.goto(REPORT, { waitUntil: 'domcontentloaded' });
    const st = await waitReportReady(page);
    if (st === 'ok') return;
    if (attempt === 1) console.log('  session not active — need manual login.');
    await interactiveLogin(page);
    return;
  }
  throw new Error('report page never rendered #sessionHeader');
}
async function login(page) { await gotoReport(page); }

async function setSession(page, sid) {
  await gotoReport(page);
  const cur = await page.evaluate(() => document.querySelector('#sessionHeader').value);
  if (cur === String(sid)) return;
  await page.evaluate((s) => { const el = document.querySelector('#sessionHeader'); el.value = s; el.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(el).trigger('change'); }, sid);
  await page.waitForTimeout(2500);
  await gotoReport(page);
  const got = await page.evaluate(() => document.querySelector('#sessionHeader').value);
  if (got !== String(sid)) throw new Error('session not set: wanted ' + sid + ' got ' + got);
}

const listClasses = (page) => page.evaluate(() =>
  Array.from(document.querySelector('#classId').options).map((o) => ({ id: o.value, name: (o.textContent || '').trim() })).filter((o) => o.id));

// Subject/Term/etc. are bootstrap-multiselect WIDGETS (a "None selected" button + a dropdown with
// a "Select all" item). Setting the hidden <select> in code does NOT register — we must click the
// widget like a human: open it, click "Select all", close. Selecting subjects fires the change
// that makes Term load, so order matters: class -> subjects -> (terms appear) -> terms.
// Select ALL options in a bootstrap-multiselect widget. A REAL click on "Select all" is required
// (for Subject it rebuilds the Term list client-side — no JS value-set fires it). First rebuild the
// widget so its dropdown matches options loaded dynamically after page render, then open (retry,
// force) and click, then Escape so the open dropdown doesn't block the next widget.
async function widgetSelectAll(page, selectId) {
  await page.evaluate((id) => { try { const $ = window.jQuery; if ($ && $('#' + id).data('multiselect')) $('#' + id).multiselect('rebuild'); } catch (e) {} }, selectId);
  await page.waitForTimeout(200);
  const wrap = page.locator('span.multiselect-native-select', { has: page.locator('#' + selectId) });
  const toggle = wrap.locator('button.multiselect').first();
  const allItem = wrap.locator('li.multiselect-all a, li.multiselect-all label, li.multiselect-all input[type=checkbox]').first();
  await toggle.scrollIntoViewIfNeeded().catch(() => {});
  let opened = false;
  for (let i = 0; i < 5 && !opened; i++) {
    await toggle.click({ timeout: 6000, force: true }).catch(() => {});
    opened = await allItem.isVisible().catch(() => false);
    if (!opened) await page.waitForTimeout(500);
  }
  if (!opened) throw new Error(`could not open #${selectId} widget`);
  await allItem.click({ timeout: 6000, force: true });
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  return page.evaluate((id) => { const s = document.getElementById(id); return s ? [...s.selectedOptions].length : 0; }, selectId);
}

// select the class, pick ALL subjects + ALL terms via the widgets, set Detailed + All-students.
async function configureClass(page, classId) {
  await page.evaluate((cid) => { const c = document.getElementById('classId'); c.value = cid; c.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(c).trigger('change'); }, classId);
  // subjects widget populates after class change
  await page.waitForFunction(() => { const s = document.getElementById('subjectId'); return s && s.options.length > 0; }, null, { timeout: 20000 });
  await widgetSelectAll(page, 'subjectId');
  // terms populate only after subjects are chosen
  const termsOk = await page.waitForFunction(() => { const t = document.getElementById('termId'); return t && t.options.length > 0; }, null, { timeout: 20000 }).then(() => true).catch(() => false);
  if (termsOk) await widgetSelectAll(page, 'termId');
  // plain dropdowns / checkboxes
  await page.evaluate(() => { const set = (id, v) => { const e = document.getElementById(id); if (e) { if (e.type === 'checkbox') e.checked = !!v; else { e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); if (window.jQuery) jQuery(e).trigger('change'); } } }; set('reportType', '0'); set('studentType', '2'); set('showMarks', true); });
  // read back what is actually selected (for the manifest + a sanity guard)
  return page.evaluate(() => {
    const vals = (id) => { const s = document.getElementById(id); return s ? [...s.selectedOptions].map((o) => ({ v: o.value, t: (o.textContent || '').trim() })) : []; };
    return { subjects: vals('subjectId'), terms: vals('termId') };
  });
}

// click the OLD builder's Excel button (#getMarks -> printMarks(1) -> initPrint) and save the file.
async function downloadReport(page, destFile) {
  page.__lastDialog = null;
  const dlP = page.waitForEvent('download', { timeout: 45000 });
  await page.evaluate(() => { const b = document.getElementById('getMarks'); if (b) b.click(); });
  let dl;
  try { dl = await dlP; } catch (e) {
    throw new Error('no download' + (page.__lastDialog ? ` (alert: "${page.__lastDialog}")` : ' (export produced no file — class likely has no marks)'));
  }
  await dl.saveAs(destFile);
  return fs.statSync(destFile).size;
}

(async () => {
  // Persistent profile so the manual Turnstile login survives across runs (resumable).
  // Cloudflare Turnstile blocks automation-fingerprinted browsers, so we: (1) use the REAL
  // installed Google Chrome (channel:'chrome') when available — far more likely to pass than
  // bundled Chromium, (2) strip the --enable-automation flag, (3) hide navigator.webdriver.
  const USER_DATA = path.join(DIR, '.browser');
  const common = {
    headless: false, acceptDownloads: true, viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--start-maximized'],
  };
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(USER_DATA, { ...common, channel: 'chrome' });
    console.log('using installed Google Chrome.');
  } catch (e) {
    console.log('Google Chrome not found, falling back to bundled Chromium (Turnstile may be harder):', String(e).slice(0, 60));
    ctx = await chromium.launchPersistentContext(USER_DATA, { ...common, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' });
  }
  await ctx.addInitScript(() => { try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {} });
  const page = ctx.pages()[0] || (await ctx.newPage());
  page.on('dialog', (d) => { page.__lastDialog = d.message(); d.accept().catch(() => {}); });   // capture + dismiss alerts
  await login(page);

  const manifest = readManifest();
  manifest.reports = manifest.reports || {};

  for (const sid of SESSIONS) {
    const year = YEARS[sid] || sid;
    console.log(`\n=== ${year} (session ${sid}) ===`);
    await setSession(page, sid);
    let classes = await listClasses(page);
    fs.mkdirSync(path.join(RAW, year), { recursive: true });
    fs.writeFileSync(path.join(RAW, year, '_classes.json'), JSON.stringify(classes, null, 2));
    if (ONLY_CLASSES.length) classes = classes.filter((c) => ONLY_CLASSES.includes(c.id));
    if (ONLY_NAMES.length) classes = classes.filter((c) => ONLY_NAMES.includes((c.name || '').toUpperCase()));
    if (MAX_CLASSES) classes = classes.slice(0, MAX_CLASSES);
    console.log(`  classes: ${classes.length}${ONLY_CLASSES.length ? ' (filtered)' : MAX_CLASSES ? ' (capped)' : ''}`);

    for (const cls of classes) {
      const key = `${year}/${cls.id}`;
      const dest = path.join(RAW, year, `${safe(cls.id)}__${safe(cls.name)}.html`);
      const prev = manifest.reports[key];
      if (!FORCE && prev && prev.bytes > 0 && fs.existsSync(dest)) { console.log(`    ${cls.name} (${cls.id}): skip (already have ${(prev.bytes / 1024).toFixed(0)}KB)`); continue; }
      await gotoReport(page);   // fresh form each class (also re-logins if session dropped)
      // sessionHeader resets to current on reload — re-assert it
      const curSid = await page.evaluate(() => document.querySelector('#sessionHeader').value);
      if (curSid !== String(sid)) { await setSession(page, sid); await gotoReport(page); }
      let sel = { subjects: [], terms: [] };
      try {
        sel = await configureClass(page, cls.id);
        const ns = (sel.subjects || []).length, nt = (sel.terms || []).length;
        const size = await downloadReport(page, dest);
        manifest.reports[key] = { year, classId: cls.id, className: cls.name, subjects: (sel.subjects || []).map((s) => s.t), terms: (sel.terms || []).map((t) => t.t), bytes: size, file: path.relative(DIR, dest), at: nowIso() };
        writeManifest(manifest);
        console.log(`    ${cls.name} (${cls.id}): ${ns} subj x ${nt} term -> ${(size / 1024).toFixed(0)}KB`);
      } catch (e) {
        console.log(`    ${cls.name} (${cls.id}): [${(sel.subjects || []).length} subj/${(sel.terms || []).length} term] FAILED ${String(e).slice(0, 80)}`);
        manifest.reports[`${year}/${cls.id}`] = { year, classId: cls.id, className: cls.name, subjects: (sel.subjects || []).length, terms: (sel.terms || []).length, error: String(e).slice(0, 120), at: nowIso() };
        writeManifest(manifest);
      }
    }
  }

  manifest.runs.push({ sessions: SESSIONS, maxClasses: MAX_CLASSES, at: nowIso() });
  writeManifest(manifest);
  await ctx.close();
  console.log('\nExtraction complete. Raw reports in out/raw/<year>/.');
})().catch((e) => { console.error(e); process.exit(1); });
