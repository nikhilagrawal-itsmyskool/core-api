import { Pool } from 'pg';

const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

export interface TestSchool {
  schoolCode: string;
  schoolId: string;
  studentId: string;
  pool: Pool;
}

function createPool(): Pool {
  return new Pool({
    host: process.env.POSTGRES_ENDPOINT || process.env.POSTGRES_HOST || 'localhost',
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USERNAME || process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
}

export async function createTestSchool(): Promise<TestSchool> {
  const pool = createPool();
  const schoolId = generateShortUuid(12);
  // Use last 6 chars of schoolId for a short, unique code (e.g. UTST4X)
  const schoolCode = `UTST${schoolId.slice(-4).toUpperCase()}`;
  const studentId = generateShortUuid(12);
  const now = new Date();

  await pool.query(
    `insert into school (uuid, name, code, created_at) values ($1, $2, $3, $4)`,
    [schoolId, 'Uniform Test School', schoolCode, now]
  );

  // admission_number must be globally unique across all schools
  await pool.query(
    `insert into student (uuid, name, admission_number, status, school_id, created_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [studentId, 'Test Student', `TADM-${studentId}`, 'active', schoolId, now]
  );

  return { schoolCode, schoolId, studentId, pool };
}

export async function cleanupTestSchool(school: TestSchool): Promise<void> {
  const { pool, schoolId } = school;

  // Delete in dependency order (no FK constraints, but be tidy)
  await pool.query(`delete from uniform_return where school_id = $1`, [schoolId]);
  await pool.query(`delete from uniform_sale_item where school_id = $1`, [schoolId]);
  await pool.query(`delete from uniform_sale where school_id = $1`, [schoolId]);
  await pool.query(`delete from uniform_purchase_log where school_id = $1`, [schoolId]);
  await pool.query(`delete from uniform_purchase_batch where school_id = $1`, [schoolId]);
  await pool.query(`delete from uniform_set_item where school_id = $1`, [schoolId]);
  await pool.query(`delete from uniform_set where school_id = $1`, [schoolId]);
  await pool.query(`delete from uniform_item_size where school_id = $1`, [schoolId]);
  await pool.query(`delete from uniform_item where school_id = $1`, [schoolId]);
  await pool.query(`delete from student where school_id = $1`, [schoolId]);
  await pool.query(`delete from school where uuid = $1`, [schoolId]);

  await pool.end();
}
