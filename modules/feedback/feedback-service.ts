import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  findEmployee,
  findStudent,
  getCurrentAcademicYearId,
} from "./feedback-common";
import {
  CATEGORY_SEED,
  OPEN_STATUSES,
  TEACHER_ACTIONABLE,
  NOTIFY,
} from "./feedback-constants";
import {
  FeedbackCategoryView,
  FeedbackView,
  FeedbackAuditRow,
  FeedbackSummary,
  RecordFeedbackRequest,
  TeacherBreakupRow,
} from "./feedback-interfaces";
import { notifyInApp } from "./feedback-notify";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class FeedbackService {
  // ── Categories (seeded on first use) ─────────────────────────────────────────
  async ensureCategories(schoolId: string, userId = "system"): Promise<void> {
    const existing = await DB.query(
      singleLineString`select count(1)::int as n from feedback_category where school_id = $1 and status <> 'deleted'`,
      [schoolId],
    );
    if (existing[0].n > 0) return;
    const now = new Date();
    for (const c of CATEGORY_SEED) {
      await DB.query(
        singleLineString`insert into feedback_category (uuid, school_id, name, sort_order, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, 'active', $5, $6)`,
        [generateShortUuid(12), schoolId, c.name, c.sortOrder, userId, now],
      );
    }
  }

  async listCategories(schoolId: string): Promise<FeedbackCategoryView[]> {
    await this.ensureCategories(schoolId);
    const rows = await DB.query(
      singleLineString`select uuid, name, sort_order, status from feedback_category
        where school_id = $1 and status <> 'deleted' order by sort_order asc nulls last, name`,
      [schoolId],
    );
    return rows.map((r: any) => ({
      uuid: r.uuid,
      name: r.name,
      sortOrder: r.sortOrder,
      status: r.status,
    }));
  }

  private async categoryExists(schoolId: string, categoryId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from feedback_category where uuid = $1 and school_id = $2 and status = 'active'`,
      [categoryId, schoolId],
    );
    return rows.length > 0;
  }

  // ── Record (home-visit feedback + assign to a teacher) ───────────────────────
  async record(schoolId: string, recordedBy: string, req: RecordFeedbackRequest): Promise<FeedbackView> {
    if (!req.studentId) throw new BusinessErrorResult(ErrorCode.BusinessError, "studentId is required");
    if (!req.categoryId) throw new BusinessErrorResult(ErrorCode.BusinessError, "categoryId is required");
    if (!req.feedbackText || !req.feedbackText.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, "feedbackText is required");
    if (!req.assignedTo) throw new BusinessErrorResult(ErrorCode.BusinessError, "assignedTo (teacher) is required");
    if (req.visitDate && !DATE_RE.test(req.visitDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, "visitDate must be YYYY-MM-DD");

    const student = await findStudent(schoolId, req.studentId);
    if (!student) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid student");
    const teacher = await findEmployee(schoolId, req.assignedTo);
    if (!teacher) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid teacher to assign");
    await this.ensureCategories(schoolId);
    if (!(await this.categoryExists(schoolId, req.categoryId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid category");

    const academicYearId = req.academicYearId || (await getCurrentAcademicYearId(schoolId));
    const id = generateShortUuid(12);
    const now = new Date();
    const visitDate = req.visitDate || now.toISOString().slice(0, 10);
    await DB.query(
      singleLineString`insert into feedback
        (uuid, school_id, academic_year_id, student_id, class_id, category_id, feedback_text, visit_date,
         assigned_to, recorded_by, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'assigned', $10, $11)`,
      [id, schoolId, academicYearId, req.studentId, req.classId || null, req.categoryId, req.feedbackText.trim(), visitDate, req.assignedTo, recordedBy, now],
    );
    await this.audit(schoolId, id, "record", `assigned to ${teacher.name}`, null, "assigned", recordedBy);
    // No per-feedback notification here — the recorder's UI batches a single
    // per-visit notification per teacher via notifyVisit() after the whole visit.
    return (await this.getFeedback(schoolId, id))!;
  }

  // ── Queries ──────────────────────────────────────────────────────────────────
  private selectSql(): string {
    return singleLineString`select f.uuid, f.academic_year_id, f.student_id, s.name as student_name, s.admission_number,
        f.class_id, c.name as class_name, f.category_id, cat.name as category_name,
        f.feedback_text, f.visit_date::text as visit_date, f.assigned_to, ae.name as assigned_to_name,
        f.recorded_by, re.name as recorded_by_name, f.teacher_comment, f.responded_by, rpe.name as responded_by_name,
        f.responded_at::text as responded_at, f.review_note, f.reviewed_by, rve.name as reviewed_by_name,
        f.reviewed_at::text as reviewed_at, f.status, f.created_at::text as created_at
      from feedback f
      left join student s on s.uuid = f.student_id and s.school_id = f.school_id
      left join class c on c.uuid = f.class_id and c.school_id = f.school_id
      left join feedback_category cat on cat.uuid = f.category_id and cat.school_id = f.school_id
      left join employee ae on ae.uuid = f.assigned_to and ae.school_id = f.school_id
      left join employee re on re.uuid = f.recorded_by and re.school_id = f.school_id
      left join employee rpe on rpe.uuid = f.responded_by and rpe.school_id = f.school_id
      left join employee rve on rve.uuid = f.reviewed_by and rve.school_id = f.school_id`;
  }

  // Director/office list + teacher /me list share this. `status: 'open'` expands to the
  // three non-terminal states. `sort: 'oldest'` orders by visit date ascending.
  async listFeedback(
    schoolId: string,
    filters: { status?: string; assignedTo?: string; recordedBy?: string; categoryId?: string; academicYearId?: string; sort?: string },
  ): Promise<FeedbackView[]> {
    const conds: string[] = ["f.school_id = $1"];
    const params: any[] = [schoolId];
    if (filters.status === "open") {
      params.push(OPEN_STATUSES as unknown as string[]);
      conds.push(`f.status = any($${params.length})`);
    } else if (filters.status) {
      params.push(filters.status);
      conds.push(`f.status = $${params.length}`);
    }
    if (filters.assignedTo) { params.push(filters.assignedTo); conds.push(`f.assigned_to = $${params.length}`); }
    if (filters.recordedBy) { params.push(filters.recordedBy); conds.push(`f.recorded_by = $${params.length}`); }
    if (filters.categoryId) { params.push(filters.categoryId); conds.push(`f.category_id = $${params.length}`); }
    if (filters.academicYearId) { params.push(filters.academicYearId); conds.push(`f.academic_year_id = $${params.length}`); }
    const order = filters.sort === "oldest"
      ? "order by f.visit_date asc nulls last, f.created_at asc"
      : "order by f.visit_date desc nulls last, f.created_at desc";
    const rows = await DB.query(`${this.selectSql()} where ${conds.join(" and ")} ${order}`, params);
    return rows.map((r: any) => this.toView(r));
  }

  async getFeedback(schoolId: string, id: string): Promise<FeedbackView | null> {
    const rows = await DB.query(`${this.selectSql()} where f.school_id = $1 and f.uuid = $2`, [schoolId, id]);
    return rows.length ? this.toView(rows[0]) : null;
  }

  private toView(r: any): FeedbackView {
    return {
      uuid: r.uuid,
      academicYearId: r.academicYearId || null,
      studentId: r.studentId,
      studentName: r.studentName || null,
      admissionNumber: r.admissionNumber || null,
      classId: r.classId || null,
      className: r.className || null,
      categoryId: r.categoryId || null,
      categoryName: r.categoryName || null,
      feedbackText: r.feedbackText,
      visitDate: r.visitDate || null,
      assignedTo: r.assignedTo,
      assignedToName: r.assignedToName || null,
      recordedBy: r.recordedBy || null,
      recordedByName: r.recordedByName || null,
      teacherComment: r.teacherComment || null,
      respondedBy: r.respondedBy || null,
      respondedByName: r.respondedByName || null,
      respondedAt: r.respondedAt || null,
      reviewNote: r.reviewNote || null,
      reviewedBy: r.reviewedBy || null,
      reviewedByName: r.reviewedByName || null,
      reviewedAt: r.reviewedAt || null,
      status: r.status,
      createdAt: r.createdAt || null,
    };
  }

  private async findRaw(schoolId: string, id: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid, student_id, assigned_to, recorded_by, status from feedback where school_id = $1 and uuid = $2`,
      [schoolId, id],
    );
    return rows[0] || null;
  }

  // ── Teacher responds ─────────────────────────────────────────────────────────
  async respond(schoolId: string, id: string, employeeId: string, comment: string): Promise<FeedbackView | null> {
    if (!comment || !comment.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, "A comment is required");
    const f = await this.findRaw(schoolId, id);
    if (!f) return null;
    if (f.assignedTo !== employeeId) throw new BusinessErrorResult(ErrorCode.BusinessError, "This feedback is not assigned to you");
    if (!(TEACHER_ACTIONABLE as readonly string[]).includes(f.status)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot respond to a ${f.status} feedback`);
    }
    const now = new Date();
    await DB.query(
      singleLineString`update feedback set teacher_comment = $1, responded_by = $2, responded_at = $3, status = 'responded',
          updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5`,
      [comment.trim(), employeeId, now, id, schoolId],
    );
    await this.audit(schoolId, id, "respond", null, f.status, "responded", employeeId);
    return this.getFeedback(schoolId, id);
  }

  // ── Director reviews ───────────────────────────────────────────────────────────
  async complete(schoolId: string, id: string, userId: string, note?: string): Promise<FeedbackView | null> {
    const f = await this.findRaw(schoolId, id);
    if (!f) return null;
    if (f.status === "completed") return this.getFeedback(schoolId, id);
    if (f.status !== "responded") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a responded feedback can be completed");
    const now = new Date();
    await DB.query(
      singleLineString`update feedback set status = 'completed', review_note = $1, reviewed_by = $2, reviewed_at = $3,
          updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5`,
      [note?.slice(0, 512) || null, userId, now, id, schoolId],
    );
    await this.audit(schoolId, id, "complete", note || null, f.status, "completed", userId);
    return this.getFeedback(schoolId, id);
  }

  async reopen(schoolId: string, id: string, userId: string, note?: string): Promise<FeedbackView | null> {
    const f = await this.findRaw(schoolId, id);
    if (!f) return null;
    if (f.status === "reopened" || f.status === "assigned") {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "This feedback is already open with the teacher");
    }
    const now = new Date();
    await DB.query(
      singleLineString`update feedback set status = 'reopened', review_note = $1, reviewed_by = $2, reviewed_at = $3,
          updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5`,
      [note?.slice(0, 512) || null, userId, now, id, schoolId],
    );
    await this.audit(schoolId, id, "reopen", note || null, f.status, "reopened", userId);
    return this.getFeedback(schoolId, id);
  }

  // ── Summary (director dashboard) ──────────────────────────────────────────────
  async summary(schoolId: string, academicYearId?: string): Promise<FeedbackSummary> {
    const conds: string[] = ["f.school_id = $1"];
    const params: any[] = [schoolId];
    if (academicYearId) { params.push(academicYearId); conds.push(`f.academic_year_id = $${params.length}`); }
    const where = conds.join(" and ");

    const statusRows = await DB.query(
      `select f.status, count(1)::int as n from feedback f where ${where} group by f.status`,
      params,
    );
    const byStatus = { assigned: 0, responded: 0, completed: 0, reopened: 0 };
    for (const r of statusRows) {
      if (r.status in byStatus) (byStatus as any)[r.status] = r.n;
    }
    const open = byStatus.assigned + byStatus.responded + byStatus.reopened;

    const teacherRows = await DB.query(
      `select f.assigned_to, e.name as employee_name, f.status, count(1)::int as n
        from feedback f
        left join employee e on e.uuid = f.assigned_to and e.school_id = f.school_id
        where ${where} group by f.assigned_to, e.name, f.status`,
      params,
    );
    const map = new Map<string, TeacherBreakupRow>();
    for (const r of teacherRows) {
      const key = r.assignedTo;
      if (!map.has(key)) {
        map.set(key, { employeeId: key, employeeName: r.employeeName || null, assigned: 0, responded: 0, completed: 0, open: 0, total: 0 });
      }
      const row = map.get(key)!;
      const n = r.n as number;
      if (r.status === "assigned" || r.status === "reopened") row.assigned += n;
      else if (r.status === "responded") row.responded += n;
      else if (r.status === "completed") row.completed += n;
      row.total += n;
    }
    const byTeacher = Array.from(map.values()).map((row) => ({ ...row, open: row.assigned + row.responded }));
    byTeacher.sort((a, b) => b.open - a.open || b.total - a.total);
    return { byStatus, open, byTeacher };
  }

  // ── Audit ──────────────────────────────────────────────────────────────────
  async getAudit(schoolId: string, feedbackId: string): Promise<FeedbackAuditRow[]> {
    const rows = await DB.query(
      singleLineString`select a.uuid, a.feedback_id, a.action, a.detail, a.from_status, a.to_status, a.changedby_userid,
          e.name as changedby_name, a.changed_at::text as changed_at
        from feedback_audit a
        left join employee e on e.uuid = a.changedby_userid and e.school_id = a.school_id
        where a.school_id = $1 and a.feedback_id = $2 order by a.changed_at desc`,
      [schoolId, feedbackId],
    );
    return rows.map((r: any) => ({
      uuid: r.uuid,
      feedbackId: r.feedbackId,
      action: r.action,
      detail: r.detail || null,
      fromStatus: r.fromStatus || null,
      toStatus: r.toStatus || null,
      changedbyUserid: r.changedbyUserid || null,
      changedbyName: r.changedbyName || null,
      changedAt: r.changedAt || null,
    }));
  }

  private async audit(
    schoolId: string,
    feedbackId: string,
    action: string,
    detail: string | null,
    fromStatus: string | null,
    toStatus: string | null,
    userId: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`insert into feedback_audit (uuid, school_id, feedback_id, action, detail, from_status, to_status, changedby_userid, changed_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [generateShortUuid(12), schoolId, feedbackId, action, detail ? detail.slice(0, 256) : null, fromStatus, toStatus, userId, new Date()],
    );
  }

  // ── Notifications (fire-and-forget, in-app inbox) ─────────────────────────────
  private async schoolCode(schoolId: string): Promise<string | null> {
    const rows = await DB.query(singleLineString`select code from school where uuid = $1`, [schoolId]);
    return rows.length ? rows[0].code : null;
  }

  // One in-app notification per teacher for a whole home visit (not per feedback).
  // Called once by the recorder's UI after it finishes recording all the cards. The
  // notification links to the student (entity_type='student') so a future inbox can
  // show the student's photo. Best-effort — never throws.
  async notifyVisit(schoolId: string, feedbackIds: string[]): Promise<{ notified: number }> {
    const ids = (feedbackIds || []).filter(Boolean);
    if (!ids.length) return { notified: 0 };
    const rows = await DB.query(
      singleLineString`select f.assigned_to, f.student_id, s.name as student_name, c.name as class_name
        from feedback f
        left join student s on s.uuid = f.student_id and s.school_id = f.school_id
        left join class c on c.uuid = f.class_id and c.school_id = f.school_id
        where f.school_id = $1 and f.uuid = any($2)`,
      [schoolId, ids],
    );
    if (!rows.length) return { notified: 0 };
    const code = await this.schoolCode(schoolId);
    if (!code) return { notified: 0 };

    // Group by teacher; a visit is one student, so take the first student/class seen.
    const byTeacher = new Map<string, { studentId: string; studentName: string; className: string | null }>();
    for (const r of rows) {
      if (!r.assignedTo || byTeacher.has(r.assignedTo)) continue;
      byTeacher.set(r.assignedTo, {
        studentId: r.studentId,
        studentName: r.studentName || "a student",
        className: r.className || null,
      });
    }

    for (const [teacherId, info] of byTeacher) {
      const who = info.className ? `${info.studentName} · ${info.className}` : info.studentName;
      await notifyInApp(code, "employee", [teacherId], NOTIFY.ASSIGNED, "New feedback",
        `Feedback received for ${who}`, { entityType: "student", entityId: info.studentId });
    }
    return { notified: byTeacher.size };
  }
}

export const feedbackService = new FeedbackService();
