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

// A 1x1 transparent PNG (valid image/png) for photo uploads.
export const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

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

// A base class in the test school with an enrolled student under the CURRENT
// academic year (so studentToday resolves), plus a real employee id to use as
// an override class-teacher. All from the sample school.
export interface Ctx {
  schoolId: string;
  academicYearId: string;
  classId: string;
  className: string;
  studentId: string;
  employeeId: string;
}

const { generateShortUuid } = require("../../../shared/util/generate-uuid.js");
const TEST_STUDENT_NAME = "HW Test Student";

let cached: Ctx | null = null;
export async function getContext(): Promise<Ctx> {
  if (cached) return cached;
  const p = getPool();
  const schoolRow = await p.query(`select uuid from school where lower(code) = lower($1)`, [TEST_SCHOOL_CODE]);
  if (schoolRow.rows.length === 0) throw new Error(`No school ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  const schoolId = schoolRow.rows[0].uuid;

  const ayRow = await p.query(
    `select uuid from academic_year where school_id = $1 order by start_date desc nulls last limit 1`,
    [schoolId],
  );
  if (ayRow.rows.length === 0) throw new Error("No academic year — run sample-school-setup");
  const academicYearId = ayRow.rows[0].uuid;

  const clsRow = await p.query(
    `select uuid, name from class where school_id = $1 and base_class_id is null order by seq asc nulls last, name limit 1`,
    [schoolId],
  );
  if (clsRow.rows.length === 0) throw new Error("No base class — run sample-school-setup");
  const classId = clsRow.rows[0].uuid;
  const className = clsRow.rows[0].name;

  const empRow = await p.query(
    `select uuid from employee where school_id = $1 and status <> 'deleted' order by name limit 1`,
    [schoolId],
  );
  if (empRow.rows.length === 0) throw new Error("No employees — run sample-school-setup");

  // Self-seed a test student + enrolment (idempotent) so studentToday resolves
  // regardless of whether the sample-school roster is loaded locally.
  let stud = await p.query(`select uuid from student where school_id = $1 and name = $2 limit 1`, [schoolId, TEST_STUDENT_NAME]);
  let studentId: string;
  if (stud.rows.length === 0) {
    studentId = generateShortUuid(12);
    await p.query(`insert into student (uuid, school_id, name, status) values ($1, $2, $3, 'active')`, [studentId, schoolId, TEST_STUDENT_NAME]);
  } else {
    studentId = stud.rows[0].uuid;
  }
  const enr = await p.query(
    `select uuid from student_class where school_id = $1 and student_id = $2 and class_id = $3 and academic_year_id = $4 limit 1`,
    [schoolId, studentId, classId, academicYearId],
  );
  if (enr.rows.length === 0) {
    await p.query(
      `insert into student_class (uuid, school_id, student_id, class_id, academic_year_id, status) values ($1, $2, $3, $4, $5, 'active')`,
      [generateShortUuid(12), schoolId, studentId, classId, academicYearId],
    );
  }

  cached = { schoolId, academicYearId, classId, className, studentId, employeeId: empRow.rows[0].uuid };
  return cached;
}

// A unique historical date (yyyy-mm-dd) — repeatable runs + exercises back-dating.
export function histDate(): string {
  const d = new Date(2016, 0, 1);
  d.setDate(d.getDate() + Math.floor(Math.random() * 3000));
  return d.toISOString().slice(0, 10);
}
