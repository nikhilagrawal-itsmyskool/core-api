import { TEST_SCHOOL_CODE } from "../../../tests/setup";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../local.config.json"), "utf8"));
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
  employeeIds: string[]; // at least 2 (recorder + assignee)
  studentId: string;
}

let cached: Ctx | null = null;
export async function getContext(): Promise<Ctx> {
  if (cached) return cached;
  const p = getPool();
  const schoolRow = await p.query(`select uuid from school where lower(code) = lower($1)`, [TEST_SCHOOL_CODE]);
  if (schoolRow.rows.length === 0) throw new Error(`No school ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  const schoolId = schoolRow.rows[0].uuid;

  const empRows = await p.query(
    `select uuid from employee where school_id = $1 and status <> 'deleted' order by name limit 5`,
    [schoolId],
  );
  if (empRows.rows.length < 2) throw new Error("Need >=2 employees — run sample-school-setup");

  const stuRows = await p.query(`select uuid from student where school_id = $1 order by name limit 1`, [schoolId]);
  if (stuRows.rows.length === 0) throw new Error("No students — run sample-school-setup");

  cached = { schoolId, employeeIds: empRows.rows.map((r: any) => r.uuid), studentId: stuRows.rows[0].uuid };
  return cached;
}

// Wipe feedback tickets for the test student so repeated runs start clean.
export async function cleanupStudentFeedback(schoolId: string, studentId: string): Promise<void> {
  const p = getPool();
  const rows = await p.query(`select uuid from feedback where school_id = $1 and student_id = $2`, [schoolId, studentId]);
  const ids = rows.rows.map((r: any) => r.uuid);
  if (!ids.length) return;
  const evRows = await p.query(`select uuid from feedback_event where school_id = $1 and feedback_id = any($2)`, [schoolId, ids]);
  const eventIds = evRows.rows.map((r: any) => r.uuid);
  if (eventIds.length) {
    await p.query(`delete from file_storage where entity_type = 'feedback' and school_id = $1 and entity_id = any($2)`, [schoolId, eventIds]);
  }
  await p.query(`delete from feedback_event where school_id = $1 and feedback_id = any($2)`, [schoolId, ids]);
  await p.query(`delete from feedback_watcher where school_id = $1 and feedback_id = any($2)`, [schoolId, ids]);
  await p.query(`delete from feedback where uuid = any($1)`, [ids]);
}
