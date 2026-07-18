/**
 * DRY RUN (read-only): assess creating student_login rows keyed on
 * family_unique_number = father's mobile, with siblings sharing it.
 *
 * Resolves father mobile (student.father_mobile -> father student_guardian row),
 * validates it as a real 10-digit Indian mobile, groups students into families,
 * and reconciles against student_sibling links. Enriches every student with
 * current-academic-year enrollment so we can tell which issues touch this year's
 * active roll. SELECT only. Writes CSV reports to ../reports.
 *
 * Usage: node family-login-dryrun.js --stage prod --school-code DBPASN
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function arg(n, d) { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; }
const STAGE = arg('--stage', 'prod');
const SCHOOL_CODE = arg('--school-code', 'DBPASN');
const ACTIVE_ONLY = process.argv.includes('--active-only'); // scope to active + current-year-enrolled
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
  if (/^(\d)\1{9}$/.test(d)) return null;                 // all-same-digit
  if (['1234567890', '9876543210'].includes(d)) return null;
  return d;
}

function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}
function write(name, rows) { fs.writeFileSync(path.join(OUT, name), csv(rows)); return rows.length; }

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
    ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false }, max: 2,
  });
  pool.on('error', () => {});
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const SID = (await q('select uuid from school where lower(code)=lower($1)', [SCHOOL_CODE]))[0].uuid;
    const curAY = (await q(
      'select uuid, name from academic_year where school_id=$1 order by start_date desc nulls last limit 1', [SID]))[0];

    let students = await q(
      `select uuid, admission_number, name, status, father_mobile, mother_mobile, guardian_mobile
       from student where school_id=$1 and status <> 'deleted'`, [SID]);

    const fg = await q(
      `select student_id, mobile from student_guardian
       where school_id=$1 and relation='father' and (status is null or status<>'deleted')
         and coalesce(nullif(trim(mobile),''),'') <> ''`, [SID]);
    const fgMobile = new Map();
    for (const r of fg) if (!fgMobile.has(r.student_id)) fgMobile.set(r.student_id, r.mobile);

    // current-year enrollment
    const enr = await q(
      `select distinct student_id from student_class
       where school_id=$1 and academic_year_id=$2`, [SID, curAY.uuid]);
    const enrolledCur = new Set(enr.map((r) => r.student_id));

    // scope to the current-year active roll when requested — sibling links, family
    // grouping and conflicts are then computed only among these students.
    if (ACTIVE_ONLY) students = students.filter((s) => s.status === 'active' && enrolledCur.has(s.uuid));

    // sibling components
    const links = await q(
      `select student_id, sibling_student_id from student_sibling
       where school_id=$1 and (status is null or status<>'deleted')`, [SID]);
    const uf = new UF();
    const ids = new Set(students.map((s) => s.uuid));
    for (const s of students) uf.find(s.uuid);
    for (const l of links) if (ids.has(l.student_id) && ids.has(l.sibling_student_id)) uf.union(l.student_id, l.sibling_student_id);

    const byId = new Map();
    for (const s of students) {
      const fromStudent = normPhone(s.father_mobile);
      const fromGuardian = normPhone(fgMobile.get(s.uuid));
      const resolved = fromStudent || fromGuardian || null;
      const activeCur = s.status === 'active' && enrolledCur.has(s.uuid);
      byId.set(s.uuid, { ...s, fatherRaw: s.father_mobile, resolved,
        source: fromStudent ? 'student.father_mobile' : fromGuardian ? 'father_guardian' : null,
        component: uf.find(s.uuid), enrolledCur: enrolledCur.has(s.uuid), activeCur });
    }
    const all = [...byId.values()];
    const tag = (s) => `${s.admission_number || s.uuid}:${s.name}${s.activeCur ? '*' : ''}=${s.resolved || 'NONE'}`;

    // exceptions
    const exceptions = all.filter((s) => !s.resolved).map((s) => ({
      uuid: s.uuid, admission_number: s.admission_number, name: s.name, status: s.status,
      enrolled_2627: s.enrolledCur, active_2627: s.activeCur,
      father_mobile_raw: s.fatherRaw, father_guardian_mobile: fgMobile.get(s.uuid) || '',
      mother_mobile: s.mother_mobile || '', guardian_mobile: s.guardian_mobile || '' }));

    // family grouping by resolved father mobile
    const byPhone = new Map();
    for (const s of all) if (s.resolved) { if (!byPhone.has(s.resolved)) byPhone.set(s.resolved, []); byPhone.get(s.resolved).push(s); }
    const sizeDist = {};
    for (const g of byPhone.values()) sizeDist[g.length] = (sizeDist[g.length] || 0) + 1;

    const largeFamilies = [...byPhone.entries()].filter(([, g]) => g.length >= 5).map(([phone, g]) => ({
      phone, count: g.length, active_2627: g.filter((x) => x.activeCur).length,
      distinct_components: new Set(g.map((x) => x.component)).size, members: g.map(tag).join(' | ') }));

    // sibling components: conflicts + partial-missing
    const compMembers = new Map();
    for (const s of all) { if (!compMembers.has(s.component)) compMembers.set(s.component, []); compMembers.get(s.component).push(s); }
    const conflicts = [], compMissingSome = [];
    for (const [comp, mem] of compMembers) {
      if (mem.length < 2) continue;
      const phones = new Set(mem.filter((m) => m.resolved).map((m) => m.resolved));
      const active2627 = mem.filter((m) => m.activeCur).length;
      if (phones.size > 1) conflicts.push({ component: comp, size: mem.length, active_2627: active2627,
        distinct_numbers: [...phones].join(' / '), members: mem.map(tag).join(' | ') });
      if (mem.some((m) => !m.resolved) && phones.size >= 1) compMissingSome.push({ component: comp, size: mem.length,
        active_2627: active2627, number: [...phones].join('/'),
        members_without_number: mem.filter((m) => !m.resolved).map(tag).join(' | ') });
    }

    // link gaps: same number across >1 sibling component
    const linkGaps = [];
    for (const [phone, g] of byPhone) {
      if (g.length < 2) continue;
      const comps = new Set(g.map((x) => x.component));
      if (comps.size > 1) linkGaps.push({ phone, students: g.length, active_2627: g.filter((x) => x.activeCur).length,
        sibling_components: comps.size, members: g.map(tag).join(' | ') });
    }

    const assignments = all.filter((s) => s.resolved).map((s) => ({
      uuid: s.uuid, admission_number: s.admission_number, name: s.name, status: s.status,
      active_2627: s.activeCur, family_unique_number: s.resolved, source: s.source }));

    const sfx = ACTIVE_ONLY ? `-${curAY.name}` : '';
    const nExc = write(`family-login-exceptions${sfx}.csv`, exceptions);
    const nConf = write(`family-login-sibling-conflicts${sfx}.csv`, conflicts);
    const nGap = write(`family-login-link-gaps${sfx}.csv`, linkGaps);
    const nLarge = write(`family-login-large-families${sfx}.csv`, largeFamilies);
    const nMiss = write(`family-login-partial-missing${sfx}.csv`, compMissingSome);
    write(`family-login-proposed-assignments${sfx}.csv`, assignments);

    const excActive = exceptions.filter((e) => e.active_2627).length;
    const confActiveGroups = conflicts.filter((c) => c.active_2627 > 0).length;
    const confActiveStudents = conflicts.reduce((a, c) => a + c.active_2627, 0);
    const gapActiveGroups = linkGaps.filter((g) => g.active_2627 > 0).length;

    console.log(`\n===== FAMILY-LOGIN DRY RUN — ${SCHOOL_CODE} (${STAGE}, read-only) =====`);
    console.log(`Current academic year: ${curAY.name} (${curAY.uuid})`);
    console.log(`Scope: ${ACTIVE_ONLY ? `ACTIVE + enrolled ${curAY.name} only` : 'all non-deleted students'}\n`);
    console.log(`Students (non-deleted):            ${all.length}   [active & enrolled ${curAY.name}: ${all.filter((s) => s.activeCur).length}]`);
    console.log(`  eligible (valid father mobile):  ${assignments.length}`);
    console.log(`  EXCEPTIONS (no usable number):   ${exceptions.length}   [active ${curAY.name}: ${excActive}]`);
    console.log(`Distinct family numbers (=> student_login rows): ${byPhone.size}\n`);
    console.log('Family size distribution:');
    Object.keys(sizeDist).map(Number).sort((a, b) => a - b).forEach((n) => console.log(`   ${n} student(s): ${sizeDist[n]} families`));
    console.log('');
    console.log(`Sibling conflicts (diff father numbers): ${nConf} groups  [involving active ${curAY.name}: ${confActiveGroups} groups / ${confActiveStudents} students]`);
    console.log(`Link gaps (same number, not all linked): ${nGap} groups   [involving active ${curAY.name}: ${gapActiveGroups} groups]`);
    console.log(`Large families (>=5 on one number):      ${nLarge}`);
    console.log(`Partial-missing sibling groups:          ${nMiss}`);
    // "Clean" = eligible students needing NO human decision: not in a conflict
    // component, not on a flagged large-family number, not in a partial-missing group.
    const conflictComps = new Set(conflicts.map((c) => c.component));
    const missingComps = new Set(compMissingSome.map((c) => c.component));
    const largePhones = new Set(largeFamilies.map((c) => c.phone));
    const clean = all.filter((s) => s.resolved &&
      !conflictComps.has(s.component) && !missingComps.has(s.component) && !largePhones.has(s.resolved));
    const cleanFamilies = new Set(clean.map((s) => s.resolved)).size;
    const inConflict = all.filter((s) => conflictComps.has(s.component)).length;
    const inLarge = all.filter((s) => s.resolved && largePhones.has(s.resolved)).length;
    const inMissing = all.filter((s) => missingComps.has(s.component)).length;
    console.log('\n--- can we auto-assign a clean family number? ---');
    console.log(`  total in scope:              ${all.length}`);
    console.log(`  - exceptions (no number):    ${exceptions.length}`);
    console.log(`  - in sibling conflicts:      ${inConflict}`);
    console.log(`  - in large families (>=5):   ${inLarge}`);
    console.log(`  - in partial-missing groups: ${inMissing}`);
    console.log(`  = CLEAN (no decision needed): ${clean.length} students -> ${cleanFamilies} family numbers`);
    console.log(`\n(* in CSV member lists marks a student active & enrolled in ${curAY.name})`);
    console.log('Reports written to', OUT);
  } catch (e) {
    console.error('ERR', e.stack || e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
