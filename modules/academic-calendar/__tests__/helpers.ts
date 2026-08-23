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
  // Same "current" resolution the module uses.
  const ay = await p.query(
    `select uuid from academic_year where school_id = $1
     order by (case when current_date between start_date and end_date then 0 else 1 end), start_date desc nulls last
     limit 1`,
    [schoolId],
  );
  cached = { schoolId, academicYearId: ay.rows[0].uuid };
  return cached;
}

// Tests use a dedicated far-future date window so they never collide with real
// calendar data; this wipes that window after the run.
export const TEST_FROM = "2099-01-01";
export const TEST_TO = "2099-01-31";
export async function cleanupTestWindow(): Promise<void> {
  const { schoolId } = await getContext();
  const p = getPool();
  await p.query(
    "delete from calendar_entry where school_id = $1 and entry_date >= $2 and entry_date <= $3",
    [schoolId, TEST_FROM, TEST_TO],
  );
  await p.query(
    "delete from calendar_holiday where school_id = $1 and holiday_date >= $2 and holiday_date <= $3",
    [schoolId, TEST_FROM, TEST_TO],
  );
  await p.query(
    "delete from calendar_type where school_id = $1 and code like 'test\\_%'",
    [schoolId],
  );
}
