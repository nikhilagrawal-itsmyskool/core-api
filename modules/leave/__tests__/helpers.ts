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
  employeeIds: string[]; // at least 1
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
  if (empRows.rows.length === 0) throw new Error("No employees — run sample-school-setup");

  cached = { schoolId, employeeIds: empRows.rows.map((r: any) => r.uuid) };
  return cached;
}

// Wipe any leave rows for the test employees inside the test month so repeated runs
// start clean (quota counts pending+approved, so leftovers would false-fail).
export async function cleanupMonth(schoolId: string, employeeIds: string[], first: string, last: string): Promise<void> {
  const p = getPool();
  const apps = await p.query(
    `select uuid from leave_application where school_id = $1 and employee_id = any($2) and from_date >= $3 and from_date <= $4`,
    [schoolId, employeeIds, first, last],
  );
  const ids = apps.rows.map((r: any) => r.uuid);
  if (ids.length) {
    await p.query(`delete from leave_audit where school_id = $1 and application_id = any($2)`, [schoolId, ids]);
    await p.query(`delete from leave_application where uuid = any($1)`, [ids]);
  }
}

export async function cleanupNotifications(schoolId: string, recipientId: string): Promise<void> {
  const p = getPool();
  await p.query(`delete from notification where school_id = $1 and recipient_id = $2 and key like 'test_%'`, [schoolId, recipientId]);
}

export async function cleanupAttendance(schoolId: string, employeeIds: string[], first: string, last: string): Promise<void> {
  const p = getPool();
  await p.query(
    `delete from employee_attendance_day where school_id = $1 and employee_id = any($2) and att_date >= $3 and att_date <= $4`,
    [schoolId, employeeIds, first, last],
  );
}

export async function cleanupDeductions(schoolId: string, employeeIds: string[], year: number, month: number): Promise<void> {
  const p = getPool();
  await p.query(
    `delete from leave_deduction_run where school_id = $1 and employee_id = any($2) and run_year = $3 and run_month = $4`,
    [schoolId, employeeIds, year, month],
  );
}
