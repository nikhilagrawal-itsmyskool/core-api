/**
 * Reconcile SchoolPad studentReport export(s) against the ItsMySkool prod DB.
 * For every admission number in the report(s), check whether it already exists in our `student`
 * table (by admission_number OR old_admission_number). Report what's MISSING so we know exactly
 * which students still need importing before SchoolPad is decommissioned.
 *
 * READ-ONLY on prod (SELECT only). No writes.
 *
 * Raw source exports are kept in the project (like exam-migration): downloads named
 * `studentReport-all-*.csv` are swept out of the Downloads folder and MOVED into out/raw/,
 * which becomes the canonical, gitignored home for the SchoolPad source data. By default the
 * reconcile runs over everything in out/raw/.
 *
 * USAGE
 *   # sweep ~/Downloads/studentReport-all-*.csv into out/raw/, then reconcile over out/raw/
 *   node scripts/student-migration/reconcile.js --stage prod --school-code DBPASN
 *   # explicit file(s) instead of the auto-sweep
 *   node scripts/student-migration/reconcile.js --file <a.csv> [--file <b.csv> ...]
 *   # options: --no-collect (skip the Downloads sweep), --downloads <dir>
 *
 * Output: console summary + out/missing-students.csv + out/reconcile-present.csv
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { getCreds } = require('./db-creds');

const OUT = path.join(__dirname, 'out');
const RAW = path.join(OUT, 'raw');
fs.mkdirSync(RAW, { recursive: true });

function parseArgs(argv) {
  const a = { stage: 'prod', schoolCode: 'DBPASN', files: [], collect: true, downloads: path.join(os.homedir(), 'Downloads') };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--stage' || v === '-s') a.stage = argv[++i];
    else if (v === '--school-code' || v === '-c') a.schoolCode = argv[++i];
    else if (v === '--file' || v === '-f') a.files.push(argv[++i]);
    else if (v === '--no-collect') a.collect = false;
    else if (v === '--downloads') a.downloads = argv[++i];
  }
  return a;
}

// Sweep studentReport-all-*.csv out of the Downloads folder into out/raw/ (preserve the data in
// the project). Returns the list of files now living in out/raw/.
function collectDownloads(dlDir) {
  const moved = [];
  if (fs.existsSync(dlDir)) {
    for (const n of fs.readdirSync(dlDir)) {
      if (/^studentReport-all-.*\.csv$/i.test(n)) {
        const dest = path.join(RAW, n);
        try { fs.renameSync(path.join(dlDir, n), dest); } // same-volume move
        catch (e) { fs.copyFileSync(path.join(dlDir, n), dest); fs.unlinkSync(path.join(dlDir, n)); } // cross-volume
        moved.push(n);
      }
    }
  }
  if (moved.length) console.log(`collected ${moved.length} file(s) from ${dlDir} -> out/raw/: ${moved.join(', ')}`);
  return fs.readdirSync(RAW).filter((n) => /\.(csv|xls)$/i.test(n)).map((n) => path.join(RAW, n));
}
// match key: trim, uppercase, collapse internal whitespace, drop spaces around slashes
const admKey = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '').replace(/ /g, '');
const nameNorm = (v) => String(v ?? '').toLowerCase().replace(/^(mr|mrs|ms|dr|late|smt|shri|km|master)\.?\s*/i, '').replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();
const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

function expandFiles(files) {
  const out = [];
  for (const f of files) {
    if (!fs.existsSync(f)) { console.error('  !! file not found:', f); continue; }
    if (fs.statSync(f).isDirectory()) {
      for (const n of fs.readdirSync(f)) if (/\.(csv|xls)$/i.test(n)) out.push(path.join(f, n));
    } else out.push(f);
  }
  return out;
}

function readReport(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const start = raw.indexOf('"Sr. No."');
  const recs = parse(start >= 0 ? raw.slice(start) : raw, { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true });
  return recs.map((r) => ({
    admNo: (r['Adm. No.'] || r['Adm No'] || r['Admission Number'] || '').trim(),
    name: (r['Student Name'] || r['Name'] || '').trim(),
    className: (r['Class Name'] || r['Enrolled In Class'] || r['Class'] || '').trim(),
  })).filter((r) => r.admNo);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Default: sweep Downloads into out/raw/ and reconcile over out/raw/. Explicit --file overrides.
  let files;
  if (args.files.length) files = expandFiles(args.files);
  else files = args.collect ? collectDownloads(args.downloads) : fs.readdirSync(RAW).filter((n) => /\.(csv|xls)$/i.test(n)).map((n) => path.join(RAW, n));
  if (!files.length) { console.error('No input files found. Put studentReport-all-*.csv in Downloads, or pass --file <csv>.'); process.exit(1); }
  console.log('Reports:', files.map((f) => path.basename(f)).join(', '));

  // --- load + union the report rows (dedup by admission number; keep first source seen) ---
  const report = new Map(); // admKey -> {admNo, name, className, sources:Set}
  const perFile = {};
  for (const f of files) {
    const rows = readReport(f);
    perFile[path.basename(f)] = rows.length;
    for (const r of rows) {
      const k = admKey(r.admNo);
      if (!report.has(k)) report.set(k, { ...r, sources: new Set([path.basename(f)]) });
      else report.get(k).sources.add(path.basename(f));
    }
  }
  console.log('Per-file rows:', JSON.stringify(perFile));
  console.log('Union distinct admission numbers:', report.size, '\n');

  // --- load prod students (READ-ONLY) ---
  const pool = new Pool({ ...(await getCreds(args.stage)), max: 3 });
  pool.on('error', (e) => console.error('  [pool] idle error:', e.message));

  const c = await pool.connect();
  let schoolId;
  try {
    const sch = await c.query('select uuid from school where lower(code)=lower($1)', [args.schoolCode]);
    if (!sch.rows.length) throw new Error('school not found: ' + args.schoolCode);
    schoolId = sch.rows[0].uuid;
    const ex = await c.query("select uuid, admission_number, old_admission_number, name, status from student where school_id=$1 and status<>'deleted'", [schoolId]);
    console.log(`prod school ${args.schoolCode} (${schoolId}): ${ex.rows.length} students\n`);

    const byAdm = new Map();      // admKey -> row
    const byOldAdm = new Map();   // admKey(old) -> row
    const byName = new Map();     // nameNorm -> [rows]
    for (const r of ex.rows) {
      if (r.admission_number) byAdm.set(admKey(r.admission_number), r);
      if (r.old_admission_number) byOldAdm.set(admKey(r.old_admission_number), r);
      const nk = nameNorm(r.name);
      if (!byName.has(nk)) byName.set(nk, []);
      byName.get(nk).push(r);
    }

    const present = [], presentViaOld = [], missing = [];
    for (const [k, r] of report) {
      if (byAdm.has(k)) present.push({ ...r, matched: byAdm.get(k).admission_number, via: 'admission_number', status: byAdm.get(k).status });
      else if (byOldAdm.has(k)) presentViaOld.push({ ...r, matched: byOldAdm.get(k).admission_number, via: 'old_admission_number', status: byOldAdm.get(k).status });
      else {
        const nameHits = (byName.get(nameNorm(r.name)) || []);
        missing.push({ ...r, nameMatch: nameHits.map((h) => `${h.admission_number} [${h.status}]`).join(' ; ') });
      }
    }

    // --- summary ---
    console.log('================ RECONCILIATION ================');
    console.log('In report (distinct adm#):   ', report.size);
    console.log('PRESENT (admission_number):  ', present.length);
    console.log('PRESENT (via old_admission): ', presentViaOld.length);
    console.log('MISSING:                     ', missing.length);
    const missNameMatch = missing.filter((m) => m.nameMatch).length;
    console.log('  └ of which share a name w/ an existing student (possible re-admission / renumber):', missNameMatch);
    console.log('================================================\n');

    // missing broken down by admission year
    const byYear = {};
    for (const m of missing) { const ym = m.admNo.match(/2K(\d{2})\s*$/i); const y = ym ? '20' + ym[1] : '??'; byYear[y] = (byYear[y] || 0) + 1; }
    console.log('MISSING by admission year:', JSON.stringify(byYear));

    // --- write outputs ---
    const mcols = ['admNo', 'name', 'className', 'nameMatch', 'sources'];
    fs.writeFileSync(path.join(OUT, 'missing-students.csv'),
      [mcols.join(','), ...missing.map((m) => [m.admNo, m.name, m.className, m.nameMatch, [...m.sources].join('|')].map(cell).join(','))].join('\n') + '\n');
    const pcols = ['admNo', 'name', 'className', 'via', 'matched', 'status'];
    fs.writeFileSync(path.join(OUT, 'reconcile-present.csv'),
      [pcols.join(','), ...[...present, ...presentViaOld].map((p) => [p.admNo, p.name, p.className, p.via, p.matched, p.status].map(cell).join(','))].join('\n') + '\n');
    console.log('\nwrote out/missing-students.csv (' + missing.length + ') + out/reconcile-present.csv (' + (present.length + presentViaOld.length) + ')');
    if (missing.length) {
      console.log('\nFirst 25 missing:');
      for (const m of missing.slice(0, 25)) console.log(`  ${m.admNo}\t${m.className}\t${m.name}${m.nameMatch ? '   <= name match: ' + m.nameMatch : ''}`);
    }
  } finally {
    c.release();
    await pool.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
