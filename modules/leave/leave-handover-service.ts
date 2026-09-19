import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import { ATTACHMENT_ALLOWED_MIME, ATTACHMENT_MAX_BYTES } from "./leave-constants";
import {
  getCurrentAcademicYearId, weeklyOffDays, fullHolidaysInRange, datesInRange,
} from "./leave-common";
import {
  isTeachingStaff, affectedPeriods, currentTopic, parseGrade, AffectedDay,
} from "./leave-handover-common";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const HANDOVER_ENTITY = "leave_handover";

interface FileInput { fileName: string; mimeType: string; base64Data: string; }
export interface HandoverInput {
  topics?: Array<{ classId: string; className?: string; subjectId?: string | null; subjectName?: string | null; chapter?: string | null; topic: string; substitution?: string | null }>;
  lessonPlan?: string;
  otherDuties?: { duties?: string[]; covering?: string; note?: string };
  lessonPlanFile?: FileInput | null;
  worksheetFiles?: FileInput[];
  affected?: AffectedDay[]; // snapshot from the preview (optional; recomputed if absent)
}

function stripPrefix(b64: string): string { return (b64 || "").replace(/^data:[^;]+;base64,/, ""); }

class LeaveHandoverService {
  // Working dates in [from,to] the teacher would actually miss (excludes weekly-offs + holidays).
  private async workingDates(schoolId: string, from: string, to: string): Promise<string[]> {
    const ay = await getCurrentAcademicYearId(schoolId);
    const weeklyOff = ay ? await weeklyOffDays(schoolId, ay) : [0];
    const holidays = await fullHolidaysInRange(schoolId, from, to);
    return datesInRange(from, to).filter((d) => {
      const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
      return !weeklyOff.includes(dow) && !holidays.has(d);
    });
  }

  // What the apply form shows: is the caller teaching staff, the periods they'll miss, and a
  // best-effort prefilled topic per distinct class+subject.
  async preview(schoolId: string, employeeId: string, fromDate: string, toDate: string): Promise<any> {
    const isTeaching = await isTeachingStaff(schoolId, employeeId);
    const dates = await this.workingDates(schoolId, fromDate, toDate);
    const affected = await affectedPeriods(schoolId, employeeId, dates);

    // Distinct class+subject across all affected days → one topic row each.
    const seen = new Map<string, { classId: string; className: string | null; subjectId: string | null; subjectName: string | null }>();
    for (const day of affected) {
      for (const p of day.periods) {
        const key = `${p.classId}::${p.subjectName || p.subjectId || ""}`;
        if (!seen.has(key)) seen.set(key, { classId: p.classId, className: p.className, subjectId: p.subjectId, subjectName: p.subjectName });
      }
    }
    const topics: any[] = [];
    for (const c of seen.values()) {
      const t = await currentTopic(schoolId, parseGrade(c.className || ""), c.subjectName || "", c.classId);
      topics.push({ classId: c.classId, className: c.className, subjectId: c.subjectId, subjectName: c.subjectName, chapter: t?.chapter || null, topic: t?.topic || "", substitution: "" });
    }
    return { isTeaching, affected, topics };
  }

  // Throw a business error if a teaching-staff member has not provided the mandatory handover
  // parts. Returns whether the caller is teaching staff (office staff need no handover). Call
  // this BEFORE creating the application so a validation failure never leaves an orphan row.
  async assertValid(schoolId: string, employeeId: string, input: HandoverInput | undefined): Promise<boolean> {
    const isTeaching = await isTeachingStaff(schoolId, employeeId);
    if (!isTeaching) return false;
    const h = input || {};
    const hasLessonPlan = !!(h.lessonPlan && h.lessonPlan.trim()) || !!h.lessonPlanFile?.base64Data;
    const duties = h.otherDuties || {};
    const hasDuties = !!(duties.duties && duties.duties.length) || !!(duties.covering && duties.covering.trim()) || !!(duties.note && duties.note.trim());
    const topics = Array.isArray(h.topics) ? h.topics : [];
    const topicsIncomplete = topics.some((t) => !t.topic || !String(t.topic).trim());
    if (!hasLessonPlan) throw new BusinessErrorResult(ErrorCode.BusinessError, "A lesson plan (text or file) is required before applying for leave");
    if (!hasDuties) throw new BusinessErrorResult(ErrorCode.BusinessError, "Please declare your other duties (e.g. van / assembly / house), or state 'none'");
    if (topicsIncomplete) throw new BusinessErrorResult(ErrorCode.BusinessError, "Enter the current chapter/topic for every affected class");
    return true;
  }

  // Persist the handover for an application (call AFTER assertValid + the application insert).
  async persist(
    schoolId: string, applicationId: string, employeeId: string,
    fromDate: string, toDate: string, input: HandoverInput | undefined, userId: string,
  ): Promise<void> {
    const h = input || {};
    const duties = h.otherDuties || {};
    const topics = Array.isArray(h.topics) ? h.topics : [];

    // Snapshot the affected periods (from the preview if supplied, else recompute now).
    const affected = h.affected && h.affected.length ? h.affected : await affectedPeriods(schoolId, employeeId, await this.workingDates(schoolId, fromDate, toDate));

    const now = new Date();
    await DB.query(
      singleLineString`insert into leave_handover
        (uuid, school_id, application_id, is_teaching, affected, topics, lesson_plan, other_duties, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (school_id, application_id) do update set affected = $5, topics = $6, lesson_plan = $7, other_duties = $8, updatedby_userid = $9, updated_at = $10`,
      [generateShortUuid(12), schoolId, applicationId, true, JSON.stringify(affected), JSON.stringify(topics),
        h.lessonPlan?.trim() || null, JSON.stringify(duties), userId, now],
    );

    await this.uploadDoc(schoolId, applicationId, employeeId, h.lessonPlanFile, "lesson_plan");
    for (const w of h.worksheetFiles || []) await this.uploadDoc(schoolId, applicationId, employeeId, w, "worksheet");
  }

  private async uploadDoc(schoolId: string, applicationId: string, userId: string, f: FileInput | null | undefined, variant: string): Promise<void> {
    if (!f?.base64Data || !f.mimeType) return;
    if (!(ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(f.mimeType)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported file type ${f.mimeType}. Allowed: ${ATTACHMENT_ALLOWED_MIME.join(", ")}`);
    }
    if (Buffer.byteLength(stripPrefix(f.base64Data), "base64") > ATTACHMENT_MAX_BYTES) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `File too large (max ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB)`);
    }
    await fileStorageService.upload({
      fileName: f.fileName || `${variant}.pdf`, mimeType: f.mimeType, base64Data: stripPrefix(f.base64Data),
      entityType: HANDOVER_ENTITY, entityId: applicationId, variant, schoolId, userId,
    });
  }

  // The handover for one application, for the Director's Approvals view.
  async getForApplication(schoolId: string, applicationId: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select is_teaching, affected, topics, lesson_plan, other_duties from leave_handover
        where school_id = $1 and application_id = $2`,
      [schoolId, applicationId],
    );
    const files = await DB.query(
      singleLineString`select uuid, file_name, mime_type, variant from file_storage
        where entity_type = $1 and entity_id = $2 and school_id = $3 order by variant, created_at`,
      [HANDOVER_ENTITY, applicationId, schoolId],
    );
    if (!rows.length && !files.length) return null;
    const r = rows[0] || {};
    return {
      isTeaching: r.isTeaching ?? null,
      affected: r.affected || [],
      topics: r.topics || [],
      lessonPlan: r.lessonPlan || null,
      otherDuties: r.otherDuties || null,
      files: files.map((f: any) => ({ fileId: f.uuid, fileName: f.fileName, mimeType: f.mimeType, variant: f.variant })),
    };
  }

  // Fetch one handover file as a data URI (Approvals "view").
  async getFile(schoolId: string, applicationId: string, fileId: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid from file_storage where uuid = $1 and entity_type = $2 and entity_id = $3 and school_id = $4`,
      [fileId, HANDOVER_ENTITY, applicationId, schoolId],
    );
    if (!rows.length) return null;
    const f = await fileStorageService.getWithData(fileId, schoolId);
    if (!f) return null;
    return { mimeType: f.mimeType, fileName: f.fileName, dataUri: `data:${f.mimeType};base64,${f.data}` };
  }
}

export const leaveHandoverService = new LeaveHandoverService();
