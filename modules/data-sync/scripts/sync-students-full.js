/**
 * Full Student Data Sync (Schoolpad wide report → new schema)
 *
 * Imports the rich studentReport export into the new schema: students,
 * normalized guardians (father/mother/guardian), household addresses (permanent +
 * communication with flags), per-school lookups (category/blood/nationality/
 * mother-tongue/state/city/locality/country), sibling links, current-year
 * enrollment, and (optionally) photos fetched from the source S3 URLs and
 * re-uploaded into our file_storage.
 *
 * Natural key: admission_number + school_id (upsert).
 * Dedup guard: a NEW admission number whose (name + DOB) matches an existing
 * student under a different admission number is SKIPPED and reported (prevents the
 * "same student, two admission numbers" mistake). Honorifics are kept verbatim in
 * stored names; they are only stripped internally for dedup matching.
 *
 * Usage:
 *   node modules/data-sync/scripts/sync-students-full.js \
 *     --stage prod --school-code DBPASN --file "C:/Users/nikhi/Downloads/studentReport.csv" \
 *     --academic-session 2026-27 [--dry-run] [--no-photos] [--limit N]
 *
 * Photos need AWS creds for the file_storage bucket, e.g.:
 *   AWS_PROFILE=prod-itsmyskool-nikhil.agrawal AWS_REGION=ap-south-1 node ... (no --no-photos)
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

// ---------- args ----------
function parseArgs(argv) {
  const a = { stage: null, schoolCode: null, file: null, session: null, dryRun: false, photos: true, photosOnly: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--stage' || v === '-s') a.stage = argv[++i];
    else if (v === '--school-code' || v === '-c') a.schoolCode = argv[++i];
    else if (v === '--file' || v === '-f') a.file = argv[++i];
    else if (v === '--academic-session') a.session = argv[++i];
    else if (v === '--dry-run') a.dryRun = true;
    else if (v === '--no-photos') a.photos = false;
    else if (v === '--photos-only') a.photosOnly = true;
    else if (v === '--limit') a.limit = parseInt(argv[++i], 10) || 0;
  }
  return a;
}

function loadConfig(stage) {
  const p = path.join(__dirname, `../../../configs/${stage}/${stage}.yml`);
  const cfg = fs.readFileSync(p, 'utf8');
  const env = {};
  for (const line of cfg.split('\n')) {
    const m = line.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

// ---------- value helpers ----------
const clean = (v) => {
  const s = String(v ?? '').trim();
  return s === '---' || s === '' ? '' : s;
};
const orNull = (v) => clean(v) || null;
const stripHon = (v) => clean(v).replace(/^(mr|mrs|ms|dr|late|smt|shri|km|master)\.?\s*/i, '').trim();
const norm = (v) => stripHon(v).toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim();
const normalizeCode = (v) => clean(v).toLowerCase().replace(/\s+/g, '-').slice(0, 64);
const parseDate = (raw) => {
  const s = clean(raw).replace(/'/g, '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};

const stats = {
  insert: 0, update: 0, skipDup: 0, guardians: 0, addresses: 0, siblingsLinked: 0,
  siblingsUnresolved: 0, tc: 0, photosUploaded: 0, photosSkipped: 0, photosFailed: 0, errors: 0,
};
const byClass = {}; // class -> {insert, update, skip}
const suspected = [];
const unresolvedSib = [];
const lookupCreated = {}; // type -> Set(code)

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.stage || !args.schoolCode || !args.file || !args.session) {
    console.log('Usage: --stage prod --school-code DBPASN --file <csv> --academic-session 2026-27 [--dry-run] [--no-photos] [--limit N]');
    process.exit(1);
  }
  const doPhotos = args.photosOnly || (args.photos && !args.dryRun);

  const env = loadConfig(args.stage);
  const bucket = env.FILE_STORAGE_BUCKET;
  const region = env.AWS_REGION || process.env.AWS_REGION || 'ap-south-1';
  let s3 = null;
  let S3 = null;
  if (doPhotos) {
    S3 = require('@aws-sdk/client-s3');
    s3 = new S3.S3Client({ region });
  }

  const raw = fs.readFileSync(args.file, 'utf8');
  let records = parse(raw.slice(raw.indexOf('"Sr. No."')), {
    columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true,
  });
  if (args.limit) records = records.slice(0, args.limit);
  console.log(`Parsed ${records.length} records${args.limit ? ` (limited)` : ''}`);
  console.log(`Mode: ${args.dryRun ? 'DRY-RUN (no writes)' : 'LIVE'}  Photos: ${doPhotos ? 'yes' : 'no'}\n`);

  const pool = new Pool({
    host: env.POSTGRES_ENDPOINT || env.POSTGRES_HOST,
    database: env.POSTGRES_DATABASE,
    user: env.POSTGRES_USERNAME || env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    port: parseInt(env.POSTGRES_PORT || '5432', 10),
    ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30000,
    keepAlive: true,
  });
  // Idle clients can emit errors (server closed the connection); without a handler
  // this crashes the process. Swallow it — the pool replaces the client, and the
  // per-row transactions + idempotent upserts make a resumed run safe.
  pool.on('error', (err) => console.error(`  [pool] idle-client error ignored: ${err.message}`));

  try {
    const c0 = await pool.connect();
    const sch = await c0.query('select uuid from school where lower(code) = lower($1)', [args.schoolCode]);
    if (sch.rows.length === 0) throw new Error(`School ${args.schoolCode} not found`);
    const schoolId = sch.rows[0].uuid;

    // Academic year (create if missing)
    let ayId;
    {
      const r = await c0.query('select uuid from academic_year where lower(code)=lower($1) and school_id=$2', [args.session, schoolId]);
      if (r.rows.length) ayId = r.rows[0].uuid;
      else {
        const m = args.session.match(/^(\d{4})-(\d{2})$/);
        const start = `${m[1]}-04-01`, end = `${Math.floor(+m[1] / 100) * 100 + +m[2]}-03-31`;
        ayId = generateShortUuid(12);
        if (!args.dryRun) await c0.query(
          `insert into academic_year (uuid,name,code,start_date,end_date,school_id,createdby_userid,created_at)
           values ($1,$2,$3,$4,$5,$6,'0',now()) on conflict (code,school_id) do nothing`,
          [ayId, args.session, args.session, start, end, schoolId]);
        console.log(`Academic year ${args.session}: ${args.dryRun ? 'would create' : 'ready'}`);
      }
    }

    // Preload existing students
    const ex = await c0.query("select uuid, admission_number, name, dob from student where school_id=$1 and status<>'deleted'", [schoolId]);
    const byAdm = new Map();
    const byNameDob = new Map();
    for (const r of ex.rows) {
      byAdm.set(String(r.admission_number || '').trim().toLowerCase(), r);
      const dob = r.dob ? new Date(r.dob).toISOString().slice(0, 10) : '';
      const k = norm(r.name) + '|' + dob;
      if (!byNameDob.has(k)) byNameDob.set(k, []);
      byNameDob.get(k).push(String(r.admission_number || '').trim());
    }
    const csvAdmSet = new Set(records.map((r) => clean(r['Adm. No.']).toLowerCase()));
    c0.release();

    const classCache = {};
    const lookupCache = {}; // `${type}|${code}` -> true (exists or created)
    const admToUuid = new Map(); // admLower -> uuid
    const guardianRefs = []; // { record, studentId, guardians: {father,mother,guardian} }

    async function resolveLookup(client, type, value) {
      const val = clean(value);
      if (!val) return null;
      const code = normalizeCode(val);
      const key = `${type}|${code}`;
      if (lookupCache[key]) return code;
      const r = await client.query('select 1 from student_lookup where school_id=$1 and lookup_type=$2 and lower(code)=lower($3) and status=$4 limit 1', [schoolId, type, code, 'active']);
      if (r.rows.length) { lookupCache[key] = true; return code; }
      (lookupCreated[type] = lookupCreated[type] || new Set()).add(code);
      if (!args.dryRun) {
        await client.query(
          `insert into student_lookup (uuid,school_id,lookup_type,code,label,status,createdby_userid,created_at)
           values ($1,$2,$3,$4,$5,'active','0',now())`,
          [generateShortUuid(12), schoolId, type, code, val]);
      }
      lookupCache[key] = true;
      return code;
    }

    async function resolveClass(client, name) {
      const key = name.toLowerCase();
      if (classCache[key]) return classCache[key];
      const r = await client.query('select uuid from class where lower(code)=lower($1) and school_id=$2', [name, schoolId]);
      if (r.rows.length) return (classCache[key] = r.rows[0].uuid);
      const uuid = generateShortUuid(12);
      if (!args.dryRun) await client.query(
        `insert into class (uuid,name,code,school_id,createdby_userid,created_at) values ($1,$2,$3,$4,'0',now()) on conflict (code,school_id) do nothing`,
        [uuid, name, name, schoolId]);
      return (classCache[key] = uuid);
    }

    // ---- PASS 1: students + guardians + addresses + enrollment ----
    if (!args.photosOnly) for (let i = 0; i < records.length; i++) {
      const row = records[i];
      const adm = clean(row['Adm. No.']);
      const cls = clean(row['Class Name']) || '(no class)';
      byClass[cls] = byClass[cls] || { insert: 0, update: 0, skip: 0 };
      if (!adm) { stats.errors++; console.error(`  Row ${i + 2}: blank admission number, skipped`); continue; }

      const client = await pool.connect();
      try {
        if (!args.dryRun) await client.query('BEGIN');
        const dob = parseDate(row['D.O.B']);
        let studentId, isInsert;
        const existing = byAdm.get(adm.toLowerCase());
        if (existing) {
          studentId = existing.uuid; isInsert = false;
        } else {
          const k = norm(row['Student Name']) + '|' + (dob || '');
          const hit = byNameDob.get(k);
          if (hit && hit.some((a) => a.toLowerCase() !== adm.toLowerCase())) {
            stats.skipDup++; byClass[cls].skip++;
            suspected.push({ name: clean(row['Student Name']), father: clean(row["Father's Name"]), newAdm: adm, existing: hit.join(', '), cls });
            if (!args.dryRun) await client.query('ROLLBACK');
            client.release();
            continue;
          }
          studentId = generateShortUuid(12); isInsert = true;
        }
        admToUuid.set(adm.toLowerCase(), studentId);

        // lookups
        const categoryCode = await resolveLookup(client, 'category', row['Category']);
        const bloodCode = await resolveLookup(client, 'blood_group', row['Blood Group']);
        const nationalityCode = await resolveLookup(client, 'nationality', row['Nationality']);
        const motherTongueCode = await resolveLookup(client, 'mother_tongue', row['Mother Tongue']);
        const stateCode = await resolveLookup(client, 'state', row['State']);
        const cityCode = await resolveLookup(client, 'city', row['City']);
        const localityCode = await resolveLookup(client, 'locality', row['Locality']);
        const countryCode = await resolveLookup(client, 'country', row['Country']);

        const statusVal = clean(row['Status']).toLowerCase() === 'inactive' ? 'inactive' : 'active';
        const fatherMobile = orNull(row['Father Mobile No.']);
        const motherMobile = orNull(row['Mother Mobile No.']);
        const guardianMobile = orNull(row['Guardian Mobile No.']);

        const vals = {
          name: clean(row['Student Name']) || null,
          gender: clean(row['Gender']) || null,
          dob,
          admissionDate: parseDate(row['Date Of Admission']),
          withdrawalDate: parseDate(row['Date Of Withdrawal']),
          withdrawalRemarks: orNull(row['Withdrawal Remarks']),
          studentEmail: orNull(row['Student Email']),
          studentMobile: orNull(row['Student Mobile']),
          aadhaar: orNull(row['Aadhaar Number']),
          previousSchool: orNull(row['Previous School Attended']),
          categoryCode, bloodCode, nationalityCode, motherTongueCode,
          fatherMobile, motherMobile, guardianMobile,
        };

        if (!args.dryRun) {
          if (isInsert) {
            await client.query(
              `insert into student
                (uuid, admission_number, name, gender, dob, status, school_id,
                 student_email, student_mobile, category_code, nationality_code, mother_tongue_code,
                 blood_group_code, aadhaar_number, previous_school, admission_date, withdrawal_date, withdrawal_remarks,
                 father_mobile, mother_mobile, guardian_mobile, createdby_userid, created_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'0',now())`,
              [studentId, adm, vals.name, vals.gender, vals.dob, statusVal, schoolId,
               vals.studentEmail, vals.studentMobile, vals.categoryCode, vals.nationalityCode, vals.motherTongueCode,
               vals.bloodCode, vals.aadhaar, vals.previousSchool, vals.admissionDate, vals.withdrawalDate, vals.withdrawalRemarks,
               vals.fatherMobile, vals.motherMobile, vals.guardianMobile]);
          } else {
            // Non-destructive: only fill fields when the CSV has a value (coalesce),
            // but name/gender/dob/status are authoritative from the export.
            await client.query(
              `update student set
                 name=$2, gender=coalesce($3,gender), dob=coalesce($4,dob), status=$5,
                 student_email=coalesce($6,student_email), student_mobile=coalesce($7,student_mobile),
                 category_code=coalesce($8,category_code), nationality_code=coalesce($9,nationality_code),
                 mother_tongue_code=coalesce($10,mother_tongue_code), blood_group_code=coalesce($11,blood_group_code),
                 aadhaar_number=coalesce($12,aadhaar_number), previous_school=coalesce($13,previous_school),
                 admission_date=coalesce($14,admission_date), withdrawal_date=coalesce($15,withdrawal_date),
                 withdrawal_remarks=coalesce($16,withdrawal_remarks),
                 father_mobile=coalesce($17,father_mobile), mother_mobile=coalesce($18,mother_mobile),
                 guardian_mobile=coalesce($19,guardian_mobile), updatedby_userid='0', updated_at=now()
               where uuid=$1 and school_id=$20`,
              [studentId, vals.name, vals.gender, vals.dob, statusVal, vals.studentEmail, vals.studentMobile,
               vals.categoryCode, vals.nationalityCode, vals.motherTongueCode, vals.bloodCode, vals.aadhaar,
               vals.previousSchool, vals.admissionDate, vals.withdrawalDate, vals.withdrawalRemarks,
               vals.fatherMobile, vals.motherMobile, vals.guardianMobile, schoolId]);
          }

          // Enrollment: one row per (student, AY) -> the CSV class.
          const classId = await resolveClass(client, cls);
          const joinDate = parseDate(row['Date Of Joining']);
          const en = await client.query('select uuid, class_id from student_class where student_id=$1 and academic_year_id=$2 and school_id=$3 limit 1', [studentId, ayId, schoolId]);
          if (en.rows.length) {
            await client.query('update student_class set class_id=$1, join_date=coalesce($2,join_date), status=coalesce(status,$3), updatedby_userid=$4, updated_at=now() where uuid=$5',
              [classId, joinDate, 'active', '0', en.rows[0].uuid]);
          } else {
            await client.query(
              `insert into student_class (uuid,student_id,academic_year_id,class_id,join_date,status,school_id,createdby_userid,created_at)
               values ($1,$2,$3,$4,$5,'active',$6,'0',now()) on conflict (student_id,academic_year_id,class_id,school_id) do nothing`,
              [generateShortUuid(12), studentId, ayId, classId, joinDate, schoolId]);
          }

          // Guardians (father/mother/guardian) — upsert by (student, relation)
          const gmap = {};
          const primaryRel = ['father', 'mother', 'guardian'].find((rel) => guardianHasData(row, rel));
          for (const rel of ['father', 'mother', 'guardian']) {
            if (!guardianHasData(row, rel)) continue;
            const gid = await upsertGuardian(client, schoolId, studentId, rel, row, rel === primaryRel);
            gmap[rel] = gid;
            stats.guardians++;
          }
          guardianRefs.push({ studentId, row, guardians: gmap });

          // Addresses — replace only when a permanent line is present
          const permLine = orNull(row['Permanent Address']);
          const corrLine = orNull(row['Correspondence Address']);
          if (permLine || corrLine) {
            await client.query("update student_address set status='deleted', updatedby_userid='0', updated_at=now() where student_id=$1 and school_id=$2 and status='active'", [studentId, schoolId]);
            const hasCorr = !!corrLine;
            await insertAddress(client, schoolId, studentId, { line: permLine || corrLine, isPermanent: true, isCommunication: !hasCorr, localityCode, cityCode, stateCode, countryCode, pincode: orNull(row['Pincode']) });
            stats.addresses++;
            if (hasCorr) {
              await insertAddress(client, schoolId, studentId, { line: corrLine, isPermanent: false, isCommunication: true, localityCode, cityCode, stateCode, countryCode, pincode: orNull(row['Pincode']) });
              stats.addresses++;
            }
          }

          // TC (rare)
          if (clean(row['TC SRN Number']) || parseDate(row['Date of TC issue']) || clean(row['Reason for leaving School'])) {
            const issue = parseDate(row['Date of TC issue']);
            await client.query(
              `insert into student_tc (uuid,school_id,student_id,application_date,srn_number,issue_date,reason_for_leaving,total_attendance_days,total_working_days,status,createdby_userid,created_at)
               values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'0',now())`,
              [generateShortUuid(12), schoolId, studentId, parseDate(row['Application for TC']), orNull(row['TC SRN Number']), issue,
               orNull(row['Reason for leaving School']), intOrNull(row['T.C Total Days Attendance']), intOrNull(row['T.C Total Working Days']), issue ? 'issued' : 'applied']);
            stats.tc++;
          }

          await client.query('COMMIT');
        } else {
          // dry-run: still record guardianRefs for reporting counts
          const gmap = {};
          for (const rel of ['father', 'mother', 'guardian']) if (guardianHasData(row, rel)) { gmap[rel] = true; stats.guardians++; }
          guardianRefs.push({ studentId, row, guardians: gmap });
          if (orNull(row['Permanent Address']) || orNull(row['Correspondence Address'])) stats.addresses += orNull(row['Correspondence Address']) ? 2 : 1;
        }

        if (isInsert) { stats.insert++; byClass[cls].insert++; }
        else { stats.update++; byClass[cls].update++; }
        if ((i + 1) % 100 === 0) console.log(`  ...processed ${i + 1}/${records.length}`);
      } catch (err) {
        if (!args.dryRun) { try { await client.query('ROLLBACK'); } catch {} }
        stats.errors++;
        console.error(`  Row ${i + 2} (${adm}) FAILED: ${err.message}`);
      } finally {
        client.release();
      }
    }

    // ---- PASS 2: siblings ----
    if (!args.photosOnly) for (const row of records) {
      const refs = parseSiblings(row['Siblings']);
      if (!refs.length) continue;
      const selfAdm = clean(row['Adm. No.']).toLowerCase();
      const selfUuid = admToUuid.get(selfAdm) || (byAdm.get(selfAdm) || {}).uuid;
      if (!selfUuid) continue;
      for (const refAdm of refs) {
        const key = refAdm.toLowerCase();
        let targetUuid = admToUuid.get(key) || (byAdm.get(key) || {}).uuid;
        if (!targetUuid && !csvAdmSet.has(key)) {
          // try DB directly (student not in this file but may exist)
          if (!args.dryRun) {
            const c = await pool.connect();
            try { const r = await c.query("select uuid from student where lower(admission_number)=lower($1) and school_id=$2 and status<>'deleted'", [refAdm, schoolId]); if (r.rows.length) targetUuid = r.rows[0].uuid; } finally { c.release(); }
          }
        }
        if (!targetUuid || targetUuid === selfUuid) { stats.siblingsUnresolved++; unresolvedSib.push({ from: clean(row['Adm. No.']), ref: refAdm }); continue; }
        if (!args.dryRun) {
          const c = await pool.connect();
          try {
            for (const [a, b] of [[selfUuid, targetUuid], [targetUuid, selfUuid]]) {
              const ex2 = await c.query("select 1 from student_sibling where school_id=$1 and student_id=$2 and sibling_student_id=$3 and status='active' limit 1", [schoolId, a, b]);
              if (!ex2.rows.length) await c.query("insert into student_sibling (uuid,school_id,student_id,sibling_student_id,status,createdby_userid,created_at) values ($1,$2,$3,$4,'active','0',now())", [generateShortUuid(12), schoolId, a, b]);
            }
          } finally { c.release(); }
        }
        stats.siblingsLinked++;
      }
    }

    // ---- PASS 3: photos ----
    if (doPhotos) {
      console.log('\nUploading photos...');
      // In --photos-only mode we didn't build the in-memory guardian map, so
      // resolve student + guardians from the DB by admission number / relation.
      const refs = args.photosOnly
        ? records.map((row) => ({ row, studentId: (byAdm.get(clean(row['Adm. No.']).toLowerCase()) || {}).uuid, guardians: null }))
        : guardianRefs;
      for (const ref of refs) {
        if (!ref.studentId) continue;
        let g = ref.guardians;
        if (!g) {
          const c = await pool.connect();
          try {
            const r = await c.query("select relation, uuid from student_guardian where student_id=$1 and school_id=$2 and status='active'", [ref.studentId, schoolId]);
            g = {}; for (const x of r.rows) g[x.relation] = x.uuid;
          } finally { c.release(); }
        }
        await maybePhoto(pool, s3, S3, bucket, schoolId, 'student', ref.studentId, ref.row['Student Photo']);
        if (g.father) await maybePhoto(pool, s3, S3, bucket, schoolId, 'guardian', g.father, ref.row['Father Photo']);
        if (g.mother) await maybePhoto(pool, s3, S3, bucket, schoolId, 'guardian', g.mother, ref.row['Mother Photo']);
        if (g.guardian) await maybePhoto(pool, s3, S3, bucket, schoolId, 'guardian', g.guardian, ref.row['Guardian Photo']);
        if ((stats.photosUploaded + stats.photosSkipped + stats.photosFailed) % 100 === 0) console.log(`  ...photos u:${stats.photosUploaded} skip:${stats.photosSkipped} fail:${stats.photosFailed}`);
      }
    }

    // ---- report ----
    printReport(args, records.length);
  } finally {
    await pool.end();
  }

  // ---- inner helpers that need closure over args/schoolId are defined above; standalone below ----
}

function intOrNull(v) { const s = clean(v); const n = parseInt(s, 10); return s && !isNaN(n) ? n : null; }

function guardianHasData(row, rel) {
  const cap = rel === 'father' ? 'Father' : rel === 'mother' ? 'Mother' : 'Guardian';
  return !!(gname(row, rel) || clean(row[`${cap} Mobile No.`]) || clean(row[`${cap} Occupation`]) ||
    clean(row[`${cap} Email`]) || clean(row[`${cap} Address`]));
}
function gname(row, rel) {
  if (rel === 'father') return clean(row["Father's Name"]);
  if (rel === 'mother') return clean(row["Mother's Name"]);
  return clean(row['Guardian Name']);
}

async function upsertGuardian(client, schoolId, studentId, rel, row, isPrimary) {
  const cap = rel === 'father' ? 'Father' : rel === 'mother' ? 'Mother' : 'Guardian';
  const data = {
    name: gname(row, rel) || null, // honorifics KEPT verbatim
    relationship: rel === 'guardian' ? (orNull(row['Guardian Relationship']) ? normalizeCode(row['Guardian Relationship']) : null) : null,
    occupation: orNull(row[`${cap} Occupation`]),
    designation: orNull(row[`${cap} Designation`]),
    organisation: orNull(row[`${cap} Organisation`]),
    education: orNull(row[`${cap} Education`]),
    address: orNull(row[`${cap} Address`]),
    mobile: orNull(row[`${cap} Mobile No.`]),
    email: orNull(row[`${cap} Email`]),
  };
  const ex = await client.query("select uuid from student_guardian where student_id=$1 and school_id=$2 and relation=$3 and status='active' limit 1", [studentId, schoolId, rel]);
  if (ex.rows.length) {
    const uuid = ex.rows[0].uuid;
    await client.query(
      `update student_guardian set name=coalesce($2,name), relationship=coalesce($3,relationship),
         occupation=coalesce($4,occupation), designation=coalesce($5,designation), organisation=coalesce($6,organisation),
         education=coalesce($7,education), address=coalesce($8,address), mobile=coalesce($9,mobile), email=coalesce($10,email),
         is_primary_contact=$11, updatedby_userid='0', updated_at=now() where uuid=$1`,
      [uuid, data.name, data.relationship, data.occupation, data.designation, data.organisation, data.education, data.address, data.mobile, data.email, isPrimary]);
    return uuid;
  }
  const uuid = generateShortUuid(12);
  await client.query(
    `insert into student_guardian (uuid,school_id,student_id,relation,relationship,name,occupation,designation,organisation,education,address,mobile,email,is_primary_contact,status,createdby_userid,created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active','0',now())`,
    [uuid, schoolId, studentId, rel, data.relationship, data.name, data.occupation, data.designation, data.organisation, data.education, data.address, data.mobile, data.email, isPrimary]);
  return uuid;
}

async function insertAddress(client, schoolId, studentId, a) {
  await client.query(
    `insert into student_address (uuid,school_id,student_id,is_permanent,is_communication,line,locality_code,city_code,state_code,country_code,pincode,status,createdby_userid,created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active','0',now())`,
    [generateShortUuid(12), schoolId, studentId, a.isPermanent, a.isCommunication, a.line, a.localityCode, a.cityCode, a.stateCode, a.countryCode, a.pincode]);
}

function parseSiblings(raw) {
  // Multi-sibling cells separate refs with HTML <br /> (and sometimes commas/newlines).
  const s = clean(raw).replace(/<br\s*\/?>/gi, '\n');
  if (!s) return [];
  const out = [];
  const re = /([^(),\n]+?)\s*\([^)]*\)/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const adm = m[1].replace(/^[\s,]+/, '').replace(/<[^>]*>/g, '').trim();
    if (adm) out.push(adm);
  }
  return [...new Set(out)];
}

async function maybePhoto(pool, s3, S3, bucket, schoolId, entityType, entityId, url) {
  const u = clean(url);
  if (!u || !/^https?:\/\//.test(u)) return;
  const client = await pool.connect();
  try {
    const ex = await client.query("select 1 from file_storage where entity_type=$1 and entity_id=$2 and school_id=$3 and (variant='original' or variant is null) limit 1", [entityType, entityId, schoolId]);
    if (ex.rows.length) { stats.photosSkipped++; return; }
    const res = await fetch(u);
    if (!res.ok) { stats.photosFailed++; return; }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = path.extname(new URL(u).pathname) || '.jpg';
    const mime = ext.toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';
    const uuid = generateShortUuid(12);
    const key = `${schoolId}/${entityType}/${entityId}/original/${uuid}${ext}`;
    await s3.send(new S3.PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: mime }));
    await client.query(
      `insert into file_storage (uuid,file_name,mime_type,size_bytes,data,storage_key,entity_type,entity_id,variant,school_id,createdby_userid,created_at)
       values ($1,$2,$3,$4,null,$5,$6,$7,'original',$8,'0',now())`,
      [uuid, `${entityType}-${entityId}${ext}`, mime, buf.length, key, entityType, entityId, schoolId]);
    stats.photosUploaded++;
  } catch (e) {
    stats.photosFailed++;
  } finally {
    client.release();
  }
}

function printReport(args, total) {
  const order = (c) => { const R = { NURSERY: 0, LKG: 1, UKG: 2, I: 3, II: 4, III: 5, IV: 6, V: 7, VI: 8, VII: 9, VIII: 10, IX: 11, X: 12, XI: 13, XII: 14 }; const b = c.split('-')[0].toUpperCase(); return (R[b] ?? 99) * 10 + (c.split('-')[1] === 'B' ? 1 : 0); };
  console.log('\nCLASS        INSERT  UPDATE   SKIP');
  console.log('----------------------------------');
  for (const c of Object.keys(byClass).sort((a, b) => order(a) - order(b))) {
    const x = byClass[c];
    console.log(`${c.padEnd(12)} ${String(x.insert).padStart(6)} ${String(x.update).padStart(7)} ${String(x.skip).padStart(6)}`);
  }
  console.log('----------------------------------');
  console.log(`TOTAL        ${String(stats.insert).padStart(6)} ${String(stats.update).padStart(7)} ${String(stats.skipDup).padStart(6)}`);
  console.log(`\nGuardians: ${stats.guardians}  Addresses: ${stats.addresses}  TC: ${stats.tc}`);
  console.log(`Siblings linked: ${stats.siblingsLinked}  unresolved refs: ${stats.siblingsUnresolved}`);
  if (!args.dryRun && args.photos) console.log(`Photos uploaded: ${stats.photosUploaded}  skipped(existing): ${stats.photosSkipped}  failed: ${stats.photosFailed}`);
  console.log(`Errors: ${stats.errors}`);
  console.log('\nLookups that would be/were created:');
  for (const [t, set] of Object.entries(lookupCreated)) console.log(`  ${t}: ${[...set].join(', ')}`);
  if (suspected.length) {
    console.log(`\nSUSPECTED DUPLICATES (skipped): ${suspected.length}`);
    for (const s of suspected.slice(0, 50)) console.log(`  • ${s.name} (father ${s.father}) new=${s.newAdm} vs existing=${s.existing} [${s.cls}]`);
  }
  if (unresolvedSib.length) {
    console.log(`\nUNRESOLVED SIBLING REFS: ${unresolvedSib.length}`);
    for (const s of unresolvedSib.slice(0, 30)) console.log(`  • ${s.from} → ${s.ref}`);
  }
  if (args.dryRun) console.log('\n(DRY-RUN — nothing was written)');
}

if (require.main === module) {
  main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
}
