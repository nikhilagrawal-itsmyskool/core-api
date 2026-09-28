/**
 * Import the Spoken English & Life Communication programme into a school.
 *
 *   node modules/programmes/scripts/import-programmes.js \
 *     --stage local --school DBPASN --dir "H:/spoken-english-docs" [--year <uuid>] [--programme SELC]
 *
 * What it does (idempotent, safe to re-run):
 *   1. ensures the `programme` row (SELC),
 *   2. seeds the controlled masters (field types, material types, domains, skills, stages),
 *   3. for each *.docx in --dir: parses it, upserts that grade's monthly units (overwrite),
 *      and stores the source .docx (per grade) for later download / re-upload.
 *
 * Grade is taken from the filename ("Class VI …" -> VI, "Nursery …" -> Nursery); falling
 * back to the grade detected inside the document.
 */
const fs = require("fs");
const path = require("path");
const { loadConfig, createPool } = require("../../../scripts/run-sql");
const { generateShortUuid } = require("../../../shared/util/generate-uuid.js");
const { parseDocx } = require("../programmes-parse.js");
const seed = require("../programmes-selc-seed.js");

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const IMPORT_USER = "import";

function parseArgs(argv) {
  const a = { stage: "local", school: "DBPASN", programme: "SELC", dir: null, year: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--stage" || k === "-s") a.stage = argv[++i];
    else if (k === "--school") a.school = argv[++i];
    else if (k === "--programme") a.programme = argv[++i];
    else if (k === "--dir") a.dir = argv[++i];
    else if (k === "--year") a.year = argv[++i];
  }
  return a;
}

async function one(pool, sql, params) {
  const r = await pool.query(sql, params);
  return r.rows[0] || null;
}

async function resolveSchoolId(pool, code) {
  const row = await one(pool, `select uuid from school where lower(code) = lower($1)`, [code]);
  if (!row) throw new Error(`School not found: ${code}`);
  return row.uuid;
}

async function resolveYearId(pool, schoolId, explicit) {
  if (explicit) return explicit;
  const row = await one(
    pool,
    `select uuid from academic_year where school_id = $1
       order by (case when current_date between start_date and end_date then 0 else 1 end), start_date desc nulls last
       limit 1`,
    [schoolId],
  );
  if (!row) throw new Error("No academic year for this school (pass --year)");
  return row.uuid;
}

async function ensureProgramme(pool, schoolId) {
  const existing = await one(
    pool,
    `select uuid from programme where school_id = $1 and lower(code) = lower($2) and status = 'active'`,
    [schoolId, seed.PROGRAMME.code],
  );
  const guidance = JSON.stringify(seed.TEACHER_GUIDANCE || []);
  if (existing) {
    await pool.query(
      `update programme set name=$1, motto=$2, philosophy=$3, teacher_guidance=$4, updatedby_userid=$5, updated_at=$6 where uuid=$7`,
      [seed.PROGRAMME.name, seed.PROGRAMME.motto, seed.PROGRAMME.philosophy, guidance, IMPORT_USER, new Date(), existing.uuid],
    );
    return existing.uuid;
  }
  const uuid = generateShortUuid(12);
  await pool.query(
    `insert into programme (uuid, school_id, code, name, motto, philosophy, teacher_guidance, status, createdby_userid, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9)`,
    [uuid, schoolId, seed.PROGRAMME.code, seed.PROGRAMME.name, seed.PROGRAMME.motto, seed.PROGRAMME.philosophy, guidance, IMPORT_USER, new Date()],
  );
  return uuid;
}

// Generic idempotent seed of a coded master row (field/material/domain).
async function seedCoded(pool, table, schoolId, programmeId, code, name, seq) {
  const existing = await one(
    pool,
    `select uuid from ${table} where programme_id = $1 and lower(code) = lower($2) and status = 'active'`,
    [programmeId, code],
  );
  const hasSeq = seq !== undefined;
  if (existing) {
    await pool.query(
      `update ${table} set name = $1${hasSeq ? ", seq = $2" : ""} where uuid = $${hasSeq ? 3 : 2}`,
      hasSeq ? [name, seq, existing.uuid] : [name, existing.uuid],
    );
    return existing.uuid;
  }
  const uuid = generateShortUuid(12);
  if (hasSeq) {
    await pool.query(
      `insert into ${table} (uuid, school_id, programme_id, code, name, seq, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,$5,$6,'active',$7,$8)`,
      [uuid, schoolId, programmeId, code, name, seq, IMPORT_USER, new Date()],
    );
  } else {
    await pool.query(
      `insert into ${table} (uuid, school_id, programme_id, code, name, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,$5,'active',$6,$7)`,
      [uuid, schoolId, programmeId, code, name, IMPORT_USER, new Date()],
    );
  }
  return uuid;
}

async function seedMasters(pool, schoolId, programmeId) {
  for (let i = 0; i < seed.FIELD_TYPES.length; i++)
    await seedCoded(pool, "programme_field_type", schoolId, programmeId, seed.FIELD_TYPES[i].code, seed.FIELD_TYPES[i].name, i + 1);
  for (const m of seed.MATERIAL_TYPES)
    await seedCoded(pool, "programme_material_type", schoolId, programmeId, m.code, m.name);
  for (const d of seed.DOMAINS)
    await seedCoded(pool, "programme_domain", schoolId, programmeId, d.code, d.name);

  const skillByName = {};
  for (const s of seed.SKILLS) {
    const existing = await one(
      pool,
      `select uuid from programme_skill where programme_id = $1 and lower(name) = lower($2) and status = 'active'`,
      [programmeId, s.name],
    );
    if (existing) {
      await pool.query(`update programme_skill set category = $1 where uuid = $2`, [s.category, existing.uuid]);
      skillByName[s.name.toLowerCase()] = existing.uuid;
    } else {
      const uuid = generateShortUuid(12);
      await pool.query(
        `insert into programme_skill (uuid, school_id, programme_id, category, name, status, createdby_userid, created_at)
         values ($1,$2,$3,$4,$5,'active',$6,$7)`,
        [uuid, schoolId, programmeId, s.category, s.name, IMPORT_USER, new Date()],
      );
      skillByName[s.name.toLowerCase()] = uuid;
    }
  }

  // Alias a few non-canonical focus-skill wordings onto master skills.
  for (const [from, to] of Object.entries(seed.SKILL_ALIASES || {})) {
    const target = skillByName[String(to).toLowerCase()];
    if (target) skillByName[from.toLowerCase()] = target;
  }

  for (let i = 0; i < seed.STAGES.length; i++) {
    const st = seed.STAGES[i];
    const existing = await one(
      pool,
      `select uuid from programme_stage where programme_id = $1 and lower(grade) = lower($2) and status = 'active'`,
      [programmeId, st.grade],
    );
    if (existing) {
      await pool.query(
        `update programme_stage set seq=$1, developmental_band=$2, master_focus=$3, stage_emphasis=$4, assessment_band=$5 where uuid=$6`,
        [i + 1, st.developmentalBand, st.masterFocus, st.stageEmphasis, st.assessmentBand, existing.uuid],
      );
    } else {
      await pool.query(
        `insert into programme_stage (uuid, school_id, programme_id, grade, seq, developmental_band, master_focus, stage_emphasis, assessment_band, status, createdby_userid, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11)`,
        [generateShortUuid(12), schoolId, programmeId, st.grade, i + 1, st.developmentalBand, st.masterFocus, st.stageEmphasis, st.assessmentBand, IMPORT_USER, new Date()],
      );
    }
  }
  return skillByName;
}

async function upsertUnit(pool, schoolId, programmeId, yearId, grade, m, programmeFocus, focusIds) {
  const title = (m.title || m.month).trim();
  const fieldsJson = JSON.stringify(m.fields || {});
  const focusJson = JSON.stringify(focusIds || []);
  const existing = await one(
    pool,
    `select uuid, version from programme_unit
       where programme_id=$1 and academic_year_id=$2 and lower(grade)=lower($3) and month=$4 and status='active'`,
    [programmeId, yearId, grade, m.month],
  );
  if (existing) {
    await pool.query(
      `update programme_unit set title=$1, programme_focus=$2, fields=$3, focus_skill_ids=$4,
         workflow_status='published', version=$5, updatedby_userid=$6, updated_at=$7 where uuid=$8`,
      [title, programmeFocus, fieldsJson, focusJson, (existing.version || 1) + 1, IMPORT_USER, new Date(), existing.uuid],
    );
  } else {
    await pool.query(
      `insert into programme_unit
        (uuid, school_id, programme_id, academic_year_id, grade, month, title, programme_focus,
         primary_domain_id, fields, focus_skill_ids, workflow_status, version, source_file_id, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'published',1,$12,'active',$13,$14)`,
      [generateShortUuid(12), schoolId, programmeId, yearId, grade, m.month, title, programmeFocus, null, fieldsJson, focusJson, null, IMPORT_USER, new Date()],
    );
  }
}

async function storeSourceDoc(pool, schoolId, programmeId, yearId, grade, buffer, fileName) {
  const base64 = buffer.toString("base64");
  const fileId = generateShortUuid(12);
  const docExisting = await one(
    pool,
    `select uuid, version, file_id from programme_source_doc
       where programme_id=$1 and academic_year_id=$2 and lower(grade)=lower($3) and status='active'`,
    [programmeId, yearId, grade],
  );
  const docId = docExisting ? docExisting.uuid : generateShortUuid(12);
  await pool.query(
    `insert into file_storage (uuid, file_name, mime_type, size_bytes, data, entity_type, entity_id, variant, school_id, createdby_userid, created_at)
     values ($1,$2,$3,$4,$5,'programme_source',$6,'original',$7,$8,$9)`,
    [fileId, fileName, DOCX_MIME, buffer.length, base64, docId, schoolId, IMPORT_USER, new Date()],
  );
  if (docExisting) {
    await pool.query(
      `update programme_source_doc set file_id=$1, version=$2, updatedby_userid=$3, updated_at=$4 where uuid=$5`,
      [fileId, (docExisting.version || 1) + 1, IMPORT_USER, new Date(), docId],
    );
    if (docExisting.file_id)
      await pool.query(`delete from file_storage where uuid=$1 and school_id=$2`, [docExisting.file_id, schoolId]);
  } else {
    await pool.query(
      `insert into programme_source_doc (uuid, school_id, programme_id, academic_year_id, grade, file_id, version, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,$5,$6,1,'active',$7,$8)`,
      [docId, schoolId, programmeId, yearId, grade, fileId, IMPORT_USER, new Date()],
    );
  }
}

async function importFile(pool, ctx, filePath) {
  const fileName = path.basename(filePath);
  const buffer = fs.readFileSync(filePath);
  const parsed = parseDocx(buffer);
  const grade = seed.gradeFromFilename(fileName) || parsed.detectedGrade;
  if (!grade) {
    console.log(`  ! SKIP ${fileName} — could not determine grade`);
    return;
  }
  const months = (parsed.months || []).filter((m) => m.month);
  let matched = 0;
  const unmatched = new Set();
  for (const m of months) {
    const focusIds = [];
    for (const name of m.focusSkills || []) {
      const id = ctx.skillByName[String(name).trim().toLowerCase()];
      if (id) focusIds.push(id);
      else unmatched.add(name);
    }
    matched += focusIds.length;
    await upsertUnit(pool, ctx.schoolId, ctx.programmeId, ctx.yearId, grade, m, parsed.programmeFocus || null, focusIds);
  }
  await storeSourceDoc(pool, ctx.schoolId, ctx.programmeId, ctx.yearId, grade, buffer, fileName);
  console.log(
    `  ✓ ${fileName} -> grade ${grade}: ${months.length} months` +
      (unmatched.size ? ` | unmatched focus skills: ${[...unmatched].join(", ")}` : ""),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    console.error("Usage: --stage <s> --school <CODE> --dir <docx-folder> [--year <uuid>]");
    process.exit(1);
  }
  const config = loadConfig(args.stage);
  const pool = createPool(config);
  try {
    const schoolId = await resolveSchoolId(pool, args.school);
    const yearId = await resolveYearId(pool, schoolId, args.year);
    console.log(`\n=== Import ${args.programme} into ${args.school} (year ${yearId}) ===\n`);

    const programmeId = await ensureProgramme(pool, schoolId);
    console.log("Seeding masters (fields, material types, domains, skills, stages)...");
    const skillByName = await seedMasters(pool, schoolId, programmeId);
    console.log(
      `  fields=${seed.FIELD_TYPES.length} materials=${seed.MATERIAL_TYPES.length} domains=${seed.DOMAINS.length} skills=${seed.SKILLS.length} stages=${seed.STAGES.length}`,
    );

    const ctx = { schoolId, programmeId, yearId, skillByName };
    const files = fs
      .readdirSync(args.dir)
      .filter((f) => /\.docx$/i.test(f) && !/^~\$/.test(f))
      .sort();
    if (files.length === 0) throw new Error(`No .docx files in ${args.dir}`);
    console.log(`\nImporting ${files.length} document(s) from ${args.dir}:`);
    for (const f of files) await importFile(pool, ctx, path.join(args.dir, f));

    console.log("\n✓ Import complete.\n");
  } catch (err) {
    console.error(`\n✗ Error: ${err.message}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) main();

module.exports = { main };
