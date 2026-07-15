/**
 * Read-only: find students in the back-year CSV whose CURRENT DB status would be
 * clobbered by a naive import (DB inactive/withdrawn but CSV says Active).
 * Usage: node check-backyear-status.js --stage prod --school-code DBPASN --file "<2025-26 csv>"
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }
const clean = (v) => { const s = String(v ?? '').trim(); return s === '---' || s === '' ? '' : s; };
function loadConfig(stage) {
  const cfg = fs.readFileSync(path.join('H:/github/itsmyskool/core-api/configs', stage, `${stage}.yml`), 'utf8');
  const env = {}; for (const l of cfg.split('\n')) { const m = l.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/); if (m) env[m[1]] = m[2]; } return env;
}
(async () => {
  const stage = arg('--stage'), schoolCode = arg('--school-code'), file = arg('--file');
  const env = loadConfig(stage);
  const raw = fs.readFileSync(file, 'utf8');
  const rows = parse(raw.slice(raw.indexOf('"Sr. No."')), { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true });
  const csv = new Map(); // admLower -> {adm, name, status}
  for (const r of rows) { const a = clean(r['Adm. No.']); if (a) csv.set(a.toLowerCase(), { adm: a, name: clean(r['Student Name']), status: (clean(r['Status']).toLowerCase() === 'inactive' ? 'inactive' : 'active') }); }
  const pool = new Pool({ host: env.POSTGRES_ENDPOINT || env.POSTGRES_HOST, database: env.POSTGRES_DATABASE, user: env.POSTGRES_USERNAME || env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, port: parseInt(env.POSTGRES_PORT || '5432', 10), ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 2 });
  pool.on('error', () => {});
  const c = await pool.connect();
  const sch = await c.query('select uuid from school where lower(code)=lower($1)', [schoolCode]);
  const schoolId = sch.rows[0].uuid;
  const db = await c.query("select admission_number, name, status from student where school_id=$1 and status<>'deleted'", [schoolId]);
  const dbByAdm = new Map(db.rows.map((r) => [String(r.admission_number || '').trim().toLowerCase(), r]));
  c.release(); await pool.end();

  const wouldReactivate = []; // DB inactive, CSV active
  const dbInactiveTotal = [];
  for (const [k, v] of csv) {
    const d = dbByAdm.get(k);
    if (d && String(d.status) === 'inactive') { dbInactiveTotal.push({ ...v, dbName: d.name }); if (v.status === 'active') wouldReactivate.push({ ...v, dbName: d.name }); }
  }
  console.log(`\nCSV rows: ${csv.size}   DB (non-deleted): ${dbByAdm.size}`);
  console.log(`Of CSV students, currently INACTIVE in DB: ${dbInactiveTotal.length}`);
  console.log(`  ...of those, CSV marks ACTIVE (would be wrongly reactivated): ${wouldReactivate.length}\n`);
  for (const x of wouldReactivate) console.log(`  ! ${x.adm.padEnd(14)} DB=inactive  CSV=active   ${x.name}`);
  console.log('');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
