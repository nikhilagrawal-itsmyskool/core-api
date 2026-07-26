#!/usr/bin/env node
/**
 * Upload the REAL "Morning Meridian" assembly plan (from "Assembly New.docx")
 * into a school. Plan ONLY: sets house-mode config (title/subtitle), creates the
 * 5-block node tree with its per-weekday content grid, scopes it to the whole
 * school and PUBLISHES it. It deliberately does NOT seed any operational data —
 * no houses/rotation, no weekly roster, no checklist, no rubric, no grades, no
 * logins. Those are set up by the school in the admin portal.
 *
 * The plan tree below is transcribed from the source doc (Dr. B.P. Agrawal
 * Shiksha Niketan) and verified against it.
 *
 * Usage (LOCAL):
 *   node scripts/seed-assembly.js                       # SS1 @ :3000
 *
 * Usage (PROD):
 *   SCHOOL_CODE=<code> STAGE=prod \
 *   GATEWAY=https://api-prod.itsmyskool.com \
 *   node scripts/seed-assembly.js
 *
 * Env:
 *   SCHOOL_CODE  target school code (default SS1)
 *   STAGE        which configs/<stage>/<stage>.yml to read for the DB lookup
 *                (school / academic year / classes) — default 'local'
 *   GATEWAY      base URL the assembly/student HTTP APIs are reachable at
 *                (default http://localhost:3000)
 *   ASSIGN_CLASSES  '0' to skip whole-school class scoping (default: assign all)
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Pool } = require('pg');

const SCHOOL_CODE = process.env.SCHOOL_CODE || 'SS1';
const GATEWAY = (process.env.GATEWAY || 'http://localhost:3000').replace(/\/$/, '');
const STAGE = process.env.STAGE || 'local';
const ASSIGN_CLASSES = process.env.ASSIGN_CLASSES !== '0';
// Service-token header so this passes the API authorizer when targeting a protected
// stage (empty for local). See scripts/lib/service-auth.js.
const { serviceAuthHeaders } = require('./service-auth.js');
const AUTH_HEADERS = serviceAuthHeaders(STAGE, 'seed-assembly');

const PLAN_NAME = 'The Morning Meridian';
const PLAN_TITLE = 'The Morning Meridian';
const PLAN_SUBTITLE = 'Where Time, Mind and Expression Align';

// ── HTTP helper (X-School-Code; endpoints are tenant-scoped, no JWT) ───────────
async function req(method, url, body) {
  const res = await fetch(`${GATEWAY}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-School-Code': SCHOOL_CODE, ...AUTH_HEADERS },
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

// ── The Morning Meridian template (verified against the source .docx) ──────────
// fill: 'roster' = house-on-duty fills it weekly; else fixed with a per-weekday grid.
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
    { title: 'The Morning Spark', description: 'Thought of the Day', fill: 'roster', day: D6('English', 'English', 'Doha, Sukti, Neeti Vachan (Hindi)', 'English', 'English', 'English') },
    { title: 'The Pulse Point', description: 'The Daily News Bulletin', fill: 'roster', day: D6('English', 'English', 'Hindi', 'English', 'English', 'English') },
  ] },
  { title: 'Block III: The Expressions Horizon', description: 'Language, Knowledge and Performance', children: [
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

// ── DB (for school / academic-year / class lookups only) ───────────────────────
function db() {
  const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../configs/${STAGE}/${STAGE}.yml`), 'utf8'));
  return new Pool({
    host: cfg.POSTGRES_ENDPOINT || cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE,
    user: cfg.POSTGRES_USERNAME || cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD,
    port: parseInt(cfg.POSTGRES_PORT || '5432'), ssl: cfg.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
}

async function main() {
  console.log(`\nSchool=${SCHOOL_CODE}  stage(db)=${STAGE}  gateway=${GATEWAY}\n`);
  const pool = db();
  const one = async (q, p) => (await pool.query(q, p)).rows;
  const school = await one(`select uuid, name from school where lower(code) = lower($1)`, [SCHOOL_CODE]);
  if (school.length === 0) throw new Error(`School ${SCHOOL_CODE} not found`);
  const schoolId = school[0].uuid;
  const ay = await one(`select uuid, name from academic_year where school_id = $1 order by start_date desc limit 1`, [schoolId]);
  if (ay.length === 0) throw new Error('No academic year for this school');
  const academicYearId = ay[0].uuid;
  const classes = await one(`select uuid, name from class where school_id = $1 order by seq nulls last, name`, [schoolId]);
  await pool.end();
  console.log(`✓ ${school[0].name} · year ${ay[0].name} · ${classes.length} classes\n`);

  // 1. House-mode config (title/subtitle from the doc). Idempotent PUT.
  await A('PUT', '/config', { mode: 'house', title: PLAN_TITLE, subtitle: PLAN_SUBTITLE });
  console.log(`✓ config → house mode ("${PLAN_TITLE}")`);

  // 2. Remove any prior plan of the same name, then create fresh.
  for (const p of (await A('GET', `/plans?academicYearId=${academicYearId}`)) || []) {
    if (p.name === PLAN_NAME) { await A('DELETE', `/plans/${p.uuid}`); console.log(`  (removed existing plan ${p.uuid})`); }
  }
  const plan = await A('POST', '/plans', { academicYearId, name: PLAN_NAME, scopeLabel: 'Whole school', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] });
  const planId = plan.uuid;
  console.log(`✓ plan "${PLAN_NAME}" (${planId})`);

  // 3. Scope to the whole school (all classes).
  if (ASSIGN_CLASSES && classes.length) {
    await A('PUT', `/plans/${planId}/classes`, { classIds: classes.map((c) => c.uuid) });
    console.log(`✓ scoped to ${classes.length} classes (whole school)`);
  } else {
    console.log('· class scope skipped (ASSIGN_CLASSES=0)');
  }

  // 4. Build the tree (+ per-weekday content grid).
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
  console.log(`✓ tree built (${nodeCount} nodes)`);

  // 5. Publish.
  await A('POST', `/plans/${planId}/publish`);
  console.log('✓ plan published');

  console.log(`\n🎉 "${PLAN_NAME}" uploaded & published for ${school[0].name}.`);
  console.log('   Next (in the admin portal): houses + rotation, rubric, checklist, then weekly rosters.\n');
}

main().catch((e) => { console.error('\n✗ Failed:', e.message); process.exit(1); });
