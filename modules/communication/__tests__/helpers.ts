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

export function uniqueKey(prefix: string): string {
  return `${prefix}${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

// A student in the test school that has at least one reachable number, so the
// ladder resolves to a real send.
let cachedStudent: { uuid: string; name: string } | null = null;
export async function getStudentWithNumber(): Promise<{ uuid: string; name: string }> {
  if (cachedStudent) return cachedStudent;
  const res = await getPool().query(
    `select st.uuid, st.name from student st
     join school s on s.uuid = st.school_id
     where lower(s.code) = lower($1) and st.status = 'active'
       and (coalesce(st.father_whatsapp, '') <> '' or coalesce(st.father_mobile, '') <> ''
            or coalesce(st.mother_whatsapp, '') <> '' or coalesce(st.mother_mobile, '') <> '')
     limit 1`,
    [TEST_SCHOOL_CODE],
  );
  if (res.rows.length === 0) throw new Error(`No student with a contact number for ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  cachedStudent = { uuid: res.rows[0].uuid, name: res.rows[0].name };
  return cachedStudent;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Drain the queue until our job reaches a terminal state. Drains fast while
// process-next keeps claiming work (handles a backlog of other queued jobs, e.g.
// attendance absence alerts); when nothing is claimable it waits briefly and
// retries — an "immediate" job's scheduled_at can round up to the next second
// (timestamp(0)), so it may be momentarily not-yet-due.
export async function processUntilDone(jobId: string): Promise<any> {
  for (let i = 0; i < 60; i++) {
    const pn = await fetch(`${BASE_URL}/messages/process-next`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workerId: 'test' }),
    });
    const pnData = await pn.json().catch(() => ({}));
    const res = await fetch(`${BASE_URL}/messages/${jobId}`, { headers });
    const job = await res.json();
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'canceled') return job;
    if (!pnData.claimed) await sleep(250); // nothing due yet — wait out the rounding window
  }
  throw new Error('job did not finish');
}

export async function createTemplate(body: any): Promise<any> {
  const res = await fetch(`${BASE_URL}/templates`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (res.status !== 200) throw new Error(`createTemplate failed (${res.status}): ${await res.text()}`);
  return res.json();
}
