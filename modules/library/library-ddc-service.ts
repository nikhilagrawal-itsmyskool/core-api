import { DB, singleLineString } from "../../shared/lib/db";
import { DDC_ALL } from "./library-ddc-sections";
import { DDC_CURATED } from "./library-ddc-curated";

// Dewey Decimal Classification reference, seeded into the global `library_ddc`.
// Tier 1: the full 1000 Sections (3-digit), level derived from the code.
// Tier 2: a curated set of deeper numbers (e.g. 796.358 cricket) + their .092
// biography forms. Selecting an entry yields ddc_number, subject_type (its
// parent's label) and topic (its own label).
const EXPECTED_TOTAL = DDC_ALL.length + DDC_CURATED.length;

// Derive level + parent for a 3-digit Tier-1 code.
function levelAndParent(code: string): { level: string; parent: string | null } {
  if (code.endsWith("00")) return { level: "class", parent: null };
  if (code.endsWith("0")) return { level: "division", parent: code.charAt(0) + "00" };
  return { level: "section", parent: code.slice(0, 2) + "0" };
}

class DdcService {
  private seeded = false;

  public async seedGlobal(): Promise<void> {
    if (this.seeded) return;
    const existing = await DB.query(
      singleLineString`select count(*)::int as count from library_ddc`,
    );
    if (existing.length > 0 && existing[0].count >= EXPECTED_TOTAL) {
      this.seeded = true;
      return;
    }

    const queries: string[] = [];
    const params: any[][] = [];
    const upsert = singleLineString`
      insert into library_ddc (code, level, label, parent_code)
      values ($1, $2, $3, $4)
      on conflict (code) do update
        set label = excluded.label, level = excluded.level, parent_code = excluded.parent_code
    `;
    for (const s of DDC_ALL) {
      const { level, parent } = levelAndParent(s.code);
      queries.push(upsert);
      params.push([s.code, level, s.label, parent]);
    }
    for (const c of DDC_CURATED) {
      queries.push(upsert);
      params.push([c.code, "section", c.label, c.parent]);
    }
    await DB.queriesInTransaction(queries, params);
    this.seeded = true;
  }

  public async list(q?: string): Promise<any[]> {
    await this.seedGlobal();
    if (q && q.trim()) {
      const term = `%${q.trim().toLowerCase()}%`;
      return DB.query(
        singleLineString`
          select code, level, label, parent_code from library_ddc
          where lower(label) like $1 or code like $2
          order by code
        `,
        [term, `${q.trim()}%`],
      );
    }
    return DB.query(
      singleLineString`select code, level, label, parent_code from library_ddc order by code`,
    );
  }

  public async getByCode(code: string): Promise<any | null> {
    await this.seedGlobal();
    const rows = await DB.query(
      singleLineString`select code, level, label, parent_code from library_ddc where code = $1`,
      [code],
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    // Resolve the parent label so the caller can fill subject_type.
    let subjectType = row.label;
    if (row.parentCode) {
      const parent = await DB.query(
        singleLineString`select label from library_ddc where code = $1`,
        [row.parentCode],
      );
      if (parent.length > 0) subjectType = parent[0].label;
    }
    return { ...row, subjectType, topic: row.label };
  }
}

export const ddcService = new DdcService();
