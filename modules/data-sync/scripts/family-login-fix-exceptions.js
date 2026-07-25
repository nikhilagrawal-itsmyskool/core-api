/**
 * One-off, idempotent fix for the parked family-login EXCEPTIONS that the
 * clean/conflict scripts intentionally skipped (LARGE_FAMILY, PARTIAL_MISSING,
 * and a mother-mobile fallback where no father number exists). Every entry below
 * is a school-CONFIRMED resolution: it sets family_unique_number on the listed
 * students (only where currently empty) and creates the shared login
 * (on conflict do nothing). Mirrors family-login-resolve-apply.js conventions
 * (phone normalize, default password, display name = lowest admission number).
 *
 * Preview by default; --commit to write. Safe to re-run.
 *   node family-login-fix-exceptions.js --stage prod --school-code DBPASN [--commit]
 *
 * Approved cases (2026-27, DBPASN):
 *   LARGE_FAMILY    9936678663 -> 6 siblings (genuine family, confirmed w/ school)
 *   PARTIAL_MISSING 8960715034 -> Vedansh 588/S/2K23 + sibling Shreyansh 1063/2K26
 *   MOTHER_FALLBACK 9305222851 -> Navya 803/S/2K25 (no father #; mother's mobile)
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { generateShortUuid } = require('H:/github/itsmyskool/core-api/shared/util/generate-uuid.js');

function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const STAGE = arg('--stage', 'prod');
const SCHOOL_CODE = arg('--school-code', 'DBPASN');
const COMMIT = process.argv.includes('--commit');
const DEFAULT_PASSWORD = 'Itsmyskool@123';
const SYSTEM_USER = '0';

// School-confirmed exception resolutions. Number is the family login username;
// admissions are the students who should carry it.
const FIXES = [
  { label: 'LARGE_FAMILY',    number: '9936678663', admissions: ['722/S/2K24', '278/J/2K22', '475/S/2K22', '725/S/2K24', '487/S/2K22', '480/S/2K22'] },
  { label: 'PARTIAL_MISSING', number: '8960715034', admissions: ['588/S/2K23', '1063/2K26'] },
  { label: 'MOTHER_FALLBACK', number: '9305222851', admissions: ['803/S/2K25'] },
];

function loadConfig(stage) {
  const cfg = fs.readFileSync(path.join('H:/github/itsmyskool/core-api/configs', stage, `${stage}.yml`), 'utf8');
  const env = {}; for (const l of cfg.split('\n')) { const m = l.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/); if (m) env[m[1]] = m[2]; } return env;
}
function normPhone(raw) {
  if (raw == null) return null;
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length !== 10) return null;
  if (!/^[6-9]/.test(d)) return null;
  if (/^(\d)\1{9}$/.test(d)) return null;
  if (['1234567890', '9876543210'].includes(d)) return null;
  return d;
}

(async () => {
  const env = loadConfig(STAGE);
  const pool = new Pool({
    host: env.POSTGRES_ENDPOINT || env.POSTGRES_HOST, database: env.POSTGRES_DATABASE,
    user: env.POSTGRES_USERNAME || env.POSTGRES_USER, password: env.POSTGRES_PASSWORD,
    port: parseInt(env.POSTGRES_PORT || '5432', 10),
    ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 3,
  });
  pool.on('error', () => {});
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
  try {
    const SID = (await q('select uuid from school where lower(code)=lower($1)', [SCHOOL_CODE]))[0].uuid;

    console.log(`\n===== FAMILY-LOGIN EXCEPTION FIX — ${SCHOOL_CODE} (${STAGE}) ${COMMIT ? '[COMMIT]' : '[PREVIEW]'} =====\n`);

    const plan = []; // { fix, number, members:[{uuid,adm,name,current}], displayName, loginExists }
    let problems = 0;
    for (const fix of FIXES) {
      const number = normPhone(fix.number);
      if (!number) { console.log(`  ✗ ${fix.label}: invalid number "${fix.number}" — skipped`); problems++; continue; }
      const rows = await q(
        `select uuid, admission_number, name, family_unique_number, status
           from student where school_id=$1 and lower(admission_number) = any($2)`,
        [SID, fix.admissions.map((a) => a.toLowerCase())]);
      const found = new Map(rows.map((r) => [String(r.admission_number).toLowerCase(), r]));
      const members = [];
      for (const adm of fix.admissions) {
        const r = found.get(adm.toLowerCase());
        if (!r) { console.log(`  ✗ ${fix.label} ${number}: admission ${adm} NOT FOUND`); problems++; continue; }
        if (r.status !== 'active') { console.log(`  ⚠ ${fix.label} ${number}: ${adm} (${r.name}) status=${r.status} — still applying`); }
        members.push({ uuid: r.uuid, adm: r.admission_number, name: r.name, current: (r.family_unique_number || '').trim() });
      }
      if (!members.length) continue;
      const displayName = [...members].sort((a, b) => String(a.adm).localeCompare(String(b.adm)))[0].name;
      const loginExists = (await q('select 1 from student_login where school_id=$1 and username=$2', [SID, number])).length > 0;
      plan.push({ label: fix.label, number, members, displayName, loginExists });
    }

    let willUpdate = 0, willLogin = 0;
    for (const p of plan) {
      console.log(`  ${p.label}  ${p.number}  (login: ${p.loginExists ? 'exists' : 'CREATE'} -> "${p.displayName}")`);
      for (const m of p.members) {
        const action = m.current === '' ? 'set' : (m.current === p.number ? 'already-set' : `CONFLICT(has ${m.current})`);
        if (m.current === '') willUpdate++;
        console.log(`      ${m.adm.padEnd(12)} ${m.name.padEnd(18)} ${action}`);
      }
      if (!p.loginExists) willLogin++;
    }
    console.log(`\nWould set family_unique_number on ${willUpdate} student(s); create ${willLogin} login(s). Problems: ${problems}.`);

    if (!COMMIT) { console.log('\nPREVIEW only — re-run with --commit to write.'); return; }

    const client = await pool.connect();
    let updated = 0, inserted = 0;
    try {
      await client.query('begin');
      for (const p of plan) {
        for (const m of p.members) {
          const r = await client.query(
            `update student set family_unique_number=$1, updatedby_userid=$2, updated_at=now()
               where uuid=$3 and school_id=$4 and coalesce(nullif(trim(family_unique_number),''),'') = ''`,
            [p.number, SYSTEM_USER, m.uuid, SID]);
          updated += r.rowCount;
        }
        const r2 = await client.query(
          `insert into student_login (uuid, username, password, display_name, school_id, createdby_userid, created_at)
             values ($1,$2,$3,$4,$5,$6,now()) on conflict (username, school_id) do nothing`,
          [generateShortUuid(12), p.number, DEFAULT_PASSWORD, p.displayName, SID, SYSTEM_USER]);
        inserted += r2.rowCount;
      }
      await client.query('commit');
      console.log(`\nCOMMITTED: student rows updated: ${updated}; student_login inserted: ${inserted}.`);
    } catch (e) {
      await client.query('rollback'); console.error('ROLLED BACK:', e.message); process.exitCode = 1;
    } finally { client.release(); }
  } catch (e) {
    console.error('ERR', e.stack || e.message); process.exitCode = 1;
  } finally { await pool.end(); }
})();
