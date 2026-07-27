import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService, getSignedPhotoUrl } from "../../shared/lib/file-storage";
import {
  getCurrentAcademicYearId,
  findStudentClass,
  findBaseClass,
  findEmployee,
} from "./homework-common";
import {
  HW_IMAGE_ALLOWED_MIME,
  HW_IMAGE_MAX_BYTES,
  FILE_ENTITY_TYPE,
} from "./homework-constants";
import {
  AddItemRequest,
  EditItemRequest,
  HomeworkDayResult,
  HomeworkItemView,
  MyHomeworkClass,
  ClassTeacherMapRow,
  StudentHomeworkView,
  HomeworkAuditRow,
} from "./homework-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

class HomeworkService {
  // ── Class-teacher resolution (override -> timetable class_teacher) ────────────

  async resolveClassTeacher(schoolId: string, classId: string, ay: string): Promise<string | null> {
    const ov = await DB.query(
      singleLineString`select teacher_id from homework_class_teacher
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and status = 'active' limit 1`,
      [schoolId, ay, classId],
    );
    if (ov.length) return ov[0].teacherId;
    const ct = await DB.query(
      singleLineString`select teacher_id from class_teacher
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and status = 'active' limit 1`,
      [schoolId, ay, classId],
    );
    return ct.length ? ct[0].teacherId : null;
  }

  async canPostForClass(schoolId: string, employeeId: string, classId: string, ay: string): Promise<boolean> {
    return (await this.resolveClassTeacher(schoolId, classId, ay)) === employeeId;
  }

  // Base classes this teacher is the (resolved) class teacher of.
  async myHomeworkClasses(schoolId: string, employeeId: string, ay: string): Promise<MyHomeworkClass[]> {
    const overrides = await DB.query(
      singleLineString`select class_id from homework_class_teacher
        where school_id = $1 and academic_year_id = $2 and teacher_id = $3 and status = 'active'`,
      [schoolId, ay, employeeId],
    );
    const cts = await DB.query(
      singleLineString`select ct.class_id from class_teacher ct
        where ct.school_id = $1 and ct.academic_year_id = $2 and ct.teacher_id = $3 and ct.status = 'active'
          and not exists (select 1 from homework_class_teacher o
            where o.school_id = ct.school_id and o.academic_year_id = ct.academic_year_id
              and o.class_id = ct.class_id and o.status = 'active')`,
      [schoolId, ay, employeeId],
    );
    const rows: { classId: string; source: "override" | "timetable" }[] = [
      ...overrides.map((r: any) => ({ classId: r.classId, source: "override" as const })),
      ...cts.map((r: any) => ({ classId: r.classId, source: "timetable" as const })),
    ];
    if (!rows.length) return [];
    const names = await DB.query(
      singleLineString`select uuid, name from class where school_id = $1 and uuid = any($2)`,
      [schoolId, rows.map((r) => r.classId)],
    );
    const nameMap = new Map<string, string>(names.map((n: any) => [n.uuid, n.name]));
    return rows
      .map((r) => ({ classId: r.classId, className: nameMap.get(r.classId) || r.classId, source: r.source }))
      .sort((a, b) => (a.className || "").localeCompare(b.className || ""));
  }

  // Admin view: every base class + its resolved class teacher (override vs timetable).
  async classTeacherMap(schoolId: string, ay: string): Promise<ClassTeacherMapRow[]> {
    const classes = await DB.query(
      singleLineString`select uuid, name from class where school_id = $1 and base_class_id is null
        order by seq asc nulls last, name`,
      [schoolId],
    );
    const overrides = await DB.query(
      singleLineString`select class_id, teacher_id from homework_class_teacher
        where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ay],
    );
    const cts = await DB.query(
      singleLineString`select class_id, teacher_id from class_teacher
        where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ay],
    );
    const ovMap = new Map(overrides.map((o: any) => [o.classId, o.teacherId]));
    const ctMap = new Map(cts.map((c: any) => [c.classId, c.teacherId]));
    const teacherIds = [...new Set([...ovMap.values(), ...ctMap.values()])] as string[];
    const tnames = teacherIds.length
      ? await DB.query(singleLineString`select uuid, name from employee where school_id = $1 and uuid = any($2)`, [schoolId, teacherIds])
      : [];
    const tmap = new Map(tnames.map((t: any) => [t.uuid, t.name]));
    return classes.map((c: any) => {
      let teacherId: string | null = null;
      let source: "override" | "timetable" | "none" = "none";
      if (ovMap.has(c.uuid)) { teacherId = ovMap.get(c.uuid) as string; source = "override"; }
      else if (ctMap.has(c.uuid)) { teacherId = ctMap.get(c.uuid) as string; source = "timetable"; }
      return { classId: c.uuid, className: c.name, teacherId, teacherName: teacherId ? tmap.get(teacherId) || null : null, source };
    });
  }

  async setClassTeacherOverride(schoolId: string, ay: string, classId: string, teacherId: string, userId: string): Promise<void> {
    if (!(await findBaseClass(schoolId, classId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid class");
    if (!(await findEmployee(schoolId, teacherId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid teacher");
    const now = new Date();
    await DB.queriesInTransaction(
      [
        singleLineString`update homework_class_teacher set status = 'deleted', updatedby_userid = $1, updated_at = $2
          where school_id = $3 and academic_year_id = $4 and class_id = $5 and status = 'active'`,
        singleLineString`insert into homework_class_teacher (uuid, school_id, academic_year_id, class_id, teacher_id, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, 'active', $6, $7)`,
      ],
      [
        [userId, now, schoolId, ay, classId],
        [generateShortUuid(12), schoolId, ay, classId, teacherId, userId, now],
      ],
    );
  }

  async clearClassTeacherOverride(schoolId: string, ay: string, classId: string, userId: string): Promise<void> {
    await DB.query(
      singleLineString`update homework_class_teacher set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where school_id = $3 and academic_year_id = $4 and class_id = $5 and status = 'active'`,
      [userId, new Date(), schoolId, ay, classId],
    );
  }

  // ── Day + items ──────────────────────────────────────────────────────────────

  private async findDayRow(schoolId: string, ay: string, classId: string, date: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid, status, academic_year_id, class_id, homework_date::text as homework_date, published_at
        from homework_day where school_id = $1 and academic_year_id = $2 and class_id = $3 and homework_date = $4`,
      [schoolId, ay, classId, date],
    );
    return rows[0] || null;
  }

  async ensureDay(schoolId: string, ay: string, classId: string, date: string, userId: string): Promise<any> {
    const existing = await this.findDayRow(schoolId, ay, classId, date);
    if (existing) return existing;
    const now = new Date();
    await DB.query(
      singleLineString`insert into homework_day (uuid, school_id, academic_year_id, class_id, homework_date, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, 'draft', $6, $7)
        on conflict (school_id, academic_year_id, class_id, homework_date) do nothing`,
      [generateShortUuid(12), schoolId, ay, classId, date, userId, now],
    );
    return this.findDayRow(schoolId, ay, classId, date);
  }

  // Active items under a day, each with a presigned image URL (null in local mode).
  private async itemsForDay(schoolId: string, dayId: string): Promise<HomeworkItemView[]> {
    const items = await DB.query(
      singleLineString`select uuid, subject_label, note, seq from homework_item
        where homework_day_id = $1 and school_id = $2 and status = 'active'
        order by seq asc nulls last, created_at asc`,
      [dayId, schoolId],
    );
    if (!items.length) return [];
    const files = await DB.query(
      singleLineString`select entity_id as item_id, uuid as file_id, storage_key from file_storage
        where entity_type = $1 and school_id = $2 and entity_id = any($3)`,
      [FILE_ENTITY_TYPE, schoolId, items.map((i: any) => i.uuid)],
    );
    const fileMap = new Map(files.map((f: any) => [f.itemId, f]));
    const out: HomeworkItemView[] = [];
    for (const it of items) {
      const f: any = fileMap.get(it.uuid);
      const imageUrl = f ? await getSignedPhotoUrl(f.storageKey) : null;
      out.push({
        uuid: it.uuid,
        subjectLabel: it.subjectLabel || null,
        note: it.note || null,
        seq: it.seq,
        imageUrl: imageUrl || null,
        fileId: f?.fileId || null,
      });
    }
    return out;
  }

  private async dayResult(schoolId: string, ay: string, classId: string, date: string): Promise<HomeworkDayResult> {
    const cls = await findBaseClass(schoolId, classId);
    const dayRow = await this.findDayRow(schoolId, ay, classId, date);
    const className = cls?.name || null;
    if (!dayRow) return { classId, date, className, day: null };
    return {
      classId,
      date,
      className,
      day: {
        uuid: dayRow.uuid,
        classId,
        className,
        academicYearId: dayRow.academicYearId,
        homeworkDate: dayRow.homeworkDate,
        status: dayRow.status,
        publishedAt: dayRow.publishedAt || null,
        items: await this.itemsForDay(schoolId, dayRow.uuid),
      },
    };
  }

  async getDay(schoolId: string, classId: string, date: string, ay?: string): Promise<HomeworkDayResult> {
    const year = ay || (await getCurrentAcademicYearId(schoolId));
    if (!year) return { classId, date, className: null, day: null };
    return this.dayResult(schoolId, year, classId, date);
  }

  async addItem(schoolId: string, req: AddItemRequest, userId: string): Promise<HomeworkDayResult> {
    const year = req.academicYearId || (await getCurrentAcademicYearId(schoolId));
    if (!year) throw new BusinessErrorResult(ErrorCode.BusinessError, "No current academic year");
    if (!(await findBaseClass(schoolId, req.classId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid class");
    const img = req.image;
    if (!img?.base64Data || !img?.mimeType) throw new BusinessErrorResult(ErrorCode.BusinessError, "image (mimeType + base64Data) is required");
    if (!(HW_IMAGE_ALLOWED_MIME as readonly string[]).includes(img.mimeType)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported image type. Allowed: ${HW_IMAGE_ALLOWED_MIME.join(", ")}`);
    }
    if (Buffer.byteLength(img.base64Data, "base64") > HW_IMAGE_MAX_BYTES) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Image too large (max ${Math.round(HW_IMAGE_MAX_BYTES / (1024 * 1024))} MB)`);
    }

    const day = await this.ensureDay(schoolId, year, req.classId, req.date, userId);
    if (day.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Unpublish the homework before adding photos");

    const itemId = generateShortUuid(12);
    const now = new Date();
    const seqRow = await DB.query(
      singleLineString`select coalesce(max(seq), 0) + 1 as next from homework_item where homework_day_id = $1 and status = 'active'`,
      [day.uuid],
    );
    await DB.query(
      singleLineString`insert into homework_item (uuid, school_id, homework_day_id, subject_label, note, seq, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
      [itemId, schoolId, day.uuid, req.subjectLabel?.trim() || null, req.note?.trim() || null, seqRow[0].next, userId, now],
    );
    await fileStorageService.upload({
      fileName: img.fileName || `homework-${itemId}.img`,
      mimeType: img.mimeType,
      base64Data: img.base64Data,
      entityType: FILE_ENTITY_TYPE,
      entityId: itemId,
      variant: "original",
      schoolId,
      userId,
    });
    await this.audit(schoolId, day.uuid, itemId, req.classId, req.date, "upload", req.subjectLabel || null, userId);
    return this.dayResult(schoolId, year, req.classId, req.date);
  }

  // Resolve an item -> its day context (with a draft/published guard).
  private async itemContext(schoolId: string, itemId: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select i.uuid as item_id, i.homework_day_id, d.class_id, d.academic_year_id,
          d.homework_date::text as homework_date, d.status as day_status
        from homework_item i join homework_day d on d.uuid = i.homework_day_id
        where i.uuid = $1 and i.school_id = $2 and i.status = 'active'`,
      [itemId, schoolId],
    );
    return rows[0] || null;
  }

  async editItem(schoolId: string, itemId: string, req: EditItemRequest, userId: string): Promise<HomeworkDayResult | null> {
    const ctx = await this.itemContext(schoolId, itemId);
    if (!ctx) return null;
    if (ctx.dayStatus === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Unpublish the homework before editing");
    await DB.query(
      singleLineString`update homework_item set subject_label = $1, note = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5 and school_id = $6`,
      [req.subjectLabel?.trim() ?? null, req.note?.trim() ?? null, userId, new Date(), itemId, schoolId],
    );
    await this.audit(schoolId, ctx.homeworkDayId, itemId, ctx.classId, ctx.homeworkDate, "edit", req.subjectLabel || null, userId);
    return this.dayResult(schoolId, ctx.academicYearId, ctx.classId, ctx.homeworkDate);
  }

  async removeItem(schoolId: string, itemId: string, userId: string): Promise<HomeworkDayResult | null> {
    const ctx = await this.itemContext(schoolId, itemId);
    if (!ctx) return null;
    if (ctx.dayStatus === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Unpublish the homework before removing photos");
    // Delete the image blob (S3/DB), then soft-delete the item.
    const files = await DB.query(
      singleLineString`select uuid from file_storage where entity_type = $1 and entity_id = $2 and school_id = $3`,
      [FILE_ENTITY_TYPE, itemId, schoolId],
    );
    for (const f of files) await fileStorageService.delete(f.uuid, schoolId);
    await DB.query(
      singleLineString`update homework_item set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, new Date(), itemId, schoolId],
    );
    await this.audit(schoolId, ctx.homeworkDayId, itemId, ctx.classId, ctx.homeworkDate, "remove", null, userId);
    return this.dayResult(schoolId, ctx.academicYearId, ctx.classId, ctx.homeworkDate);
  }

  private async dayById(schoolId: string, dayId: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid, status, academic_year_id, class_id, homework_date::text as homework_date from homework_day where uuid = $1 and school_id = $2`,
      [dayId, schoolId],
    );
    return rows[0] || null;
  }

  async publish(schoolId: string, dayId: string, userId: string): Promise<HomeworkDayResult | null> {
    const day = await this.dayById(schoolId, dayId);
    if (!day) return null;
    if (day.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Homework is already published");
    const cnt = await DB.query(
      singleLineString`select count(1)::int as n from homework_item where homework_day_id = $1 and status = 'active'`,
      [dayId],
    );
    if (cnt[0].n === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, "Add at least one photo before publishing");
    const now = new Date();
    await DB.query(
      singleLineString`update homework_day set status = 'published', published_at = $1, publishedby_userid = $2, updatedby_userid = $2, updated_at = $1 where uuid = $3`,
      [now, userId, dayId],
    );
    await this.audit(schoolId, dayId, null, day.classId, day.homeworkDate, "publish", null, userId);
    return this.dayResult(schoolId, day.academicYearId, day.classId, day.homeworkDate);
  }

  async unpublish(schoolId: string, dayId: string, userId: string): Promise<HomeworkDayResult | null> {
    const day = await this.dayById(schoolId, dayId);
    if (!day) return null;
    if (day.status !== "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a published homework can be unpublished");
    await DB.query(
      singleLineString`update homework_day set status = 'draft', published_at = null, publishedby_userid = null, updatedby_userid = $1, updated_at = $2 where uuid = $3`,
      [userId, new Date(), dayId],
    );
    await this.audit(schoolId, dayId, null, day.classId, day.homeworkDate, "unpublish", null, userId);
    return this.dayResult(schoolId, day.academicYearId, day.classId, day.homeworkDate);
  }

  // Owning (class, academic year) of a day / item — for teacher /me scope checks.
  async dayScope(schoolId: string, dayId: string): Promise<{ classId: string; ay: string } | null> {
    const d = await this.dayById(schoolId, dayId);
    return d ? { classId: d.classId, ay: d.academicYearId } : null;
  }

  async itemScope(schoolId: string, itemId: string): Promise<{ classId: string; ay: string } | null> {
    const c = await this.itemContext(schoolId, itemId);
    return c ? { classId: c.classId, ay: c.academicYearId } : null;
  }

  // ── Student read surface (published only) ────────────────────────────────────

  async studentToday(schoolId: string, studentId: string, date: string, academicYearId?: string): Promise<StudentHomeworkView> {
    const ay = academicYearId || (await getCurrentAcademicYearId(schoolId));
    const placement = ay ? await findStudentClass(schoolId, studentId, ay) : null;
    if (!ay || !placement) return { date, classId: null, className: null, published: false, items: [] };
    const day = await this.findDayRow(schoolId, ay, placement.classId, date);
    if (!day || day.status !== "published") {
      return { date, classId: placement.classId, className: placement.className, published: false, items: [] };
    }
    return {
      date,
      classId: placement.classId,
      className: placement.className,
      published: true,
      items: await this.itemsForDay(schoolId, day.uuid),
    };
  }

  // ── Single-image base64 (fallback / local dev) ───────────────────────────────

  async getItemImage(schoolId: string, itemId: string): Promise<{ data: string; mimeType: string; fileName: string } | null> {
    const files = await DB.query(
      singleLineString`select uuid from file_storage where entity_type = $1 and entity_id = $2 and school_id = $3 order by created_at desc limit 1`,
      [FILE_ENTITY_TYPE, itemId, schoolId],
    );
    if (!files.length) return null;
    const stored = await fileStorageService.getWithData(files[0].uuid, schoolId);
    return stored ? { data: stored.data, mimeType: stored.mimeType, fileName: stored.fileName } : null;
  }

  // ── Audit ────────────────────────────────────────────────────────────────────

  async getAudit(schoolId: string, classId: string, date: string): Promise<HomeworkAuditRow[]> {
    const rows = await DB.query(
      singleLineString`select a.uuid, a.homework_day_id, a.item_id, a.action, a.detail, a.changedby_userid,
          e.name as changedby_name, a.changed_at::text as changed_at
        from homework_audit a
        left join employee e on e.uuid = a.changedby_userid and e.school_id = a.school_id
        where a.school_id = $1 and a.class_id = $2 and a.homework_date = $3
        order by a.changed_at desc`,
      [schoolId, classId, date],
    );
    return rows.map((r: any) => ({
      uuid: r.uuid,
      homeworkDayId: r.homeworkDayId || null,
      itemId: r.itemId || null,
      action: r.action,
      detail: r.detail || null,
      changedbyUserid: r.changedbyUserid || null,
      changedbyName: r.changedbyName || null,
      changedAt: r.changedAt || null,
    }));
  }

  private async audit(
    schoolId: string,
    dayId: string | null,
    itemId: string | null,
    classId: string,
    date: string,
    action: string,
    detail: string | null,
    userId: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`insert into homework_audit (uuid, school_id, homework_day_id, item_id, class_id, homework_date, action, detail, changedby_userid, changed_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [generateShortUuid(12), schoolId, dayId, itemId, classId, date, action, detail ? detail.slice(0, 256) : null, userId, new Date()],
    );
  }
}

export const homeworkService = new HomeworkService();
