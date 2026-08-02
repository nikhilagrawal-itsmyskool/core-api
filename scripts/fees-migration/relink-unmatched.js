/**
 * Fees migration RELINK — back-fills student_id on the PARKED rows (the receipts/ledger whose
 * student did not exist in itsmyskool at load time, so they were stored with student_id = NULL
 * and the admission number kept in a snapshot). Run this AFTER you load the missing students.
 *
 *   node scripts/fees-migration/relink-unmatched.js --stage prod --school-code DBPASN [--apply]
 *
 * DRY-RUN by default (reports what would link, writes nothing). Pass --apply to write.
 * Idempotent: once a row is linked its student_id is no longer null, so a re-run only picks up
 * whatever is still parked.
 *
 * How a parked row is matched back to a student:
 *   - ledger  : student_id is null AND split_part(remarks,' ',1) = 'adm:<no>'   (remarks='adm:<no> <name>')
 *   - receipts: student_id is null AND admission_no_snapshot = '<no>'
 * A parked admission number links when a student.admission_number equals it.
 *
 * RENUMBERED students (already in itsmyskool under a NEW admission number, e.g. the J<->S
 * renumbering) will NOT auto-match on their old parked number. Provide an optional map file
 *   out/relink-map.json  =  { "<oldParkedAdm>": "<currentAdmissionNumber>", ... }
 * and this script resolves the old number to that student. Numbers with no student and no map
 * entry are reported (and written to out/relink-still-unmatched.txt) so nothing links silently.
 */
const fs = require('fs');
const path = require('path');
const { loadConfig, createPool } = require('../run-sql');

const OUT = path.join(__dirname, 'out');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const STAGE = arg('stage', 'local');
const SCHOOL_CODE = arg('school-code', 'DBPASN');
const APPLY = !!arg('apply', false);

(async () => {
  const pool = createPool(loadConfig(STAGE));
  const school = (await pool.query('select uuid from school where lower(code)=lower($1)', [SCHOOL_CODE])).rows[0];
  if (!school) { console.error(`school ${SCHOOL_CODE} not found in ${STAGE}`); process.exit(1); }
  const schoolId = school.uuid;

  // student admission_number -> uuid, and old_admission_number -> {uuid, current adm} for renumbered
  const stuRows = (await pool.query('select uuid, admission_number, old_admission_number from student where school_id=$1', [schoolId])).rows;
  const stuByAdm = {}; const stuByOldAdm = {};
  stuRows.forEach((s) => {
    if (s.admission_number) stuByAdm[s.admission_number] = s.uuid;
    if (s.old_admission_number) stuByOldAdm[s.old_admission_number] = { uuid: s.uuid, adm: s.admission_number };
  });

  // optional old -> current admission-number map for renumbered students
  const mapPath = path.join(OUT, 'relink-map.json');
  const remap = fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : {};

  // discover every parked admission number actually present in the DB (source of truth)
  const parked = new Set();
  const ledgerAdm = (await pool.query("select distinct split_part(remarks,' ',1) tag from student_ledger_entry where school_id=$1 and student_id is null and legacy_source='schoolpad' and remarks like 'adm:%'", [schoolId])).rows;
  ledgerAdm.forEach((r) => { const a = String(r.tag || '').replace(/^adm:/, ''); if (a) parked.add(a); });
  const recAdm = (await pool.query('select distinct admission_no_snapshot adm from fee_receipt where school_id=$1 and student_id is null and admission_no_snapshot is not null', [schoolId])).rows;
  recAdm.forEach((r) => { if (r.adm) parked.add(String(r.adm)); });

  const linked = []; const unlinked = [];
  let totLedger = 0, totReceipts = 0;

  for (const adm of [...parked].sort()) {
    // resolve the parked number to a student: manual map wins, then same admission_number,
    // then auto-detect a renumbered student via old_admission_number.
    let uuid = null; let targetAdm = adm; let via = 'adm';
    if (remap[adm] && stuByAdm[remap[adm]]) { uuid = stuByAdm[remap[adm]]; targetAdm = remap[adm]; via = 'map'; }
    else if (stuByAdm[adm]) { uuid = stuByAdm[adm]; via = 'adm'; }
    else if (stuByOldAdm[adm]) { uuid = stuByOldAdm[adm].uuid; targetAdm = stuByOldAdm[adm].adm; via = 'old#'; }
    if (!uuid) { unlinked.push(adm); continue; }

    if (APPLY) {
      const l = await pool.query("update student_ledger_entry set student_id=$1 where school_id=$2 and student_id is null and split_part(remarks,' ',1)=$3", [uuid, schoolId, `adm:${adm}`]);
      const r = await pool.query('update fee_receipt set student_id=$1 where school_id=$2 and student_id is null and admission_no_snapshot=$3', [uuid, schoolId, adm]);
      linked.push({ adm, targetAdm, uuid, via, ledger: l.rowCount, receipts: r.rowCount });
      totLedger += l.rowCount; totReceipts += r.rowCount;
    } else {
      const l = (await pool.query("select count(*) c from student_ledger_entry where school_id=$1 and student_id is null and split_part(remarks,' ',1)=$2", [schoolId, `adm:${adm}`])).rows[0].c;
      const r = (await pool.query('select count(*) c from fee_receipt where school_id=$1 and student_id is null and admission_no_snapshot=$2', [schoolId, adm])).rows[0].c;
      linked.push({ adm, targetAdm, uuid, via, ledger: Number(l), receipts: Number(r) });
      totLedger += Number(l); totReceipts += Number(r);
    }
  }

  linked.forEach((x) => console.log(`${x.adm.padEnd(12)}${x.adm === x.targetAdm ? '' : ' -> ' + x.targetAdm} [${x.via}] -> ${x.uuid}  ledger=${x.ledger} receipts=${x.receipts}`));
  if (unlinked.length) {
    fs.writeFileSync(path.join(OUT, 'relink-still-unmatched.txt'), unlinked.join('\n') + '\n');
    console.log(`\nstill unmatched (no student, no map entry): ${unlinked.length} -> out/relink-still-unmatched.txt`);
    console.log('  ' + unlinked.join('  '));
  }
  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN (nothing written — pass --apply)'} | linked ${linked.length} adm | ledger rows ${totLedger} | receipts ${totReceipts} | still-parked ${unlinked.length}`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
