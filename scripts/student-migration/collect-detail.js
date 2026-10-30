/**
 * Collect per-student DETAIL exports (studentReport-<adm>.csv, one student each with the full
 * column set) out of Downloads into out/raw/detail/, and track them against the 23 missing
 * students from the reconciliation (out/missing-students.csv).
 *
 * READ-ONLY on data (just moves files + prints a checklist). No DB, no prod writes.
 *
 * USAGE  node scripts/student-migration/collect-detail.js [--downloads <dir>] [--no-collect]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parse } = require('csv-parse/sync');

const OUT = path.join(__dirname, 'out');
const DETAIL = path.join(OUT, 'raw', 'detail');
fs.mkdirSync(DETAIL, { recursive: true });
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); if (i === -1) return d; const v = process.argv[i + 1]; return v && !v.startsWith('--') ? v : true; };
const DL = arg('downloads', path.join(os.homedir(), 'Downloads'));
const COLLECT = !arg('no-collect', false);

const admKey = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
// read the single Adm. No. out of a detail CSV (authoritative — don't trust the filename)
function admOf(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const start = raw.indexOf('"Sr. No."');
    const recs = parse(start >= 0 ? raw.slice(start) : raw, { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true });
    return recs.map((r) => admKey(r['Adm. No.'] || r['Adm No'] || '')).filter(Boolean);
  } catch (e) { return []; }
}

// 1) sweep Downloads: studentReport-*.csv but NOT studentReport-all-*.csv
if (COLLECT && fs.existsSync(DL)) {
  for (const n of fs.readdirSync(DL)) {
    if (/^studentReport-.*\.csv$/i.test(n) && !/^studentReport-all-/i.test(n)) {
      const src = path.join(DL, n), dest = path.join(DETAIL, n);
      try { fs.renameSync(src, dest); console.log('moved', n); }
      catch (e) {
        try { fs.copyFileSync(src, dest); try { fs.unlinkSync(src); } catch (_) {} console.log('copied (src busy, left in Downloads)', n); }
        catch (e2) { console.log('SKIP (locked)', n, e2.message); }
      }
    }
  }
}

// 2) index what detail we now have
const have = new Map(); // admKey -> filename
for (const n of fs.readdirSync(DETAIL)) {
  if (!/\.csv$/i.test(n)) continue;
  for (const a of admOf(path.join(DETAIL, n))) have.set(a, n);
}

// 3) compare to the 23 missing
const missPath = path.join(OUT, 'missing-students.csv');
if (!fs.existsSync(missPath)) { console.log('\n(no out/missing-students.csv yet — run reconcile.js first)'); process.exit(0); }
const miss = parse(fs.readFileSync(missPath, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, relax_quotes: true });
const targets = miss.map((m) => ({ adm: m.admNo, key: admKey(m.admNo), name: m.name, cls: m.className, nameMatch: m.nameMatch }))
  .filter((t) => t.key && t.key !== '0000'); // drop the Dummy junk row

const covered = targets.filter((t) => have.has(t.key));
const pending = targets.filter((t) => !have.has(t.key));
const extra = [...have.keys()].filter((k) => !targets.some((t) => t.key === k) && k !== '0000');

console.log(`\n===== DETAIL COLLECTION ===== (detail files: ${have.size}, targets: ${targets.length})`);
console.log(`COVERED: ${covered.length}/${targets.length}`);
console.log(`PENDING: ${pending.length}`);
if (pending.length) {
  console.log('\nStill need (download studentReport-<adm>.csv for each):');
  for (const t of pending) console.log(`  ${t.adm}\t${t.cls}\t${t.name}${t.nameMatch ? '   [name-match: ' + t.nameMatch + ']' : ''}`);
}
if (extra.length) { console.log('\nDetail files NOT in the missing list (check these):'); for (const k of extra) console.log(`  ${k}  (${have.get(k)})`); }
if (!pending.length) console.log('\nAll missing students have detail files — ready to import.');
