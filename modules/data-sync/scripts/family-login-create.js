/**
 * Create parent (family) logins for the CLEAN, no-decision cohort of the current
 * academic year, and set student.family_unique_number = father mobile so siblings
 * share one login (username = family number, password = default).
 *
 * "Clean" = active + current-year-enrolled students with a valid father mobile,
 * excluding sibling-number conflicts, large families (>=5 on one number), and
 * partial-missing sibling groups. Those excluded students are written to a single
 * detailed exceptions CSV with a reason + linked family data (NO WRITE for them).
 *
 * Recomputes everything from live DB. Preview by default; pass --commit to write.
 *   node family-login-create.js --stage prod --school-code DBPASN            (preview)
 *   node family-login-create.js --stage prod --school-code DBPASN --commit   (write)
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

    // scope: active + enrolled in current year
    const enr = await q('select distinct student_id from student_class where school_id=$1 and academic_year_id=$2', [SID, curAY.uuid]);
    const enrolledCur = new Set(enr.map((r) => r.student_id));
    let students = (await q(
      `select uuid, admission_number, name, status, family_unique_number,
              father_mobile, mother_mobile, guardian_mobile
       from student where school_id=$1 and status <> 'deleted'`, [SID]))
      .filter((s) => s.status === 'active' && enrolledCur.has(s.uuid));

    const fg = await q(
      `select student_id, mobile from student_guardian
       where school_id=$1 and relation='father' and (status is null or status<>'deleted')
         and coalesce(nullif(trim(mobile),''),'') <> ''`, [SID]);
    const fgMobile = new Map();
    for (const r of fg) if (!fgMobile.has(r.student_id)) fgMobile.set(r.student_id, r.mobile);

    // sibling components (within scope)
    const links = await q(`select student_id, sibling_student_id from student_sibling where school_id=$1 and (status is null or status<>'deleted')`, [SID]);
    const uf = new UF();
    const ids = new Set(students.map((s) => s.uuid));
    for (const s of students) uf.find(s.uuid);
    for (const l of links) if (ids.has(l.student_id) && ids.has(l.sibling_student_id)) uf.union(l.student_id, l.sibling_student_id);

    // resolve father mobile
    for (const s of students) {
      s.resolved = normPhone(s.father_mobile) || normPhone(fgMobile.get(s.uuid)) || null;
      s.source = normPhone(s.father_mobile) ? 'student.father_mobile' : normPhone(fgMobile.get(s.uuid)) ? 'father_guardian' : null;
      s.component = uf.find(s.uuid);
    }

    // group maps
    const byPhone = new Map(), byComp = new Map();
    for (const s of students) {
      if (s.resolved) { if (!byPhone.has(s.resolved)) byPhone.set(s.resolved, []); byPhone.get(s.resolved).push(s); }
      if (!byComp.has(s.component)) byComp.set(s.component, []); byComp.get(s.component).push(s);
    }
    const conflictComps = new Set(), missingComps = new Set(), largePhones = new Set();
    for (const [comp, mem] of byComp) {
      if (mem.length < 2) continue;
      const phones = new Set(mem.filter((m) => m.resolved).map((m) => m.resolved));
      if (phones.size > 1) conflictComps.add(comp);
      if (mem.some((m) => !m.resolved) && phones.size >= 1) missingComps.add(comp);
    }
    for (const [phone, g] of byPhone) if (g.length >= 5) largePhones.add(phone);

    const reasonFor = (s) => {
      if (!s.resolved) return 'NO_FATHER_MOBILE';
      if (conflictComps.has(s.component)) return 'SIBLING_CONFLICT';
      if (largePhones.has(s.resolved)) return 'LARGE_FAMILY';
      if (missingComps.has(s.component)) return 'PARTIAL_MISSING';
      return null; // clean
    };

    const clean = students.filter((s) => reasonFor(s) === null);
    const excluded = students.filter((s) => reasonFor(s) !== null);

    // families among clean (father number -> members)
    const cleanFamilies = new Map();
    for (const s of clean) { if (!cleanFamilies.has(s.resolved)) cleanFamilies.set(s.resolved, []); cleanFamilies.get(s.resolved).push(s); }
    const tag = (s) => `${s.admission_number || s.uuid}:${s.name}=${s.resolved || 'NONE'}`;
    const displayNameFor = (mem) => [...mem].sort((a, b) => String(a.admission_number).localeCompare(String(b.admission_number)))[0].name;

    // ---- consolidated exceptions CSV (reason + linked family data) ----
    const excRows = excluded.map((s) => {
      const mem = byComp.get(s.component);
      const numbers = [...new Set(mem.filter((m) => m.resolved).map((m) => m.resolved))];
      return {
        reason: reasonFor(s),
        uuid: s.uuid, admission_number: s.admission_number, name: s.name, status: s.status,
        resolved_father_mobile: s.resolved || '', source: s.source || '',
        sibling_component: s.component, group_size: mem.length,
        group_distinct_numbers: numbers.join(' / '),
        group_members: mem.map(tag).join(' | '),
        father_mobile_raw: s.father_mobile || '', father_guardian_mobile: fgMobile.get(s.uuid) || '',
        mother_mobile: s.mother_mobile || '', guardian_mobile: s.guardian_mobile || '',
      };
    }).sort((a, b) => a.reason.localeCompare(b.reason) || String(a.sibling_component).localeCompare(String(b.sibling_component)));
    fs.writeFileSync(path.join(OUT, `family-login-exceptions-detailed-${curAY.name}.csv`), csv(excRows));

    // ---- created-logins credential sheet ----
    const loginRows = [...cleanFamilies.entries()].map(([num, mem]) => ({
      username: num, password: DEFAULT_PASSWORD, display_name: displayNameFor(mem),
      student_count: mem.length, students: mem.map((m) => `${m.admission_number}:${m.name}`).join(' | '),
    })).sort((a, b) => a.username.localeCompare(b.username));
    fs.writeFileSync(path.join(OUT, `family-login-created-${curAY.name}.csv`), csv(loginRows));

    // report
    const excByReason = {};
    for (const r of excRows) excByReason[r.reason] = (excByReason[r.reason] || 0) + 1;
    console.log(`\n===== FAMILY-LOGIN CREATE — ${SCHOOL_CODE} (${STAGE}) ${COMMIT ? '[COMMIT]' : '[PREVIEW]'} =====`);
    console.log(`Academic year: ${curAY.name}   scope: active + enrolled ${curAY.name}`);
    console.log(`In scope: ${students.length}`);
    console.log(`CLEAN: ${clean.length} students -> ${cleanFamilies.size} logins`);
    console.log(`EXCLUDED: ${excluded.length}  ${JSON.stringify(excByReason)}`);
    console.log(`\nWould: set family_unique_number on ${clean.length} students, insert ${cleanFamilies.size} student_login rows.`);
    console.log(`Reports: family-login-created-${curAY.name}.csv, family-login-exceptions-detailed-${curAY.name}.csv`);

    if (!COMMIT) { console.log('\nPREVIEW only — re-run with --commit to write.'); return; }

    // ---- WRITE (transactional, idempotent) ----
    const client = await pool.connect();
    let updated = 0, inserted = 0;
    try {
      await client.query('begin');
      for (const s of clean) {
        const r = await client.query(
          `update student set family_unique_number=$1, updatedby_userid=$2, updated_at=now()
           where uuid=$3 and school_id=$4 and coalesce(nullif(trim(family_unique_number),''),'') = ''`,
          [s.resolved, SYSTEM_USER, s.uuid, SID]);
        updated += r.rowCount;
      }
      for (const [num, mem] of cleanFamilies) {
        const r = await client.query(
          `insert into student_login (uuid, username, password, display_name, school_id, createdby_userid, created_at)
           values ($1,$2,$3,$4,$5,$6,now()) on conflict (username, school_id) do nothing`,
          [generateShortUuid(12), num, DEFAULT_PASSWORD, displayNameFor(mem), SID, SYSTEM_USER]);
        inserted += r.rowCount;
      }
      await client.query('commit');
      console.log(`\nCOMMITTED: student rows updated (family_unique_number): ${updated}; student_login inserted: ${inserted}`);
    } catch (e) {
      await client.query('rollback');
      console.error('ROLLED BACK:', e.message);
      process.exitCode = 1;
    } finally {
      client.release();
    }
  } catch (e) {
    console.error('ERR', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
