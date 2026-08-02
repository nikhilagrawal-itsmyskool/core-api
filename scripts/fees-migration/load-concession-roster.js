/**
 * Concession ROSTER loader (+ value fix). Two jobs, both config-only (no ledger/balance change):
 *
 *  1. FIX fee_concession.value: the first config load mis-parsed "Rs.225" as 0.225. Re-parse the
 *     config-concessions-*.json grids and correct each template's value by (school, year, name).
 *  2. BUILD fee_concession_student from the migrated ledger: every applied concession is a ledger
 *     line (kind='concession') whose head_label is the concession NAME, so distinct (student,
 *     concession-name) → one roster row. Matches the SchoolPad "Apply Concession" report exactly.
 *
 *   node scripts/fees-migration/load-concession-roster.js --stage prod --school-code DBPASN [--years 2026-2027] [--apply]
 *
 * DRY-RUN by default. Idempotent: skips (concession, student) pairs already present.
 */
const fs = require('fs');
const path = require('path');
const { loadConfig, createPool } = require('../run-sql');
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const OUT = path.join(__dirname, 'out');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const STAGE = arg('stage', 'local');
const SCHOOL_CODE = arg('school-code', 'DBPASN');
const APPLY = !!arg('apply', false);
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const isRow = (r) => Array.isArray(r) && /^\d+$/.test(String(r[0] || '').trim());
const parseRs = (v) => { const m = String(v || '').match(/(\d[\d,]*(?:\.\d+)?)/); return m ? Number(m[1].replace(/,/g, '')) : 0; };
const readCfg = (kind, year) => { const p = path.join(OUT, `config-${kind}-${year}.json`); return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')).rows || []) : []; };

(async () => {
  const pool = createPool(loadConfig(STAGE));
  const school = (await pool.query('select uuid from school where lower(code)=lower($1)', [SCHOOL_CODE])).rows[0];
  if (!school) { console.error(`school ${SCHOOL_CODE} not found`); process.exit(1); }
  const sid = school.uuid;
  const ayRows = (await pool.query('select uuid, name from academic_year where school_id=$1', [sid])).rows;
  const ayByStart = {}; ayRows.forEach((a) => { const m = String(a.name || '').match(/(20\d\d)/); if (m) ayByStart[m[1]] = a.uuid; });

  const years = (arg('years', null) ? String(arg('years')).split(',') : fs.readdirSync(OUT).filter((f) => /^config-concessions-\d{4}-\d{4}\.json$/.test(f)).map((f) => f.match(/(\d{4}-\d{4})/)[1])).sort();
  const now = new Date();
  let gFixed = 0, gRoster = 0, gUnmapped = 0;

  for (const year of years) {
    const ay = ayByStart[year.slice(0, 4)];
    if (!ay) { console.log(`${year}: academic_year MISSING — skipped`); continue; }

    // 1. fix template values from the config grid
    let fixed = 0;
    for (const r of readCfg('concessions', year).filter(isRow)) {
      const name = String(r[1] || '').trim(); if (!name) continue;
      const val = parseRs(r[2]);
      if (APPLY) {
        const res = await pool.query("update fee_concession set value=$1, updated_at=$2 where school_id=$3 and academic_year_id=$4 and name=$5 and status='active' and value <> $1", [val, now, sid, ay, name]);
        fixed += res.rowCount;
      } else {
        const cur = (await pool.query("select value from fee_concession where school_id=$1 and academic_year_id=$2 and name=$3 and status='active'", [sid, ay, name])).rows[0];
        if (cur && Number(cur.value) !== val) fixed++;
      }
    }

    // 2. build roster from ledger concession lines (head_label = concession name)
    const tpl = {};
    (await pool.query("select uuid, name from fee_concession where school_id=$1 and academic_year_id=$2 and status='active'", [sid, ay])).rows.forEach((t) => (tpl[norm(t.name)] = t.uuid));
    const links = (await pool.query("select distinct student_id, head_label from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='concession' and status='active' and student_id is not null", [sid, ay])).rows;
    const existing = new Set((await pool.query("select concession_id, student_id from fee_concession_student where school_id=$1 and status='active'", [sid])).rows.map((r) => `${r.concession_id}|${r.student_id}`));

    const vals = []; let unmapped = 0; const seen = new Set();
    for (const l of links) {
      const cid = tpl[norm(l.head_label)];
      if (!cid) { unmapped++; continue; }
      const key = `${cid}|${l.student_id}`;
      if (existing.has(key) || seen.has(key)) continue;
      seen.add(key);
      vals.push([generateShortUuid(12), sid, cid, l.student_id, 'active', 'system', now]);
    }
    if (APPLY && vals.length) await insertMany(pool, 'fee_concession_student', ['uuid', 'school_id', 'concession_id', 'student_id', 'status', 'createdby_userid', 'created_at'], vals);

    gFixed += fixed; gRoster += vals.length; gUnmapped += unmapped;
    console.log(`${year}: valuesFixed=${fixed} rosterRows=${vals.length} unmappedLedgerConc=${unmapped}`);
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN (pass --apply)'} | valuesFixed=${gFixed} rosterRows=${gRoster} unmapped=${gUnmapped}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

async function insertMany(pool, table, cols, rows) {
  if (!rows.length) return;
  const chunk = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values = slice.map((_, ri) => '(' + cols.map((__, ci) => `$${ri * cols.length + ci + 1}`).join(',') + ')').join(',');
    await pool.query(`insert into ${table} (${cols.join(',')}) values ${values}`, slice.flat());
  }
}
