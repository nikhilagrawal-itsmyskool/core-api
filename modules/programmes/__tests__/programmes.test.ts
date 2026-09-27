import { TEST_SCHOOL_CODE } from "../../../tests/setup";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

const config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../local.config.json"), "utf8"),
);
const port = process.env.GATEWAY_PORT || config.httpPort;
const BASE_URL = `http://localhost:${port}/${config.prefix}`;
const headers = {
  "Content-Type": "application/json",
  "X-School-Code": TEST_SCHOOL_CODE,
};
const { generateShortUuid } = require("../../../shared/util/generate-uuid.js");

// A throwaway programme so the test doesn't depend on the real SELC import.
const CODE = "ZTESTSELC";
const GRADE = "ZTEST";

let pool: Pool;
let schoolId = "";
let academicYearId = "";
let programmeId = "";
const skillIds: string[] = [];

async function seed() {
  const s = await pool.query(`select uuid from school where lower(code)=lower($1)`, [TEST_SCHOOL_CODE]);
  if (s.rows.length === 0) throw new Error(`No school ${TEST_SCHOOL_CODE} — run sample-school-setup`);
  schoolId = s.rows[0].uuid;
  const ay = await pool.query(
    `select uuid from academic_year where school_id=$1 order by start_date desc limit 1`,
    [schoolId],
  );
  if (ay.rows.length === 0) throw new Error("No academic year — run sample-school-setup");
  academicYearId = ay.rows[0].uuid;

  await cleanup();

  programmeId = generateShortUuid(12);
  await pool.query(
    `insert into programme (uuid, school_id, code, name, motto, status, created_at)
     values ($1,$2,$3,$4,$5,'active',now())`,
    [programmeId, schoolId, CODE, "Test Programme", "Test motto"],
  );
  const fields = [
    ["F01", "Theme", 1],
    ["F04", "Key Vocabulary", 4],
    ["F15", "Assessment / Observation", 15],
  ];
  for (const [code, name, seq] of fields) {
    await pool.query(
      `insert into programme_field_type (uuid, school_id, programme_id, code, name, seq, status, created_at)
       values ($1,$2,$3,$4,$5,$6,'active',now())`,
      [generateShortUuid(12), schoolId, programmeId, code, name, seq],
    );
  }
  for (const name of ["Listening", "Speaking"]) {
    const id = generateShortUuid(12);
    await pool.query(
      `insert into programme_skill (uuid, school_id, programme_id, category, name, status, created_at)
       values ($1,$2,$3,$4,$5,'active',now())`,
      [id, schoolId, programmeId, "Foundational Communication", name],
    );
    skillIds.push(id);
  }
}

async function cleanup() {
  const p = await pool.query(
    `select uuid from programme where school_id=$1 and lower(code)=lower($2)`,
    [schoolId, CODE],
  );
  for (const row of p.rows) {
    await pool.query(`delete from programme_unit where programme_id=$1`, [row.uuid]);
    await pool.query(`delete from programme_source_doc where programme_id=$1`, [row.uuid]);
    await pool.query(`delete from programme_field_type where programme_id=$1`, [row.uuid]);
    await pool.query(`delete from programme_skill where programme_id=$1`, [row.uuid]);
    await pool.query(`delete from programme_stage where programme_id=$1`, [row.uuid]);
    await pool.query(`delete from programme where uuid=$1`, [row.uuid]);
  }
}

beforeAll(async () => {
  pool = new Pool({
    host: process.env.POSTGRES_HOST || process.env.POSTGRES_ENDPOINT,
    database: process.env.POSTGRES_DATABASE,
    user: process.env.POSTGRES_USER || process.env.POSTGRES_USERNAME,
    password: process.env.POSTGRES_PASSWORD,
    port: parseInt(process.env.POSTGRES_PORT || "5432"),
    ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
  });
  await seed();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("programmes module", () => {
  test("health", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.module).toBe("programmes");
  });

  test("lookups include the seeded programme", async () => {
    const res = await fetch(`${BASE_URL}/lookups`, { headers });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.months.length).toBe(12);
    expect(body.programmes.some((p: any) => p.code === CODE)).toBe(true);
  });

  test("catalog/{code} returns the programme with its masters", async () => {
    const res = await fetch(`${BASE_URL}/catalog/${CODE}`, { headers });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.code).toBe(CODE);
    expect(body.fieldTypes.length).toBe(3);
    expect(body.skills.length).toBe(2);
  });

  let unitId = "";
  test("create a unit with fields + focus skills", async () => {
    const res = await fetch(`${BASE_URL}/units`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        programmeCode: CODE,
        academicYearId,
        grade: GRADE,
        month: "april",
        title: "Test Unit",
        programmeFocus: "Interact → Narrate",
        fields: { F01: "Test Unit", F04: "alpha, beta", F15: "assess me" },
        focusSkillIds: skillIds,
        workflowStatus: "published",
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.uuid).toBeTruthy();
    unitId = body.uuid;
  });

  test("teach resolves the unit into ordered labelled fields + focus skill names", async () => {
    const res = await fetch(
      `${BASE_URL}/teach?programme=${CODE}&grade=${GRADE}&month=april&academicYearId=${academicYearId}`,
      { headers },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.unit).toBeTruthy();
    expect(body.unit.title).toBe("Test Unit");
    // Fields are ordered by field-type seq and labelled from the master.
    expect(body.unit.fields.map((f: any) => f.code)).toEqual(["F01", "F04", "F15"]);
    expect(body.unit.fields.find((f: any) => f.code === "F04").name).toBe("Key Vocabulary");
    expect(body.unit.fields.find((f: any) => f.code === "F04").content).toBe("alpha, beta");
    expect(body.unit.focusSkills.map((s: any) => s.name).sort()).toEqual(["Listening", "Speaking"]);
  });

  test("list units for the grade includes it", async () => {
    const res = await fetch(`${BASE_URL}/units?programme=${CODE}&grade=${GRADE}&academicYearId=${academicYearId}`, {
      headers,
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.some((u: any) => u.uuid === unitId)).toBe(true);
  });

  test("duplicate month for the same grade is rejected", async () => {
    const res = await fetch(`${BASE_URL}/units`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        programmeCode: CODE,
        academicYearId,
        grade: GRADE,
        month: "april",
        title: "Dup",
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("teach returns unit:null for a month with no content", async () => {
    const res = await fetch(
      `${BASE_URL}/teach?programme=${CODE}&grade=${GRADE}&month=december&academicYearId=${academicYearId}`,
      { headers },
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.unit).toBeNull();
  });

  test("delete the unit", async () => {
    const res = await fetch(`${BASE_URL}/units/${unitId}`, { method: "DELETE", headers });
    expect(res.status).toBe(200);
  });
});
