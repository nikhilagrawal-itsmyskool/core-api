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
  await p.query("delete from exam_audit where exam_id = any($1)", [ids]);
  await p.query("delete from examination where uuid = any($1)", [ids]);
}
