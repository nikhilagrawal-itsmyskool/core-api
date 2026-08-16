/**
 * Local integration test for the reconcile APPLY path (writes to the local DB).
 * Opt-in + self-cleaning:
 *   SYLLABUS_LOCAL_IT=1 node node_modules/jest/bin/jest.js modules/syllabus/__tests__/reconcile-apply.it.test.ts
 * Proves: apply() preserves progress on kept entries, enforces the mark guardrail,
 * soft-deletes confirmed removals (+ their progress), inserts new, snapshots a revision.
 */
const path = require("path");
const { loadConfig } = require(path.join(__dirname, "..", "..", "..", "scripts", "run-sql.js"));

const RUN = process.env.SYLLABUS_LOCAL_IT === "1";
const d = RUN ? describe : describe.skip;

// ── minimal .docx (zip, stored/no-compression — our parser ignores CRC) ───────
function zipStore(entries: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt32LE(0, 14); // crc (ignored by our reader)
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, e.data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 10); // method stored
    cd.writeUInt32LE(0, 16); // crc
    cd.writeUInt32LE(e.data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + e.data.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cdBuf, eocd]);
}
const cell = (t: string | null) => `<w:tc><w:p><w:r><w:t>${t ?? ""}</w:t></w:r></w:p></w:tc>`;
const row = (cells: (string | null)[]) => `<w:tr>${cells.map(cell).join("")}</w:tr>`;
function docxBase64(rows: (string | null)[][]): string {
  const body = `<w:tbl>${rows.map(row).join("")}</w:tbl>`;
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
  return zipStore([{ name: "word/document.xml", data: Buffer.from(xml, "utf8") }]).toString("base64");
}

const SID = "itestschool1";
const AY = "itest_ay0001";
const PLAN = "itest_plan01";
const SUBJ = "itest_subj01";
const CLS = "itest_cls001";
const USER = "itestuser001";

const HEADER = ["Month", "Chapter", "Pages", "Lab Activity"];
const DOC_V1 = [
  HEADER,
  ["April", "Ch-1. Alpha", "1-5", "A1 First lab activity"],
  ["April", null, null, "A2 Second lab activity"],
  ["May", "Ch-2. Beta", "6-9", "B1 Beta lab activity"],
];
// minor edit: Ch-1 pages 1-5 -> 1-6, drop A2, add A3, keep A1/Ch-2/B1
const DOC_V2 = [
  HEADER,
  ["April", "Ch-1. Alpha", "1-6", "A1 First lab activity"],
  ["April", null, null, "A3 Third lab activity"],
  ["May", "Ch-2. Beta", "6-9", "B1 Beta lab activity"],
];

d("reconcile apply — local DB integration", () => {
  let svc: any;
  let DB: any;

  beforeAll(async () => {
    const cfg = loadConfig("local");
    process.env.POSTGRES_HOST = cfg.POSTGRES_HOST || cfg.POSTGRES_ENDPOINT;
    process.env.POSTGRES_DATABASE = cfg.POSTGRES_DATABASE;
    process.env.POSTGRES_USER = cfg.POSTGRES_USERNAME || cfg.POSTGRES_USER;
    process.env.POSTGRES_PASSWORD = cfg.POSTGRES_PASSWORD;
    process.env.POSTGRES_PORT = String(cfg.POSTGRES_PORT || 5432);
    process.env.POSTGRES_SSL = "false";
    delete process.env.FILE_STORAGE_BUCKET; // force Postgres file storage locally
    svc = require("../syllabus-reconcile-service").syllabusReconcileService;
    DB = require("../../../shared/lib/db").DB;
    await cleanup();
    await DB.query(
      `insert into syllabus (uuid, school_id, academic_year_id, grade, subject_id, layout, status, createdby_userid, created_at)
       values ($1,$2,$3,'ITEST',$4,'senior','active',$5, now())`,
      [PLAN, SID, AY, SUBJ, USER],
    );
  });

  async function cleanup() {
    await DB.query(`delete from syllabus_progress where school_id=$1`, [SID]);
    await DB.query(`delete from syllabus_entry where school_id=$1`, [SID]);
    await DB.query(`delete from syllabus_revision where school_id=$1`, [SID]);
    await DB.query(`delete from syllabus where school_id=$1`, [SID]);
    await DB.query(`delete from file_storage where school_id=$1`, [SID]);
  }
  afterAll(async () => { if (RUN) await cleanup(); });

  const entriesByTitle = async () => {
    const rows = await DB.query(
      `select uuid, title, page_ref, status, parent_entry_id from syllabus_entry where school_id=$1 order by seq`,
      [SID],
    );
    const map: Record<string, any> = {};
    rows.forEach((r: any) => { map[r.title] = r; });
    return map;
  };
  const marksOn = async (entryId: string) =>
    (await DB.query(`select count(*)::int c from syllabus_progress where syllabus_entry_id=$1`, [entryId]))[0].c;

  test("seed via apply on the empty plan → 5 entries + 1 revision", async () => {
    const res = await svc.apply(PLAN, docxBase64(DOC_V1), "itest.docx", [], "seed", SID, USER);
    expect(res.applied).toBe(true);
    const m = await entriesByTitle();
    expect(Object.keys(m)).toEqual(expect.arrayContaining(["Ch-1. Alpha", "A1 First lab activity", "A2 Second lab activity", "Ch-2. Beta", "B1 Beta lab activity"]));
    const revs = await DB.query(`select rev_no from syllabus_revision where school_id=$1`, [SID]);
    expect(revs.length).toBe(1);
  });

  test("mark progress on A1 (keep) and A2 (will be removed)", async () => {
    const m = await entriesByTitle();
    for (const [title, cls] of [["A1 First lab activity", CLS], ["A2 Second lab activity", CLS]] as const) {
      await DB.query(
        `insert into syllabus_progress (uuid, school_id, syllabus_entry_id, class_id, status, created_at)
         values ($1,$2,$3,$4,'covered', now())`,
        [`itp_${title.slice(0, 3).replace(/\s/g, "")}001`.slice(0, 12), SID, m[title].uuid, cls],
      );
    }
    expect(await marksOn(m["A1 First lab activity"].uuid)).toBe(1);
  });

  test("apply v2 WITHOUT a decision is blocked (A2 has marks)", async () => {
    await expect(svc.apply(PLAN, docxBase64(DOC_V2), "itest.docx", [], "v2", SID, USER)).rejects.toThrow(/resolve/i);
  });

  test("apply v2 confirming A2 removal → A1 marks survive, A2 gone, A3 added", async () => {
    const before = await entriesByTitle();
    const a1Id = before["A1 First lab activity"].uuid;
    const a2Id = before["A2 Second lab activity"].uuid;

    const res = await svc.apply(PLAN, docxBase64(DOC_V2), "itest.docx",
      [{ kind: "remove", oldId: a2Id }], "v2 apply", SID, USER);
    expect(res.applied).toBe(true);

    // A1: same uuid still active, its progress row preserved
    const after = await entriesByTitle();
    expect(after["A1 First lab activity"].uuid).toBe(a1Id);
    expect(after["A1 First lab activity"].status).toBe("active");
    expect(await marksOn(a1Id)).toBe(1);

    // A2: soft-deleted, progress dropped
    expect(await marksOn(a2Id)).toBe(0);
    const a2 = await DB.query(`select status from syllabus_entry where uuid=$1`, [a2Id]);
    expect(a2[0].status).toBe("deleted");

    // A3 inserted; Ch-1 page updated 1-5 -> 1-6
    expect(after["A3 Third lab activity"]).toBeTruthy();
    expect(after["A3 Third lab activity"].status).toBe("active");
    expect(after["Ch-1. Alpha"].pageRef).toBe("1-6");

    // a second revision was snapshotted
    const revs = await DB.query(`select rev_no from syllabus_revision where school_id=$1 order by rev_no`, [SID]);
    expect(revs.map((r: any) => r.revNo)).toEqual([1, 2]);
  });
});
