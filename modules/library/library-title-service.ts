import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { LANGUAGES, DEFAULTS, Language } from "./library-constants";
import { LibraryTitle, TitleFields, TitleRollup } from "./library-interfaces";
import { callnoService } from "./library-callno-service";
import { copyService } from "./library-copy-service";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const TITLE_COLUMNS = singleLineString`
  uuid, school_id, work_id, title_as_printed, language, edition, year_of_publication,
  publisher, isbn, local_call_no, pages, cover_file_id, status, createdby_userid, created_at
`;

class TitleService {
  public validateLanguage(language: any): Language {
    const valid = LANGUAGES.some((l) => l.value === language);
    if (!valid) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Invalid language. Must be one of: ${LANGUAGES.map((l) => l.value).join(", ")}`,
      );
    }
    return language;
  }

  // Build a title insert. `cutter`/`ddcNumber` come from the parent work so the
  // local call number can be auto-derived when not explicitly supplied.
  public buildInsert(
    data: TitleFields,
    workId: string,
    schoolId: string,
    userId: string,
    now: Date,
    workCutter?: string,
    workDdc?: string,
  ) {
    const language = this.validateLanguage(data.language);
    if (!data.titleAsPrinted || !data.titleAsPrinted.trim()) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "titleAsPrinted is required",
      );
    }
    const uuid = generateShortUuid(12);
    const localCallNo =
      data.localCallNo && data.localCallNo.trim()
        ? data.localCallNo.trim()
        : callnoService.generate(workCutter, workDdc, language);
    const query = singleLineString`
      insert into library_title (${TITLE_COLUMNS})
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      returning *
    `;
    const params = [
      uuid,
      schoolId,
      workId,
      data.titleAsPrinted.trim(),
      language,
      data.edition || null,
      data.yearOfPublication ?? null,
      data.publisher || null,
      data.isbn || null,
      localCallNo,
      data.pages ?? null,
      data.coverFileId || null,
      DEFAULTS.STATUS,
      userId,
      now,
    ];
    return { query, params, uuid, localCallNo };
  }

  private async getWork(workId: string, schoolId: string): Promise<any | null> {
    const r = await DB.query(
      singleLineString`select * from library_work where uuid = $1 and school_id = $2 and status = 'active'`,
      [workId, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  // Add a new edition/language title to an existing work (optionally with copies).
  public async addToWork(
    workId: string,
    data: TitleFields,
    schoolId: string,
    userId: string,
  ): Promise<LibraryTitle> {
    const work = await this.getWork(workId, schoolId);
    if (!work)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Work not found");
    const now = new Date();
    const ins = this.buildInsert(
      data,
      workId,
      schoolId,
      userId,
      now,
      work.cutter,
      work.ddcNumber,
    );
    const rows = await DB.query(ins.query, ins.params);
    return rows[0];
  }

  public async getById(
    id: string,
    schoolId: string,
  ): Promise<LibraryTitle | null> {
    const r = await DB.query(
      singleLineString`select * from library_title where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  // Per-status copy counts for a set of titles, returned as a map keyed by title.
  public async copyCountsForTitles(
    titleIds: string[],
    schoolId: string,
  ): Promise<
    Record<string, { total: number; available: number; issued: number }>
  > {
    const map: Record<
      string,
      { total: number; available: number; issued: number }
    > = {};
    if (titleIds.length === 0) return map;
    const placeholders = titleIds.map((_, i) => `$${i + 2}`).join(", ");
    const rows = await DB.query(
      singleLineString`
        select title_id,
          count(*)::int as total,
          count(*) filter (where status = 'available')::int as available,
          count(*) filter (where status = 'issued')::int as issued
        from library_copy
        where school_id = $1 and title_id in (${placeholders}) and status <> 'deleted'
        group by title_id
      `,
      [schoolId, ...titleIds],
    );
    for (const r of rows) {
      map[r.titleId] = {
        total: r.total,
        available: r.available,
        issued: r.issued,
      };
    }
    return map;
  }

  public async listByWork(
    workId: string,
    schoolId: string,
  ): Promise<TitleRollup[]> {
    const titles = await DB.query(
      singleLineString`
        select * from library_title
        where work_id = $1 and school_id = $2 and status = 'active'
        order by language, edition
      `,
      [workId, schoolId],
    );
    const counts = await this.copyCountsForTitles(
      titles.map((t: any) => t.uuid),
      schoolId,
    );
    return titles.map((t: any) => {
      const c = counts[t.uuid] || { total: 0, available: 0, issued: 0 };
      return {
        ...t,
        totalCopies: c.total,
        availableCopies: c.available,
        issuedCopies: c.issued,
      };
    });
  }

  public async update(
    id: string,
    data: TitleFields,
    schoolId: string,
    userId: string,
  ): Promise<LibraryTitle | null> {
    const fields: Record<string, any> = {
      title_as_printed: data.titleAsPrinted,
      language: data.language
        ? this.validateLanguage(data.language)
        : undefined,
      edition: data.edition,
      year_of_publication: data.yearOfPublication,
      publisher: data.publisher,
      isbn: data.isbn,
      local_call_no: data.localCallNo,
      pages: data.pages,
      cover_file_id: data.coverFileId,
    };
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    for (const [col, val] of Object.entries(fields)) {
      if (val !== undefined) {
        updates.push(`${col} = $${i++}`);
        params.push(val);
      }
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
        update library_title set ${updates.join(", ")}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning *
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

export const titleService = new TitleService();
