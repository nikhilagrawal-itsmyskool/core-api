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

// A class in the test school that has >= 2 enrolled active students, with the
// enrolled student ids. Drives mark/finalize tests against real roster data.
let cached: { classId: string; academicYearId: string; studentIds: string[] } | null = null;
export async function getEnrolledClass(): Promise<{ classId: string; academicYearId: string; studentIds: string[] }> {
  if (cached) return cached;
  const grp = await getPool().query(
    `select sc.class_id, sc.academic_year_id, count(*) as n
     from student_class sc join student st on st.uuid = sc.student_id
     join school s on s.uuid = sc.school_id
     where lower(s.code) = lower($1) and st.status = 'active'
     group by sc.class_id, sc.academic_year_id having count(*) >= 2
     order by n desc limit 1`,
    [TEST_SCHOOL_CODE],
  );
  if (grp.rows.length === 0) throw new Error(`No class with >=2 enrolled students for ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  const { class_id, academic_year_id } = grp.rows[0];
  const studs = await getPool().query(
    `select st.uuid from student_class sc join student st on st.uuid = sc.student_id
     join school s on s.uuid = sc.school_id
     where lower(s.code) = lower($1) and sc.class_id = $2 and sc.academic_year_id = $3 and st.status = 'active'
     order by st.name`,
    [TEST_SCHOOL_CODE, class_id, academic_year_id],
  );
  cached = { classId: class_id, academicYearId: academic_year_id, studentIds: studs.rows.map((r) => r.uuid) };
  return cached;
}

// A unique historical date (yyyy-mm-dd) so each test gets its own session and
// runs are repeatable (also exercises back-dating).
export function uniqueDate(): string {
  const d = new Date(2015, 0, 1);
  d.setDate(d.getDate() + Math.floor(Math.random() * 3500));
  return d.toISOString().slice(0, 10);
}
