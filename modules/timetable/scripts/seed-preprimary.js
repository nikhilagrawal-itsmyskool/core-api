#!/usr/bin/env node
/**
 * Seed the Pre-Primary (Nursery / LKG / UKG) hand-authored timetable.
 *
 * These are static, teacher-less label grids (mother-teacher classes). This script bootstraps
 * them into the normal timetable model as a MANUAL master so they render everywhere and stay
 * hand-editable afterward (see modules/timetable/DESIGN.md "manual master"):
 *   - one "Pre-Primary" timetable_config (shared Mon-Sat bell skeleton; clock times null for now)
 *       per day: seq0 assembly ("Circle time / Assembly / Discussion"), seq1-3 teaching (I-III),
 *       seq4 break (RECESS), seq5-7 teaching (IV-VI)
 *   - one "Pre-Primary" timetable_wing holding the 3 classes
 *   - one published_timetable (config_id set, source_candidate_id null), authored with per-class
 *     teacher-less published_entry rows carrying the cell text in `label`, then activated.
 *
 * Grids are per-GRADE; each grade resolves to its lowest-seq section (the "-A" section), so with
 * "one section per grade" any extra section (e.g. UKG-B) is left out and can get the same grid
 * later via the editor. Idempotent: config + wing are reused by name; each run creates a FRESH
 * master and activates it (archiving the prior active Pre-Primary master for the same wing scope).
 * The whole write runs in ONE transaction; --dry-run performs every write then ROLLs BACK.
 *
 * Usage:
 *   node modules/timetable/scripts/seed-preprimary.js --stage local [--school-code DBPASN] [--year 2026-27] [--dry-run]
 *   (prod needs SSO creds exported first: aws sso login --sso-session itsmyskool)
 */
const path = require('path');
const { loadConfig, createPool } = require(path.join(__dirname, '../../../scripts/run-sql.js'));
const { getCreds } = require(path.join(__dirname, '../../../scripts/student-migration/db-creds.js'));
const { generateShortUuid } = require(path.join(__dirname, '../../../shared/util/generate-uuid.js'));

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const STAGE = arg('stage', 'local');
const SCHOOL_CODE = arg('school-code', 'DBPASN');
const YEAR = arg('year', '2026-27');
const DRY = process.argv.includes('--dry-run');

const CONFIG_NAME = 'Pre-Primary';
const WING_NAME = 'Pre-Primary';
const UID = 'seed-pp'; // <= varchar(12) for *_userid columns

// slot layout per day: the 6 period cells (I..VI) are 'teaching' (teacher-less); 0=assembly, 4=break.
const SLOT_LAYOUT = [
  { sequence: 0, slotType: 'assembly', label: 'Circle time / Assembly / Discussion' },
  { sequence: 1, slotType: 'teaching', label: null }, // I
  { sequence: 2, slotType: 'teaching', label: null }, // II
  { sequence: 3, slotType: 'teaching', label: null }, // III
  { sequence: 4, slotType: 'break', label: 'RECESS' },
  { sequence: 5, slotType: 'teaching', label: null }, // IV
  { sequence: 6, slotType: 'teaching', label: null }, // V
  { sequence: 7, slotType: 'teaching', label: null }, // VI
];
const PERIOD_SEQS = [1, 2, 3, 5, 6, 7]; // I..VI in order
const DAYS = [1, 2, 3, 4, 5, 6]; // Mon..Sat
const GRADE_PREFIX = { NURSERY: 'nursery', LKG: 'lkg', UKG: 'ukg' };

// grids: GRADE -> dayOfWeek(1..6) -> [I, II, III, IV, V, VI]. Transcribed verbatim from the PDFs.
// Saturday's merged V+VI tail is repeated per cell for now (cell-merging is a separate feature).
const GRIDS = {
  NURSERY: {
    1: ['Phonic sound', 'Phonic sound', 'English Course book', 'English Workbook', 'English Notebook', 'English Oral / Rhyme'],
    2: ['Conversation', 'Maths Course book', 'Maths Course book', 'Maths Notebook', 'Maths Notebook', 'Maths Oral / Mind Magic'],
    3: ['GK / EVS Oral', 'General Awareness Book', 'General Awareness Book', 'English Notebook', 'English Notebook', 'Games'],
    4: ['Dance', 'Hindi Course book', 'Hindi Course book', 'Hindi Workbook', 'Hindi Workbook', 'Hindi Oral / Rhyme'],
    5: ['Music', 'Hindi Note book', 'Hindi Note book', 'AV Room / Story Time', 'AV Room / Story Time', 'Art & Activity book'],
    6: ['P.T. / Yoga', 'Maths Note book', 'Maths Note book', 'Art Notebook', 'Activity', 'Activity'],
  },
  LKG: {
    1: ['Phonics', 'शब्द अभ्यास Workbook', 'शब्द अभ्यास Workbook', 'हिन्दी N.B.', 'हिन्दी N.B.', 'शब्द ज्ञान / हिन्दी बालगीत'],
    2: ['Phonics', 'Literacy Skill book', 'Literacy Skill book', 'English Notebook', 'English Notebook', 'English Oral / English Rhymes'],
    3: ['Dance', 'General Awareness WB', 'General Awareness WB', 'EVS NB', 'EVS NB', 'EVS Oral'],
    4: ['GK / Conversation', 'Numeracy Skill book', 'Numeracy Workbook', 'Maths NB', 'Maths NB', 'Maths Oral'],
    5: ['Music', 'हिन्दी / Maths Notebook', 'हिन्दी / Maths Notebook', 'Art NB', 'Story time / Activity Room', 'Game'],
    6: ['P.T. / Yoga', 'English Notebook', 'English Notebook', 'Scrapbook / Art WB', 'Saturday Activity + Stem + Montessori Activity', 'Saturday Activity + Stem + Montessori Activity'],
  },
  UKG: {
    1: ['Monday Test', 'Hindi Book', 'Hindi N.B.', 'Maths Oral', 'Cursive Writing', 'English Phonics'],
    2: ['Reading Skill', 'English Book', 'English N.B.', 'EVS Book', 'EVS N.B.', 'EVS Activity'],
    3: ['Yoga / Library', 'Hindi Book', 'Hindi N.B.', 'Maths Book', 'Maths N.B.', 'Dance'],
    4: ['GK / Conversation', 'English Book', 'English Book', 'EVS Book', 'EVS N.B.', 'Hindi Rhymes'],
    5: ['Music', 'Maths Book', 'Maths N.B.', 'Hindi Sulekh', 'EVS Oral', 'English Rhymes'],
    6: ['P.T.', 'Art N.B. / Book', 'STEM or SEL', 'Conversation', 'Saturday Activity + Stem + Montessori Activity', 'Saturday Activity + Stem + Montessori Activity'],
  },
};

async function makePool() {
  // prod: the checked-in prod.yml password is STALE — resolve via SSM (needs SSO creds
  // exported). local/dev: use the plaintext yml password.
  if (STAGE === 'prod') {
    const { Pool } = require('pg');
    return new Pool(await getCreds('prod'));
  }
  return createPool(loadConfig(STAGE));
}

async function main() {
  const pool = await makePool();
  const now = new Date();
  const client = await pool.connect();
  const q = (text, params) => client.query(text, params);
  try {
    await client.query('BEGIN');

    // --- resolve school + academic year ---
    const sr = await q(`select uuid from school where lower(code) = lower($1)`, [SCHOOL_CODE]);
    if (!sr.rows.length) throw new Error(`school code ${SCHOOL_CODE} not found`);
    const schoolId = sr.rows[0].uuid;

    const yr = await q(
      `select uuid, name from academic_year where school_id = $1 and (name = $2 or uuid = $2) order by name desc limit 1`,
      [schoolId, YEAR],
    );
    if (!yr.rows.length) throw new Error(`academic year ${YEAR} not found for ${SCHOOL_CODE}`);
    const academicYearId = yr.rows[0].uuid;

    // --- resolve each grade to its lowest-seq section ---
    const classes = {};
    for (const [grade, prefix] of Object.entries(GRADE_PREFIX)) {
      const cr = await q(
        `select uuid, name from class where school_id = $1 and base_class_id is null and lower(name) like lower($2) order by seq asc nulls last, name limit 1`,
        [schoolId, `${prefix}%`],
      );
      if (!cr.rows.length) throw new Error(`no class matching "${prefix}*" found for ${SCHOOL_CODE}`);
      classes[grade] = cr.rows[0].uuid;
      console.log(`  ${grade} -> ${cr.rows[0].name} (${cr.rows[0].uuid})`);
    }
    console.log(`\nSchool ${SCHOOL_CODE} (${schoolId}) · year ${yr.rows[0].name} (${academicYearId})`);

    // --- ensure config (+ days + slots), reuse by name ---
    let configId;
    const existingCfg = await q(
      `select uuid from timetable_config where school_id = $1 and academic_year_id = $2 and name = $3 and (status is null or status = 'active') limit 1`,
      [schoolId, academicYearId, CONFIG_NAME],
    );
    if (existingCfg.rows.length) {
      configId = existingCfg.rows[0].uuid;
      console.log(`\nReusing config ${CONFIG_NAME} (${configId})`);
    } else {
      configId = generateShortUuid(12);
      console.log(`\nCreating config ${CONFIG_NAME} (${configId}) — ${DAYS.length} days x ${SLOT_LAYOUT.length} slots`);
      await q(
        `insert into timetable_config (uuid, school_id, academic_year_id, name, status, createdby_userid, created_at) values ($1,$2,$3,$4,'active',$5,$6)`,
        [configId, schoolId, academicYearId, CONFIG_NAME, UID, now],
      );
      for (const dow of DAYS) {
        const dayId = generateShortUuid(12);
        await q(
          `insert into day_structure (uuid, school_id, config_id, day_of_week, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6)`,
          [dayId, schoolId, configId, dow, UID, now],
        );
        for (const s of SLOT_LAYOUT) {
          await q(
            `insert into time_slot (uuid, school_id, day_structure_id, sequence, slot_type, label, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [generateShortUuid(12), schoolId, dayId, s.sequence, s.slotType, s.label, UID, now],
          );
        }
      }
    }

    // --- build dayOfWeek -> [period slot ids in I..VI order] ---
    const slotRows = await q(
      `select ds.day_of_week, ts.sequence, ts.uuid from day_structure ds
         join time_slot ts on ts.day_structure_id = ds.uuid
        where ds.config_id = $1 and ds.school_id = $2`,
      [configId, schoolId],
    );
    const periodSlotByDay = {};
    for (const dow of DAYS) {
      periodSlotByDay[dow] = PERIOD_SEQS.map(
        (seq) => slotRows.rows.find((r) => r.day_of_week === dow && r.sequence === seq)?.uuid,
      );
      if (periodSlotByDay[dow].some((x) => !x))
        throw new Error(`missing period slots for day ${dow} in config ${configId}`);
    }

    // --- ensure wing (+ members), reuse by name ---
    let wingId;
    const existingWing = await q(
      `select uuid from timetable_wing where school_id = $1 and academic_year_id = $2 and name = $3 and (status is null or status = 'active') limit 1`,
      [schoolId, academicYearId, WING_NAME],
    );
    if (existingWing.rows.length) {
      wingId = existingWing.rows[0].uuid;
      console.log(`Reusing wing ${WING_NAME} (${wingId})`);
    } else {
      wingId = generateShortUuid(12);
      console.log(`Creating wing ${WING_NAME} (${wingId}) — ${Object.keys(classes).length} classes`);
      await q(
        `insert into timetable_wing (uuid, school_id, academic_year_id, name, status, createdby_userid, created_at) values ($1,$2,$3,$4,'active',$5,$6)`,
        [wingId, schoolId, academicYearId, WING_NAME, UID, now],
      );
      for (const classId of Object.values(classes)) {
        await q(
          `insert into timetable_wing_class (uuid, school_id, wing_id, class_id, status, createdby_userid, created_at) values ($1,$2,$3,$4,'active',$5,$6)`,
          [generateShortUuid(12), schoolId, wingId, classId, UID, now],
        );
      }
    }

    // --- create a fresh draft master + per-class label entries ---
    const masterId = generateShortUuid(12);
    await q(
      `insert into published_timetable (uuid, school_id, academic_year_id, wing_id, config_id, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,'draft',$6,$7)`,
      [masterId, schoolId, academicYearId, wingId, configId, UID, now],
    );
    let entryCount = 0;
    for (const [grade, classId] of Object.entries(classes)) {
      const byDay = GRIDS[grade];
      for (const dow of DAYS) {
        const slotIds = periodSlotByDay[dow];
        for (let idx = 0; idx < byDay[dow].length; idx++) {
          await q(
            `insert into published_entry (uuid, school_id, published_timetable_id, class_id, subject_id, teacher_id, day_of_week, time_slot_id, label, createdby_userid, created_at)
             values ($1,$2,$3,$4,null,null,$5,$6,$7,$8,$9)`,
            [generateShortUuid(12), schoolId, masterId, classId, dow, slotIds[idx], byDay[dow][idx], UID, now],
          );
          entryCount++;
        }
      }
    }

    // --- activate: archive prior active master for (year, wing), flip this one active ---
    await q(
      `update published_timetable set status='archived', updated_at=$1 where school_id=$2 and academic_year_id=$3 and status='active' and wing_id is not distinct from $4`,
      [now, schoolId, academicYearId, wingId],
    );
    await q(`update published_timetable set status='active', updated_at=$1 where uuid=$2`, [now, masterId]);
    console.log(`\nMaster ${masterId}: ${entryCount} label entries · wing ${wingId} · config ${configId}`);

    if (DRY) {
      await client.query('ROLLBACK');
      console.log('\n[dry-run] all writes rolled back — nothing persisted.');
    } else {
      await client.query('COMMIT');
      console.log('\nDone. Pre-Primary master activated.');
    }
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
