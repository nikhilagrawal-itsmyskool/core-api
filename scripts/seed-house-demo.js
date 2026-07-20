#!/usr/bin/env node
/**
 * Seed a rich HOUSE-MODE demo into the local test school so the assembly admin
 * UI has real content to explore. Loads the DBPASN "Morning Meridian" template
 * (5 blocks, ~35 nodes) plus houses + rotation + an approved weekly roster +
 * checklist + rubric + evaluator + a grade.
 *
 * Usage:  node scripts/seed-house-demo.js            (school SS1, gateway :3000)
 *         SCHOOL_CODE=SS1 GATEWAY=http://localhost:3000 node scripts/seed-house-demo.js
 *
 * Prerequisite: the local stack is running (npm run start:all) with assembly +
 * student modules routed on the gateway, and the school already has an academic
 * year, classes and a few employees (sample-school-setup / ss1 data).
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Pool } = require('pg');

const SCHOOL_CODE = process.env.SCHOOL_CODE || 'SS1';
const GATEWAY = (process.env.GATEWAY || 'http://localhost:3000').replace(/\/$/, '');
const STAGE = process.env.STAGE || 'local';

// ── HTTP helper (X-School-Code; assembly endpoints need no JWT offline) ───────
async function req(method, url, body) {
  const res = await fetch(`${GATEWAY}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-School-Code': SCHOOL_CODE },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* non-json */ }
  if (res.status >= 400) {
    const msg = json?.error?.description || text || res.statusText;
    throw new Error(`${method} ${url} → ${res.status}: ${msg}`);
  }
  return json;
}
const A = (m, p, b) => req(m, `/assembly${p}`, b);
const S = (m, p, b) => req(m, `/students${p}`, b);

// ── Date helpers ──────────────────────────────────────────────────────────────
const iso = (d) => d.toISOString().slice(0, 10);
const mondayOf = (d) => { const x = new Date(d); const dow = x.getUTCDay(); x.setUTCDate(x.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); return iso(x); };
const addDays = (s, n) => { const x = new Date(`${s}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return iso(x); };

// ── The Morning Meridian template ─────────────────────────────────────────────
// fill: 'roster' = house fills weekly; else fixed 'auto' with a per-weekday grid.
const D6 = (mon, tue, wed, thu, fri, sat) => ({ mon, tue, wed, thu, fri, sat });
const same = (v) => D6(v, v, v, v, v, v);
const TREE = [
  { title: 'Block I: The Harmonic Dawn', description: 'Daily Spiritual & Vocal Alignment', children: [
    { title: 'Symphony of Souls', description: 'Entry Song Slot', day: D6('Motivational', 'Motivational', 'Motivational', 'Patriotic', 'Patriotic', 'Patriotic') },
    { title: 'Divine Chords', description: 'The Complete Spiritual Block', children: [
      { title: 'Pratah Smaran', description: 'Morning Remembrance Verses', day: same('Karagre Vasate') },
      { title: 'Vedic Vibrations', description: 'Ancient Mantras & Sonic Energy', day: D6('Gayatri Mantra', 'Gayatri Mantra', 'Gayatri Mantra', 'Shlok', 'Shlok', 'Shlok') },
      { title: 'Saraswati Vandana', description: 'Invocation & Prayer', day: D6('हे हंसवाहिनी ज्ञानदायिनी', 'हे हंसवाहिनी ज्ञानदायिनी', 'हे हंसवाहिनी ज्ञानदायिनी', 'या कुन्देन्दु तुषारहार', 'या कुन्देन्दु तुषारहार', 'या कुन्देन्दु तुषारहार') },
    ] },
  ] },
  { title: 'Block II: The Core Foundations', description: 'The Civic Oath, Daily Wisdom & Live News Bulletin', children: [
    { title: 'The Solemn Oath', description: 'National Pledge', day: D6('English', 'English', 'Hindi', 'English', 'English', 'English') },
    // Roster slot with a per-day language/focus hint (house fills the actual thought).
    { title: 'The Morning Spark', description: 'Thought of the Day', fill: 'roster', day: D6('English', 'English', 'Doha, Sukti, Neeti Vachan (Hindi)', 'English', 'English', 'English') },
    { title: 'The Pulse Point', description: 'The Daily News Bulletin', fill: 'roster', day: D6('English', 'English', 'Hindi', 'English', 'English', 'English') },
  ] },
  { title: 'Block III: The Expressions Horizon', description: 'Language, Knowledge and Performance', children: [
    // Each is ONE daily roster segment; its FOCUS rotates by day (the doc's grid),
    // carried as per-weekday content. The house fills the actual word/topic/act.
    { title: 'Lingua Lexicon', description: 'The Language Grid', fill: 'roster', day: D6(
      'Word of the Day (Word, Pronunciation, Use, Synonym, Antonym)', 'The Phrase Phase (Idioms, Phrases, Proverbs)',
      'Vagdhaara (Muhaware, Lokokti, Elite Hindi Shabd)', 'Double Trouble (Confusing Words: Accept/Except, Birth/Berth)',
      'Mind Your Language (Common Errors: Incorrect → Correct → Reason)', 'The Global Dial (Words from other languages, e.g. Konnichiwa)') },
    { title: 'Mentis Matrix', description: 'The Knowledge Hub', fill: 'roster', day: D6(
      'Perspective 360° (Deep analysis of one big topic with India’s impact)', 'Sci-Files (Myth Buster / Genius / Backyard Science files)',
      'Discover India (GK related to India from ancient to modern era)', 'World Window (Global geography, history, polity, culture, trivia)',
      'Character Credo (Manners, etiquettes, values, life skills, moral stories)', 'Wonder Box (Amazing facts, puzzles, riddles, Myths vs Facts)') },
    { title: 'Stage Spectrum', description: 'The Performing Arts Stage', fill: 'roster', day: D6(
      'Alter Ego (Monologues & Solo Character Acting)', 'Dialogue Duel (Dialogue-Form Acts, Two-Person Jugalbandi)',
      'Mudra (Dance, Expressions & Mime)', 'Forum (Street Plays & Social Awakenings)',
      'Tableau (Freeze-Frame Pictures & Living Jhankis)', 'Resonance (Flash Mob / Chant)') },
    { title: 'Skill Skylines', description: 'Poetry, Dance, Open-Mic & Individual Talents Hub', fill: 'roster' },
    { title: 'The Page Turners', description: 'Book Review', fill: 'roster' },
    { title: 'The Flex and Flow', description: 'Health & Fitness Block', fill: 'roster' },
  ] },
  { title: 'Block IV: The Day’s Spotlight', description: 'Personalities, Commemorative Days and Celebrations', children: [
    { title: 'Calendar Chronicles', description: 'History, Heritage & Days Grid', fill: 'roster', day: D6(
      'Titans of Time (Great Personalities)', 'Milestone Markers (Important Days)', 'Festal Focus (Festivals & Occasions)',
      'Titans of Time (Great Personalities)', 'Milestone Markers (Important Days)', 'Festal Focus (Festivals & Occasions)') },
    { title: 'The Birthday Beacons', description: 'Birthday Celebration', fill: 'roster' },
  ] },
  { title: 'Block V: The Wisdom Compass', description: 'Guiding Voices from Within and Beyond', children: [
    { title: 'Mentors’ Mandate', description: 'The Leadership Vision & Guidance', fill: 'roster', optional: true },
    { title: 'Podium Presence', description: 'Guest Speakers, Experts & Community Blessings Hub', fill: 'roster', optional: true },
  ] },
  { title: 'National Anthem', description: 'Final Dismissal Stand', day: same('Jan Gan Man') },
];

const HOUSES = [
  { name: 'Aravali', color: '#e53935' },
  { name: 'Nilgiri', color: '#1e88e5' },
  { name: 'Shivalik', color: '#43a047' },
  { name: 'Vindhya', color: '#fbc02d' },
];
const CHECKLIST = [
  { phase: 'Before assembly', scope: 'week', text: 'Weekly roster approved & printed' },
  { phase: 'Before assembly', scope: 'day', text: 'Sound system & mic tested' },
  { phase: 'During assembly', scope: 'day', text: 'Anchors present and in uniform' },
  { phase: 'During assembly', scope: 'day', text: 'Time discipline maintained' },
  { phase: 'After assembly', scope: 'week', text: 'Feedback logged & shared with house' },
];
const METRICS = ['Discipline', 'Content Quality', 'Presentation', 'Diction & Clarity', 'Punctuality', 'Creativity', 'Audience Engagement'];
const PENALTIES = [
  { name: 'Overran time', value: 2 }, { name: 'Incomplete segment', value: 3 },
  { name: 'Indiscipline', value: 2 }, { name: 'Late start', value: 1 },
];

// ── DB (for school/year/class/employee lookups) ───────────────────────────────
function db() {
  const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
  return new Pool({
    host: cfg.POSTGRES_ENDPOINT || cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE,
    user: cfg.POSTGRES_USERNAME || cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD,
    port: parseInt(cfg.POSTGRES_PORT || '5432'), ssl: cfg.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
}

async function main() {
  const pool = db();
  const one = async (q, p) => (await pool.query(q, p)).rows;
  const school = await one(`select uuid from school where lower(code) = lower($1)`, [SCHOOL_CODE]);
  if (school.length === 0) throw new Error(`School ${SCHOOL_CODE} not found — run sample-school-setup first`);
  const schoolId = school[0].uuid;
  const ay = await one(`select uuid, name from academic_year where school_id = $1 order by start_date desc limit 1`, [schoolId]);
  if (ay.length === 0) throw new Error('No academic year for this school');
  const academicYearId = ay[0].uuid;
  const classes = await one(`select uuid, name from class where school_id = $1 order by seq nulls last, name limit 4`, [schoolId]);
  let employees = await one(`select uuid, name from employee where school_id = $1 and status <> 'deleted' order by created_at limit 6`, [schoolId]);
  if (employees.length < 5) {
    const { generateShortUuid } = require('../shared/util/generate-uuid.js');
    const names = ['Meera Iyer', 'Rohan Verma', 'Anjali Nair', 'Vikram Rao', 'Kavita Menon'];
    for (let i = employees.length; i < 5; i++) {
      await pool.query(
        `insert into employee (uuid, name, status, school_id, createdby_userid, created_at) values ($1,$2,'active',$3,'seed',now())`,
        [generateShortUuid(12), `${names[i]} (demo)`, schoolId],
      );
    }
    employees = await one(`select uuid, name from employee where school_id = $1 and status <> 'deleted' order by created_at limit 6`, [schoolId]);
    console.log(`  (seeded demo teachers; now ${employees.length} employees)`);
  }

  // Give the first house's in-charge a real teacher login (linked via
  // family_unique_number = username) with the 'teacher' role (assembly.view, no
  // manage) so the teacher PWA can be driven end-to-end.
  {
    const { generateShortUuid } = require('../shared/util/generate-uuid.js');
    const ic = employees[0];
    const username = 'aravali.ic';
    let role = await one(`select uuid from role where school_id = $1 and code = 'teacher'`, [schoolId]);
    let roleId = role[0]?.uuid;
    if (!roleId) {
      roleId = generateShortUuid(12);
      await pool.query(`insert into role (uuid, name, code, school_id, createdby_userid, created_at) values ($1,'Teacher','teacher',$2,'seed',now())`, [roleId, schoolId]);
    }
    await pool.query(`update employee set family_unique_number = $1 where uuid = $2`, [username, ic.uuid]);
    await pool.query(`delete from employee_login where school_id = $1 and username = $2`, [schoolId, username]);
    await pool.query(`insert into employee_login (uuid, username, password, display_name, school_id, createdby_userid, created_at) values ($1,$2,'Itsmyskool@123',$3,$4,'seed',now())`, [generateShortUuid(12), username, ic.name, schoolId]);
    await pool.query(`delete from employee_role where employee_id = $1 and school_id = $2`, [ic.uuid, schoolId]);
    await pool.query(`insert into employee_role (uuid, employee_id, role_id, school_id, createdby_userid, created_at) values ($1,$2,$3,$4,'seed',now())`, [generateShortUuid(12), ic.uuid, roleId, schoolId]);
    console.log(`  (teacher login: ${username} / Itsmyskool@123 → in-charge ${ic.name})`);
  }
  await pool.end();
  console.log(`School ${SCHOOL_CODE} (${schoolId}) · year ${ay[0].name} · ${classes.length} classes · ${employees.length} employees`);

  // 1. Mode = house.
  await A('PUT', '/config', { mode: 'house', title: 'The Morning Meridian', subtitle: 'Where Time, Mind and Expression Align' });
  console.log('✓ config → house mode');

  // 2. Houses (reuse by name) + in-charge + rotation order.
  const existingHouses = (await S('GET', '/houses')).houses || [];
  const houseIds = [];
  for (let i = 0; i < HOUSES.length; i++) {
    const h = HOUSES[i];
    let found = existingHouses.find((x) => x.name?.toLowerCase() === h.name.toLowerCase());
    if (!found) found = await S('POST', '/houses', { name: h.name, color: h.color });
    const houseId = found.uuid || found.houseId;
    houseIds.push(houseId);
    await S('PUT', `/houses/${houseId}/teachers`, { teachers: [{ employeeId: employees[i].uuid, role: 'incharge' }] });
    await A('PUT', `/houses/${houseId}/rotation`, { sortOrder: i });
  }
  console.log(`✓ ${houseIds.length} houses + in-charges + rotation order`);

  // 3. Clear any prior demo plan of the same name, then create the plan.
  const PLAN_NAME = 'The Morning Meridian';
  for (const p of (await A('GET', `/plans?academicYearId=${academicYearId}`)) || []) {
    if (p.name === PLAN_NAME) { await A('DELETE', `/plans/${p.uuid}`); }
  }
  const plan = await A('POST', '/plans', { academicYearId, name: PLAN_NAME, scopeLabel: 'Whole school', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] });
  const planId = plan.uuid;
  if (classes.length) await A('PUT', `/plans/${planId}/classes`, { classIds: classes.map((c) => c.uuid) });
  console.log(`✓ plan "${PLAN_NAME}" (${planId})`);

  // 4. Build the tree.
  let nodeCount = 0;
  async function build(nodes, parentId) {
    for (const n of nodes) {
      const created = await A('POST', `/plans/${planId}/nodes`, {
        parentId, title: n.title, description: n.description || undefined,
        fillMode: n.fill === 'roster' ? 'roster' : undefined,
        isOptional: n.optional || undefined,
        options: n.options || undefined,
      });
      nodeCount++;
      if (n.day) {
        const content = Object.entries(n.day).filter(([, v]) => v).map(([weekday, v]) => ({ weekday, content: v }));
        if (content.length) await A('PUT', `/nodes/${created.uuid}/day-content`, { content });
      }
      if (n.children) await build(n.children, created.uuid);
    }
  }
  await build(TREE, undefined);
  await A('POST', `/plans/${planId}/publish`);
  console.log(`✓ tree built (${nodeCount} nodes) + published`);

  // 5. Rotation pin (start the cycle) + an approved week roster on the CURRENT
  //    week (so the roster editor's default view shows content). A current week is
  //    past its roster deadline, so unlock it before filling.
  const weekStart = mondayOf(new Date());
  await A('PUT', `/plans/${planId}/rotation`, { weekStart, houseId: houseIds[0] });
  let week = await A('POST', `/plans/${planId}/weeks`, { weekStart });
  if (!week.editable) week = await A('POST', `/weeks/${week.uuid}/unlock`, { reason: 'demo seed' });
  const monday = week.days?.[0];
  if (monday) {
    const slots = (monday.slots || []).slice(0, 3);
    await A('PUT', `/weeks/${week.uuid}/roster`, {
      days: [{
        date: monday.date,
        anchors: [{ targetType: 'text', targetText: 'Head Girl' }, { targetType: 'text', targetText: 'Head Boy' }],
        owners: [{ targetType: 'employee', targetId: employees[0].uuid }],
      }],
      entries: slots.map((s, i) => ({
        date: monday.date, nodeId: s.nodeId, opted: true,
        content: `${s.title}: sample content for the day`,
        participants: classes.length ? [{ role: 'presenter', targetType: 'class', targetId: classes[i % classes.length].uuid }] : [],
      })),
    });
    await A('POST', `/weeks/${week.uuid}/submit`);
    await A('POST', `/weeks/${week.uuid}/approve`);
    console.log(`✓ week ${weekStart} roster filled, submitted & approved (house ${week.houseName || houseIds[0]})`);
  }

  // 6. Checklist (clear + create).
  for (const it of ((await A('GET', '/checklist/items')).items || [])) await A('DELETE', `/checklist/items/${it.uuid}`);
  for (const it of CHECKLIST) await A('POST', '/checklist/items', it);
  console.log(`✓ ${CHECKLIST.length} checklist items`);

  // 7. Rubric (clear + create) + scaling.
  const rub = await A('GET', '/rubric');
  for (const m of rub.metrics) await A('DELETE', `/rubric/metrics/${m.uuid}`);
  for (const p of rub.penalties) await A('DELETE', `/rubric/penalties/${p.uuid}`);
  const metricIds = [];
  for (const name of METRICS) metricIds.push((await A('POST', '/rubric/metrics', { name, maxMarks: 5 })).uuid);
  const penaltyIds = [];
  for (const p of PENALTIES) penaltyIds.push((await A('POST', '/rubric/penalties', p)).uuid);
  await A('PUT', '/rubric/config', { scalingAdjustment: -5 });
  console.log(`✓ rubric: ${METRICS.length} metrics ×5, ${PENALTIES.length} penalties, −5 scaling`);

  // 8. Evaluator + a grade on the approved week.
  for (const e of (await A('GET', '/evaluators')) || []) await A('DELETE', `/evaluators/${e.uuid}`);
  const evaluator = employees[4];
  await A('POST', '/evaluators', { employeeId: evaluator.uuid, startDate: addDays(weekStart, -30), endDate: addDays(weekStart, 30) });
  if (monday) {
    await A('POST', `/weeks/${week.uuid}/grades`, {
      gradeDate: monday.date, evaluatorId: evaluator.uuid,
      metrics: metricIds.map((id, i) => ({ metricId: id, score: [5, 4, 5, 4, 5, 3, 4][i] })),
      penalties: [penaltyIds[0]],
      starPresenter: 'Aarav Sharma', diction: 'Crisp & confident', feedback: 'Strong opening; watch the timing on announcements.',
    });
    console.log('✓ evaluator assigned + a sample grade recorded');
  }

  console.log('\n🎉 House-mode demo seeded. Log in to the admin portal and open Assembly ▸ Houses & Rotation / Roster / Checklist / Grading / Leaderboard.');
}

main().catch((e) => { console.error('\n✗ Seed failed:', e.message); process.exit(1); });
