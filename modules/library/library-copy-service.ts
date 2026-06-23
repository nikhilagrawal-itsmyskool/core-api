import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { DEFAULTS } from "./library-constants";
import { LibraryCopy, CopyInput } from "./library-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const COPY_COLUMNS = singleLineString`
  uuid, school_id, title_id, accession_no, acquisition_date, acquisition_year, source,
  bill_no, bill_date, bill_file_id, acquisition_batch_id, price, is_specimen, almirah,
  shelf, qr_value, book_condition, remarks, status, createdby_userid, created_at
`;

class CopyService {
  // Build the insert query + params for a single copy. Shared by catalog (single
  // transaction) and add-copies. qr_value encodes identity (accession number).
  public buildInsert(
    copy: CopyInput,
    titleId: string,
    schoolId: string,
    userId: string,
    batchId: string | null,
    now: Date,
  ) {
    const uuid = generateShortUuid(12);
    const acquisitionYear =
      copy.acquisitionYear ??
      (copy.acquisitionDate
        ? new Date(copy.acquisitionDate).getFullYear()
        : null);
    const query = singleLineString`
      insert into library_copy (${COPY_COLUMNS})
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
      returning *
    `;
    const params = [
      uuid,
      schoolId,
      titleId,
      copy.accessionNo.trim(),
      copy.acquisitionDate || null,
      acquisitionYear,
      copy.source || null,
      copy.billNo || null,
      copy.billDate || null,
      copy.billFileId || null,
      batchId,
      copy.price ?? null,
      copy.isSpecimen ?? false,
      copy.almirah || null,
      copy.shelf || null,
      copy.accessionNo.trim(),
      copy.bookCondition || null,
      copy.remarks || null,
      DEFAULTS.COPY_STATUS,
      userId,
      now,
    ];
    return { query, params, uuid };
  }

  // Ensure none of the accession numbers already exist (active) for this school,
  // and that the batch itself has no duplicates.
  public async assertAccessionsFree(
    accessionNos: string[],
    schoolId: string,
  ): Promise<void> {
    const cleaned = accessionNos.map((a) => (a || "").trim()).filter(Boolean);
    if (cleaned.length === 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "At least one accession number is required",
      );
    }
    const lowered = cleaned.map((a) => a.toLowerCase());
    const dupInBatch = lowered.filter((a, idx) => lowered.indexOf(a) !== idx);
    if (dupInBatch.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Duplicate accession number(s) in request: ${dupInBatch.join(", ")}`,
      );
    }
    const placeholders = cleaned.map((_, i) => `$${i + 2}`).join(", ");
    const existing = await DB.query(
      singleLineString`
        select accession_no from library_copy
        where school_id = $1 and lower(accession_no) in (${placeholders}) and status <> 'deleted'
      `,
      [schoolId, ...lowered],
    );
    if (existing.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Accession number(s) already exist: ${existing.map((e: any) => e.accessionNo).join(", ")}`,
      );
    }
  }

  private async getTitleIfActive(
    titleId: string,
    schoolId: string,
  ): Promise<any | null> {
    const r = await DB.query(
      singleLineString`select * from library_title where uuid = $1 and school_id = $2 and status = 'active'`,
      [titleId, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  // Add a batch of copies to an existing title (a new acquisition). All copies in
  // one call share a generated acquisition_batch_id.
  public async addCopies(
    titleId: string,
    copies: CopyInput[],
    schoolId: string,
    userId: string,
  ): Promise<LibraryCopy[]> {
    const title = await this.getTitleIfActive(titleId, schoolId);
    if (!title)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Title not found");
    if (!copies || copies.length === 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "At least one copy is required",
      );
    }
    await this.assertAccessionsFree(
      copies.map((c) => c.accessionNo),
      schoolId,
    );

    const batchId = generateShortUuid(12);
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    for (const copy of copies) {
      const ins = this.buildInsert(
        copy,
        titleId,
        schoolId,
        userId,
        batchId,
        now,
      );
      queries.push(ins.query);
      params.push(ins.params);
    }
    const results = await DB.queriesInTransaction(queries, params);
    return results.map((r: any[]) => r[0]);
  }

  public async getById(
    id: string,
    schoolId: string,
  ): Promise<LibraryCopy | null> {
    const r = await DB.query(
      singleLineString`select * from library_copy where uuid = $1 and school_id = $2 and status <> 'deleted'`,
      [id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  public async getByAccession(
    accessionNo: string,
    schoolId: string,
  ): Promise<any | null> {
    const r = await DB.query(
      singleLineString`
        select c.*, t.title_as_printed, t.local_call_no, t.language, w.uniform_title, w.author_display
        from library_copy c
        left join library_title t on c.title_id = t.uuid
        left join library_work w on t.work_id = w.uuid
        where c.school_id = $1 and lower(c.accession_no) = lower($2) and c.status <> 'deleted'
      `,
      [schoolId, accessionNo],
    );
    return r.length > 0 ? r[0] : null;
  }

  // Search copies by title / author / keyword / accession, returning book
  // details so circulation can pick a copy without knowing the accession number.
  public async search(
    schoolId: string,
    opts: { q?: string; status?: string; limit?: number },
  ): Promise<any[]> {
    const params: any[] = [schoolId];
    let where = `c.school_id = $1 and c.status <> 'deleted'`;
    if (opts.status) {
      params.push(opts.status);
      where += ` and c.status = $${params.length}`;
    }
    if (opts.q && opts.q.trim()) {
      params.push(`%${opts.q.trim().toLowerCase()}%`);
      const p = `$${params.length}`;
      where += ` and (lower(t.title_as_printed) like ${p} or lower(coalesce(w.author_display,'')) like ${p} or lower(coalesce(w.uniform_title,'')) like ${p} or lower(coalesce(w.keywords,'')) like ${p} or lower(c.accession_no) like ${p})`;
    }
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
    params.push(limit);
    return DB.query(
      singleLineString`
        select c.uuid, c.accession_no, c.status, c.almirah, c.shelf,
          t.title_as_printed, t.local_call_no, t.language, w.author_display, w.uniform_title
        from library_copy c
        left join library_title t on c.title_id = t.uuid
        left join library_work w on t.work_id = w.uuid
        where ${where}
        order by t.title_as_printed, c.accession_no
        limit $${params.length}
      `,
      params,
    );
  }

  public async listByTitle(
    titleId: string,
    schoolId: string,
  ): Promise<LibraryCopy[]> {
    return DB.query(
      singleLineString`
        select * from library_copy
        where title_id = $1 and school_id = $2 and status <> 'deleted'
        order by accession_no
      `,
      [titleId, schoolId],
    );
  }

  public async update(
    id: string,
    data: Partial<CopyInput> & { status?: string },
    schoolId: string,
    userId: string,
  ): Promise<LibraryCopy | null> {
    const fields: Record<string, any> = {
      acquisition_date: data.acquisitionDate,
      acquisition_year: data.acquisitionYear,
      source: data.source,
      bill_no: data.billNo,
      bill_date: data.billDate,
      bill_file_id: data.billFileId,
      price: data.price,
      is_specimen: data.isSpecimen,
      almirah: data.almirah,
      shelf: data.shelf,
      book_condition: data.bookCondition,
      remarks: data.remarks,
      status: data.status,
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
        update library_copy set ${updates.join(", ")}
        where uuid = $${i++} and school_id = $${i++} and status <> 'deleted'
        returning *
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(
    id: string,
    schoolId: string,
    userId: string,
  ): Promise<void> {
    const copy = await this.getById(id, schoolId);
    if (copy && copy.status === "issued") {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Cannot delete a copy that is currently issued",
      );
    }
    await DB.query(
      singleLineString`
        update library_copy set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status <> 'deleted'
      `,
      [userId, new Date(), id, schoolId],
    );
  }
}

export const copyService = new CopyService();
