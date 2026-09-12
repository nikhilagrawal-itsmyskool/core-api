import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import {
  findEmployee,
  findStudent,
  getCurrentAcademicYearId,
  currentClassId,
  reviewerEmployeeIds,
  employeeNames,
} from "./feedback-common";
import {
  CATEGORY_SEED,
  NOTIFY,
  NOTIFY_ENTITY_TYPE,
  FILE_ENTITY_TYPE,
  ATTACHMENT_ALLOWED_MIME,
  ATTACHMENT_MAX_BYTES,
  FeedbackEventType,
} from "./feedback-constants";
import {
  FeedbackCategoryView,
  FeedbackView,
  FeedbackThread,
  FeedbackSummary,
  TeacherBreakupRow,
  TimelineEventView,
  WatcherView,
  AttachmentInput,
  AttachmentMeta,
  RecordFeedbackRequest,
  CommentRequest,
  AssignRequest,
  ReviewRequest,
} from "./feedback-interfaces";
import { notifyInApp } from "./feedback-notify";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Context an action carries about its actor. `isReviewer` = the actor came through the
// director (god) surface — it exempts them from the mandatory-comment-on-assign rule and
// lets them act on any ticket regardless of ownership.
interface ActorCtx {
  isReviewer: boolean;
}

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
    return rows.map((r: any) => ({ uuid: r.uuid, name: r.name, sortOrder: r.sortOrder, status: r.status }));
  }

  private async categoryExists(schoolId: string, categoryId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from feedback_category where uuid = $1 and school_id = $2 and status = 'active'`,
      [categoryId, schoolId],
    );
    return rows.length > 0;
  }

  // ── Record (home-visit feedback + first assignment) ──────────────────────────
  async record(schoolId: string, recordedBy: string, req: RecordFeedbackRequest): Promise<FeedbackThread> {
    if (!req.studentId) throw new BusinessErrorResult(ErrorCode.BusinessError, "studentId is required");
    if (!req.categoryId) throw new BusinessErrorResult(ErrorCode.BusinessError, "categoryId is required");
    if (!req.feedbackText || !req.feedbackText.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, "feedbackText is required");
    if (!req.assignedTo) throw new BusinessErrorResult(ErrorCode.BusinessError, "assignedTo is required");
    if (req.visitDate && !DATE_RE.test(req.visitDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, "visitDate must be YYYY-MM-DD");

    const student = await findStudent(schoolId, req.studentId);
    if (!student) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid student");
    const assignee = await findEmployee(schoolId, req.assignedTo);
    if (!assignee) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid employee to assign");
    await this.ensureCategories(schoolId);
    if (!(await this.categoryExists(schoolId, req.categoryId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid category");

    const academicYearId = req.academicYearId || (await getCurrentAcademicYearId(schoolId));
    // Snapshot the class: trust the client's classId, else resolve from the enrolment.
    const classId = req.classId || (await currentClassId(schoolId, req.studentId, academicYearId));
    const id = generateShortUuid(12);
    const now = new Date();
    const visitDate = req.visitDate || now.toISOString().slice(0, 10);
    await DB.query(
      singleLineString`insert into feedback
        (uuid, school_id, academic_year_id, student_id, class_id, category_id, feedback_text, visit_date,
         assigned_to, recorded_by, status, last_activity_at, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'open', $11, $10, $11)`,
      [id, schoolId, academicYearId, req.studentId, classId || null, req.categoryId, req.feedbackText.trim(), visitDate, req.assignedTo, recordedBy, now],
    );
    const eventId = await this.insertEvent(schoolId, id, "record", recordedBy, null, { toStatus: "open", toAssignee: req.assignedTo }, now);
    await this.uploadAttachments(schoolId, eventId, recordedBy, req.attachments);
    await this.addWatcher(schoolId, id, recordedBy, now);
    await this.addWatcher(schoolId, id, req.assignedTo, now);

    const actorName = (await this.name(schoolId, recordedBy)) || "The office";
    const who = await this.ticketWho(schoolId, id);
    await this.notifyEvent(schoolId, id, recordedBy, {
      key: NOTIFY.ASSIGNED,
      title: "New feedback assigned to you",
      body: `${actorName} sent you feedback for ${who}`,
      extraRecipientId: req.assignedTo,
    });
    return (await this.getThread(schoolId, id))!;
  }

  // ── Comment (status-neutral; any participant) ────────────────────────────────
  async addComment(schoolId: string, id: string, actorId: string, req: CommentRequest, ctx: ActorCtx): Promise<FeedbackThread | null> {
    const body = (req.body || "").trim();
    const hasFiles = Array.isArray(req.attachments) && req.attachments.length > 0;
    if (!body && !hasFiles) throw new BusinessErrorResult(ErrorCode.BusinessError, "A comment or attachment is required");
    const f = await this.findRaw(schoolId, id);
    if (!f) return null;
    if (!ctx.isReviewer && !(await this.isParticipant(schoolId, id, actorId))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "This feedback is not shared with you");
    }
    const now = new Date();
    const eventId = await this.insertEvent(schoolId, id, "comment", actorId, body || null, { mentions: req.mentions }, now);
    await this.uploadAttachments(schoolId, eventId, actorId, req.attachments);
    await this.addWatcher(schoolId, id, actorId, now);
    await this.addMentionWatchers(schoolId, id, req.mentions, now);
    await this.bumpActivity(schoolId, id, actorId, now);

    const actorName = (await this.name(schoolId, actorId)) || "Someone";
    const who = await this.ticketWho(schoolId, id);
    await this.notifyEvent(schoolId, id, actorId, {
      key: NOTIFY.COMMENTED,
      title: "New comment on feedback",
      body: `${actorName} commented on ${who}`,
      mentionIds: req.mentions,
    });
    return this.getThread(schoolId, id);
  }

  // ── Assign (forward / send back) — owner or reviewer ─────────────────────────
  async assign(schoolId: string, id: string, actorId: string, req: AssignRequest, ctx: ActorCtx): Promise<FeedbackThread | null> {
    if (!req.toEmployeeId) throw new BusinessErrorResult(ErrorCode.BusinessError, "toEmployeeId is required");
    const f = await this.findRaw(schoolId, id);
    if (!f) return null;
    if (f.status !== "open") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only an open ticket can be reassigned — reopen it first");
    if (!ctx.isReviewer && f.assignedTo !== actorId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Only the current owner can reassign this feedback");
    }
    const target = await findEmployee(schoolId, req.toEmployeeId);
    if (!target) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid employee to assign");
    const comment = (req.comment || "").trim();
    if (!ctx.isReviewer && !comment) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "A comment is required when reassigning");
    }
    const now = new Date();
    const eventId = await this.insertEvent(schoolId, id, "assign", actorId, comment || null,
      { fromAssignee: f.assignedTo, toAssignee: req.toEmployeeId, mentions: req.mentions }, now);
    await this.uploadAttachments(schoolId, eventId, actorId, req.attachments);
    await DB.query(
      singleLineString`update feedback set assigned_to = $1, updatedby_userid = $2, updated_at = $3, last_activity_at = $3
        where uuid = $4 and school_id = $5`,
      [req.toEmployeeId, actorId, now, id, schoolId],
    );
    await this.addWatcher(schoolId, id, req.toEmployeeId, now);
    await this.addMentionWatchers(schoolId, id, req.mentions, now);

    const actorName = (await this.name(schoolId, actorId)) || "Someone";
    const who = await this.ticketWho(schoolId, id);
    await this.notifyEvent(schoolId, id, actorId, {
      key: NOTIFY.ASSIGNED,
      title: "Feedback assigned",
      body: `${actorName} assigned ${who} to ${target.name}`,
      mentionIds: req.mentions,
      extraRecipientId: req.toEmployeeId,
    });
    return this.getThread(schoolId, id);
  }

  // ── Director decisions (reviewer/god only) ───────────────────────────────────
  async complete(schoolId: string, id: string, actorId: string, note?: string): Promise<FeedbackThread | null> {
    const f = await this.findRaw(schoolId, id);
    if (!f) return null;
    if (f.status === "completed") return this.getThread(schoolId, id);
    if (f.status !== "open") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only an open ticket can be completed");
    const now = new Date();
    await this.insertEvent(schoolId, id, "complete", actorId, note?.trim() || null, { fromStatus: "open", toStatus: "completed" }, now);
    await DB.query(
      singleLineString`update feedback set status = 'completed', closed_by = $1, closed_at = $2, updatedby_userid = $1, updated_at = $2, last_activity_at = $2
        where uuid = $3 and school_id = $4`,
      [actorId, now, id, schoolId],
    );
    const who = await this.ticketWho(schoolId, id);
    await this.notifyEvent(schoolId, id, actorId, { key: NOTIFY.COMPLETED, title: "Feedback completed", body: `Feedback for ${who} was marked completed` });
    return this.getThread(schoolId, id);
  }

  async cancel(schoolId: string, id: string, actorId: string, note?: string): Promise<FeedbackThread | null> {
    const f = await this.findRaw(schoolId, id);
    if (!f) return null;
    if (f.status === "cancelled") return this.getThread(schoolId, id);
    if (f.status !== "open") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only an open ticket can be cancelled");
    const now = new Date();
    await this.insertEvent(schoolId, id, "cancel", actorId, note?.trim() || null, { fromStatus: "open", toStatus: "cancelled" }, now);
    await DB.query(
      singleLineString`update feedback set status = 'cancelled', closed_by = $1, closed_at = $2, updatedby_userid = $1, updated_at = $2, last_activity_at = $2
        where uuid = $3 and school_id = $4`,
      [actorId, now, id, schoolId],
    );
    const who = await this.ticketWho(schoolId, id);
    await this.notifyEvent(schoolId, id, actorId, { key: NOTIFY.CANCELLED, title: "Feedback cancelled", body: `Feedback for ${who} was cancelled` });
    return this.getThread(schoolId, id);
  }

  async reopen(schoolId: string, id: string, actorId: string, req: ReviewRequest): Promise<FeedbackThread | null> {
    const f = await this.findRaw(schoolId, id);
    if (!f) return null;
    if (f.status === "open") throw new BusinessErrorResult(ErrorCode.BusinessError, "This feedback is already open");
    let target = f.assignedTo;
    if (req.toEmployeeId && req.toEmployeeId !== f.assignedTo) {
      const t = await findEmployee(schoolId, req.toEmployeeId);
      if (!t) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid employee to assign");
      target = req.toEmployeeId;
    }
    const now = new Date();
    const reassigned = target !== f.assignedTo;
    await this.insertEvent(schoolId, id, "reopen", actorId, req.note?.trim() || null, {
      fromStatus: f.status, toStatus: "open",
      fromAssignee: reassigned ? f.assignedTo : undefined,
      toAssignee: reassigned ? target : undefined,
    }, now);
    await DB.query(
      singleLineString`update feedback set status = 'open', assigned_to = $1, closed_by = null, closed_at = null,
          updatedby_userid = $2, updated_at = $3, last_activity_at = $3
        where uuid = $4 and school_id = $5`,
      [target, actorId, now, id, schoolId],
    );
    await this.addWatcher(schoolId, id, target, now);
    const who = await this.ticketWho(schoolId, id);
    await this.notifyEvent(schoolId, id, actorId, { key: NOTIFY.REOPENED, title: "Feedback reopened", body: `Feedback for ${who} was reopened`, extraRecipientId: target });
    return this.getThread(schoolId, id);
  }

  // ── Mark seen (unread tracking) ──────────────────────────────────────────────
  // Updates an existing watcher's last_seen_at. Non-watchers viewing a ticket are not
  // silently subscribed (so opening a ticket never floods you with its future activity).
  async markSeen(schoolId: string, id: string, employeeId: string): Promise<{ ok: true }> {
    await DB.query(
      singleLineString`update feedback_watcher set last_seen_at = $1 where feedback_id = $2 and employee_id = $3 and school_id = $4`,
      [new Date(), id, employeeId, schoolId],
    );
    return { ok: true };
  }

  async setMuted(schoolId: string, id: string, employeeId: string, muted: boolean): Promise<{ ok: true }> {
    await DB.query(
      singleLineString`update feedback_watcher set muted = $1 where feedback_id = $2 and employee_id = $3 and school_id = $4`,
      [muted, id, employeeId, schoolId],
    );
    return { ok: true };
  }

  // ── Queries ──────────────────────────────────────────────────────────────────
  private headerSelect(callerId: string | null): { sql: string; leadParams: any[] } {
    // $1 is always school_id; if a caller is given it occupies $2 (for the unread join).
    const watcherJoin = callerId
      ? `left join feedback_watcher w on w.feedback_id = f.uuid and w.employee_id = $2`
      : `left join feedback_watcher w on w.feedback_id = f.uuid and w.employee_id = ''`;
    const unread = `(w.employee_id is not null and f.last_activity_at is not null
        and (w.last_seen_at is null or f.last_activity_at > w.last_seen_at)) as unread`;
    const sql = singleLineString`select f.uuid, f.academic_year_id, f.student_id, s.name as student_name, s.admission_number,
        f.class_id,
        coalesce(c.name, (select cl.name from student_class scc join class cl on cl.uuid = scc.class_id and cl.school_id = scc.school_id
          where scc.student_id = f.student_id and scc.academic_year_id = f.academic_year_id and scc.school_id = f.school_id
          order by cl.seq nulls last limit 1)) as class_name,
        f.category_id, cat.name as category_name,
        f.feedback_text, f.visit_date::text as visit_date, f.assigned_to, ae.name as assigned_to_name,
        f.recorded_by, re.name as recorded_by_name, f.status, f.closed_by, ce.name as closed_by_name,
        f.closed_at::text as closed_at, f.last_activity_at::text as last_activity_at, f.created_at::text as created_at,
        ${unread}
      from feedback f
      left join student s on s.uuid = f.student_id and s.school_id = f.school_id
      left join class c on c.uuid = f.class_id and c.school_id = f.school_id
      left join feedback_category cat on cat.uuid = f.category_id and cat.school_id = f.school_id
      left join employee ae on ae.uuid = f.assigned_to and ae.school_id = f.school_id
      left join employee re on re.uuid = f.recorded_by and re.school_id = f.school_id
      left join employee ce on ce.uuid = f.closed_by and ce.school_id = f.school_id
      ${watcherJoin}`;
    return { sql, leadParams: callerId ? [callerId] : [] };
  }

  // Director/office list. `owner: 'director' | 'teachers'` filters by whether the current
  // owner holds a reviewer role. `callerId` drives the per-caller unread flag.
  async listFeedback(
    schoolId: string,
    filters: { status?: string; assignedTo?: string; recordedBy?: string; categoryId?: string; academicYearId?: string; owner?: string; sort?: string; callerId?: string },
  ): Promise<FeedbackView[]> {
    const callerId = filters.callerId || null;
    const { sql, leadParams } = this.headerSelect(callerId);
    const params: any[] = [schoolId, ...leadParams];
    const conds: string[] = ["f.school_id = $1"];
    if (filters.status) { params.push(filters.status); conds.push(`f.status = $${params.length}`); }
    if (filters.assignedTo) { params.push(filters.assignedTo); conds.push(`f.assigned_to = $${params.length}`); }
    if (filters.recordedBy) { params.push(filters.recordedBy); conds.push(`f.recorded_by = $${params.length}`); }
    if (filters.categoryId) { params.push(filters.categoryId); conds.push(`f.category_id = $${params.length}`); }
    if (filters.academicYearId) { params.push(filters.academicYearId); conds.push(`f.academic_year_id = $${params.length}`); }

    if (filters.owner === "director" || filters.owner === "teachers") {
      const reviewers = await reviewerEmployeeIds(schoolId);
      if (filters.owner === "director") {
        if (!reviewers.length) return [];
        params.push(reviewers); conds.push(`f.assigned_to = any($${params.length})`);
      } else if (reviewers.length) {
        params.push(reviewers); conds.push(`f.assigned_to <> all($${params.length})`);
      }
    }
    const order = filters.sort === "newest"
      ? "order by f.last_activity_at desc nulls last, f.created_at desc"
      : filters.sort === "activity"
        ? "order by f.last_activity_at desc nulls last"
        : "order by f.visit_date asc nulls last, f.created_at asc"; // oldest (default)
    const rows = await DB.query(`${sql} where ${conds.join(" and ")} ${order}`, params);
    const reviewerSet = new Set(await reviewerEmployeeIds(schoolId));
    return rows.map((r: any) => this.toView(r, reviewerSet));
  }

  // Teacher /me list. tab: 'act' (I own it, open) | 'watching' (I watch it, not owner) |
  // 'recorded' (I recorded it).
  async listForEmployee(schoolId: string, employeeId: string, tab: string, status?: string): Promise<FeedbackView[]> {
    const { sql } = this.headerSelect(employeeId);
    const params: any[] = [schoolId, employeeId];
    const conds: string[] = ["f.school_id = $1"];
    let order = "order by f.last_activity_at desc nulls last, f.created_at desc";
    if (tab === "watching") {
      conds.push(`exists(select 1 from feedback_watcher wx where wx.feedback_id = f.uuid and wx.employee_id = $2)`);
      conds.push(`f.assigned_to <> $2`);
    } else if (tab === "recorded") {
      conds.push(`f.recorded_by = $2`);
    } else {
      // default: 'act'
      conds.push(`f.assigned_to = $2`);
      conds.push(`f.status = 'open'`);
      order = "order by f.last_activity_at asc nulls last, f.created_at asc"; // oldest waiting first
    }
    if (status) { params.push(status); conds.push(`f.status = $${params.length}`); }
    const rows = await DB.query(`${sql} where ${conds.join(" and ")} ${order}`, params);
    const reviewerSet = new Set(await reviewerEmployeeIds(schoolId));
    return rows.map((r: any) => this.toView(r, reviewerSet));
  }

  private toView(r: any, reviewerSet: Set<string>): FeedbackView {
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
      awaitingDirector: r.status === "open" && reviewerSet.has(r.assignedTo),
      recordedBy: r.recordedBy || null,
      recordedByName: r.recordedByName || null,
      status: r.status,
      closedBy: r.closedBy || null,
      closedByName: r.closedByName || null,
      closedAt: r.closedAt || null,
      lastActivityAt: r.lastActivityAt || null,
      createdAt: r.createdAt || null,
      unread: !!r.unread,
    };
  }

  async getHeader(schoolId: string, id: string, callerId?: string): Promise<FeedbackView | null> {
    const { sql } = this.headerSelect(callerId || null);
    const params = callerId ? [schoolId, callerId, id] : [schoolId, id];
    const rows = await DB.query(`${sql} where f.school_id = $1 and f.uuid = $${params.length}`, params);
    if (!rows.length) return null;
    const reviewerSet = new Set(await reviewerEmployeeIds(schoolId));
    return this.toView(rows[0], reviewerSet);
  }

  // Full ticket thread: header + timeline (names/mentions/attachments resolved) + watchers.
  async getThread(schoolId: string, id: string, callerId?: string): Promise<FeedbackThread | null> {
    const header = await this.getHeader(schoolId, id, callerId);
    if (!header) return null;

    const evRows = await DB.query(
      singleLineString`select uuid, event_type, actor_id, body, from_status, to_status, from_assignee, to_assignee, mentions,
          created_at::text as created_at
        from feedback_event where school_id = $1 and feedback_id = $2 order by created_at asc, uuid asc`,
      [schoolId, id],
    );
    const eventIds = evRows.map((e: any) => e.uuid);

    // Attachments (bytes in file_storage, keyed by entity_id = event uuid).
    const filesByEvent = new Map<string, AttachmentMeta[]>();
    if (eventIds.length) {
      const files = await DB.query(
        singleLineString`select uuid, entity_id, file_name, mime_type, size_bytes from file_storage
          where entity_type = $1 and school_id = $2 and entity_id = any($3) order by created_at asc`,
        [FILE_ENTITY_TYPE, schoolId, eventIds],
      );
      for (const f of files) {
        const arr = filesByEvent.get(f.entityId) || [];
        arr.push({ fileId: f.uuid, fileName: f.fileName || null, mimeType: f.mimeType || null, sizeBytes: f.sizeBytes ?? null });
        filesByEvent.set(f.entityId, arr);
      }
    }

    // Resolve every referenced employee id to a name in one query.
    const idsToName: string[] = [];
    for (const e of evRows) {
      if (e.actorId) idsToName.push(e.actorId);
      if (e.fromAssignee) idsToName.push(e.fromAssignee);
      if (e.toAssignee) idsToName.push(e.toAssignee);
      if (Array.isArray(e.mentions)) idsToName.push(...e.mentions);
    }
    const nameMap = await employeeNames(schoolId, idsToName);

    const events: TimelineEventView[] = evRows.map((e: any) => ({
      uuid: e.uuid,
      eventType: e.eventType as FeedbackEventType,
      actorId: e.actorId || null,
      actorName: e.actorId ? nameMap.get(e.actorId) || null : null,
      body: e.body || null,
      fromStatus: e.fromStatus || null,
      toStatus: e.toStatus || null,
      fromAssignee: e.fromAssignee || null,
      fromAssigneeName: e.fromAssignee ? nameMap.get(e.fromAssignee) || null : null,
      toAssignee: e.toAssignee || null,
      toAssigneeName: e.toAssignee ? nameMap.get(e.toAssignee) || null : null,
      mentions: (Array.isArray(e.mentions) ? e.mentions : []).map((mid: string) => ({ id: mid, name: nameMap.get(mid) || null })),
      attachments: filesByEvent.get(e.uuid) || [],
      createdAt: e.createdAt || null,
    }));

    // Watchers.
    const wRows = await DB.query(
      singleLineString`select w.employee_id, e.name as employee_name, w.muted, w.last_seen_at::text as last_seen_at
        from feedback_watcher w
        left join employee e on e.uuid = w.employee_id and e.school_id = w.school_id
        where w.school_id = $1 and w.feedback_id = $2 order by w.added_at asc`,
      [schoolId, id],
    );
    const watchers: WatcherView[] = wRows.map((w: any) => ({
      employeeId: w.employeeId,
      employeeName: w.employeeName || null,
      muted: !!w.muted,
      lastSeenAt: w.lastSeenAt || null,
    }));

    return { ...header, events, watchers };
  }

  async getAttachmentFile(schoolId: string, fileId: string): Promise<{ data: string; mimeType: string; fileName: string } | null> {
    const stored = await fileStorageService.getWithData(fileId, schoolId);
    if (!stored) return null;
    // Confirm it belongs to this module (defence in depth).
    if (stored.entityType !== FILE_ENTITY_TYPE) return null;
    return { data: stored.data, mimeType: stored.mimeType, fileName: stored.fileName };
  }

  // Attachment fetch scoped to a teacher: only returns the file if the caller participates
  // in the ticket the file hangs off. Prevents a teacher pulling an arbitrary file by id.
  async getAttachmentForParticipant(schoolId: string, fileId: string, employeeId: string): Promise<{ data: string; mimeType: string; fileName: string } | null> {
    const meta = await DB.query(
      singleLineString`select entity_id from file_storage where uuid = $1 and school_id = $2 and entity_type = $3`,
      [fileId, schoolId, FILE_ENTITY_TYPE],
    );
    if (!meta.length) return null;
    const ev = await DB.query(
      singleLineString`select feedback_id from feedback_event where uuid = $1 and school_id = $2`,
      [meta[0].entityId, schoolId],
    );
    if (!ev.length) return null;
    if (!(await this.isParticipant(schoolId, ev[0].feedbackId, employeeId))) return null;
    return this.getAttachmentFile(schoolId, fileId);
  }

  async isParticipant(schoolId: string, id: string, employeeId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from feedback where uuid = $1 and school_id = $2 and (recorded_by = $3 or assigned_to = $3)
        union select 1 from feedback_watcher where feedback_id = $1 and school_id = $2 and employee_id = $3 limit 1`,
      [id, schoolId, employeeId],
    );
    return rows.length > 0;
  }

  // ── Summary (director dashboard) ─────────────────────────────────────────────
  async summary(schoolId: string, academicYearId?: string): Promise<FeedbackSummary> {
    const conds: string[] = ["f.school_id = $1"];
    const params: any[] = [schoolId];
    if (academicYearId) { params.push(academicYearId); conds.push(`f.academic_year_id = $${params.length}`); }
    const where = conds.join(" and ");
    const reviewers = new Set(await reviewerEmployeeIds(schoolId));

    const statusRows = await DB.query(`select f.status, count(1)::int as n from feedback f where ${where} group by f.status`, params);
    const byStatus = { open: 0, completed: 0, cancelled: 0 };
    for (const r of statusRows) if (r.status in byStatus) (byStatus as any)[r.status] = r.n;

    // open tickets split by owner-role.
    const openOwners = await DB.query(`select f.assigned_to, count(1)::int as n from feedback f where ${where} and f.status = 'open' group by f.assigned_to`, params);
    let awaitingDirector = 0;
    for (const r of openOwners) if (reviewers.has(r.assignedTo)) awaitingDirector += r.n;
    const outWithTeachers = byStatus.open - awaitingDirector;

    // teacher-wise breakup (non-reviewer owners).
    const teacherRows = await DB.query(
      `select f.assigned_to, e.name as employee_name, f.status, count(1)::int as n, min(f.created_at)::text as oldest
        from feedback f
        left join employee e on e.uuid = f.assigned_to and e.school_id = f.school_id
        where ${where} group by f.assigned_to, e.name, f.status`,
      params,
    );
    const map = new Map<string, TeacherBreakupRow>();
    for (const r of teacherRows) {
      if (reviewers.has(r.assignedTo)) continue; // director's own plate = awaiting-director, not a teacher row
      const key = r.assignedTo;
      if (!map.has(key)) map.set(key, { employeeId: key, employeeName: r.employeeName || null, open: 0, completed: 0, total: 0, oldestOpenAt: null });
      const row = map.get(key)!;
      const n = r.n as number;
      if (r.status === "open") { row.open += n; row.oldestOpenAt = r.oldest || row.oldestOpenAt; }
      else if (r.status === "completed") row.completed += n;
      row.total += n;
    }
    const byTeacher = Array.from(map.values());
    byTeacher.sort((a, b) => b.open - a.open || b.total - a.total);
    return { byStatus, open: byStatus.open, awaitingDirector, outWithTeachers, byTeacher };
  }

  // ── Low-level helpers ────────────────────────────────────────────────────────
  private async findRaw(schoolId: string, id: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select uuid, student_id, assigned_to, recorded_by, status from feedback where school_id = $1 and uuid = $2`,
      [schoolId, id],
    );
    return rows[0] || null;
  }

  private async insertEvent(
    schoolId: string,
    feedbackId: string,
    type: FeedbackEventType,
    actorId: string | null,
    body: string | null,
    opts: { fromStatus?: string; toStatus?: string; fromAssignee?: string; toAssignee?: string; mentions?: string[] },
    now: Date,
  ): Promise<string> {
    const uuid = generateShortUuid(12);
    const mentions = Array.isArray(opts.mentions) && opts.mentions.length
      ? JSON.stringify(Array.from(new Set(opts.mentions.filter(Boolean))))
      : null;
    await DB.query(
      singleLineString`insert into feedback_event
        (uuid, school_id, feedback_id, event_type, actor_id, body, from_status, to_status, from_assignee, to_assignee, mentions, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [uuid, schoolId, feedbackId, type, actorId, body, opts.fromStatus || null, opts.toStatus || null,
        opts.fromAssignee || null, opts.toAssignee || null, mentions, now],
    );
    return uuid;
  }

  private async bumpActivity(schoolId: string, id: string, actorId: string, now: Date): Promise<void> {
    await DB.query(
      singleLineString`update feedback set last_activity_at = $1, updatedby_userid = $2, updated_at = $1 where uuid = $3 and school_id = $4`,
      [now, actorId, id, schoolId],
    );
  }

  private async addWatcher(schoolId: string, id: string, employeeId: string, now: Date): Promise<void> {
    if (!employeeId) return;
    await DB.query(
      singleLineString`insert into feedback_watcher (uuid, school_id, feedback_id, employee_id, muted, last_seen_at, added_at)
        values ($1, $2, $3, $4, false, null, $5) on conflict (feedback_id, employee_id) do nothing`,
      [generateShortUuid(12), schoolId, id, employeeId, now],
    );
  }

  private async addMentionWatchers(schoolId: string, id: string, mentions: string[] | undefined, now: Date): Promise<void> {
    for (const m of Array.from(new Set((mentions || []).filter(Boolean)))) {
      await this.addWatcher(schoolId, id, m, now);
    }
  }

  private async uploadAttachments(schoolId: string, eventId: string, userId: string, attachments?: AttachmentInput[]): Promise<number> {
    if (!Array.isArray(attachments) || !attachments.length) return 0;
    let n = 0;
    for (const a of attachments) {
      if (!a?.base64Data || !a?.mimeType) continue;
      if (!(ATTACHMENT_ALLOWED_MIME as readonly string[]).includes(a.mimeType)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Unsupported file type. Allowed: ${ATTACHMENT_ALLOWED_MIME.join(", ")}`);
      }
      if (Buffer.byteLength(a.base64Data, "base64") > ATTACHMENT_MAX_BYTES) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `File too large (max ${Math.round(ATTACHMENT_MAX_BYTES / (1024 * 1024))} MB)`);
      }
      await fileStorageService.upload({
        fileName: a.fileName || `feedback-${eventId}-${n + 1}`,
        mimeType: a.mimeType,
        base64Data: a.base64Data,
        entityType: FILE_ENTITY_TYPE,
        entityId: eventId,
        variant: "original",
        schoolId,
        userId,
      });
      n++;
    }
    return n;
  }

  private async name(schoolId: string, employeeId: string): Promise<string | null> {
    if (!employeeId) return null;
    const m = await employeeNames(schoolId, [employeeId]);
    return m.get(employeeId) || null;
  }

  private async ticketWho(schoolId: string, id: string): Promise<string> {
    const rows = await DB.query(
      singleLineString`select s.name as student_name, c.name as class_name from feedback f
        left join student s on s.uuid = f.student_id and s.school_id = f.school_id
        left join class c on c.uuid = f.class_id and c.school_id = f.school_id
        where f.uuid = $1 and f.school_id = $2`,
      [id, schoolId],
    );
    if (!rows.length) return "a student";
    const student = rows[0].studentName || "a student";
    return rows[0].className ? `${student} · ${rows[0].className}` : student;
  }

  private async schoolCode(schoolId: string): Promise<string | null> {
    const rows = await DB.query(singleLineString`select code from school where uuid = $1`, [schoolId]);
    return rows.length ? rows[0].code : null;
  }

  private async activeWatcherIds(schoolId: string, id: string): Promise<string[]> {
    const rows = await DB.query(
      singleLineString`select employee_id from feedback_watcher where school_id = $1 and feedback_id = $2 and (muted is null or muted = false)`,
      [schoolId, id],
    );
    return rows.map((r: any) => r.employeeId).filter(Boolean);
  }

  // Fan out one in-app notification to the ticket's watchers (minus the actor and the
  // @mentioned, who get a stronger dedicated ping). Best-effort — never throws.
  private async notifyEvent(
    schoolId: string,
    id: string,
    actorId: string,
    opts: { key: string; title: string; body: string; mentionIds?: string[]; extraRecipientId?: string },
  ): Promise<void> {
    const code = await this.schoolCode(schoolId);
    if (!code) return;
    const mentionSet = new Set((opts.mentionIds || []).filter(Boolean));
    const primary = new Set(await this.activeWatcherIds(schoolId, id));
    if (opts.extraRecipientId) primary.add(opts.extraRecipientId);
    primary.delete(actorId);
    for (const m of mentionSet) primary.delete(m);
    const primaryIds = Array.from(primary);
    if (primaryIds.length) {
      await notifyInApp(code, "employee", primaryIds, opts.key, opts.title, opts.body, { entityType: NOTIFY_ENTITY_TYPE, entityId: id });
    }
    const mentionIds = Array.from(mentionSet).filter((m) => m !== actorId);
    if (mentionIds.length) {
      const actorName = (await this.name(schoolId, actorId)) || "Someone";
      const who = await this.ticketWho(schoolId, id);
      await notifyInApp(code, "employee", mentionIds, NOTIFY.MENTIONED, "You were mentioned",
        `${actorName} mentioned you on ${who}`, { entityType: NOTIFY_ENTITY_TYPE, entityId: id });
    }
  }
}

export const feedbackService = new FeedbackService();
