import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService, getSignedPhotoUrl } from "../../shared/lib/file-storage";
import {
  getCurrentAcademicYearId,
  findBaseClass,
  findClassName,
  findEmployeeName,
  gradeOf,
} from "./outreach-common";
import {
  IMAGE_ALLOWED_MIME,
  IMAGE_MAX_BYTES,
  FILE_ENTITY_TYPE,
  REACTION_EMOJIS,
  ReactionEmoji,
} from "./outreach-constants";
import {
  AudienceSpec,
  AudienceView,
  CreateMomentRequest,
  UpdateMomentRequest,
  AddPhotoRequest,
  AddVideoRequest,
  MomentView,
  MomentListRow,
  MomentPhotoView,
  MomentVideoView,
  ReactionSummary,
  AudienceOptions,
  MyClass,
  MomentAuditRow,
} from "./outreach-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Extract the 11-char YouTube id from any common URL form (watch / youtu.be / shorts /
// embed / live), or a bare id. Returns null if it doesn't look like a YouTube video.
function parseYouTubeId(input: string): string | null {
  const s = (input || "").trim();
  if (!s) return null;
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s; // already a bare id
  let m =
    s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||
    s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/) ||
    s.match(/youtube\.com\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

class OutreachService {
  // ── Audience ─────────────────────────────────────────────────────────────────

  // Validate + normalize an audience spec. Rejects empty sets and bad class refs; a
  // 'school' row collapses the whole set (everyone). Returns de-duplicated rows.
  private async normalizeAudience(schoolId: string, specs: AudienceSpec[]): Promise<AudienceSpec[]> {
    if (!Array.isArray(specs) || !specs.length) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "At least one audience is required");
    }
    if (specs.some((s) => s.scope === "school")) return [{ scope: "school", refId: null }];
    const seen = new Set<string>();
    const out: AudienceSpec[] = [];
    for (const s of specs) {
      if (s.scope === "grade") {
        const g = (s.refId || "").trim();
        if (!g) throw new BusinessErrorResult(ErrorCode.BusinessError, "Grade audience requires a grade");
        const key = `grade:${g}`;
        if (!seen.has(key)) { seen.add(key); out.push({ scope: "grade", refId: g }); }
      } else if (s.scope === "class") {
        const c = (s.refId || "").trim();
        if (!c || !(await findBaseClass(schoolId, c))) {
          throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid class in audience");
        }
        const key = `class:${c}`;
        if (!seen.has(key)) { seen.add(key); out.push({ scope: "class", refId: c }); }
      } else {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid audience scope: ${s.scope}`);
      }
    }
    return out;
  }

  private async writeAudience(schoolId: string, momentId: string, specs: AudienceSpec[]): Promise<void> {
    const now = new Date();
    for (const s of specs) {
      await DB.query(
        singleLineString`insert into moment_audience (uuid, school_id, moment_id, scope, ref_id, created_at)
          values ($1, $2, $3, $4, $5, $6)`,
        [generateShortUuid(12), schoolId, momentId, s.scope, s.refId ?? null, now],
      );
    }
  }

  // Load + label a moment's audience rows for display.
  private async audienceViews(schoolId: string, momentId: string): Promise<AudienceView[]> {
    const rows = await DB.query(
      singleLineString`select scope, ref_id from moment_audience where moment_id = $1 order by scope`,
      [momentId],
    );
    if (!rows.length) return [];
    const classIds = rows.filter((r: any) => r.scope === "class" && r.refId).map((r: any) => r.refId);
    const nameMap = new Map<string, string>();
    if (classIds.length) {
      const names = await DB.query(
        singleLineString`select uuid, name from class where school_id = $1 and uuid = any($2)`,
        [schoolId, classIds],
      );
      names.forEach((n: any) => nameMap.set(n.uuid, n.name));
    }
    return rows.map((r: any) => {
      let label = "Whole school";
      if (r.scope === "grade") label = `Class ${r.refId}`;
      else if (r.scope === "class") label = nameMap.get(r.refId) || r.refId;
      return { scope: r.scope, refId: r.refId || null, label };
    });
  }

  // ── Create / update ────────────────────────────────────────────────────────────

  async createMoment(schoolId: string, req: CreateMomentRequest, userId: string, authorEmployeeId: string | null, ay?: string): Promise<MomentView> {
    const year = ay || (await getCurrentAcademicYearId(schoolId));
    if (!year) throw new BusinessErrorResult(ErrorCode.BusinessError, "No current academic year");
    const audience = await this.normalizeAudience(schoolId, req.audience);
    const id = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`insert into moment (uuid, school_id, academic_year_id, author_employee_id, title, body, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, 'draft', $7, $8)`,
      [id, schoolId, year, authorEmployeeId, req.title?.trim() || null, req.body?.trim() || null, userId, now],
    );
    await this.writeAudience(schoolId, id, audience);
    await this.audit(schoolId, id, "create", req.title?.trim() || null, userId);
    return this.getMoment(schoolId, id, { reactorId: null });
  }

  async updateMoment(schoolId: string, id: string, req: UpdateMomentRequest, userId: string): Promise<MomentView | null> {
    const m = await this.momentRow(schoolId, id);
    if (!m) return null;
    if (m.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Unpublish the moment before editing");
    await DB.query(
      singleLineString`update moment set title = $1, body = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5 and school_id = $6`,
      [req.title?.trim() ?? null, req.body?.trim() ?? null, userId, new Date(), id, schoolId],
    );
    if (req.audience) {
      const audience = await this.normalizeAudience(schoolId, req.audience);
      await DB.query(singleLineString`delete from moment_audience where moment_id = $1`, [id]);
      await this.writeAudience(schoolId, id, audience);
    }
    await this.audit(schoolId, id, "edit", req.title?.trim() || null, userId);
    return this.getMoment(schoolId, id, { reactorId: null });
  }

  // ── Photos ───────────────────────────────────────────────────────────────────

  async addPhoto(schoolId: string, momentId: string, req: AddPhotoRequest, userId: string): Promise<MomentView | null> {
    const m = await this.momentRow(schoolId, momentId);
    if (!m) return null;
    if (m.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Unpublish the moment before adding photos");
    const img = req.image;
    if (!img?.base64Data || !img?.mimeType) throw new BusinessErrorResult(ErrorCode.BusinessError, "image (mimeType + base64Data) is required");
    if (!(IMAGE_ALLOWED_MIME as readonly string[]).includes(img.mimeType)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported image type. Allowed: ${IMAGE_ALLOWED_MIME.join(", ")}`);
    }
    if (Buffer.byteLength(img.base64Data, "base64") > IMAGE_MAX_BYTES) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Image too large (max ${Math.round(IMAGE_MAX_BYTES / (1024 * 1024))} MB)`);
    }
    const photoId = generateShortUuid(12);
    const now = new Date();
    const seqRow = await DB.query(
      singleLineString`select coalesce(max(seq), 0) + 1 as next from moment_photo where moment_id = $1 and status = 'active'`,
      [momentId],
    );
    await DB.query(
      singleLineString`insert into moment_photo (uuid, school_id, moment_id, caption, seq, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, 'active', $6, $7)`,
      [photoId, schoolId, momentId, req.caption?.trim() || null, seqRow[0].next, userId, now],
    );
    await fileStorageService.upload({
      fileName: img.fileName || `moment-${photoId}.img`,
      mimeType: img.mimeType,
      base64Data: img.base64Data,
      entityType: FILE_ENTITY_TYPE,
      entityId: photoId,
      variant: "original",
      schoolId,
      userId,
    });
    // Optional small variant for list covers (saves the teacher's mobile data).
    if (req.thumb?.base64Data && req.thumb?.mimeType) {
      await fileStorageService.upload({
        fileName: req.thumb.fileName || `moment-${photoId}-thumb.img`,
        mimeType: req.thumb.mimeType,
        base64Data: req.thumb.base64Data,
        entityType: FILE_ENTITY_TYPE,
        entityId: photoId,
        variant: "thumb",
        schoolId,
        userId,
      });
    }
    await this.audit(schoolId, momentId, "photo-add", req.caption?.trim() || null, userId);
    return this.getMoment(schoolId, momentId, { reactorId: null });
  }

  async removePhoto(schoolId: string, momentId: string, photoId: string, userId: string): Promise<MomentView | null> {
    const m = await this.momentRow(schoolId, momentId);
    if (!m) return null;
    if (m.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Unpublish the moment before removing photos");
    const p = await DB.query(
      singleLineString`select uuid from moment_photo where uuid = $1 and moment_id = $2 and school_id = $3 and status = 'active'`,
      [photoId, momentId, schoolId],
    );
    if (!p.length) return null;
    const files = await DB.query(
      singleLineString`select uuid from file_storage where entity_type = $1 and entity_id = $2 and school_id = $3`,
      [FILE_ENTITY_TYPE, photoId, schoolId],
    );
    for (const f of files) await fileStorageService.delete(f.uuid, schoolId);
    await DB.query(
      singleLineString`update moment_photo set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, new Date(), photoId, schoolId],
    );
    await this.audit(schoolId, momentId, "photo-remove", null, userId);
    return this.getMoment(schoolId, momentId, { reactorId: null });
  }

  // Single-image base64 (fallback / local dev when there's no presigned URL).
  async getPhotoImage(schoolId: string, photoId: string): Promise<{ data: string; mimeType: string; fileName: string } | null> {
    const files = await DB.query(
      singleLineString`select uuid from file_storage where entity_type = $1 and entity_id = $2 and school_id = $3 and (variant = 'original' or variant is null) order by created_at desc limit 1`,
      [FILE_ENTITY_TYPE, photoId, schoolId],
    );
    if (!files.length) return null;
    const stored = await fileStorageService.getWithData(files[0].uuid, schoolId);
    return stored ? { data: stored.data, mimeType: stored.mimeType, fileName: stored.fileName } : null;
  }

  private async photos(schoolId: string, momentId: string): Promise<MomentPhotoView[]> {
    const rows = await DB.query(
      singleLineString`select uuid, caption, seq from moment_photo
        where moment_id = $1 and school_id = $2 and status = 'active'
        order by seq asc nulls last, created_at asc`,
      [momentId, schoolId],
    );
    if (!rows.length) return [];
    const files = await DB.query(
      singleLineString`select entity_id as photo_id, uuid as file_id, storage_key, storage_provider from file_storage
        where entity_type = $1 and school_id = $2 and entity_id = any($3) and (variant = 'original' or variant is null)`,
      [FILE_ENTITY_TYPE, schoolId, rows.map((r: any) => r.uuid)],
    );
    const fileMap = new Map(files.map((f: any) => [f.photoId, f]));
    const out: MomentPhotoView[] = [];
    for (const r of rows) {
      const f: any = fileMap.get(r.uuid);
      const imageUrl = f ? await getSignedPhotoUrl(f.storageKey, 300, f.storageProvider) : null;
      out.push({ uuid: r.uuid, caption: r.caption || null, seq: r.seq, imageUrl: imageUrl || null, fileId: f?.fileId || null });
    }
    return out;
  }

  // ── Videos (YouTube links) ─────────────────────────────────────────────────────

  async addVideo(schoolId: string, momentId: string, req: AddVideoRequest, userId: string): Promise<MomentView | null> {
    const m = await this.momentRow(schoolId, momentId);
    if (!m) return null;
    if (m.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Unpublish the moment before adding videos");
    const youtubeId = parseYouTubeId(req.url || "");
    if (!youtubeId) throw new BusinessErrorResult(ErrorCode.BusinessError, "Not a valid YouTube link");
    const videoId = generateShortUuid(12);
    const now = new Date();
    const seqRow = await DB.query(
      singleLineString`select coalesce(max(seq), 0) + 1 as next from moment_video where moment_id = $1 and status = 'active'`,
      [momentId],
    );
    await DB.query(
      singleLineString`insert into moment_video (uuid, school_id, moment_id, youtube_id, url, caption, seq, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)`,
      [videoId, schoolId, momentId, youtubeId, (req.url || "").slice(0, 512), req.caption?.trim() || null, seqRow[0].next, userId, now],
    );
    await this.audit(schoolId, momentId, "edit", `video-add ${youtubeId}`, userId);
    return this.getMoment(schoolId, momentId, { reactorId: null });
  }

  async removeVideo(schoolId: string, momentId: string, videoId: string, userId: string): Promise<MomentView | null> {
    const m = await this.momentRow(schoolId, momentId);
    if (!m) return null;
    if (m.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Unpublish the moment before removing videos");
    const v = await DB.query(
      singleLineString`select uuid from moment_video where uuid = $1 and moment_id = $2 and school_id = $3 and status = 'active'`,
      [videoId, momentId, schoolId],
    );
    if (!v.length) return null;
    await DB.query(
      singleLineString`update moment_video set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, new Date(), videoId, schoolId],
    );
    await this.audit(schoolId, momentId, "edit", "video-remove", userId);
    return this.getMoment(schoolId, momentId, { reactorId: null });
  }

  private async videos(schoolId: string, momentId: string): Promise<MomentVideoView[]> {
    const rows = await DB.query(
      singleLineString`select uuid, youtube_id, url, caption from moment_video
        where moment_id = $1 and school_id = $2 and status = 'active'
        order by seq asc nulls last, created_at asc`,
      [momentId, schoolId],
    );
    return rows.map((r: any) => ({ uuid: r.uuid, youtubeId: r.youtubeId, url: r.url || null, caption: r.caption || null }));
  }

  private async mediaCount(momentId: string): Promise<number> {
    const r = await DB.query(
      singleLineString`select
          (select count(1) from moment_photo where moment_id = $1 and status = 'active')
        + (select count(1) from moment_video where moment_id = $1 and status = 'active') as n`,
      [momentId],
    );
    return Number(r[0].n) || 0;
  }

  // ── Publish / unpublish ────────────────────────────────────────────────────────

  async publish(schoolId: string, id: string, userId: string): Promise<MomentView | null> {
    const m = await this.momentRow(schoolId, id);
    if (!m) return null;
    if (m.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Moment is already published");
    if ((await this.mediaCount(id)) === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, "Add at least one photo or video before publishing");
    const now = new Date();
    await DB.query(
      singleLineString`update moment set status = 'published', published_at = $1, publish_at = null, publishedby_userid = $2, updatedby_userid = $2, updated_at = $1 where uuid = $3`,
      [now, userId, id],
    );
    await this.audit(schoolId, id, "publish", null, userId);
    return this.getMoment(schoolId, id, { reactorId: null });
  }

  // ── Scheduled publish ──────────────────────────────────────────────────────────

  // Set a future publish time on a draft ("scheduled"). A worker (processScheduled) flips it
  // to published at that moment and notifies. Requires media, like an immediate publish.
  async schedule(schoolId: string, id: string, publishAtIso: string, userId: string): Promise<MomentView | null> {
    const m = await this.momentRow(schoolId, id);
    if (!m) return null;
    if (m.status === "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Moment is already published");
    const when = new Date(publishAtIso);
    if (isNaN(when.getTime())) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid publish time");
    if (when.getTime() <= Date.now()) throw new BusinessErrorResult(ErrorCode.BusinessError, "Scheduled time must be in the future");
    if ((await this.mediaCount(id)) === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, "Add at least one photo or video before scheduling");
    await DB.query(
      singleLineString`update moment set publish_at = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
      [when, userId, new Date(), id, schoolId],
    );
    await this.audit(schoolId, id, "edit", `schedule ${when.toISOString()}`, userId);
    return this.getMoment(schoolId, id, { reactorId: null });
  }

  // Cancel a pending schedule (back to a plain draft).
  async cancelSchedule(schoolId: string, id: string, userId: string): Promise<MomentView | null> {
    const m = await this.momentRow(schoolId, id);
    if (!m) return null;
    await DB.query(
      singleLineString`update moment set publish_at = null, updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, new Date(), id, schoolId],
    );
    await this.audit(schoolId, id, "edit", "unschedule", userId);
    return this.getMoment(schoolId, id, { reactorId: null });
  }

  // Publish every draft whose scheduled time has arrived. Returns the published ids (for the
  // worker to fan notifications). A due moment with no media is un-scheduled (not retried).
  async processScheduled(limit = 50): Promise<{ momentId: string; schoolId: string }[]> {
    const due = await DB.query(
      singleLineString`select uuid, school_id from moment
        where status = 'draft' and publish_at is not null and publish_at <= now()
        order by publish_at asc limit ${Math.min(limit, 200)}`,
    );
    const published: { momentId: string; schoolId: string }[] = [];
    for (const d of due) {
      try {
        const r = await this.publish(d.schoolId, d.uuid, "scheduler");
        if (r) published.push({ momentId: d.uuid, schoolId: d.schoolId });
      } catch {
        // e.g. no media left — clear the schedule so it isn't retried every minute.
        await DB.query(singleLineString`update moment set publish_at = null where uuid = $1`, [d.uuid]);
      }
    }
    return published;
  }

  async unpublish(schoolId: string, id: string, userId: string): Promise<MomentView | null> {
    const m = await this.momentRow(schoolId, id);
    if (!m) return null;
    if (m.status !== "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a published moment can be unpublished");
    await DB.query(
      singleLineString`update moment set status = 'draft', published_at = null, publishedby_userid = null, updatedby_userid = $1, updated_at = $2 where uuid = $3`,
      [userId, new Date(), id],
    );
    await this.audit(schoolId, id, "unpublish", null, userId);
    return this.getMoment(schoolId, id, { reactorId: null });
  }

  // Resolve the student uuids a published moment should notify (audience-expanded for the
  // moment's academic year). A 'school' row expands to every enrolled student. The year is
  // read from the moment itself, so the publish path just passes the id.
  async resolveAudienceStudentIds(schoolId: string, momentId: string): Promise<string[]> {
    const m = await this.momentRow(schoolId, momentId);
    if (!m) return [];
    const ay = m.academicYearId;
    const aud = await DB.query(
      singleLineString`select scope, ref_id from moment_audience where moment_id = $1`,
      [momentId],
    );
    if (!aud.length) return [];
    const whole = aud.some((a: any) => a.scope === "school");
    if (whole) {
      const rows = await DB.query(
        singleLineString`select distinct student_id from student_class
          where school_id = $1 and academic_year_id = $2 and (status is null or status <> 'deleted')`,
        [schoolId, ay],
      );
      return rows.map((r: any) => r.studentId);
    }
    const classIds = new Set<string>();
    aud.filter((a: any) => a.scope === "class" && a.refId).forEach((a: any) => classIds.add(a.refId));
    const grades = aud.filter((a: any) => a.scope === "grade" && a.refId).map((a: any) => a.refId);
    if (grades.length) {
      const gradeClasses = await DB.query(
        singleLineString`select uuid, name from class
          where school_id = $1 and base_class_id is null and class_group_id is null`,
        [schoolId],
      );
      gradeClasses.forEach((c: any) => { if (grades.includes(gradeOf(c.name))) classIds.add(c.uuid); });
    }
    if (!classIds.size) return [];
    const rows = await DB.query(
      singleLineString`select distinct student_id from student_class
        where school_id = $1 and academic_year_id = $2 and class_id = any($3) and (status is null or status <> 'deleted')`,
      [schoolId, ay, [...classIds]],
    );
    return rows.map((r: any) => r.studentId);
  }

  // ── Reads ──────────────────────────────────────────────────────────────────────

  private async momentRow(schoolId: string, id: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid, school_id, academic_year_id, author_employee_id, title, body, status,
          published_at::text as published_at, publish_at::text as publish_at, created_at::text as created_at
        from moment where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    return rows[0] || null;
  }

  async getMoment(schoolId: string, id: string, opts: { reactorId: string | null }): Promise<MomentView> {
    const m = await this.momentRow(schoolId, id);
    if (!m) throw new BusinessErrorResult(ErrorCode.InvalidId, "Moment not found");
    return {
      uuid: m.uuid,
      title: m.title || null,
      body: m.body || null,
      status: m.status,
      publishedAt: m.publishedAt || null,
      publishAt: m.publishAt || null,
      scheduled: m.status === "draft" && !!m.publishAt,
      authorEmployeeId: m.authorEmployeeId || null,
      authorName: m.authorEmployeeId ? await findEmployeeName(schoolId, m.authorEmployeeId) : null,
      audience: await this.audienceViews(schoolId, id),
      photos: await this.photos(schoolId, id),
      videos: await this.videos(schoolId, id),
      reactions: await this.reactionSummary(schoolId, id, opts.reactorId),
      createdAt: m.createdAt || null,
    };
  }

  async listMoments(schoolId: string, filters: { status?: string; classId?: string; limit?: number; offset?: number }): Promise<MomentListRow[]> {
    const where: string[] = ["m.school_id = $1"];
    const params: any[] = [schoolId];
    if (filters.status === "draft" || filters.status === "published") {
      params.push(filters.status);
      where.push(`m.status = $${params.length}`);
    }
    if (filters.classId) {
      params.push(filters.classId);
      where.push(`exists (select 1 from moment_audience a where a.moment_id = m.uuid and a.scope = 'class' and a.ref_id = $${params.length})`);
    }
    const limit = Math.min(filters.limit || 50, 100);
    const offset = filters.offset || 0;
    const rows = await DB.query(
      singleLineString`select m.uuid, m.title, m.status, m.published_at::text as published_at, m.publish_at::text as publish_at, m.created_at::text as created_at,
          m.author_employee_id,
          (select p.uuid from moment_photo p where p.moment_id = m.uuid and p.status = 'active' order by p.seq asc nulls last, p.created_at asc limit 1) as cover_photo_id,
          (select count(1)::int from moment_photo p where p.moment_id = m.uuid and p.status = 'active') as photo_count,
          (select count(1)::int from moment_video v where v.moment_id = m.uuid and v.status = 'active') as video_count,
          (select count(1)::int from moment_reaction r where r.moment_id = m.uuid) as reaction_count
        from moment m
        where ${where.join(" and ")}
        order by m.created_at desc
        limit ${limit} offset ${offset}`,
      params,
    );
    // Batch-resolve cover thumbnails (first photo of each moment).
    const coverIds = rows.map((r: any) => r.coverPhotoId).filter(Boolean);
    const coverMap = new Map<string, any>();
    if (coverIds.length) {
      const files = await DB.query(
        singleLineString`select entity_id as photo_id, variant, storage_key, storage_provider from file_storage
          where entity_type = $1 and school_id = $2 and entity_id = any($3)`,
        [FILE_ENTITY_TYPE, schoolId, coverIds],
      );
      // Prefer the small 'thumb' variant for covers; fall back to the original.
      files.forEach((f: any) => { if (!coverMap.has(f.photoId) || f.variant === "thumb") coverMap.set(f.photoId, f); });
    }
    const out: MomentListRow[] = [];
    for (const r of rows) {
      const cf = r.coverPhotoId ? coverMap.get(r.coverPhotoId) : null;
      const coverUrl = cf ? await getSignedPhotoUrl(cf.storageKey, 300, cf.storageProvider) : null;
      out.push({
        uuid: r.uuid,
        title: r.title || null,
        coverUrl: coverUrl || null,
        status: r.status,
        publishedAt: r.publishedAt || null,
        publishAt: r.publishAt || null,
        scheduled: r.status === "draft" && !!r.publishAt,
        authorName: r.authorEmployeeId ? await findEmployeeName(schoolId, r.authorEmployeeId) : null,
        audience: await this.audienceViews(schoolId, r.uuid),
        photoCount: r.photoCount,
        videoCount: r.videoCount,
        reactionCount: r.reactionCount,
        createdAt: r.createdAt || null,
      });
    }
    return out;
  }

  // Classes + grades for the audience picker (base classes only, ordered by seq).
  async audienceOptions(schoolId: string): Promise<AudienceOptions> {
    const rows = await DB.query(
      singleLineString`select uuid, name, seq from class
        where school_id = $1 and base_class_id is null and class_group_id is null
        order by seq asc nulls last, name`,
      [schoolId],
    );
    const classes = rows.map((r: any) => ({ classId: r.uuid, name: r.name, grade: gradeOf(r.name) }));
    const grades: { grade: string }[] = [];
    const seen = new Set<string>();
    for (const c of classes) {
      if (c.grade && !seen.has(c.grade)) { seen.add(c.grade); grades.push({ grade: c.grade }); }
    }
    return { grades, classes };
  }

  // ── Reactions ────────────────────────────────────────────────────────────────

  async reactionSummary(schoolId: string, momentId: string, reactorId: string | null): Promise<ReactionSummary> {
    const rows = await DB.query(
      singleLineString`select emoji, count(1)::int as n from moment_reaction where moment_id = $1 group by emoji`,
      [momentId],
    );
    const counts: Record<string, number> = {};
    let total = 0;
    rows.forEach((r: any) => { counts[r.emoji] = r.n; total += r.n; });
    let mine: string | null = null;
    if (reactorId) {
      const m = await DB.query(
        singleLineString`select emoji from moment_reaction where moment_id = $1 and reactor_id = $2`,
        [momentId, reactorId],
      );
      mine = m.length ? m[0].emoji : null;
    }
    return { counts, total, mine };
  }

  async setReaction(schoolId: string, momentId: string, reactorType: "student" | "employee", reactorId: string, emoji: string | null): Promise<ReactionSummary> {
    const token = (emoji || "").trim();
    if (!token) {
      await DB.query(
        singleLineString`delete from moment_reaction where moment_id = $1 and reactor_id = $2`,
        [momentId, reactorId],
      );
      return this.reactionSummary(schoolId, momentId, reactorId);
    }
    if (!(REACTION_EMOJIS as readonly string[]).includes(token)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported reaction. Allowed: ${REACTION_EMOJIS.join(", ")}`);
    }
    const now = new Date();
    const existing = await DB.query(
      singleLineString`select uuid from moment_reaction where moment_id = $1 and reactor_id = $2`,
      [momentId, reactorId],
    );
    if (existing.length) {
      await DB.query(
        singleLineString`update moment_reaction set emoji = $1, updated_at = $2 where uuid = $3`,
        [token, now, existing[0].uuid],
      );
    } else {
      await DB.query(
        singleLineString`insert into moment_reaction (uuid, school_id, moment_id, reactor_type, reactor_id, emoji, created_at)
          values ($1, $2, $3, $4, $5, $6, $7)`,
        [generateShortUuid(12), schoolId, momentId, reactorType, reactorId, token, now],
      );
    }
    return this.reactionSummary(schoolId, momentId, reactorId);
  }

  // ── Student (parent app) feed — published + audience-matched only ──────────────

  // The student's base-class enrolment + derived grade for a year (student_class stores
  // the base class even for streamed students, which is the audience-matching granularity).
  private async studentClassAndGrade(schoolId: string, studentId: string, ay: string): Promise<{ classId: string; grade: string } | null> {
    const rows = await DB.query(
      singleLineString`select sc.class_id, c.name from student_class sc
        join class c on c.uuid = sc.class_id and c.school_id = sc.school_id
        where sc.school_id = $1 and sc.student_id = $2 and sc.academic_year_id = $3
          and (sc.status is null or sc.status <> 'deleted')
        limit 1`,
      [schoolId, studentId, ay],
    );
    if (!rows.length) return null;
    return { classId: rows[0].classId, grade: gradeOf(rows[0].name) };
  }

  private async visibleMomentIds(schoolId: string, ay: string, classId: string, grade: string, limit: number, offset: number): Promise<string[]> {
    const rows = await DB.query(
      singleLineString`select m.uuid from moment m
        where m.school_id = $1 and m.status = 'published' and m.academic_year_id = $2
          and exists (select 1 from moment_audience a where a.moment_id = m.uuid and (
            a.scope = 'school'
            or (a.scope = 'grade' and a.ref_id = $3)
            or (a.scope = 'class' and a.ref_id = $4)
          ))
        order by m.published_at desc nulls last
        limit ${limit} offset ${offset}`,
      [schoolId, ay, grade, classId],
    );
    return rows.map((r: any) => r.uuid);
  }

  async studentFeed(schoolId: string, studentId: string, ay: string | null, opts: { limit?: number; offset?: number }): Promise<{ moments: MomentView[] }> {
    const year = ay || (await getCurrentAcademicYearId(schoolId));
    const sc = year ? await this.studentClassAndGrade(schoolId, studentId, year) : null;
    if (!year || !sc) return { moments: [] };
    const limit = Math.min(opts.limit || 20, 50);
    const offset = opts.offset || 0;
    const ids = await this.visibleMomentIds(schoolId, year, sc.classId, sc.grade, limit, offset);
    const moments: MomentView[] = [];
    for (const id of ids) moments.push(await this.getMoment(schoolId, id, { reactorId: studentId }));
    return { moments };
  }

  // A single published moment, only if the student is in its audience.
  async studentMoment(schoolId: string, studentId: string, momentId: string, ay: string | null): Promise<MomentView | null> {
    const year = ay || (await getCurrentAcademicYearId(schoolId));
    const sc = year ? await this.studentClassAndGrade(schoolId, studentId, year) : null;
    if (!year || !sc) return null;
    if (!(await this.studentCanSee(schoolId, momentId, sc.classId, sc.grade))) return null;
    return this.getMoment(schoolId, momentId, { reactorId: studentId });
  }

  async studentCanSee(schoolId: string, momentId: string, classId: string, grade: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from moment m
        where m.uuid = $1 and m.school_id = $2 and m.status = 'published'
          and exists (select 1 from moment_audience a where a.moment_id = m.uuid and (
            a.scope = 'school'
            or (a.scope = 'grade' and a.ref_id = $3)
            or (a.scope = 'class' and a.ref_id = $4)
          ))
        limit 1`,
      [momentId, schoolId, grade, classId],
    );
    return rows.length > 0;
  }

  // Resolve a student's class+grade (public helper for the reaction path).
  async resolveStudentScope(schoolId: string, studentId: string, ay: string | null): Promise<{ classId: string; grade: string } | null> {
    const year = ay || (await getCurrentAcademicYearId(schoolId));
    return year ? this.studentClassAndGrade(schoolId, studentId, year) : null;
  }

  // ── Teacher (PWA) own-class surface ──────────────────────────────────────────

  async canPostForClass(schoolId: string, employeeId: string, classId: string, ay: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from class_teacher
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and teacher_id = $4 and status = 'active' limit 1`,
      [schoolId, ay, classId, employeeId],
    );
    return rows.length > 0;
  }

  async myClasses(schoolId: string, employeeId: string, ay: string): Promise<MyClass[]> {
    const rows = await DB.query(
      singleLineString`select ct.class_id, c.name, c.seq from class_teacher ct
        join class c on c.uuid = ct.class_id and c.school_id = ct.school_id
        where ct.school_id = $1 and ct.academic_year_id = $2 and ct.teacher_id = $3 and ct.status = 'active'
        order by c.seq asc nulls last, c.name`,
      [schoolId, ay, employeeId],
    );
    return rows.map((r: any) => ({ classId: r.classId, className: r.name }));
  }

  // The author of a moment (for teacher own-authored scope checks).
  async momentAuthor(schoolId: string, momentId: string): Promise<string | null> {
    const m = await this.momentRow(schoolId, momentId);
    return m ? m.authorEmployeeId || null : null;
  }

  async authoredByTeacher(schoolId: string, employeeId: string): Promise<MomentListRow[]> {
    const rows = await DB.query(
      singleLineString`select uuid from moment where school_id = $1 and author_employee_id = $2
        order by coalesce(published_at, created_at) desc nulls last limit 50`,
      [schoolId, employeeId],
    );
    const out: MomentListRow[] = [];
    for (const r of rows) {
      const v = await this.getMoment(schoolId, r.uuid, { reactorId: null });
      out.push({
        uuid: v.uuid, title: v.title ?? null, status: v.status, publishedAt: v.publishedAt ?? null,
        publishAt: v.publishAt ?? null, scheduled: v.scheduled ?? false,
        authorName: v.authorName ?? null, audience: v.audience,
        photoCount: v.photos.length, videoCount: v.videos.length, reactionCount: v.reactions.total, createdAt: v.createdAt ?? null,
      });
    }
    return out;
  }

  // ── Audit ──────────────────────────────────────────────────────────────────────

  async getAudit(schoolId: string, momentId: string): Promise<MomentAuditRow[]> {
    const rows = await DB.query(
      singleLineString`select a.uuid, a.action, a.detail, a.changedby_userid, e.name as changedby_name, a.changed_at::text as changed_at
        from moment_audit a
        left join employee e on e.uuid = a.changedby_userid and e.school_id = a.school_id
        where a.school_id = $1 and a.moment_id = $2
        order by a.changed_at desc`,
      [schoolId, momentId],
    );
    return rows.map((r: any) => ({
      uuid: r.uuid,
      action: r.action,
      detail: r.detail || null,
      changedbyUserid: r.changedbyUserid || null,
      changedbyName: r.changedbyName || null,
      changedAt: r.changedAt || null,
    }));
  }

  private async audit(schoolId: string, momentId: string | null, action: string, detail: string | null, userId: string): Promise<void> {
    await DB.query(
      singleLineString`insert into moment_audit (uuid, school_id, moment_id, action, detail, changedby_userid, changed_at)
        values ($1, $2, $3, $4, $5, $6, $7)`,
      [generateShortUuid(12), schoolId, momentId, action, detail ? detail.slice(0, 256) : null, userId, new Date()],
    );
  }
}

export const outreachService = new OutreachService();
