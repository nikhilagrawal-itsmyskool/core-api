/**
 * READ-ONLY check: resolve sibling father-mobile conflicts by picking the number on
 * the LAST admission (max admission_date) in each sibling group and applying it to
 * the whole group. Simulates only — no writes. Flags groups where the rule is
 * ambiguous (latest record has no valid number, or an admission_date tie between
 * records carrying different numbers).
 *
 *   node family-login-resolve-check.js --stage prod --school-code DBPASN
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const STAGE = arg('--stage', 'prod');
const SCHOOL_CODE = arg('--school-code', 'DBPASN');
const OUT = path.join(__dirname, '..', 'reports');

function loadConfig(stage) {
  const cfg = fs.readFileSync(path.join('H:/github/itsmyskool/core-api/configs', stage, `${stage}.yml`), 'utf8');
  const env = {};
  for (const l of cfg.split('\n')) { const m = l.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/); if (m) env[m[1]] = m[2]; }
  return env;
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
function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
class UF {
  constructor() { this.p = new Map(); }
  find(x) { if (!this.p.has(x)) this.p.set(x, x); let r = x; while (this.p.get(r) !== r) r = this.p.get(r); while (this.p.get(x) !== r) { const n = this.p.get(x); this.p.set(x, r); x = n; } return r; }
  union(a, b) { this.p.set(this.find(a), this.find(b)); }
}
const dstr = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

(async () => {
  const env = loadConfig(STAGE);
  const pool = new Pool({
    host: env.POSTGRES_ENDPOINT || env.POSTGRES_HOST, database: env.POSTGRES_DATABASE,
    user: env.POSTGRES_USERNAME || env.POSTGRES_USER, password: env.POSTGRES_PASSWORD,
    port: parseInt(env.POSTGRES_PORT || '5432', 10),
    ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 2,
  });
  pool.on('error', () => {});
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const SID = (await q('select uuid from school where lower(code)=lower($1)', [SCHOOL_CODE]))[0].uuid;
    const curAY = (await q('select uuid, name from academic_year where school_id=$1 order by start_date desc nulls last limit 1', [SID]))[0];

    const enr = await q('select distinct student_id from student_class where school_id=$1 and academic_year_id=$2', [SID, curAY.uuid]);
    const enrolledCur = new Set(enr.map((r) => r.student_id));
    let students = (await q(
      `select uuid, admission_number, name, status, family_unique_number, admission_date,
              father_mobile, mother_mobile, guardian_mobile
       from student where school_id=$1 and status <> 'deleted'`, [SID]))
      .filter((s) => s.status === 'active' && enrolledCur.has(s.uuid));

    const fg = await q(
      `select student_id, mobile from student_guardian
       where school_id=$1 and relation='father' and (status is null or status<>'deleted')
         and coalesce(nullif(trim(mobile),''),'') <> ''`, [SID]);
    const fgMobile = new Map();
    for (const r of fg) if (!fgMobile.has(r.student_id)) fgMobile.set(r.student_id, r.mobile);

    const links = await q(`select student_id, sibling_student_id from student_sibling where school_id=$1 and (status is null or status<>'deleted')`, [SID]);
    const uf = new UF();
    const ids = new Set(students.map((s) => s.uuid));
    for (const s of students) uf.find(s.uuid);
    for (const l of links) if (ids.has(l.student_id) && ids.has(l.sibling_student_id)) uf.union(l.student_id, l.sibling_student_id);

    for (const s of students) { s.resolved = normPhone(s.father_mobile) || normPhone(fgMobile.get(s.uuid)) || null; s.component = uf.find(s.uuid); }
    const byComp = new Map();
    for (const s of students) { if (!byComp.has(s.component)) byComp.set(s.component, []); byComp.get(s.component).push(s); }

    // conflict groups only
    const groups = [];
    for (const [comp, mem] of byComp) {
      if (mem.length < 2) continue;
      const phones = new Set(mem.filter((m) => m.resolved).map((m) => m.resolved));
      if (phones.size > 1) groups.push([comp, mem]);
    }

    const summary = [], changes = [];
    let cleanGroups = 0, reviewGroups = 0, recordsToUpdate = 0;
    for (const [comp, mem] of groups) {
      // latest admission first; tie-break by admission_number desc for determinism
      const sorted = [...mem].sort((a, b) => {
        const da = a.admission_date ? +new Date(a.admission_date) : -Infinity;
        const db = b.admission_date ? +new Date(b.admission_date) : -Infinity;
        return db - da || String(b.admission_number).localeCompare(String(a.admission_number));
      });
      const latest = sorted[0];
      const latestWithNum = sorted.find((m) => m.resolved) || null;
      // ambiguity flags
      const latestHasNum = !!latest.resolved;
      const secondDate = sorted[1] ? (sorted[1].admission_date ? +new Date(sorted[1].admission_date) : -Infinity) : null;
      const latestDate = latest.admission_date ? +new Date(latest.admission_date) : -Infinity;
      const dateTie = sorted[1] && latestDate === secondDate && sorted[0].resolved !== sorted[1].resolved;

      const chosen = latestHasNum ? latest.resolved : (latestWithNum ? latestWithNum.resolved : null);
      const flags = [];
      if (!latestHasNum) flags.push('LATEST_HAS_NO_NUMBER->used_next_admission_with_number');
      if (dateTie) flags.push('ADMISSION_DATE_TIE');
      if (!chosen) flags.push('NO_VALID_NUMBER_IN_GROUP');
      if (flags.length) reviewGroups++; else cleanGroups++;

      const toChange = mem.filter((m) => m.resolved !== chosen); // includes those with a different number OR none
      recordsToUpdate += toChange.length;

      summary.push({
        component: comp, group_size: mem.length,
        chosen_number: chosen || '', chosen_from: latestHasNum ? latest.admission_number : (latestWithNum ? latestWithNum.admission_number : ''),
        chosen_admission_date: dstr(latestHasNum ? latest.admission_date : latestWithNum && latestWithNum.admission_date),
        distinct_numbers: [...new Set(mem.filter((m) => m.resolved).map((m) => m.resolved))].join(' / '),
        records_to_update: toChange.length,
        flags: flags.join('; '),
        members: sorted.map((m) => `${m.admission_number}:${m.name}[${dstr(m.admission_date)}]=${m.resolved || 'NONE'}`).join(' | '),
      });
      for (const m of toChange) changes.push({
        component: comp, uuid: m.uuid, admission_number: m.admission_number, name: m.name,
        admission_date: dstr(m.admission_date), current_number: m.resolved || '', new_number: chosen || '',
        flags: flags.join('; '),
      });
    }

    fs.writeFileSync(path.join(OUT, `family-login-conflict-resolution-${curAY.name}.csv`), csv(summary));
    fs.writeFileSync(path.join(OUT, `family-login-conflict-changes-${curAY.name}.csv`), csv(changes));

    const studentsAffected = new Set(groups.flatMap(([, m]) => m.map((x) => x.uuid))).size;
    const newLogins = new Set(summary.map((s) => s.chosen_number).filter(Boolean)).size;
    console.log(`\n===== CONFLICT-RESOLUTION CHECK — ${SCHOOL_CODE} (${STAGE}, read-only) =====`);
    console.log(`Rule: within each sibling group, adopt the father number on the LAST admission (max admission_date).`);
    console.log(`Academic year: ${curAY.name}\n`);
    console.log(`Conflict groups:            ${groups.length}   (students: ${studentsAffected})`);
    console.log(`  resolve cleanly by rule:  ${cleanGroups}`);
    console.log(`  need review (flagged):    ${reviewGroups}`);
    console.log(`Student records to update (family number changes): ${recordsToUpdate}`);
    console.log(`New family logins these would yield:               ${newLogins}`);
    console.log(`\nReports:`);
    console.log(`  family-login-conflict-resolution-${curAY.name}.csv  (per group: chosen number, flags)`);
    console.log(`  family-login-conflict-changes-${curAY.name}.csv     (per record: current -> new number)`);
  } catch (e) {
    console.error('ERR', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
