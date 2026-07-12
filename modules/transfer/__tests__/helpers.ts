import { TEST_SCHOOL_CODE } from '../../../tests/setup';
import * as fs from 'fs';
import * as path from 'path';
const { Pool } = require('pg');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../local.config.json'), 'utf8'));
const port = process.env.GATEWAY_PORT || config.httpPort;

export const BASE_URL = `http://localhost:${port}/${config.prefix}`;
export const headers = {
  'Content-Type': 'application/json',
  'X-School-Code': TEST_SCHOOL_CODE,
};

export function createTestPool() {
  return new Pool({
    host: process.env.POSTGRES_ENDPOINT || process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USERNAME || process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    port: parseInt(process.env.POSTGRES_PORT || '5432'),
    ssl: process.env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  });
}

export function uid(): string {
  return `${Date.now()}${Math.floor(Math.random() * 100000)}`.slice(-12);
}

export async function getSchoolId(pool: any): Promise<string> {
  const r = await pool.query(`select uuid from school where lower(code) = lower($1)`, [TEST_SCHOOL_CODE]);
  if (r.rows.length === 0) throw new Error(`School ${TEST_SCHOOL_CODE} not found`);
  return r.rows[0].uuid;
}

// Seed a bare active student directly (transfer tests don't depend on the student module HTTP).
export async function seedStudent(pool: any, schoolId: string, tag: string): Promise<string> {
  const studentId = `st${uid()}`.slice(0, 12);
  await pool.query(
    `insert into student (uuid, admission_number, name, status, school_id, createdby_userid, created_at)
     values ($1,$2,$3,'active',$4,'test',$5)`,
    [studentId, `${tag}-TC`, `${tag} TcKid`, schoolId, new Date()]
  );
  return studentId;
}
