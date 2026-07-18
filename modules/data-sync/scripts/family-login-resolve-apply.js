/**
 * Resolve sibling father-mobile CONFLICTS and create the resulting family logins.
 * Rule: within each sibling group with >1 father number, adopt the number on the
 * LAST admission (max admission_date; tie-break = highest admission_number), set it
 * as family_unique_number on every member of that group (a number-less sibling in
 * the group inherits it), and create one login per group.
 *
 * Then writes the POST-ALGORITHM exceptions file: students still without a login
 * (no valid number anywhere, large-family review cases, partial-missing groups).
 *
 * Preview by default; --commit to write. Read-recompute from live DB.
 *   node family-login-resolve-apply.js --stage prod --school-code DBPASN [--commit]
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
const OUT = path.join(__dirname, '..', 'reports');

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
    ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 3,
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
    const byComp = new Map(), byPhone = new Map();
    for (const s of students) {
      if (!byComp.has(s.component)) byComp.set(s.component, []); byComp.get(s.component).push(s);
      if (s.resolved) { if (!byPhone.has(s.resolved)) byPhone.set(s.resolved, []); byPhone.get(s.resolved).push(s); }
    }
    const largePhones = new Set([...byPhone].filter(([, g]) => g.length >= 5).map(([p]) => p));

    // conflict components -> chosen number by rule
    const chosenByComp = new Map(); // comp -> number
    const changes = [];
    for (const [comp, mem] of byComp) {
      if (mem.length < 2) continue;
      const phones = new Set(mem.filter((m) => m.resolved).map((m) => m.resolved));
      if (phones.size <= 1) continue; // not a conflict
      const sorted = [...mem].sort((a, b) => {
        const da = a.admission_date ? +new Date(a.admission_date) : -Infinity;
        const db = b.admission_date ? +new Date(b.admission_date) : -Infinity;
        return db - da || String(b.admission_number).localeCompare(String(a.admission_number));
      });
      const chosen = sorted[0].resolved || (sorted.find((m) => m.resolved) || {}).resolved || null;
      if (!chosen) continue;
      chosenByComp.set(comp, chosen);
      for (const m of mem) if (m.resolved !== chosen) changes.push({
        component: comp, uuid: m.uuid, admission_number: m.admission_number, name: m.name,
        admission_date: dstr(m.admission_date), current_number: m.resolved || '(none)', new_number: chosen,
      });
    }
    const resolvedIds = new Set([...chosenByComp.keys()].flatMap((c) => byComp.get(c).map((m) => m.uuid)));

    // reason classification for whatever remains after algo (not clean, not conflict-resolved)
    const conflictComps = new Set(chosenByComp.keys());
    const missingComps = new Set();
    for (const [comp, mem] of byComp) {
      if (mem.length < 2) continue;
      const phones = new Set(mem.filter((m) => m.resolved).map((m) => m.resolved));
      if (mem.some((m) => !m.resolved) && phones.size === 1) missingComps.add(comp); // partial-missing, single number
    }
    const remainingReason = (s) => {
      if (conflictComps.has(s.component)) return null; // resolved by algo (incl. inherited)
      if (largePhones.has(s.resolved)) return 'LARGE_FAMILY';
      if (!s.resolved) return 'NO_FATHER_MOBILE';
      if (missingComps.has(s.component)) return 'PARTIAL_MISSING';
      return null; // clean (already has a login from the earlier run)
    };
    const tag = (s) => `${s.admission_number}:${s.name}[${dstr(s.admission_date)}]=${s.resolved || 'NONE'}`;
    const remaining = students.filter((s) => remainingReason(s) !== null && (largePhones.has(s.resolved) || !s.resolved || missingComps.has(s.component)));
    const afterAlgo = remaining.map((s) => {
      const mem = byComp.get(s.component);
      return {
        reason: remainingReason(s), stage: 'after-conflict-algorithm',
        uuid: s.uuid, admission_number: s.admission_number, name: s.name, status: s.status,
        resolved_father_mobile: s.resolved || '', sibling_component: s.component, group_size: mem.length,
        group_distinct_numbers: [...new Set(mem.filter((m) => m.resolved).map((m) => m.resolved))].join(' / '),
        group_members: mem.map(tag).join(' | '),
        father_mobile_raw: s.father_mobile || '', father_guardian_mobile: fgMobile.get(s.uuid) || '',
        mother_mobile: s.mother_mobile || '', guardian_mobile: s.guardian_mobile || '',
      };
    }).sort((a, b) => a.reason.localeCompare(b.reason));

    fs.writeFileSync(path.join(OUT, `family-login-conflict-changes-applied-${curAY.name}.csv`), csv(changes));
    fs.writeFileSync(path.join(OUT, `family-login-exceptions-after-algo-${curAY.name}.csv`), csv(afterAlgo));

    const displayNameFor = (mem) => [...mem].sort((a, b) => String(a.admission_number).localeCompare(String(b.admission_number)))[0].name;
    const remByReason = {}; for (const r of afterAlgo) remByReason[r.reason] = (remByReason[r.reason] || 0) + 1;

    console.log(`\n===== CONFLICT RESOLVE + CREATE — ${SCHOOL_CODE} (${STAGE}) ${COMMIT ? '[COMMIT]' : '[PREVIEW]'} =====`);
    console.log(`Academic year: ${curAY.name}`);
    console.log(`Conflict groups resolved: ${chosenByComp.size}  -> ${new Set([...chosenByComp.values()]).size} new logins`);
    console.log(`Student records set to a family number: ${resolvedIds.size}  (of which number changed: ${changes.length})`);
    console.log(`Remaining exceptions after algorithm: ${afterAlgo.length}  ${JSON.stringify(remByReason)}`);
    console.log(`Reports: family-login-conflict-changes-applied-${curAY.name}.csv, family-login-exceptions-after-algo-${curAY.name}.csv`);

    if (!COMMIT) { console.log('\nPREVIEW only — re-run with --commit to write.'); return; }

    const client = await pool.connect();
    let updated = 0, inserted = 0;
    try {
      await client.query('begin');
      for (const [comp, chosen] of chosenByComp) {
        for (const m of byComp.get(comp)) {
          const r = await client.query(
            `update student set family_unique_number=$1, updatedby_userid=$2, updated_at=now()
             where uuid=$3 and school_id=$4 and coalesce(nullif(trim(family_unique_number),''),'') = ''`,
            [chosen, SYSTEM_USER, m.uuid, SID]);
          updated += r.rowCount;
        }
        const r2 = await client.query(
          `insert into student_login (uuid, username, password, display_name, school_id, createdby_userid, created_at)
           values ($1,$2,$3,$4,$5,$6,now()) on conflict (username, school_id) do nothing`,
          [generateShortUuid(12), chosen, DEFAULT_PASSWORD, displayNameFor(byComp.get(comp)), SID, SYSTEM_USER]);
        inserted += r2.rowCount;
      }
      await client.query('commit');
      console.log(`\nCOMMITTED: student rows updated: ${updated}; student_login inserted: ${inserted}`);
    } catch (e) {
      await client.query('rollback'); console.error('ROLLED BACK:', e.message); process.exitCode = 1;
    } finally { client.release(); }
  } catch (e) {
    console.error('ERR', e.stack || e.message); process.exitCode = 1;
  } finally { await pool.end(); }
})();
