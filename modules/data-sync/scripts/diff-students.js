/**
 * Read-only diff: studentReport CSV vs DB (student table + current-AY enrollment).
 * Mirrors sync-students-full.js field mapping and its UPDATE semantics so a field
 * is reported as changed ONLY if a real sync would actually alter it. Writes nothing.
 *
 * Usage:
 *   node diff-students.js --stage prod --school-code DBPASN \
 *     --file "C:/Users/nikhi/Downloads/studentReport (3).csv" --academic-session 2026-27 [--limit N]
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');

const REPO = path.join(__dirname, '..', '..', '..', '..', '..', '..', '..'); // not used; we pass abs paths
function parseArgs(argv) {
  const a = { stage: null, schoolCode: null, file: null, session: null, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--stage') a.stage = argv[++i];
    else if (v === '--school-code') a.schoolCode = argv[++i];
    else if (v === '--file') a.file = argv[++i];
    else if (v === '--academic-session') a.session = argv[++i];
    else if (v === '--limit') a.limit = parseInt(argv[++i], 10) || 0;
  }
  return a;
}
function loadConfig(configPath) {
  const cfg = fs.readFileSync(configPath, 'utf8');
  const env = {};
  for (const line of cfg.split('\n')) {
    const m = line.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const clean = (v) => { const s = String(v ?? '').trim(); return s === '---' || s === '' ? '' : s; };
const orNull = (v) => clean(v) || null;
const stripHon = (v) => clean(v).replace(/^(mr|mrs|ms|dr|late|smt|shri|km|master)\.?\s*/i, '').trim();
const norm = (v) => stripHon(v).toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim();
const normalizeCode = (v) => clean(v).toLowerCase().replace(/\s+/g, '-').slice(0, 64);
const parseDate = (raw) => {
  const s = clean(raw).replace(/'/g, '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
const dbDate = (d) => {
  if (!d) return null;
  const x = new Date(d);
  // Format using LOCAL components — pg returns `date` as local-midnight Date;
  // toISOString() would shift to the previous day under IST (+5:30).
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const lc = (v) => (v == null ? null : String(v));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = args.configPath || path.join('H:/github/itsmyskool/core-api/configs', args.stage, `${args.stage}.yml`);
  const env = loadConfig(configPath);

  const raw = fs.readFileSync(args.file, 'utf8');
  let records = parse(raw.slice(raw.indexOf('"Sr. No."')), {
    columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true,
  });
  if (args.limit) records = records.slice(0, args.limit);

  const pool = new Pool({
    host: env.POSTGRES_ENDPOINT || env.POSTGRES_HOST,
    database: env.POSTGRES_DATABASE,
    user: env.POSTGRES_USERNAME || env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    port: parseInt(env.POSTGRES_PORT || '5432', 10),
    ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 4, idleTimeoutMillis: 30000, keepAlive: true,
  });
  pool.on('error', () => {});

  const c = await pool.connect();
  const sch = await c.query('select uuid from school where lower(code)=lower($1)', [args.schoolCode]);
  if (!sch.rows.length) throw new Error(`School ${args.schoolCode} not found`);
  const schoolId = sch.rows[0].uuid;

  const ayr = await c.query('select uuid from academic_year where lower(code)=lower($1) and school_id=$2', [args.session, schoolId]);
  const ayId = ayr.rows.length ? ayr.rows[0].uuid : null;

  // Preload students
  const cols = `uuid, admission_number, name, gender, dob, status, student_email, student_mobile,
    category_code, nationality_code, mother_tongue_code, blood_group_code, aadhaar_number,
    previous_school, admission_date, withdrawal_date, withdrawal_remarks,
    father_mobile, mother_mobile, guardian_mobile`;
  const ex = await c.query(`select ${cols} from student where school_id=$1 and status<>'deleted'`, [schoolId]);
  const byAdm = new Map();
  const byNameDob = new Map();
  for (const r of ex.rows) {
    byAdm.set(String(r.admission_number || '').trim().toLowerCase(), r);
    const k = norm(r.name) + '|' + (dbDate(r.dob) || '');
    if (!byNameDob.has(k)) byNameDob.set(k, []);
    byNameDob.get(k).push(String(r.admission_number || '').trim());
  }

  // Preload current-AY enrollment class code per student
  const enrollClass = new Map(); // studentUuid -> classCode (upper)
  if (ayId) {
    const en = await c.query(
      `select sc.student_id, cl.code as class_code
         from student_class sc join class cl on cl.uuid = sc.class_id
        where sc.school_id=$1 and sc.academic_year_id=$2`, [schoolId, ayId]);
    for (const r of en.rows) enrollClass.set(r.student_id, r.class_code);
  }
  const dbAdmInCsv = new Set();

  const newStudents = [];
  const suspectedDup = [];
  const changed = []; // {adm, name, cls, diffs:[{field, from, to}]}
  const fieldCounts = {};

  // Fields: [csvKey mapper -> value, dbColumn, label]  (coalesce semantics: change only if csv present && != db)
  function cmpCoalesce(diffs, label, csvVal, dbVal) {
    if (csvVal == null) return; // sync would keep db value
    if (lc(csvVal) !== lc(dbVal)) diffs.push({ field: label, from: dbVal, to: csvVal });
  }
  function cmpAlways(diffs, label, csvVal, dbVal) { // set unconditionally (name, status)
    if (lc(csvVal) !== lc(dbVal)) diffs.push({ field: label, from: dbVal, to: csvVal });
  }

  for (const row of records) {
    const adm = clean(row['Adm. No.']);
    const cls = clean(row['Class Name']) || '(no class)';
    if (!adm) continue;
    const existing = byAdm.get(adm.toLowerCase());
    const dob = parseDate(row['D.O.B']);

    if (!existing) {
      const k = norm(row['Student Name']) + '|' + (dob || '');
      const hit = byNameDob.get(k);
      if (hit && hit.some((x) => x.toLowerCase() !== adm.toLowerCase())) {
        suspectedDup.push({ name: clean(row['Student Name']), newAdm: adm, existing: hit.join(', '), cls });
      } else {
        newStudents.push({ adm, name: clean(row['Student Name']), cls });
      }
      continue;
    }
    dbAdmInCsv.add(adm.toLowerCase());

    const diffs = [];
    const name = clean(row['Student Name']) || null;
    const statusVal = clean(row['Status']).toLowerCase() === 'inactive' ? 'inactive' : 'active';
    cmpAlways(diffs, 'name', name, existing.name);
    cmpAlways(diffs, 'status', statusVal, existing.status);
    cmpCoalesce(diffs, 'gender', clean(row['Gender']) || null, existing.gender);
    cmpCoalesce(diffs, 'dob', dob, dbDate(existing.dob));
    cmpCoalesce(diffs, 'studentEmail', orNull(row['Student Email']), existing.student_email);
    cmpCoalesce(diffs, 'studentMobile', orNull(row['Student Mobile']), existing.student_mobile);
    cmpCoalesce(diffs, 'category', clean(row['Category']) ? normalizeCode(row['Category']) : null, existing.category_code);
    cmpCoalesce(diffs, 'nationality', clean(row['Nationality']) ? normalizeCode(row['Nationality']) : null, existing.nationality_code);
    cmpCoalesce(diffs, 'motherTongue', clean(row['Mother Tongue']) ? normalizeCode(row['Mother Tongue']) : null, existing.mother_tongue_code);
    cmpCoalesce(diffs, 'bloodGroup', clean(row['Blood Group']) ? normalizeCode(row['Blood Group']) : null, existing.blood_group_code);
    cmpCoalesce(diffs, 'aadhaar', orNull(row['Aadhaar Number']), existing.aadhaar_number);
    cmpCoalesce(diffs, 'previousSchool', orNull(row['Previous School Attended']), existing.previous_school);
    cmpCoalesce(diffs, 'admissionDate', parseDate(row['Date Of Admission']), dbDate(existing.admission_date));
    cmpCoalesce(diffs, 'withdrawalDate', parseDate(row['Date Of Withdrawal']), dbDate(existing.withdrawal_date));
    cmpCoalesce(diffs, 'withdrawalRemarks', orNull(row['Withdrawal Remarks']), existing.withdrawal_remarks);
    cmpCoalesce(diffs, 'fatherMobile', orNull(row['Father Mobile No.']), existing.father_mobile);
    cmpCoalesce(diffs, 'motherMobile', orNull(row['Mother Mobile No.']), existing.mother_mobile);
    cmpCoalesce(diffs, 'guardianMobile', orNull(row['Guardian Mobile No.']), existing.guardian_mobile);
    // enrollment class for the AY
    const dbCls = enrollClass.get(existing.uuid) || null;
    if (dbCls == null) diffs.push({ field: 'enrollClass', from: '(none)', to: cls });
    else if (String(dbCls).toUpperCase() !== cls.toUpperCase()) diffs.push({ field: 'enrollClass', from: dbCls, to: cls });

    if (diffs.length) {
      changed.push({ adm, name, cls, diffs });
      for (const d of diffs) fieldCounts[d.field] = (fieldCounts[d.field] || 0) + 1;
    }
  }

  // DB students not present in CSV (potential withdrawals / not exported)
  const dbOnly = [];
  for (const [admLower, r] of byAdm) {
    if (!dbAdmInCsv.has(admLower) && !suspectedDup.length /*noop*/) {}
  }
  const csvAdmSet = new Set(records.map((r) => clean(r['Adm. No.']).toLowerCase()).filter(Boolean));
  for (const [admLower, r] of byAdm) {
    if (!csvAdmSet.has(admLower)) dbOnly.push({ adm: r.admission_number, name: r.name, status: r.status });
  }

  c.release();
  await pool.end();

  // ---- report ----
  const L = (s) => console.log(s);
  L(`\n=== STUDENT DIFF: CSV vs DB (${args.stage} / ${args.schoolCode} / AY ${args.session}) ===`);
  L(`CSV rows: ${records.length}   DB active students: ${byAdm.size}   AY enrollment loaded: ${ayId ? 'yes' : 'NO (year missing)'}`);
  L(`\nSUMMARY`);
  L(`  New students (in CSV, not in DB):        ${newStudents.length}`);
  L(`  Suspected duplicates (name+DOB match):   ${suspectedDup.length}`);
  L(`  Existing students with field changes:    ${changed.length}`);
  L(`  DB students NOT in this CSV:             ${dbOnly.length}`);

  if (Object.keys(fieldCounts).length) {
    L(`\nCHANGES BY FIELD`);
    for (const [f, n] of Object.entries(fieldCounts).sort((a, b) => b[1] - a[1])) L(`  ${f.padEnd(18)} ${n}`);
  }

  if (newStudents.length) {
    L(`\nNEW STUDENTS (${newStudents.length})`);
    for (const s of newStudents) L(`  + ${s.adm.padEnd(14)} ${s.cls.padEnd(10)} ${s.name}`);
  }
  if (suspectedDup.length) {
    L(`\nSUSPECTED DUPLICATES (${suspectedDup.length}) — would be SKIPPED by sync`);
    for (const s of suspectedDup) L(`  ! ${s.name} new=${s.newAdm} vs existing=${s.existing} [${s.cls}]`);
  }
  if (changed.length) {
    L(`\nFIELD CHANGES (${changed.length} students)`);
    for (const ch of changed) {
      L(`  ~ ${ch.adm} (${ch.name}) [${ch.cls}]`);
      for (const d of ch.diffs) L(`       ${d.field}: ${JSON.stringify(d.from)}  ->  ${JSON.stringify(d.to)}`);
    }
  }
  if (dbOnly.length) {
    L(`\nIN DB BUT NOT IN CSV (${dbOnly.length})`);
    for (const s of dbOnly.slice(0, 200)) L(`  - ${String(s.adm).padEnd(14)} ${s.status.padEnd(9)} ${s.name}`);
    if (dbOnly.length > 200) L(`  ...and ${dbOnly.length - 200} more`);
  }
  L('');
}
main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
