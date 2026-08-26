import { TEST_SCHOOL_CODE } from "../../../tests/setup";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../local.config.json"), "utf8"),
);
const port = process.env.GATEWAY_PORT || config.httpPort;

export const BASE_URL = `http://localhost:${port}/${config.prefix}`;
export const headers = {
  "Content-Type": "application/json",
  "X-School-Code": TEST_SCHOOL_CODE,
};

// Marker embedded in test exam names so cleanup only ever touches test rows.
export const TEST_MARKER = "__EXAM_TEST__";

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || process.env.POSTGRES_ENDPOINT,
      database: process.env.POSTGRES_DATABASE,
      user: process.env.POSTGRES_USER || process.env.POSTGRES_USERNAME,
      password: process.env.POSTGRES_PASSWORD,
      port: parseInt(process.env.POSTGRES_PORT || "5432"),
      ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export interface Ctx {
  schoolId: string;
  academicYearId: string;
}

let cached: Ctx | null = null;
export async function getContext(): Promise<Ctx> {
  if (cached) return cached;
  const p = getPool();
  const school = await p.query("select uuid from school where lower(code) = lower($1)", [TEST_SCHOOL_CODE]);
  const schoolId = school.rows[0].uuid;
  const ay = await p.query(
    `select uuid from academic_year where school_id = $1
     order by (case when current_date between start_date and end_date then 0 else 1 end), start_date desc nulls last
     limit 1`,
    [schoolId],
  );
  cached = { schoolId, academicYearId: ay.rows[0].uuid };
  return cached;
}

// Remove every test exam (and its child rows) — matched by the marker in the name.
export async function cleanupTestExams(): Promise<void> {
  const { schoolId } = await getContext();
  const p = getPool();
  const rows = await p.query(
    "select uuid from examination where school_id = $1 and name like $2",
    [schoolId, `%${TEST_MARKER}%`],
  );
  const ids = rows.rows.map((r: any) => r.uuid);
  if (!ids.length) return;
  await p.query("delete from exam_paper where exam_id = any($1)", [ids]);
  await p.query("delete from exam_invigilator where exam_id = any($1)", [ids]);
  await p.query("delete from exam_admit_card where exam_id = any($1)", [ids]);
  await p.query("delete from exam_dues_override where exam_id = any($1)", [ids]);
  await p.query("delete from exam_print_log where exam_id = any($1)", [ids]);
  await p.query("delete from exam_attendance where exam_id = any($1)", [ids]);
  await p.query("delete from exam_attendance_audit where exam_id = any($1)", [ids]);
  await p.query("delete from exam_audit where exam_id = any($1)", [ids]);
  await p.query("delete from examination where uuid = any($1)", [ids]);
}

// A paper uuid for (exam, grade, date) — the admin/roster tests operate on a paper.
export async function getPaperId(examId: string, grade: string, dateIso: string): Promise<string | null> {
  const p = getPool();
  const r = await p.query(
    "select uuid from exam_paper where exam_id = $1 and grade = $2 and exam_date = $3 and status = 'active' limit 1",
    [examId, grade, dateIso],
  );
  return r.rows.length ? r.rows[0].uuid : null;
}

// Seed / remove a stored signature for an employee id (so sign-roster has one to stamp).
const TINY_SIG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export async function seedSignature(employeeId: string): Promise<void> {
  const { schoolId } = await getContext();
  const p = getPool();
  await p.query("delete from file_storage where school_id = $1 and entity_type = 'employee_signature' and entity_id = $2", [schoolId, employeeId]);
  await p.query(
    "insert into file_storage (uuid, file_name, mime_type, size_bytes, data, entity_type, entity_id, variant, school_id, createdby_userid, created_at) values ($1,'sig.png','image/png',$2,$3,'employee_signature',$4,'original',$5,$4,now())",
    [`sig${Date.now().toString(36).slice(-9)}`, TINY_SIG.length, TINY_SIG, employeeId, schoolId],
  );
}
export async function cleanupSignature(employeeId: string): Promise<void> {
  const { schoolId } = await getContext();
  const p = getPool();
  await p.query("delete from file_storage where school_id = $1 and entity_type = 'employee_signature' and entity_id = $2", [schoolId, employeeId]);
}

// A real section (class) that has active enrolment — plus the year it's enrolled in and
// one student in it — used by the roster/admit-card tests. Picks whichever academic year
// actually has enrolment (not necessarily the "current" one). Null if the sample school
// has no enrolled classes at all (tests then skip those assertions).
export async function getSampleSection(): Promise<{ sectionClassId: string; grade: string; studentId: string; academicYearId: string } | null> {
  const { schoolId } = await getContext();
  const p = getPool();
  const secRows = await p.query(
    `select sc.class_id, sc.academic_year_id, c.name from student_class sc
     join class c on c.uuid = sc.class_id and c.school_id = sc.school_id and c.base_class_id is null
     join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status = 'active'
     where sc.school_id = $1
     group by sc.class_id, sc.academic_year_id, c.name order by c.name limit 1`,
    [schoolId],
  );
  if (!secRows.rows.length) return null;
  const sectionClassId = secRows.rows[0].class_id;
  const academicYearId = secRows.rows[0].academic_year_id;
  const name = secRows.rows[0].name;
  const grade = (name.indexOf("-") === -1 ? name : name.slice(0, name.indexOf("-"))).trim();
  const stuRows = await p.query(
    `select s.uuid from student_class sc join student s on s.uuid = sc.student_id and s.status = 'active'
     where sc.class_id = $1 and sc.academic_year_id = $2 and sc.school_id = $3 order by s.name limit 1`,
    [sectionClassId, academicYearId, schoolId],
  );
  return { sectionClassId, grade, studentId: stuRows.rows[0].uuid, academicYearId };
}

// Remove test branding (school-scoped) so the suite never leaves logo/stamp behind.
export async function cleanupBranding(): Promise<void> {
  const { schoolId } = await getContext();
  const p = getPool();
  await p.query("delete from file_storage where school_id = $1 and entity_type in ('school_logo','school_stamp')", [schoolId]);
  await p.query("delete from school_branding where school_id = $1", [schoolId]);
}
