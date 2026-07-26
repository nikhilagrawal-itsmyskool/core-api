import { TEST_SCHOOL_CODE } from "../../../tests/setup";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { parseGrade } from "../syllabus-util";

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../local.config.json"), "utf8"),
);
const port = process.env.GATEWAY_PORT || config.httpPort;

export const BASE_URL = `http://localhost:${port}/${config.prefix}`;
export const headers = {
  "Content-Type": "application/json",
  "X-School-Code": TEST_SCHOOL_CODE,
};

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || process.env.POSTGRES_ENDPOINT,
      database: process.env.POSTGRES_DATABASE,
      user: process.env.POSTGRES_USER || process.env.POSTGRES_USERNAME,
      password: process.env.POSTGRES_PASSWORD,
      port: parseInt(process.env.POSTGRES_PORT || "5432"),
      ssl:
        process.env.POSTGRES_SSL === "false"
          ? false
          : { rejectUnauthorized: false },
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

// Seed references from the sample school: an academic year and two classes
// (sections) that share a grade prefix, used to author a plan and to prove
// per-section progress isolation.
export interface Seed {
  academicYearId: string;
  grade: string;
  sectionA: { classId: string; className: string };
  sectionB: { classId: string; className: string };
}

let cached: Seed | null = null;
export async function getSeed(): Promise<Seed> {
  if (cached) return cached;
  const schoolRow = await getPool().query(
    `select uuid from school where lower(code) = lower($1)`,
    [TEST_SCHOOL_CODE],
  );
  if (schoolRow.rows.length === 0)
    throw new Error(`No school ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  const schoolId = schoolRow.rows[0].uuid;

  const ay = await getPool().query(
    `select uuid from academic_year where school_id = $1 order by start_date desc limit 1`,
    [schoolId],
  );
  if (ay.rows.length === 0)
    throw new Error("No academic year — run sample-school-setup");

  const classes = await getPool().query(
    `select uuid, name from class where school_id = $1 order by seq asc nulls last, name`,
    [schoolId],
  );
  if (classes.rows.length === 0)
    throw new Error("No classes — run sample-school-setup");

  // Find a grade with at least two sections (e.g. I-A, I-B); fall back to two
  // arbitrary classes treated as distinct sections if none share a grade.
  const byGrade = new Map<string, { classId: string; className: string }[]>();
  for (const r of classes.rows) {
    const g = parseGrade(r.name).toLowerCase();
    if (!byGrade.has(g)) byGrade.set(g, []);
    byGrade.get(g)!.push({ classId: r.uuid, className: r.name });
  }
  let pick = [...byGrade.entries()].find(([, secs]) => secs.length >= 2);
  let grade: string;
  let secs: { classId: string; className: string }[];
  if (pick) {
    grade = parseGrade(pick[1][0].className);
    secs = pick[1];
  } else {
    grade = parseGrade(classes.rows[0].name);
    secs = [
      { classId: classes.rows[0].uuid, className: classes.rows[0].name },
      {
        classId: classes.rows[Math.min(1, classes.rows.length - 1)].uuid,
        className: classes.rows[Math.min(1, classes.rows.length - 1)].name,
      },
    ];
  }

  cached = {
    academicYearId: ay.rows[0].uuid,
    grade,
    sectionA: secs[0],
    sectionB: secs[1],
  };
  return cached;
}

// A short random suffix so unique-constrained names don't collide across runs.
export function rnd(): string {
  return Math.random().toString(36).slice(2, 8);
}

// Ensure a stream (class_stream) exists+active for the test school, so plan
// stream tests have a valid code to reference. Idempotent.
export async function ensureStream(code: string, name: string): Promise<void> {
  const schoolRow = await getPool().query(
    `select uuid from school where lower(code) = lower($1)`,
    [TEST_SCHOOL_CODE],
  );
  if (schoolRow.rows.length === 0)
    throw new Error(`No school ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  const schoolId = schoolRow.rows[0].uuid;
  const existing = await getPool().query(
    `select uuid from class_stream where school_id = $1 and lower(code) = lower($2)`,
    [schoolId, code],
  );
  if (existing.rows.length > 0) {
    await getPool().query(`update class_stream set status = 'active' where uuid = $1`, [
      existing.rows[0].uuid,
    ]);
    return;
  }
  const { generateShortUuid } = require("../../../shared/util/generate-uuid.js");
  await getPool().query(
    `insert into class_stream (uuid, school_id, code, name, seq, status) values ($1, $2, $3, $4, $5, 'active')`,
    [generateShortUuid(12), schoolId, code, name, 1],
  );
}
