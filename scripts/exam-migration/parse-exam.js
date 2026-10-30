/**
 * Parse SchoolPad "Consolidated Marks Report (Detailed)" HTML exports into normalized NDJSON.
 *
 * Each report is one class/session. Structure (verified):
 *   <tr id='sub_tr'>      3-col lead, then <td colspan=14> per subject (14 = 7 tests x 2 terms)
 *   <tr id='term_tr'>     3-col lead, then <td colspan=7> "TERM 1" / "TERM 2" per subject
 *   <tr id='testType_tr'> 3-col lead, then one <td> per column: "PT-I (10)", "Half Yearly (50)", …
 *   <tr id='masterRow'>   roll | adm | name | one cell per column
 *                         cell = "<raw> <br>GRADE <br>scaled <br>pct%"   ("0(NA)"=absent, "-"=none)
 * We expand the three header rows by colspan to get a column->(subject,term,test,max) map, then
 * read each student's raw mark per column. Output: one row per (student,subject,term,testType).
 *
 * USAGE
 *   node scripts/exam-migration/parse-exam.js --file "C:/path/MarksReport.xls"   # single file
 *   node scripts/exam-migration/parse-exam.js [--year 2025-2026]                 # all out/raw/<year>/*.html
 *   node scripts/exam-migration/parse-exam.js --file x.xls --sample 8            # print N sample rows
 * Output -> out/marks-<year>.ndjson (one JSON row per student x subject x term x test).
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT = path.join(DIR, 'out');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
const SAMPLE = Number(arg('sample', 0)) || 0;

const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
// strip a cell's HTML -> text with <br> as newlines
const cellText = (html) => decode(String(html).replace(/<br[^>]*>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/ /g, ' ').split('\n').map((x) => x.trim()).filter((x) => x !== '').join('\n');
// split a row's HTML into {colspan, html} td descriptors
function tds(rowHtml) {
  const out = [];
  const re = /<td([^>]*)>([\s\S]*?)<\/td>/gi; let m;
  while ((m = re.exec(rowHtml))) { const cs = (m[1].match(/colspan\s*=\s*['"]?(\d+)/i) || [])[1]; out.push({ colspan: cs ? +cs : 1, html: m[2] }); }
  return out;
}
// expand tds by colspan into a flat per-column array of cell-texts, then drop the 3-col lead
const expandDropLead = (rowHtml, lead = 3) => {
  const flat = [];
  for (const td of tds(rowHtml)) { const t = cellText(td.html); for (let i = 0; i < td.colspan; i++) flat.push(t); }
  return flat.slice(lead);
};
const rowById = (html, id) => (html.match(new RegExp("<tr[^>]*id=['\"]?" + id + "['\"]?[^>]*>([\\s\\S]*?)</tr>", 'i')) || [])[1] || null;

function parseReport(html, hint) {
  const className = (html.match(/Marks Report\s*<\/?[^>]*>?\s*([A-Za-z0-9 .\-]+?)\s*<(?:strong|\/td|br)/i) || html.match(/Marks Report\s+([A-Za-z0-9.\-]+)/i) || [])[1] || hint.className || '';
  const year = (html.match(/Session\s*<\/?[^>]*>?\s*(\d{4}-\d{4})/i) || html.match(/Session\s+(\d{4}-\d{4})/i) || [])[1] || hint.year || '';
  const subRow = rowById(html, 'sub_tr'), termRow = rowById(html, 'term_tr'), testRow = rowById(html, 'testType_tr');
  if (!subRow || !termRow || !testRow) throw new Error('header rows (sub_tr/term_tr/testType_tr) not found');
  const subjectByCol = expandDropLead(subRow).map((s) => s.trim());
  const termByCol = expandDropLead(termRow).map((t) => t.trim());
  const testByCol = expandDropLead(testRow).map((t) => {
    const m = t.match(/^(.*?)\s*\((\d+(?:\.\d+)?)\)\s*$/);   // "PT-I (10)" -> name, max
    return m ? { test: m[1].trim(), max: Number(m[2]) } : { test: t.trim(), max: null };
  });
  const ncol = Math.min(subjectByCol.length, termByCol.length, testByCol.length);

  // data rows: every <tr id='masterRow'> (one per student)
  const rows = [...html.matchAll(/<tr[^>]*id=['"]?masterRow['"]?[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  const records = [];
  let students = 0;
  for (const r of rows) {
    const cells = tds(r);
    if (cells.length < 4) continue;
    const roll = cellText(cells[0].html);
    const adm = cellText(cells[1].html);
    const name = cellText(cells[2].html);
    if (!adm) continue;
    students++;
    const dataCells = cells.slice(3);
    for (let c = 0; c < ncol && c < dataCells.length; c++) {
      const raw = cellText(dataCells[c].html);            // e.g. "9\nA2\n9\n90%" or "-" or "0(NA)\nE2\n2\n0%"
      const first = (raw.split('\n')[0] || '').trim();    // the mark token
      const grade = (raw.split('\n')[1] || '').trim();
      if (first === '' || first === '-') continue;         // no record for this (student,test)
      const absent = /\((NA|AB|L)\)/i.test(first) || /^(AB|A|NA|L)$/i.test(first);
      const num = (first.match(/-?\d+(?:\.\d+)?/) || [])[0];
      records.push({
        year, className: className.trim(), admissionNo: adm, studentName: name, rollNo: roll,
        subject: subjectByCol[c], term: termByCol[c], testType: testByCol[c].test, maxMarks: testByCol[c].max,
        mark: num != null ? Number(num) : null, grade: /^[A-E]\d?$/i.test(grade) ? grade : null, absent: absent ? 1 : 0,
      });
    }
  }
  return { className: className.trim(), year, ncol, subjects: [...new Set(subjectByCol)], tests: [...new Set(testByCol.map((t) => t.test))], students, records };
}

// ---- collect input files ----
let files = [];
const fileArg = arg('file', null);
const dirArg = arg('dir', null);
if (fileArg && fileArg !== true) files = [fileArg];
else if (dirArg && dirArg !== true) {
  // parse every download in a folder (any extension); year/class come from file CONTENT
  for (const f of fs.readdirSync(dirArg)) {
    if (/^_|\.json$/i.test(f)) continue;
    const full = path.join(dirArg, f);
    if (fs.statSync(full).isFile() && /marksreport|\.(xls|html?)$/i.test(f)) files.push(full);
  }
} else {
  const yr = arg('year', null);
  const rawDir = path.join(OUT, 'raw');
  if (fs.existsSync(rawDir)) {
    for (const y of fs.readdirSync(rawDir)) {
      if (yr && yr !== true && y !== yr) continue;
      const d = path.join(rawDir, y);
      if (!fs.statSync(d).isDirectory()) continue;
      for (const f of fs.readdirSync(d)) if (f.endsWith('.html')) files.push(path.join(d, f));
    }
  }
}
if (!files.length) { console.error('No input files. Pass --file <path> or populate out/raw/<year>/*.html'); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
const byYear = {};
let totalRecords = 0, totalStudents = 0;
const sampleRows = [];
for (const f of files) {
  const html = fs.readFileSync(f, 'utf8');
  const base = path.basename(f, '.html');
  const hint = { className: base.split('__')[1] || '', year: path.basename(path.dirname(f)) };
  let res;
  try { res = parseReport(html, hint); } catch (e) { console.log(`SKIP ${f}: ${e.message}`); continue; }
  const y = res.year || 'unknown';
  (byYear[y] = byYear[y] || []).push(...res.records);
  totalRecords += res.records.length; totalStudents += res.students;
  if (sampleRows.length < SAMPLE) sampleRows.push(...res.records.slice(0, SAMPLE - sampleRows.length));
  console.log(`${res.className || base} [${y}]: ${res.students} students, ${res.subjects.length} subjects, ${res.ncol} columns -> ${res.records.length} marks`);
}
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const CSV_COLS = ['className', 'admissionNo', 'studentName', 'rollNo', 'subject', 'term', 'testType', 'maxMarks', 'mark', 'absent'];
for (const [y, recs] of Object.entries(byYear)) {
  const nd = path.join(OUT, `marks-${y}.ndjson`);
  fs.writeFileSync(nd, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const csv = path.join(OUT, `marks-${y}.csv`);
  fs.writeFileSync(csv, [CSV_COLS.join(','), ...recs.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n');
  console.log(`wrote ${recs.length} -> ${path.relative(DIR, nd)}  +  ${path.basename(csv)}`);
}
console.log(`\nTOTAL: ${totalStudents} students, ${totalRecords} mark rows across ${files.length} file(s).`);
if (SAMPLE) { console.log(`\n--- ${sampleRows.length} sample rows ---`); for (const r of sampleRows) console.log(JSON.stringify(r)); }
