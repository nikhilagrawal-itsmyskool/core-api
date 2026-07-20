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

// A direct DB pool for seeding/inspecting fixtures (env loaded by tests/setup.ts).
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

export interface Fixtures {
  schoolId: string;
  yearFromId: string;
  yearToId: string;
  classAId: string;
  classBId: string;
  tag: string; // unique tag to find/clean rows created this run
}

// Create two academic years (from earlier, to later) and two classes, tagged for cleanup.
export async function createFixtures(pool: any): Promise<Fixtures> {
  const schoolId = await getSchoolId(pool);
  // Keep tag short: class.code / academic_year.code are varchar(16) and the tag is
  // used as their prefix (tag + a short label must stay <= 16 chars).
  const tag = `t${uid()}`.slice(0, 9);
  const now = new Date();

  const yearFromId = `ay${uid()}`.slice(0, 12);
  const yearToId = `ay${uid()}`.slice(0, 12);
  const classAId = `cl${uid()}`.slice(0, 12);
  const classBId = `cl${uid()}`.slice(0, 12);

  await pool.query(
    `insert into academic_year (uuid, name, code, start_date, end_date, school_id, createdby_userid, created_at)
     values ($1,$2,$3,$4,$5,$6,'test',$7)`,
    [yearFromId, `${tag}-FROM`, `${tag}F`, '2025-04-01', '2026-03-31', schoolId, now]
  );
  await pool.query(
    `insert into academic_year (uuid, name, code, start_date, end_date, school_id, createdby_userid, created_at)
     values ($1,$2,$3,$4,$5,$6,'test',$7)`,
    [yearToId, `${tag}-TO`, `${tag}T`, '2026-04-01', '2027-03-31', schoolId, now]
  );
  await pool.query(
    `insert into class (uuid, name, code, school_id, createdby_userid, created_at) values ($1,$2,$3,$4,'test',$5)`,
    [classAId, `${tag}-A`, `${tag}A`, schoolId, now]
  );
  await pool.query(
    `insert into class (uuid, name, code, school_id, createdby_userid, created_at) values ($1,$2,$3,$4,'test',$5)`,
    [classBId, `${tag}-B`, `${tag}B`, schoolId, now]
  );

  return { schoolId, yearFromId, yearToId, classAId, classBId, tag };
}

export async function cleanupFixtures(pool: any, f: Fixtures): Promise<void> {
  // Remove enrollment + students created against these fixtures, then the fixtures.
  await pool.query(
    `delete from student_class where academic_year_id = any($1) or class_id = any($2)`,
    [[f.yearFromId, f.yearToId], [f.classAId, f.classBId]]
  );
  await pool.query(`delete from student_guardian where createdby_userid = 'system' and school_id = $1 and name like $2`, [
    f.schoolId,
    `${f.tag}%`,
  ]);
  await pool.query(`delete from student where school_id = $1 and admission_number like $2`, [f.schoolId, `${f.tag}%`]);
  await pool.query(`delete from student_login where school_id = $1 and username like $2`, [f.schoolId, `${f.tag}%`]);
  await pool.query(
    `delete from house_teacher where school_id = $1 and house_id in (select uuid from house where school_id = $1 and name like $2)`,
    [f.schoolId, `${f.tag}%`]
  );
  await pool.query(`delete from house where school_id = $1 and name like $2`, [f.schoolId, `${f.tag}%`]);
  await pool.query(`delete from employee where school_id = $1 and name like $2`, [f.schoolId, `${f.tag}%`]);
  await pool.query(`delete from academic_year where uuid = any($1)`, [[f.yearFromId, f.yearToId]]);
  await pool.query(`delete from class where uuid = any($1)`, [[f.classAId, f.classBId]]);
}

export async function enrollmentRows(pool: any, studentId: string): Promise<any[]> {
  const r = await pool.query(
    `select academic_year_id, class_id, roll_number, status from student_class where student_id = $1`,
    [studentId]
  );
  return r.rows;
}

export async function studentStatus(pool: any, studentId: string): Promise<string | null> {
  const r = await pool.query(`select status from student where uuid = $1`, [studentId]);
  return r.rows.length ? r.rows[0].status : null;
}

// HTTP helper: create a student via the API, returns the detail body.
export async function createStudent(body: Record<string, any>): Promise<any> {
  const res = await fetch(`${BASE_URL}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`createStudent failed (${res.status}): ${await res.text()}`);
  return res.json();
}
