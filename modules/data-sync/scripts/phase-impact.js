/**
 * Read-only impact preview for a sync phase under the NEW logic (entry-date join_date
 * rule + --address-fill-only). Reports student insert/update/dup, enrollment
 * join_date shifts / new enrollments, and address fill-vs-skip. Writes nothing.
 *
 * Usage: node phase-impact.js --stage prod --school-code DBPASN --file "<csv>" --academic-session 2026-27
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
function arg(n) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; }
const clean = (v) => { const s = String(v ?? '').trim(); return s === '---' || s === '' ? '' : s; };
const orNull = (v) => clean(v) || null;
const stripHon = (v) => clean(v).replace(/^(mr|mrs|ms|dr|late|smt|shri|km|master)\.?\s*/i, '').trim();
const norm = (v) => stripHon(v).toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim();
const parseDate = (raw) => { const s = clean(raw).replace(/'/g, '').trim(); const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (m) return `${m[3]}-${m[2]}-${m[1]}`; return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };
const dbDate = (d) => { if (!d) return null; const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
function loadConfig(stage) { const cfg = fs.readFileSync(path.join('H:/github/itsmyskool/core-api/configs', stage, `${stage}.yml`), 'utf8'); const env = {}; for (const l of cfg.split('\n')) { const m = l.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/); if (m) env[m[1]] = m[2]; } return env; }

(async () => {
  const stage = arg('--stage'), schoolCode = arg('--school-code'), file = arg('--file'), session = arg('--academic-session');
  const env = loadConfig(stage);
  const m = session.match(/^(\d{4})-(\d{2})$/);
  const ayStart = `${m[1]}-04-01`, ayEnd = `${Math.floor(+m[1] / 100) * 100 + +m[2]}-03-31`;
  const raw = fs.readFileSync(file, 'utf8');
  const rows = parse(raw.slice(raw.indexOf('"Sr. No."')), { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true });

  const pool = new Pool({ host: env.POSTGRES_ENDPOINT || env.POSTGRES_HOST, database: env.POSTGRES_DATABASE, user: env.POSTGRES_USERNAME || env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, port: parseInt(env.POSTGRES_PORT || '5432', 10), ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 2 });
  pool.on('error', () => {});
  const c = await pool.connect();
  const schoolId = (await c.query('select uuid from school where lower(code)=lower($1)', [schoolCode])).rows[0].uuid;
  const ayr = await c.query('select uuid from academic_year where lower(code)=lower($1) and school_id=$2', [session, schoolId]);
  const ayId = ayr.rows.length ? ayr.rows[0].uuid : null;

  const ex = await c.query("select uuid, admission_number, name, dob, status from student where school_id=$1 and status<>'deleted'", [schoolId]);
  const byAdm = new Map(); const byNameDob = new Map();
  for (const r of ex.rows) {
    byAdm.set(String(r.admission_number || '').trim().toLowerCase(), r);
    const k = norm(r.name) + '|' + (dbDate(r.dob) || ''); if (!byNameDob.has(k)) byNameDob.set(k, []); byNameDob.get(k).push(String(r.admission_number || '').trim());
  }
  // existing enrollment join_date for this AY, and students with any active address
  const enrByStudent = new Map();
  if (ayId) { const en = await c.query('select student_id, join_date from student_class where school_id=$1 and academic_year_id=$2', [schoolId, ayId]); for (const r of en.rows) enrByStudent.set(r.student_id, dbDate(r.join_date)); }
  const hasAddr = new Set((await c.query("select distinct student_id from student_address where school_id=$1 and status='active'", [schoolId])).rows.map((r) => r.student_id));
  c.release(); await pool.end();

  let studInsert = 0, studUpdate = 0, studDup = 0;
  let enrNew = 0, enrJoinChange = 0, enrJoinSame = 0;
  let addrFill = 0, addrSkip = 0, addrNoLine = 0;
  const joinExamples = [];
  for (const row of rows) {
    const adm = clean(row['Adm. No.']); if (!adm) continue;
    const existing = byAdm.get(adm.toLowerCase());
    const dob = parseDate(row['D.O.B']);
    let studentId = null;
    if (existing) { studUpdate++; studentId = existing.uuid; }
    else { const hit = byNameDob.get(norm(row['Student Name']) + '|' + (dob || '')); if (hit && hit.some((x) => x.toLowerCase() !== adm.toLowerCase())) { studDup++; continue; } studInsert++; }

    // join_date under new rule
    const rawJoin = parseDate(row['Date Of Joining']);
    const newJoin = (rawJoin && rawJoin >= ayStart && rawJoin <= ayEnd) ? rawJoin : ayStart;
    if (studentId && enrByStudent.has(studentId)) {
      const old = enrByStudent.get(studentId);
      if (old === newJoin) enrJoinSame++; else { enrJoinChange++; if (joinExamples.length < 12) joinExamples.push({ adm, name: clean(row['Student Name']), old, new: newJoin }); }
    } else { enrNew++; }

    // address fill-only impact
    const hasLine = !!(orNull(row['Permanent Address']) || orNull(row['Correspondence Address']));
    if (!hasLine) addrNoLine++;
    else if (studentId && hasAddr.has(studentId)) addrSkip++;
    else addrFill++;
  }

  const P = (s) => console.log(s);
  P(`\n=== PHASE IMPACT: ${session}  (${path.basename(file)}) ===`);
  P(`AY ${session}: start ${ayStart}  end ${ayEnd}  ${ayId ? '(exists in DB)' : '(NOT in DB — would be created)'}`);
  P(`\nSTUDENTS   update(matched): ${studUpdate}   insert(new): ${studInsert}   suspected-dup(skip): ${studDup}`);
  P(`ENROLLMENT (AY ${session})   new rows: ${enrNew}   join_date CHANGES: ${enrJoinChange}   join_date unchanged: ${enrJoinSame}`);
  P(`ADDRESS (fill-only)   would FILL (no addr now): ${addrFill}   SKIP (already has): ${addrSkip}   no line in file: ${addrNoLine}`);
  if (joinExamples.length) { P(`\nSample join_date changes:`); for (const e of joinExamples) P(`  ${e.adm.padEnd(14)} ${String(e.old).padEnd(12)} -> ${e.new}   ${e.name}`); }
  P('');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
