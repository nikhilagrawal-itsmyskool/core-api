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

// academicYearId / teacherId are not validated against core tables by the
// foundation CRUD, so tests can use stable synthetic ids for them.
export const TEST_ACADEMIC_YEAR_ID = 'tt-test-yr1';
export const TEST_TEACHER_ID = 'tt-test-tch1';
export const TEST_TEACHER_ID_2 = 'tt-test-tch2';

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

// Resolve a real class uuid for the test school (the sample school has classes).
let cachedClassId: string | null = null;
export async function getClassId(): Promise<string> {
  if (cachedClassId) return cachedClassId;
  const res = await getPool().query(
    `select c.uuid from class c
     join school s on s.uuid = c.school_id
     where lower(s.code) = lower($1) limit 1`,
    [TEST_SCHOOL_CODE],
  );
  if (res.rows.length === 0) throw new Error(`No class found for school ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  cachedClassId = res.rows[0].uuid;
  return cachedClassId;
}

export function uniqueCode(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

// A unique academic-year id that fits academic_year_id varchar(12).
export function uniqueYearId(): string {
  return ('y' + Date.now().toString(36)).slice(0, 12);
}

// Create a subject, returning its uuid.
export async function createSubject(kind = 'academic'): Promise<{ uuid: string; code: string }> {
  const code = uniqueCode('SUB');
  const res = await fetch(`${BASE_URL}/subjects`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ name: `Subject ${code}`, code, kind }),
  });
  if (res.status !== 200) throw new Error(`createSubject failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return { uuid: data.uuid, code };
}
