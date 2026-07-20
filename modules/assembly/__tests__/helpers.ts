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
export function getPool(): Pool {
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

// A short HTTP helper returning { status, body }.
export async function api(method: string, path: string, body?: any): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* no body */ }
  return { status: res.status, body: json };
}

// Seed references from the sample school: an academic year and >= 4 classes.
let cached: { schoolId: string; academicYearId: string; classIds: string[] } | null = null;
export async function getSeed(): Promise<{ schoolId: string; academicYearId: string; classIds: string[] }> {
  if (cached) return cached;
  const schoolRow = await getPool().query(`select uuid from school where lower(code) = lower($1)`, [TEST_SCHOOL_CODE]);
  if (schoolRow.rows.length === 0) throw new Error(`No school ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  const schoolId = schoolRow.rows[0].uuid;

  const ay = await getPool().query(
    `select uuid from academic_year where school_id = $1 order by start_date desc limit 1`, [schoolId]);
  if (ay.rows.length === 0) throw new Error('No academic year — run sample-school-setup');

  const cls = await getPool().query(
    `select uuid from class where school_id = $1 order by seq nulls last, name limit 4`, [schoolId]);
  if (cls.rows.length < 4) throw new Error('Need >= 4 classes — run sample-school-setup');

  cached = { schoolId, academicYearId: ay.rows[0].uuid, classIds: cls.rows.map(r => r.uuid) };
  return cached;
}

// Hard-delete a test plan and everything hanging off it (nodes, specials, themes,
// audience, weekdays). Keeps the suite repeatable against a persistent DB.
export async function cleanupPlan(planId: string): Promise<void> {
  const p = getPool();
  const specials = (await p.query(`select uuid from assembly_special where plan_id = $1`, [planId])).rows.map(r => r.uuid);
  const owners = [planId, ...specials];
  const ids = (await p.query(`select uuid from assembly_node where owner_id = any($1)`, [owners])).rows.map(r => r.uuid);
  if (ids.length) {
    for (const t of ['assembly_node_day', 'assembly_node_responsible', 'assembly_node_resource', 'assembly_node_audit', 'assembly_node_day_content']) {
      await p.query(`delete from ${t} where node_id = any($1)`, [ids]);
    }
    await p.query(`delete from assembly_node where owner_id = any($1)`, [owners]);
  }
  // House-mode weekly roster rows hanging off this plan's weeks.
  const weeks = (await p.query(`select uuid from assembly_week where plan_id = $1`, [planId])).rows.map(r => r.uuid);
  if (weeks.length) {
    const grades = (await p.query(`select uuid from assembly_grade where week_id = any($1)`, [weeks])).rows.map(r => r.uuid);
    if (grades.length) {
      for (const t of ['assembly_grade_metric', 'assembly_grade_penalty']) {
        await p.query(`delete from ${t} where grade_id = any($1)`, [grades]);
      }
      await p.query(`delete from assembly_grade where week_id = any($1)`, [weeks]);
    }
    for (const t of ['assembly_roster_entry', 'assembly_roster_participant', 'assembly_week_unlock', 'assembly_checklist_tick', 'assembly_checklist_signoff']) {
      await p.query(`delete from ${t} where week_id = any($1)`, [weeks]);
    }
    await p.query(`delete from assembly_week where plan_id = $1`, [planId]);
  }
  await p.query(`delete from assembly_week_house where plan_id = $1`, [planId]);
  await p.query(`delete from assembly_special where plan_id = $1`, [planId]);
  await p.query(`delete from assembly_theme where plan_id = $1`, [planId]);
  await p.query(`delete from assembly_plan_class where plan_id = $1`, [planId]);
  await p.query(`delete from assembly_plan_day where plan_id = $1`, [planId]);
  await p.query(`delete from assembly_plan where uuid = $1`, [planId]);
}

// Remove the per-school assembly config row (restores default 'template' mode).
export async function resetAssemblyConfig(schoolId: string): Promise<void> {
  await getPool().query(`delete from assembly_school_config where school_id = $1`, [schoolId]);
}

// Purge test-school grading config (rubric + evaluators) + any fixtures matching
// a name tag (seeded employees/houses).
export async function resetGrading(schoolId: string, tag: string): Promise<void> {
  const p = getPool();
  for (const t of ['assembly_rubric_metric', 'assembly_rubric_penalty', 'assembly_evaluator']) {
    await p.query(`delete from ${t} where school_id = $1`, [schoolId]);
  }
  await p.query(`delete from assembly_rubric_config where school_id = $1`, [schoolId]);
  await p.query(`delete from employee where school_id = $1 and name like $2`, [schoolId, `${tag}%`]);
  await p.query(`delete from house where school_id = $1 and name like $2`, [schoolId, `${tag}%`]);
}

// Seed an employee + a house directly, and pin a week's house snapshot (test setup
// for grading — the assembly module has no employee/house create of its own).
export async function seedEmployee(schoolId: string, name: string): Promise<string> {
  const id = `em${Date.now()}${Math.floor(Math.random() * 10000)}`.slice(0, 12);
  await getPool().query(
    `insert into employee (uuid, name, status, school_id, createdby_userid, created_at) values ($1,$2,'active',$3,'test',now())`,
    [id, name, schoolId],
  );
  return id;
}
export async function seedHouse(schoolId: string, name: string): Promise<string> {
  const id = `ho${Date.now()}${Math.floor(Math.random() * 10000)}`.slice(0, 12);
  await getPool().query(
    `insert into house (uuid, school_id, name, code, status, createdby_userid, created_at) values ($1,$2,$3,$4,'active','test',now())`,
    [id, schoolId, name, name.replace(/[^a-z0-9]+/gi, '_').slice(0, 30)],
  );
  return id;
}
export async function setWeekHouse(weekId: string, houseId: string, houseName: string): Promise<void> {
  await getPool().query(`update assembly_week set house_id = $1, house_name = $2 where uuid = $3`, [houseId, houseName, weekId]);
}

export async function deleteThemeById(themeId: string): Promise<void> {
  await getPool().query(`delete from assembly_theme where uuid = $1`, [themeId]);
}

export async function deleteChecklistItemById(itemId: string): Promise<void> {
  await getPool().query(`delete from assembly_checklist_item where uuid = $1`, [itemId]);
}

// A date in the given month/year for a target weekday (0=Sun..6=Sat).
export function dateForWeekday(year: number, month: number, dow: number): string {
  for (let d = 1; d <= 28; d++) {
    const s = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (new Date(`${s}T00:00:00Z`).getUTCDay() === dow) return s;
  }
  throw new Error('no such weekday');
}
