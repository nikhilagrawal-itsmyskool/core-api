import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  BulkEntriesRequest,
  CreateSyllabusRequest,
  EntryInput,
  ReorderEntriesRequest,
  Syllabus,
  SyllabusEntry,
  UpdateSyllabusRequest,
} from "./syllabus-interfaces";
import {
  DEFAULTS,
  ENTRY_TYPE_VALUES,
  EntryType,
  LAYOUT_VALUES,
  MONTH_VALUES,
  Month,
  TERM_VALUES,
  Term,
} from "./syllabus-constants";
import { academicYearExists, listClasses } from "./syllabus-common";
import { gradeEquals } from "./syllabus-util";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const SYLLABUS_COLS = singleLineString`
  uuid, school_id, academic_year_id, grade, subject_id, book, layout, note, status
`;
const ENTRY_COLS = singleLineString`
  uuid, syllabus_id, seq, month, entry_type, topic_no, title, theme, page_ref, term
`;

// Half-yearly term spans April–August; the rest of the session is annual.
const HALF_YEARLY_MONTHS: Month[] = ["april", "may", "june", "july", "august"];
// `term` (which exam block content is tested in) is only meaningful for study
// content — topics, the supplementary note boxes, and GK refreshers. Structural
// markers (exam, revision, section headers, activities) carry no term: it's
// either redundant with their title (e.g. "Half Yearly Examination") or meaningless.
const TERM_TYPES = new Set<EntryType>(["topic", "note", "refresher"]);
function resolveTerm(entryType: EntryType, month: Month, explicit?: Term): Term | null {
  if (!TERM_TYPES.has(entryType)) return null;
  if (explicit) return explicit;
  return HALF_YEARLY_MONTHS.includes(month) ? "half_yearly" : "annual";
}

class SyllabusPlanService {
  // ── Plans ─────────────────────────────────────────────────────────────────
  public async createSyllabus(
    data: CreateSyllabusRequest,
    schoolId: string,
    userId: string,
  ): Promise<Syllabus> {
    if (!data.grade || !data.grade.trim()) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "grade is required",
      );
    }
    if (!data.academicYearId) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "academicYearId is required",
      );
    }
    if (!data.subjectId) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "subjectId is required",
      );
    }
    if (!LAYOUT_VALUES.includes(data.layout)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `layout must be one of: ${LAYOUT_VALUES.join(", ")}`,
      );
    }
    if (!(await academicYearExists(schoolId, data.academicYearId))) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Invalid academicYearId",
      );
    }
    if (!(await this.subjectExists(schoolId, data.subjectId))) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Invalid subjectId",
      );
    }
    if (!(await this.gradeExists(schoolId, data.grade))) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Grade "${data.grade.trim()}" has no class sections`,
      );
    }
    await this.assertPlanFree(
      schoolId,
      data.academicYearId,
      data.grade,
      data.subjectId,
      null,
    );

    const uuid = generateShortUuid(12);
    const rows = await DB.query(
      singleLineString`
        insert into syllabus
        (uuid, school_id, academic_year_id, grade, subject_id, book, layout, note, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        returning ${SYLLABUS_COLS}
      `,
      [
        uuid,
        schoolId,
        data.academicYearId,
        data.grade.trim(),
        data.subjectId,
        data.book?.trim() || null,
        data.layout,
        data.note?.trim() || null,
        DEFAULTS.STATUS,
        userId,
        new Date(),
      ],
    );
    return rows[0];
  }

  public async updateSyllabus(
    id: string,
    data: UpdateSyllabusRequest,
    schoolId: string,
    userId: string,
  ): Promise<Syllabus | null> {
    const existing = await this.getSyllabusHeader(id, schoolId);
    if (!existing) return null;
    if (data.layout !== undefined && !LAYOUT_VALUES.includes(data.layout)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `layout must be one of: ${LAYOUT_VALUES.join(", ")}`,
      );
    }

    // Grade is editable, but must be a real grade (has class sections) and stay
    // unique per (year, grade, subject). A grade change invalidates the plan's
    // section-scoped data (teacher assignments + coverage), which we clear below.
    let gradeChanging = false;
    if (data.grade !== undefined) {
      const newGrade = (data.grade || "").trim();
      if (!newGrade) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, "grade cannot be blank");
      }
      gradeChanging = newGrade.toLowerCase() !== existing.grade.toLowerCase();
      if (gradeChanging) {
        if (!(await this.gradeExists(schoolId, newGrade))) {
          throw new BusinessErrorResult(
            ErrorCode.BusinessError,
            `Grade "${newGrade}" has no class sections`,
          );
        }
        await this.assertPlanFree(schoolId, existing.academicYearId, newGrade, existing.subjectId, id);
      }
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => {
      updates.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (data.book !== undefined) set("book", data.book?.trim() || null);
    if (data.layout !== undefined) set("layout", data.layout);
    if (data.note !== undefined) set("note", data.note?.trim() || null);
    if (gradeChanging) set("grade", (data.grade as string).trim());

    if (updates.length === 0) return existing;
    set("updatedby_userid", userId);
    set("updated_at", new Date());
    params.push(id, schoolId);

    // On a grade change, drop teacher assignments and coverage — both point at the
    // old grade's sections and are meaningless for the new grade. Entries (the
    // subject content) are kept.
    if (gradeChanging) {
      await DB.queriesInTransaction(
        [
          singleLineString`delete from syllabus_plan_teacher where syllabus_id = $1 and school_id = $2`,
          singleLineString`delete from syllabus_progress where syllabus_entry_id in (select uuid from syllabus_entry where syllabus_id = $1 and school_id = $2)`,
        ],
        [[id, schoolId], [id, schoolId]],
      );
    }

    const rows = await DB.query(
      singleLineString`
        update syllabus set ${updates.join(", ")}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning ${SYLLABUS_COLS}
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async deleteSyllabus(
    id: string,
    schoolId: string,
    userId: string,
  ): Promise<boolean> {
    const existing = await this.getSyllabusHeader(id, schoolId);
    if (!existing) return false;
    const now = new Date();
    // Soft-delete the plan and its entries; hard-delete their progress marks.
    await DB.queriesInTransaction(
      [
        singleLineString`
          delete from syllabus_progress
          where syllabus_entry_id in (select uuid from syllabus_entry where syllabus_id = $1 and school_id = $2)
        `,
        singleLineString`update syllabus_entry set status = 'deleted', updated_at = $1 where syllabus_id = $2 and school_id = $3`,
        singleLineString`update syllabus set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      ],
      [
        [id, schoolId],
        [now, id, schoolId],
        [userId, now, id, schoolId],
      ],
    );
    return true;
  }

  public async getSyllabusHeader(
    id: string,
    schoolId: string,
  ): Promise<Syllabus | null> {
    const rows = await DB.query(
      singleLineString`select ${SYLLABUS_COLS} from syllabus where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // Full plan: header + subject name + ordered entries.
  public async getSyllabus(id: string, schoolId: string): Promise<any | null> {
    const header = await this.getSyllabusHeader(id, schoolId);
    if (!header) return null;
    const subjectName = await this.subjectName(schoolId, header.subjectId);
    const entries = await this.listEntries(id, schoolId);
    return { ...header, subjectName, entries };
  }

  public async listSyllabi(
    schoolId: string,
    filters: { academicYearId?: string; grade?: string; subjectId?: string },
  ): Promise<any[]> {
    const params: any[] = [schoolId];
    let query = singleLineString`
      select s.uuid, s.school_id, s.academic_year_id, s.grade, s.subject_id,
             s.book, s.layout, s.note, s.status, sub.name as subject_name
      from syllabus s
      left join syllabus_subject sub on sub.uuid = s.subject_id
      where s.school_id = $1 and s.status = 'active'
    `;
    let i = 2;
    if (filters.academicYearId) {
      query += ` and s.academic_year_id = $${i++}`;
      params.push(filters.academicYearId);
    }
    if (filters.grade) {
      query += ` and lower(s.grade) = lower($${i++})`;
      params.push(filters.grade.trim());
    }
    if (filters.subjectId) {
      query += ` and s.subject_id = $${i++}`;
      params.push(filters.subjectId);
    }
    query += ` order by s.grade, subject_name`;
    return DB.query(query, params);
  }

  // ── Entries ─────────────────────────────────────────────────────────────
  public async listEntries(
    syllabusId: string,
    schoolId: string,
  ): Promise<SyllabusEntry[]> {
    return DB.query(
      singleLineString`
        select ${ENTRY_COLS} from syllabus_entry
        where syllabus_id = $1 and school_id = $2 and status = 'active'
        order by seq asc
      `,
      [syllabusId, schoolId],
    );
  }

  public async addEntry(
    syllabusId: string,
    input: EntryInput,
    schoolId: string,
    userId: string,
  ): Promise<SyllabusEntry | null> {
    const plan = await this.getSyllabusHeader(syllabusId, schoolId);
    if (!plan) return null;
    this.validateEntry(input);
    const nextSeq = (await this.maxSeq(syllabusId, schoolId)) + 1;
    const rows = await this.insertEntries(
      syllabusId,
      schoolId,
      userId,
      [input],
      nextSeq,
    );
    return rows[0];
  }

  // Append after the last entry, or replace the whole list (soft-delete existing
  // + their progress, then insert fresh from seq 1). Returns the resulting list.
  public async bulkEntries(
    syllabusId: string,
    data: BulkEntriesRequest,
    schoolId: string,
    userId: string,
  ): Promise<SyllabusEntry[] | null> {
    const plan = await this.getSyllabusHeader(syllabusId, schoolId);
    if (!plan) return null;
    if (!Array.isArray(data.entries) || data.entries.length === 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "entries array is required",
      );
    }
    data.entries.forEach((e) => this.validateEntry(e));
    const mode = data.mode === "replace" ? "replace" : "append";
    const now = new Date();

    if (mode === "replace") {
      await DB.queriesInTransaction(
        [
          singleLineString`
            delete from syllabus_progress
            where syllabus_entry_id in (select uuid from syllabus_entry where syllabus_id = $1 and school_id = $2 and status = 'active')
          `,
          singleLineString`update syllabus_entry set status = 'deleted', updated_at = $1 where syllabus_id = $2 and school_id = $3 and status = 'active'`,
        ],
        [
          [syllabusId, schoolId],
          [now, syllabusId, schoolId],
        ],
      );
    }
    const startSeq =
      mode === "replace" ? 1 : (await this.maxSeq(syllabusId, schoolId)) + 1;
    await this.insertEntries(
      syllabusId,
      schoolId,
      userId,
      data.entries,
      startSeq,
    );
    return this.listEntries(syllabusId, schoolId);
  }

  public async updateEntry(
    entryId: string,
    input: EntryInput,
    schoolId: string,
    userId: string,
  ): Promise<SyllabusEntry | null> {
    const existing = await DB.query(
      singleLineString`select ${ENTRY_COLS} from syllabus_entry where uuid = $1 and school_id = $2 and status = 'active'`,
      [entryId, schoolId],
    );
    if (existing.length === 0) return null;

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => {
      updates.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (input.month !== undefined) {
      if (!MONTH_VALUES.includes(input.month))
        throw new BusinessErrorResult(ErrorCode.BusinessError, "invalid month");
      set("month", input.month);
    }
    if (input.entryType !== undefined) {
      if (!ENTRY_TYPE_VALUES.includes(input.entryType))
        throw new BusinessErrorResult(
          ErrorCode.BusinessError,
          "invalid entryType",
        );
      set("entry_type", input.entryType);
    }
    if (input.topicNo !== undefined)
      set("topic_no", input.topicNo?.trim() || null);
    if (input.title !== undefined) {
      if (!input.title.trim())
        throw new BusinessErrorResult(
          ErrorCode.BusinessError,
          "title cannot be blank",
        );
      set("title", input.title.trim());
    }
    if (input.theme !== undefined) set("theme", input.theme?.trim() || null);
    if (input.pageRef !== undefined)
      set("page_ref", input.pageRef?.trim() || null);
    // term applies only to topic/note. Validate if provided; clear it whenever the
    // (effective) type is a structural row so an edit can't reintroduce a stray term.
    if (input.term !== undefined && input.term !== null && !TERM_VALUES.includes(input.term))
      throw new BusinessErrorResult(ErrorCode.BusinessError, "invalid term");
    const effectiveType = input.entryType !== undefined ? input.entryType : existing[0].entryType;
    if (!TERM_TYPES.has(effectiveType)) {
      if (input.term !== undefined || input.entryType !== undefined) set("term", null);
    } else if (input.term !== undefined) {
      set("term", input.term || null);
    }

    if (updates.length === 0) return existing[0];
    set("updatedby_userid", userId);
    set("updated_at", new Date());
    params.push(entryId, schoolId);

    const rows = await DB.query(
      singleLineString`
        update syllabus_entry set ${updates.join(", ")}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning ${ENTRY_COLS}
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async deleteEntry(
    entryId: string,
    schoolId: string,
    userId: string,
  ): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select uuid from syllabus_entry where uuid = $1 and school_id = $2 and status = 'active'`,
      [entryId, schoolId],
    );
    if (rows.length === 0) return false;
    const now = new Date();
    await DB.queriesInTransaction(
      [
        singleLineString`delete from syllabus_progress where syllabus_entry_id = $1 and school_id = $2`,
        singleLineString`update syllabus_entry set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      ],
      [
        [entryId, schoolId],
        [userId, now, entryId, schoolId],
      ],
    );
    return true;
  }

  // Resequence entries 1..n in the given order. Ids not belonging to this plan
  // are ignored; entries omitted from `order` keep their relative order after.
  public async reorderEntries(
    syllabusId: string,
    data: ReorderEntriesRequest,
    schoolId: string,
    userId: string,
  ): Promise<SyllabusEntry[] | null> {
    const plan = await this.getSyllabusHeader(syllabusId, schoolId);
    if (!plan) return null;
    if (!Array.isArray(data.order)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "order array is required",
      );
    }
    const current = await this.listEntries(syllabusId, schoolId);
    const validIds = new Set(current.map((e) => e.uuid));
    const ordered = data.order.filter((id) => validIds.has(id));
    const remaining = current
      .map((e) => e.uuid)
      .filter((id) => !ordered.includes(id));
    const finalOrder = [...ordered, ...remaining];

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    finalOrder.forEach((id, idx) => {
      queries.push(
        singleLineString`update syllabus_entry set seq = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
      );
      params.push([idx + 1, userId, now, id, schoolId]);
    });
    if (queries.length > 0) await DB.queriesInTransaction(queries, params);
    return this.listEntries(syllabusId, schoolId);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  private validateEntry(input: EntryInput): void {
    if (!input.title || !input.title.trim()) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "title is required for each entry",
      );
    }
    if (!input.month || !MONTH_VALUES.includes(input.month)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `month must be one of: ${MONTH_VALUES.join(", ")}`,
      );
    }
    if (
      input.entryType !== undefined &&
      !ENTRY_TYPE_VALUES.includes(input.entryType)
    ) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `entryType must be one of: ${ENTRY_TYPE_VALUES.join(", ")}`,
      );
    }
    if (
      input.term !== undefined &&
      input.term !== null &&
      !TERM_VALUES.includes(input.term)
    ) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `term must be one of: ${TERM_VALUES.join(", ")}`,
      );
    }
  }

  private async insertEntries(
    syllabusId: string,
    schoolId: string,
    userId: string,
    inputs: EntryInput[],
    startSeq: number,
  ): Promise<SyllabusEntry[]> {
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    const created: SyllabusEntry[] = [];
    inputs.forEach((input, idx) => {
      const uuid = generateShortUuid(12);
      const seq = startSeq + idx;
      const entryType: EntryType = input.entryType || DEFAULTS.ENTRY_TYPE;
      const month = input.month as Month;
      const term: Term | null = resolveTerm(entryType, month, input.term as Term);
      queries.push(singleLineString`
        insert into syllabus_entry
        (uuid, school_id, syllabus_id, seq, month, entry_type, topic_no, title, theme, page_ref, term, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `);
      params.push([
        uuid,
        schoolId,
        syllabusId,
        seq,
        month,
        entryType,
        input.topicNo?.trim() || null,
        input.title.trim(),
        input.theme?.trim() || null,
        input.pageRef?.trim() || null,
        term,
        DEFAULTS.STATUS,
        userId,
        now,
      ]);
      created.push({
        uuid,
        syllabusId,
        seq,
        month,
        entryType,
        topicNo: input.topicNo?.trim() || null,
        title: input.title.trim(),
        theme: input.theme?.trim() || null,
        pageRef: input.pageRef?.trim() || null,
        term,
      });
    });
    if (queries.length > 0) await DB.queriesInTransaction(queries, params);
    return created;
  }

  private async maxSeq(syllabusId: string, schoolId: string): Promise<number> {
    const rows = await DB.query(
      singleLineString`select coalesce(max(seq), 0) as max_seq from syllabus_entry where syllabus_id = $1 and school_id = $2 and status = 'active'`,
      [syllabusId, schoolId],
    );
    return Number(rows[0]?.maxSeq ?? 0);
  }

  private async subjectExists(
    schoolId: string,
    subjectId: string,
  ): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from syllabus_subject where uuid = $1 and school_id = $2 and status = 'active'`,
      [subjectId, schoolId],
    );
    return rows.length > 0;
  }

  // A grade is valid only if at least one class section derives to it (e.g. "III"
  // requires an "III-A"/"III-B"). Keeps plans tied to grades that actually exist.
  private async gradeExists(schoolId: string, grade: string): Promise<boolean> {
    const classes = await listClasses(schoolId);
    return classes.some((c) => gradeEquals(c.name, grade));
  }

  private async subjectName(
    schoolId: string,
    subjectId: string,
  ): Promise<string | null> {
    const rows = await DB.query(
      singleLineString`select name from syllabus_subject where uuid = $1 and school_id = $2`,
      [subjectId, schoolId],
    );
    return rows.length > 0 ? rows[0].name : null;
  }

  private async assertPlanFree(
    schoolId: string,
    academicYearId: string,
    grade: string,
    subjectId: string,
    excludeId: string | null,
  ): Promise<void> {
    const params: any[] = [schoolId, academicYearId, grade.trim(), subjectId];
    let query = singleLineString`
      select uuid from syllabus
      where school_id = $1 and academic_year_id = $2 and lower(grade) = lower($3) and subject_id = $4 and status = 'active'
    `;
    if (excludeId) {
      params.push(excludeId);
      query += ` and uuid != $5`;
    }
    const rows = await DB.query(query, params);
    if (rows.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `A syllabus for grade "${grade.trim()}" and this subject already exists for the year`,
      );
    }
  }
}

export const syllabusPlanService = new SyllabusPlanService();
