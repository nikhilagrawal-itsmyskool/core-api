import { TEST_SCHOOL_CODE } from "../../../tests/setup";
import { DB, singleLineString } from "../../../shared/lib/db";
import * as fs from "fs";
import * as path from "path";

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../local.config.json"), "utf8"),
);
const port = process.env.GATEWAY_PORT || config.httpPort;

export const BASE_URL = `http://localhost:${port}/${config.prefix}`;
export const headers = {
  "Content-Type": "application/json",
  "X-School-Code": TEST_SCHOOL_CODE,
};

// Unique suffix per test run so accession numbers don't collide across reruns
// (accession_no is unique per school).
export const RUN = Date.now().toString(36);

// Borrowers come from real seeded data; fetch one student id directly from the DB.
export async function aStudentId(): Promise<string> {
  const school = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [TEST_SCHOOL_CODE],
  );
  const schoolId = school[0].uuid;
  const rows = await DB.query(
    singleLineString`select uuid from student where school_id = $1 limit 1`,
    [schoolId],
  );
  if (rows.length === 0) throw new Error("No student found for test school");
  return rows[0].uuid;
}

export async function post(url: string, body: any): Promise<Response> {
  return fetch(`${BASE_URL}${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}
export async function get(url: string): Promise<Response> {
  return fetch(`${BASE_URL}${url}`, { headers });
}
