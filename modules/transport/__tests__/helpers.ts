import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';
import { Pool } from 'pg';

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;

export const BASE_URL = `http://localhost:${port}/${config.prefix}`;
export const headers = {
  'Content-Type': 'application/json',
  'X-School-Code': TEST_SCHOOL_CODE,
};

let pool: Pool | null = null;
function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || process.env.POSTGRES_ENDPOINT,
      database: process.env.POSTGRES_DATABASE,
      user: process.env.POSTGRES_USER || process.env.POSTGRES_USERNAME,
      password: process.env.POSTGRES_PASSWORD,
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}

// Seed references from the sample school: an academic year, two active students,
// and one employee (used as route staff).
let cached: { academicYearId: string; studentIds: string[]; employeeId: string } | null = null;
export async function getSeed(): Promise<{ academicYearId: string; studentIds: string[]; employeeId: string }> {
  if (cached) return cached;
  const schoolRow = await getPool().query(`select uuid from school where lower(code) = lower($1)`, [TEST_SCHOOL_CODE]);
  if (schoolRow.rows.length === 0) throw new Error(`No school ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  const schoolId = schoolRow.rows[0].uuid;

  const ay = await getPool().query(
    `select uuid from academic_year where school_id = $1 order by start_date desc limit 1`, [schoolId]);
  if (ay.rows.length === 0) throw new Error('No academic year — run sample-school-setup');

  const studs = await getPool().query(
    `select uuid from student where school_id = $1 and status = 'active' order by name limit 2`, [schoolId]);
  if (studs.rows.length < 2) throw new Error('Need >= 2 active students — run sample-school-setup');

  const emp = await getPool().query(
    `select uuid from employee where school_id = $1 and status != 'deleted' order by name limit 1`, [schoolId]);
  if (emp.rows.length === 0) throw new Error('No employee — run sample-school-setup');

  cached = {
    academicYearId: ay.rows[0].uuid,
    studentIds: studs.rows.map((r) => r.uuid),
    employeeId: emp.rows[0].uuid,
  };
  return cached;
}

// A short random suffix so unique-constrained names (stop/vehicle/route) don't
// collide across repeated test runs against a persistent DB.
export function rnd(): string {
  return Math.random().toString(36).slice(2, 8);
}
