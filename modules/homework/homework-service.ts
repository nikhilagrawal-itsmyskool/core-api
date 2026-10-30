import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService, getSignedPhotoUrl } from "../../shared/lib/file-storage";
import { convertDocxToPdf } from "../../shared/lib/docx-to-pdf";
import { resolveEffectiveClassId } from "../../shared/lib/effective-class";
import {
  getCurrentAcademicYearId,
  findPostableClass,
  findClassName,
  findEmployee,
} from "./homework-common";
import {
  HW_IMAGE_ALLOWED_MIME,
  HW_IMAGE_MAX_BYTES,
  HW_DOC_MAX_BYTES,
  HW_PDF_MIME,
  HW_WORD_ALLOWED_MIME,
  HW_PDF_MIME_OUT,
  HW_MAX_CONVERT_ATTEMPTS,
  FILE_ENTITY_TYPE,
  HW_VARIANT_ORIGINAL,
  HW_VARIANT_SOURCE,
} from "./homework-constants";
import {
  AddItemRequest,
  EditItemRequest,
  HomeworkDayResult,
  HomeworkItemView,
  ConversionStatus,
  MyHomeworkClass,
  ClassTeacherMapRow,
  PostableClass,
  StudentHomeworkView,
  HomeworkAuditRow,
} from "./homework-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Word->PDF conversion is enabled only once the LibreOffice layer is provisioned and
// verified (self-test). Gated separately from syllabus so each can be flipped on its
// own. When disabled the worker claims nothing, so pending Word items wait (never fail).
function isHomeworkConvertEnabled(): boolean {
  return process.env.HOMEWORK_CONVERT_ENABLED === "true";
}

// Result of claiming+converting one pending item in the worker.
type ConvertResult =
  | { status: "converted"; itemId: string }
  | { status: "retry"; itemId: string; error: string }
  | { status: "failed"; itemId: string; error: string }
  | { status: "idle" }
  | { status: "skipped"; reason: string };

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

  // Classes homework can be posted for this year: non-streamed base classes that run
  // this year, plus the stream-child classes (XI-A Science / Commerce) of any enrolled
  // streamed base class. A streamed base is replaced by its stream children — each has
  // its own class teacher + student audience. Non-streamed classes are unchanged.
  async listPostableClasses(schoolId: string, ay: string): Promise<PostableClass[]> {
    const rows = await DB.query(
      singleLineString`
        select class_id, name, base_class_id, stream_code, stream_name, seq from (
          select c.uuid as class_id, c.name, null::varchar as base_class_id,
                 null::varchar as stream_code, null::varchar as stream_name, c.seq
          from class c
          where c.school_id = $1 and c.base_class_id is null and c.class_group_id is null
            and exists (
              select 1 from student_class sc
              join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status <> 'deleted'
              where sc.class_id = c.uuid and sc.school_id = c.school_id and sc.academic_year_id = $2
                and (sc.status is null or sc.status <> 'deleted')
            )
            and not exists (
              select 1 from class ch
              where ch.school_id = c.school_id and ch.base_class_id = c.uuid and ch.stream_code is not null
            )
          union all
          select ch.uuid as class_id, ch.name, ch.base_class_id, ch.stream_code, cs.name as stream_name, ch.seq
          from class ch
          left join class_stream cs on cs.school_id = ch.school_id and lower(cs.code) = lower(ch.stream_code) and cs.status = 'active'
          where ch.school_id = $1 and ch.base_class_id is not null and ch.stream_code is not null
            and exists (
              select 1 from student_class sc
              join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status <> 'deleted'
              where sc.class_id = ch.base_class_id and sc.school_id = ch.school_id and sc.academic_year_id = $2
                and (sc.status is null or sc.status <> 'deleted')
            )
        ) q
        order by seq asc nulls last, name`,
      [schoolId, ay],
    );
    return rows.map((r: any) => ({
      classId: r.classId,
      name: r.name,
      baseClassId: r.baseClassId || null,
      streamCode: r.streamCode || null,
      streamName: r.streamName || null,
    }));
  }

  // Admin view: every postable class + its resolved class teacher (override vs timetable).
  async classTeacherMap(schoolId: string, ay: string): Promise<ClassTeacherMapRow[]> {
    const classes = await this.listPostableClasses(schoolId, ay);
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
    const tmap = new Map<string, string>(tnames.map((t: any) => [t.uuid, t.name]));
    return classes.map((c) => {
      let teacherId: string | null = null;
      let source: "override" | "timetable" | "none" = "none";
      if (ovMap.has(c.classId)) { teacherId = ovMap.get(c.classId) as string; source = "override"; }
      else if (ctMap.has(c.classId)) { teacherId = ctMap.get(c.classId) as string; source = "timetable"; }
      return {
        classId: c.classId,
        className: c.name,
        streamCode: c.streamCode,
        streamName: c.streamName,
        teacherId,
        teacherName: teacherId ? tmap.get(teacherId) || null : null,
        source,
      };
    });
  }

  async setClassTeacherOverride(schoolId: string, ay: string, classId: string, teacherId: string, userId: string): Promise<void> {
    if (!(await findPostableClass(schoolId, classId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid class");
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

  // Map an item's stored pdf_status to the client-facing conversion status. Images and
  // PDFs carry no pdf_status (null) and are always 'ready'; a converting Word item is
  // 'pending' until the worker finishes.
  private conversionStatus(pdfStatus: string | null): ConversionStatus {
    if (pdfStatus === "failed") return "failed";
    if (pdfStatus === "pending" || pdfStatus === "converting") return "pending";
    return "ready";
  }

  // Active items under a day. Images carry a presigned imageUrl; PDFs (incl. converted
  // Word docs) carry fileUrl + mimeType so the client opens them as a document. A Word
  // item still converting has no 'original' file yet — it reports conversionStatus
  // 'pending' and its name comes from the uploaded source. (URLs are null in local mode.)
  private async itemsForDay(schoolId: string, dayId: string): Promise<HomeworkItemView[]> {
    const items = await DB.query(
      singleLineString`select uuid, subject_label, note, seq, pdf_status from homework_item
        where homework_day_id = $1 and school_id = $2 and status = 'active'
        order by seq asc nulls last, created_at asc`,
      [dayId, schoolId],
    );
    if (!items.length) return [];
    const files = await DB.query(
      singleLineString`select entity_id as item_id, uuid as file_id, storage_key, storage_provider,
          mime_type, file_name, variant from file_storage
        where entity_type = $1 and school_id = $2 and entity_id = any($3)`,
      [FILE_ENTITY_TYPE, schoolId, items.map((i: any) => i.uuid)],
    );
    // Prefer the rendered 'original' per item; fall back to the 'source' (Word doc
    // awaiting conversion) for the display name only.
    const originalMap = new Map<string, any>();
    const sourceMap = new Map<string, any>();
    for (const f of files as any[]) {
      if (f.variant === HW_VARIANT_SOURCE) sourceMap.set(f.itemId, f);
      else originalMap.set(f.itemId, f);
    }
    const out: HomeworkItemView[] = [];
    for (const it of items) {
      const status = this.conversionStatus(it.pdfStatus || null);
      const original: any = originalMap.get(it.uuid);
      const source: any = sourceMap.get(it.uuid);
      const isImage = !!original && typeof original.mimeType === "string" && original.mimeType.startsWith("image/");
      const signedUrl = original ? await getSignedPhotoUrl(original.storageKey, 300, original.storageProvider) : null;
      out.push({
        uuid: it.uuid,
        subjectLabel: it.subjectLabel || null,
        note: it.note || null,
        seq: it.seq,
        imageUrl: isImage ? signedUrl || null : null,
        fileUrl: original ? signedUrl || null : null,
        mimeType: original?.mimeType || (source ? HW_PDF_MIME_OUT : null),
        fileName: original?.fileName || source?.fileName || null,
        conversionStatus: status,
        fileId: original?.fileId || null,
      });
    }
    return out;
  }

  private async dayResult(schoolId: string, ay: string, classId: string, date: string): Promise<HomeworkDayResult> {
    const className = await findClassName(schoolId, classId);
    const dayRow = await this.findDayRow(schoolId, ay, classId, date);
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
    if (!(await findPostableClass(schoolId, req.classId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid class");

    const img = req.image;
    if (!img?.base64Data || !img?.mimeType) throw new BusinessErrorResult(ErrorCode.BusinessError, "file (mimeType + base64Data) is required");
    const isImage = (HW_IMAGE_ALLOWED_MIME as readonly string[]).includes(img.mimeType);
    const isPdf = img.mimeType === HW_PDF_MIME;
    const isWord = (HW_WORD_ALLOWED_MIME as readonly string[]).includes(img.mimeType);
    if (!isImage && !isPdf && !isWord) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Unsupported file type. Upload a photo (JPG/PNG/WebP), a PDF, or a Word document.",
      );
    }
    const maxBytes = isImage ? HW_IMAGE_MAX_BYTES : HW_DOC_MAX_BYTES;
    if (Buffer.byteLength(img.base64Data, "base64") > maxBytes) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `File too large (max ${Math.round(maxBytes / (1024 * 1024))} MB)`);
    }

    const day = await this.ensureDay(schoolId, year, req.classId, req.date, userId);
    if (day.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Unpublish the homework before adding items");

    const itemId = generateShortUuid(12);
    const now = new Date();
    const seqRow = await DB.query(
      singleLineString`select coalesce(max(seq), 0) + 1 as next from homework_item where homework_day_id = $1 and status = 'active'`,
      [day.uuid],
    );

    if (isWord) {
      // Store the Word doc as the SOURCE; the worker converts it to a PDF 'original'
      // and flips pdf_status 'pending' -> 'ready'. Nothing parent-facing until ready.
      const src = await fileStorageService.upload({
        fileName: img.fileName || `homework-${itemId}.docx`,
        mimeType: img.mimeType,
        base64Data: img.base64Data,
        entityType: FILE_ENTITY_TYPE,
        entityId: itemId,
        variant: HW_VARIANT_SOURCE,
        schoolId,
        userId,
      });
      await DB.query(
        singleLineString`insert into homework_item
          (uuid, school_id, homework_day_id, subject_label, note, seq, status, pdf_status, pdf_attempts, src_file_id, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, 'active', 'pending', 0, $7, $8, $9)`,
        [itemId, schoolId, day.uuid, req.subjectLabel?.trim() || null, req.note?.trim() || null, seqRow[0].next, src.uuid, userId, now],
      );
    } else {
      // Image or PDF — stored directly and immediately viewable (no conversion).
      await DB.query(
        singleLineString`insert into homework_item
          (uuid, school_id, homework_day_id, subject_label, note, seq, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)`,
        [itemId, schoolId, day.uuid, req.subjectLabel?.trim() || null, req.note?.trim() || null, seqRow[0].next, userId, now],
      );
      await fileStorageService.upload({
        fileName: img.fileName || `homework-${itemId}.${isPdf ? "pdf" : "img"}`,
        mimeType: img.mimeType,
        base64Data: img.base64Data,
        entityType: FILE_ENTITY_TYPE,
        entityId: itemId,
        variant: HW_VARIANT_ORIGINAL,
        schoolId,
        userId,
      });
    }
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
      singleLineString`select
          count(1)::int as n,
          count(1) filter (where pdf_status in ('pending', 'converting'))::int as preparing,
          count(1) filter (where pdf_status = 'failed')::int as failed
        from homework_item where homework_day_id = $1 and status = 'active'`,
      [dayId],
    );
    if (cnt[0].n === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, "Add at least one item before publishing");
    // A Word doc is still being converted to PDF — publishing now would show parents an
    // item that isn't ready. Block until the worker finishes (usually within a minute).
    if (cnt[0].preparing > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "A document is still being prepared — try again in a moment");
    }
    if (cnt[0].failed > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "A document couldn't be processed — remove it (or upload a PDF) before publishing");
    }
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
    // Resolve the student's EFFECTIVE class — the stream-child class (XI-A Science)
    // for a streamed student, the base class otherwise. Homework is posted per that
    // class, so this is where the child's homework lives.
    const eff = ay ? await resolveEffectiveClassId(schoolId, studentId, ay) : null;
    if (!ay || !eff) return { date, classId: null, className: null, published: false, items: [] };
    const className = await findClassName(schoolId, eff.classId);
    const day = await this.findDayRow(schoolId, ay, eff.classId, date);
    if (!day || day.status !== "published") {
      return { date, classId: eff.classId, className, published: false, items: [] };
    }
    // Publishing is blocked until every item is ready, so a published day should only
    // hold ready items — filter defensively so a parent never sees a converting item.
    const items = (await this.itemsForDay(schoolId, day.uuid)).filter((i) => i.conversionStatus === "ready");
    return {
      date,
      classId: eff.classId,
      className,
      published: true,
      items,
    };
  }

  // ── Word→PDF conversion worker (docx -> pdf) ─────────────────────────────────
  // Claim one pending Word item (for update skip locked, overlap-safe across drains),
  // convert its source doc to PDF, store it as the 'original', mark ready. Transient
  // failures go back to 'pending' until HW_MAX_CONVERT_ATTEMPTS, then 'failed'. When
  // the converter is not enabled, we DON'T claim anything (so nothing is marked failed).
  async processNextConversion(): Promise<ConvertResult> {
    if (!isHomeworkConvertEnabled()) {
      return { status: "skipped", reason: "converter not enabled" };
    }
    const claimed = await DB.query(
      singleLineString`
        update homework_item
        set pdf_status = 'converting', pdf_attempts = coalesce(pdf_attempts, 0) + 1, updated_at = now()
        where uuid = (
          select uuid from homework_item
          where status = 'active' and pdf_status = 'pending' and src_file_id is not null
          order by created_at asc nulls first
          limit 1
          for update skip locked
        )
        returning uuid, school_id, src_file_id, coalesce(pdf_attempts, 0) as pdf_attempts`,
      [],
    );
    if (claimed.length === 0) return { status: "idle" };
    const item = claimed[0];

    try {
      const src = await fileStorageService.getWithData(item.srcFileId, item.schoolId);
      if (!src) throw new Error("source Word file missing");
      const pdfBase64 = await convertDocxToPdf(src.data, src.fileName);
      await fileStorageService.upload({
        fileName: (src.fileName || "homework").replace(/\.docx?$/i, "") + ".pdf",
        mimeType: HW_PDF_MIME_OUT,
        base64Data: pdfBase64,
        entityType: FILE_ENTITY_TYPE,
        entityId: item.uuid,
        variant: HW_VARIANT_ORIGINAL,
        schoolId: item.schoolId,
        userId: "0",
      });
      await DB.query(
        singleLineString`update homework_item set pdf_status = 'ready', pdf_error = null, updated_at = now() where uuid = $1`,
        [item.uuid],
      );
      return { status: "converted", itemId: item.uuid };
    } catch (e: any) {
      const message = String(e?.message || e).slice(0, 500);
      const giveUp = item.pdfAttempts >= HW_MAX_CONVERT_ATTEMPTS;
      await DB.query(
        singleLineString`update homework_item set pdf_status = $1, pdf_error = $2, updated_at = now() where uuid = $3`,
        [giveUp ? "failed" : "pending", message, item.uuid],
      );
      return giveUp
        ? { status: "failed", itemId: item.uuid, error: message }
        : { status: "retry", itemId: item.uuid, error: message };
    }
  }

  // Drain the queue until empty, the converter is unavailable, or the time budget runs
  // out (EventBridge on AWS; a poller script drives it locally).
  async drainConversions(maxMs = 50000): Promise<{ converted: number; failed: number; skipped: boolean }> {
    const start = Date.now();
    let converted = 0;
    let failed = 0;
    while (Date.now() - start < maxMs) {
      const r = await this.processNextConversion();
      if (r.status === "idle") break;
      if (r.status === "skipped") return { converted, failed, skipped: true };
      if (r.status === "converted") converted += 1;
      if (r.status === "failed") failed += 1;
      // 'retry' loops again
    }
    return { converted, failed, skipped: false };
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
