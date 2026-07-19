import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  BulkProgressRequest,
  MarkProgressRequest,
} from "./syllabus-interfaces";
import { PROGRESS_STATUS_VALUES, ProgressStatus } from "./syllabus-constants";
import { findClass } from "./syllabus-common";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

class SyllabusProgressService {
  // Entries of a plan with this section's coverage overlaid, plus counts.
  public async getRoster(
    syllabusId: string,
    classId: string,
    schoolId: string,
  ): Promise<any | null> {
    const plan = await DB.query(
      singleLineString`select uuid from syllabus where uuid = $1 and school_id = $2 and status = 'active'`,
      [syllabusId, schoolId],
    );
    if (plan.length === 0) return null;
    const cls = await findClass(schoolId, classId);
    if (!cls)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid classId");

    const entries = await DB.query(
      singleLineString`
        select e.uuid, e.syllabus_id, e.seq, e.month, e.entry_type, e.topic_no, e.title, e.theme, e.page_ref, e.term,
               coalesce(p.status = 'covered', false) as covered, p.covered_date, p.remark
        from syllabus_entry e
        left join syllabus_progress p on p.syllabus_entry_id = e.uuid and p.class_id = $2
        where e.syllabus_id = $1 and e.school_id = $3 and e.status = 'active'
        order by e.seq asc
      `,
      [syllabusId, classId, schoolId],
    );

    const topics = entries.filter((e: any) => e.entryType === "topic");
    const coveredTopics = topics.filter((e: any) => e.covered === true).length;
    return {
      syllabusId,
      classId,
      className: cls.name,
      counts: {
        total: topics.length,
        covered: coveredTopics,
        pending: topics.length - coveredTopics,
      },
      entries,
    };
  }

  public async mark(
    data: MarkProgressRequest,
    schoolId: string,
    userId: string,
  ): Promise<any> {
    if (!data.entryId || !data.classId) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "entryId and classId are required",
      );
    }
    if (!PROGRESS_STATUS_VALUES.includes(data.status)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `status must be one of: ${PROGRESS_STATUS_VALUES.join(", ")}`,
      );
    }
    await this.assertEntry(schoolId, data.entryId);
    const cls = await findClass(schoolId, data.classId);
    if (!cls)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid classId");

    const row = await this.upsert(
      schoolId,
      userId,
      data.entryId,
      data.classId,
      data.status,
      data.coveredDate,
      data.remark,
    );
    return row;
  }

  public async markBulk(
    data: BulkProgressRequest,
    schoolId: string,
    userId: string,
  ): Promise<{ marked: number }> {
    if (!data.classId)
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "classId is required",
      );
    if (!Array.isArray(data.marks) || data.marks.length === 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "marks array is required",
      );
    }
    const cls = await findClass(schoolId, data.classId);
    if (!cls)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid classId");

    // Validate all entries belong to this school in one query.
    const entryIds = [
      ...new Set(data.marks.map((m) => m.entryId).filter(Boolean)),
    ];
    if (entryIds.length === 0)
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "each mark needs an entryId",
      );
    const placeholders = entryIds.map((_, i) => `$${i + 2}`).join(", ");
    const found = await DB.query(
      singleLineString`select uuid from syllabus_entry where school_id = $1 and status = 'active' and uuid in (${placeholders})`,
      [schoolId, ...entryIds],
    );
    const valid = new Set(found.map((r: any) => r.uuid));

    let marked = 0;
    for (const m of data.marks) {
      if (!valid.has(m.entryId)) continue;
      if (!PROGRESS_STATUS_VALUES.includes(m.status)) continue;
      await this.upsert(
        schoolId,
        userId,
        m.entryId,
        data.classId,
        m.status,
        m.coveredDate,
        m.remark,
      );
      marked++;
    }
    return { marked };
  }

  // Insert or update the single (entry, class) progress row. Covered without an
  // explicit date defaults to today; pending clears the covered date.
  private async upsert(
    schoolId: string,
    userId: string,
    entryId: string,
    classId: string,
    status: ProgressStatus,
    coveredDate?: string,
    remark?: string,
  ): Promise<any> {
    const now = new Date();
    const coveredOn =
      status === "covered"
        ? coveredDate && /^\d{4}-\d{2}-\d{2}$/.test(coveredDate)
          ? coveredDate
          : now.toISOString().slice(0, 10)
        : null;
    const rows = await DB.query(
      singleLineString`
        insert into syllabus_progress
        (uuid, school_id, syllabus_entry_id, class_id, status, covered_date, marked_by, remark, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        on conflict (syllabus_entry_id, class_id) do update set
          status = excluded.status,
          covered_date = excluded.covered_date,
          marked_by = excluded.marked_by,
          remark = excluded.remark,
          updatedby_userid = $9,
          updated_at = $10
        returning uuid, syllabus_entry_id, class_id, status, covered_date, marked_by, remark
      `,
      [
        generateShortUuid(12),
        schoolId,
        entryId,
        classId,
        status,
        coveredOn,
        userId,
        remark?.trim() || null,
        userId,
        now,
      ],
    );
    return rows[0];
  }

  private async assertEntry(schoolId: string, entryId: string): Promise<void> {
    const rows = await DB.query(
      singleLineString`select uuid from syllabus_entry where uuid = $1 and school_id = $2 and status = 'active'`,
      [entryId, schoolId],
    );
    if (rows.length === 0)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid entryId");
  }
}

export const syllabusProgressService = new SyllabusProgressService();
