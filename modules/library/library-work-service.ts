import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { DEFAULTS, colorForDdc } from "./library-constants";
import { LibraryWork, WorkFields, WorkWithTitles } from "./library-interfaces";
import { authorService } from "./library-author-service";
import { titleService } from "./library-title-service";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const WORK_COLUMNS = singleLineString`
  uuid, school_id, uniform_title, author_input, author_display, first_author_surname,
  cutter, ddc_number, subject_type, topic, keywords, age_from, age_to, class_from,
  class_to, color_code, status, createdby_userid, created_at
`;

class WorkService {
  // Derive author_display / first_author_surname / cutter from free-text input,
  // unless the caller already confirmed explicit values (from the preview).
  public deriveAuthorFields(work: WorkFields): {
    authorInput: string | null;
    authorDisplay: string | null;
    firstAuthorSurname: string | null;
    cutter: string | null;
  } {
    const authorInput = work.authorInput ? work.authorInput.trim() : null;
    if (work.authorDisplay || work.firstAuthorSurname) {
      const surname = work.firstAuthorSurname || "";
      return {
        authorInput,
        authorDisplay: work.authorDisplay || surname || null,
        firstAuthorSurname: surname || null,
        cutter: surname ? authorService.toRomanCutter(surname) : null,
      };
    }
    if (authorInput) {
      const n = authorService.normalize(authorInput);
      return {
        authorInput,
        authorDisplay: n.authorDisplay || null,
        firstAuthorSurname: n.firstAuthorSurname || null,
        cutter: n.cutter || null,
      };
    }
    return {
      authorInput: null,
      authorDisplay: null,
      firstAuthorSurname: null,
      cutter: null,
    };
  }

  public buildInsert(
    work: WorkFields,
    schoolId: string,
    userId: string,
    now: Date,
  ) {
    if (!work.uniformTitle || !work.uniformTitle.trim()) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "work.uniformTitle is required",
      );
    }
    const uuid = generateShortUuid(12);
    const author = this.deriveAuthorFields(work);
    const query = singleLineString`
      insert into library_work (${WORK_COLUMNS})
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      returning *
    `;
    const params = [
      uuid,
      schoolId,
      work.uniformTitle.trim(),
      author.authorInput,
      author.authorDisplay,
      author.firstAuthorSurname,
      author.cutter,
      work.ddcNumber || null,
      work.subjectType || null,
      work.topic || null,
      work.keywords || null,
      work.ageFrom ?? null,
      work.ageTo ?? null,
      work.classFrom || null,
      work.classTo || null,
      // Color is auto-derived from the DDC main class unless explicitly set.
      work.colorCode || colorForDdc(work.ddcNumber) || null,
      DEFAULTS.STATUS,
      userId,
      now,
    ];
    return {
      query,
      params,
      uuid,
      cutter: author.cutter,
      ddcNumber: work.ddcNumber || null,
    };
  }

  public async create(
    work: WorkFields,
    schoolId: string,
    userId: string,
  ): Promise<LibraryWork> {
    const ins = this.buildInsert(work, schoolId, userId, new Date());
    const rows = await DB.query(ins.query, ins.params);
    return rows[0];
  }

  public async getById(
    id: string,
    schoolId: string,
  ): Promise<LibraryWork | null> {
    const r = await DB.query(
      singleLineString`select * from library_work where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  // Work + its titles (each with per-status copy counts) + cross-edition totals.
  public async getWithTitles(
    id: string,
    schoolId: string,
  ): Promise<WorkWithTitles | null> {
    const work = await this.getById(id, schoolId);
    if (!work) return null;
    const titles = await titleService.listByWork(id, schoolId);
    const totalCopies = titles.reduce((s, t) => s + t.totalCopies, 0);
    const availableCopies = titles.reduce((s, t) => s + t.availableCopies, 0);
    return { ...work, titles, totalCopies, availableCopies };
  }

  // Search works (collapsed), each with aggregate copy counts across all titles.
  public async search(
    schoolId: string,
    opts: { q?: string; limit?: number; offset?: number },
  ): Promise<any[]> {
    const params: any[] = [schoolId];
    let where = `w.school_id = $1 and w.status = 'active'`;
    if (opts.q && opts.q.trim()) {
      params.push(`%${opts.q.trim().toLowerCase()}%`);
      where += ` and (lower(w.uniform_title) like $${params.length} or lower(coalesce(w.author_display, '')) like $${params.length} or lower(coalesce(w.keywords, '')) like $${params.length} or lower(coalesce(w.topic, '')) like $${params.length})`;
    }
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    params.push(limit);
    params.push(offset);
    return DB.query(
      singleLineString`
        select w.*,
          coalesce(c.total, 0) as total_copies,
          coalesce(c.available, 0) as available_copies,
          coalesce(tc.title_count, 0) as title_count
        from library_work w
        left join (
          select t.work_id,
            count(co.uuid)::int as total,
            count(co.uuid) filter (where co.status = 'available')::int as available
          from library_title t
          left join library_copy co on co.title_id = t.uuid and co.status <> 'deleted'
          where t.status = 'active'
          group by t.work_id
        ) c on c.work_id = w.uuid
        left join (
          select work_id, count(*)::int as title_count
          from library_title where status = 'active' group by work_id
        ) tc on tc.work_id = w.uuid
        where ${where}
        order by w.uniform_title
        limit $${params.length - 1} offset $${params.length}
      `,
      params,
    );
  }

  // Distinct keyword suggestions for autocomplete. Keywords are stored as a
  // comma-separated string per work; split and dedupe across the school.
  public async suggestKeywords(schoolId: string, q?: string): Promise<string[]> {
    const params: any[] = [schoolId];
    let filter = "";
    if (q && q.trim()) {
      params.push(`%${q.trim().toLowerCase()}%`);
      filter = ` and lower(trim(k)) like $${params.length}`;
    }
    const rows = await DB.query(
      singleLineString`
        select distinct trim(k) as keyword
        from library_work w, unnest(string_to_array(coalesce(w.keywords, ''), ',')) k
        where w.school_id = $1 and w.status = 'active' and trim(k) <> ''${filter}
        order by keyword
        limit 20
      `,
      params,
    );
    return rows.map((r: any) => r.keyword);
  }

  // Self-learning DDC suggestions: the DDC numbers this school has already used
  // (with the topic they assigned and how often), so deep constructed numbers
  // like 796.358092 are reusable after being entered once.
  public async suggestUsedDdc(schoolId: string, q?: string): Promise<any[]> {
    const params: any[] = [schoolId];
    let filter = "";
    if (q && q.trim()) {
      params.push(`${q.trim()}%`);
      filter = ` and ddc_number like $${params.length}`;
    }
    return DB.query(
      singleLineString`
        select ddc_number as code, max(topic) as topic, count(*)::int as uses
        from library_work
        where school_id = $1 and status = 'active' and ddc_number is not null and ddc_number <> ''${filter}
        group by ddc_number
        order by uses desc, ddc_number
        limit 20
      `,
      params,
    );
  }

  public async update(
    id: string,
    work: WorkFields,
    schoolId: string,
    userId: string,
  ): Promise<LibraryWork | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => {
      if (val !== undefined) {
        updates.push(`${col} = $${i++}`);
        params.push(val);
      }
    };
    set("uniform_title", work.uniformTitle);
    set("ddc_number", work.ddcNumber);
    set("subject_type", work.subjectType);
    set("topic", work.topic);
    set("keywords", work.keywords);
    set("age_from", work.ageFrom);
    set("age_to", work.ageTo);
    set("class_from", work.classFrom);
    set("class_to", work.classTo);
    set("color_code", work.colorCode);
    // Re-derive author fields when author input/display changes.
    if (
      work.authorInput !== undefined ||
      work.authorDisplay !== undefined ||
      work.firstAuthorSurname !== undefined
    ) {
      const a = this.deriveAuthorFields(work);
      set("author_input", a.authorInput);
      set("author_display", a.authorDisplay);
      set("first_author_surname", a.firstAuthorSurname);
      set("cutter", a.cutter);
    }
    if (updates.length === 0) return this.getById(id, schoolId);
    updates.push(`updatedby_userid = $${i++}`);
    params.push(userId);
    updates.push(`updated_at = $${i++}`);
    params.push(new Date());
    params.push(id);
    params.push(schoolId);
    const rows = await DB.query(
      singleLineString`
        update library_work set ${updates.join(", ")}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning *
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

export const workService = new WorkService();
