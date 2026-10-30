/** Combine the per-student DETAIL CSVs in out/raw/detail/ into one CSV that sync-students-full.js
 * can consume (shared header, one row per student). Only includes files whose Adm. No. is in the
 * 22 real-missing targets (skips the 0000 Dummy). Writes out/raw/detail/_combined.csv. */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');

const OUT = path.join(__dirname, 'out');
const DETAIL = path.join(OUT, 'raw', 'detail');
const admKey = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
// optional explicit allow-list of admission numbers + output filename (default _combined.csv)
const ONLY = arg('only', '') ? new Set(String(arg('only', '')).split(',').map(admKey)) : null;
const OUTNAME = arg('out', '_combined.csv');
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

// target set (from reconciliation), minus the Dummy junk
let targets = null;
const mp = path.join(OUT, 'missing-students.csv');
if (fs.existsSync(mp)) targets = new Set(parse(fs.readFileSync(mp, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, relax_quotes: true }).map((m) => admKey(m.admNo)).filter((k) => k && k !== '0000'));

let header = null;
const rows = [];
const seen = new Set();
for (const n of fs.readdirSync(DETAIL).sort()) {
  if (!/\.csv$/i.test(n) || n.startsWith('_')) continue;
  const raw = fs.readFileSync(path.join(DETAIL, n), 'utf8');
  const start = raw.indexOf('"Sr. No."');
  if (start < 0) { console.log('SKIP (no header):', n); continue; }
  const recs = parse(raw.slice(start), { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true });
  if (!header && recs.length) header = Object.keys(recs[0]);
  for (const r of recs) {
    const k = admKey(r['Adm. No.']);
    if (!k) continue;
    if (ONLY && !ONLY.has(k)) continue;
    if (!ONLY && targets && !targets.has(k)) { console.log('  (not a target, skipping row)', k, n); continue; }
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(r);
  }
}
if (!header) { console.error('no header found'); process.exit(1); }
const outFile = path.join(DETAIL, OUTNAME);
// Force-quote the header so the literal `"Sr. No."` is present — the importer slices the file
// from that exact quoted token, so an unquoted header makes it parse 0 records.
const lines = [header.map((h) => '"' + String(h).replace(/"/g, '""') + '"').join(',')];
for (const r of rows) lines.push(header.map((h) => cell(r[h])).join(','));
fs.writeFileSync(outFile, lines.join('\n') + '\n');
console.log(`\ncombined ${rows.length} students -> ${path.relative(process.cwd(), outFile)}`);
console.log('adm numbers:', [...seen].join(', '));
