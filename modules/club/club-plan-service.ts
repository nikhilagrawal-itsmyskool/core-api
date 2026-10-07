import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { getCurrentAcademicYearId, findEmployee, writeAudit } from "./club-common";
import {
  Alert,
  AssignmentRequest,
  CompletionRequest,
  CreatePlanRequest,
  GroupRequest,
  PlanValidation,
  SlotRequest,
  UpdatePlanRequest,
} from "./club-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};
// Two [start,end) windows overlap when each starts before the other ends.
const overlaps = (aS: string, aE: string, bS: string, bE: string): boolean =>
  toMin(aS) < toMin(bE) && toMin(bS) < toMin(aE);

// The weekly plan board: plan -> slot -> group -> assignment -> completion. Reuses existing
// ERP class/employee masters by reference. Publish is atomic + idempotent and gated on
// server-side conflict/coverage validation.
class ClubPlanService {
  // ── Plans ─────────────────────────────────────────────────────────────────

  async listPlans(schoolId: string, q: { academicYearId?: string; from?: string; to?: string }): Promise<any[]> {
    const where: string[] = ["p.school_id = $1"];
    const params: any[] = [schoolId];
    if (q.academicYearId) { params.push(q.academicYearId); where.push(`p.academic_year_id = $${params.length}`); }
    if (q.from) { params.push(q.from); where.push(`p.plan_date >= $${params.length}`); }
    if (q.to) { params.push(q.to); where.push(`p.plan_date <= $${params.length}`); }
    return DB.query(
      `select p.uuid, p.plan_date, p.title, p.participation_scope, p.coverage, p.status, p.row_version,
              (select count(*) from club_plan_assignment a where a.plan_id = p.uuid and a.state = 'scheduled') as assignment_count
         from club_plan p
        where ${where.join(" and ")}
        order by p.plan_date desc`,
      params,
    );
  }

  async getPlan(schoolId: string, planId: string): Promise<any | null> {
    const p = await DB.query(
      singleLineString`select uuid, academic_year_id, plan_date, title, participation_scope, coverage,
          status, row_version, note, published_at, closed_at, cancel_reason
        from club_plan where uuid = $1 and school_id = $2`,
      [planId, schoolId],
    );
    if (!p.length) return null;
    const [slots, groups, assignments] = await Promise.all([
      DB.query(singleLineString`select uuid, start_time, end_time, label, seq from club_plan_slot where plan_id = $1 order by seq nulls last, start_time`, [planId]),
      DB.query(singleLineString`select uuid, source_type, source_ref, label_snapshot, strength_snapshot, seq from club_plan_group where plan_id = $1 order by seq nulls last, label_snapshot`, [planId]),
      DB.query(
        singleLineString`select a.uuid, a.slot_id, a.group_id, a.activity_version_id, a.club_id, a.teacher_employee_id,
            a.venue_ref, a.venue_name_snapshot, a.state, a.cancel_reason,
            v.title as activity_title, v.version_no as activity_version_no,
            e.name as teacher_name,
            c.outcome as completion_outcome, c.issue_type as completion_issue
          from club_plan_assignment a
          left join club_activity_version v on v.uuid = a.activity_version_id
          left join employee e on e.uuid = a.teacher_employee_id
          left join club_plan_completion c on c.assignment_id = a.uuid
          where a.plan_id = $1 order by a.created_at`,
        [planId],
      ),
    ]);
    return { ...p[0], slots, groups, assignments };
  }

  async createPlan(schoolId: string, body: CreatePlanRequest, userId: string): Promise<any> {
    if (!body.planDate || !DATE_RE.test(body.planDate)) {
      throw new BusinessErrorResult(ErrorCode.InvalidInput, "planDate (YYYY-MM-DD) is required");
    }
    const ay = body.academicYearId || (await getCurrentAcademicYearId(schoolId));
    if (!ay) throw new BusinessErrorResult(ErrorCode.BusinessError, "No current academic year");

    const dup = await DB.query(
      singleLineString`select uuid from club_plan where school_id = $1 and academic_year_id = $2 and plan_date = $3 and status <> 'cancelled'`,
      [schoolId, ay, body.planDate],
    );
    if (dup.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "A plan already exists for this date");

    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`insert into club_plan
          (uuid, school_id, academic_year_id, plan_date, title, participation_scope, coverage, status, row_version, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,'draft',1,$8,now())`,
      [
        uuid, schoolId, ay, body.planDate, body.title || null,
        body.participationScope || "whole", body.coverage || "selective", userId,
      ],
    );
    await writeAudit(schoolId, userId, "plan.create", "plan", uuid, { after: { planDate: body.planDate } });
    return this.getPlan(schoolId, uuid);
  }

  async updatePlan(schoolId: string, planId: string, body: UpdatePlanRequest, userId: string): Promise<any | null> {
    const plan = await this._plan(schoolId, planId);
    if (!plan) return null;
    this._assertRowVersion(plan, body.rowVersion);
    if (plan.status !== "draft") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a draft plan can be edited here");
    await DB.query(
      singleLineString`update club_plan set
          title = coalesce($3, title),
          participation_scope = coalesce($4, participation_scope),
          coverage = coalesce($5, coverage),
          row_version = row_version + 1, updatedby_userid = $6, updated_at = now()
        where uuid = $1 and school_id = $2`,
      [planId, schoolId, body.title ?? null, body.participationScope ?? null, body.coverage ?? null, userId],
    );
    return this.getPlan(schoolId, planId);
  }

  // ── Slots ─────────────────────────────────────────────────────────────────
  async addSlot(schoolId: string, planId: string, body: SlotRequest, _userId: string): Promise<any> {
    await this._requireDraft(schoolId, planId);
    if (!TIME_RE.test(body.startTime) || !TIME_RE.test(body.endTime)) throw new BusinessErrorResult(ErrorCode.InvalidInput, "startTime/endTime must be HH:MM");
    if (toMin(body.endTime) <= toMin(body.startTime)) throw new BusinessErrorResult(ErrorCode.InvalidInput, "endTime must be after startTime");
    await DB.query(
      singleLineString`insert into club_plan_slot (uuid, school_id, plan_id, start_time, end_time, label, seq)
        values ($1,$2,$3,$4,$5,$6,$7)`,
      [generateShortUuid(12), schoolId, planId, body.startTime, body.endTime, body.label || null, body.seq ?? null],
    );
    return this.getPlan(schoolId, planId);
  }

  async removeSlot(schoolId: string, planId: string, slotId: string): Promise<any> {
    await this._requireDraft(schoolId, planId);
    await DB.query(singleLineString`delete from club_plan_assignment where plan_id = $1 and slot_id = $2`, [planId, slotId]);
    await DB.query(singleLineString`delete from club_plan_slot where uuid = $1 and plan_id = $2`, [slotId, planId]);
    return this.getPlan(schoolId, planId);
  }

  // ── Groups ────────────────────────────────────────────────────────────────
  async addGroup(schoolId: string, planId: string, body: GroupRequest, _userId: string): Promise<any> {
    await this._requireDraft(schoolId, planId);
    if (!body.label || !body.label.trim()) throw new BusinessErrorResult(ErrorCode.InvalidInput, "label is required");
    const groupId = generateShortUuid(12);
    await DB.query(
      singleLineString`insert into club_plan_group (uuid, school_id, plan_id, source_type, source_ref, label_snapshot, strength_snapshot, seq)
        values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [groupId, schoolId, planId, body.sourceType || "class", body.sourceRef || null, body.label.trim(), body.strength ?? null, body.seq ?? null],
    );
    if (body.members?.length) {
      for (const m of body.members) {
        if (!m.studentId) continue;
        await DB.query(
          singleLineString`insert into club_plan_group_member (uuid, school_id, plan_group_id, student_id, student_name_snapshot)
            values ($1,$2,$3,$4,$5)`,
          [generateShortUuid(12), schoolId, groupId, m.studentId, m.studentName || null],
        );
      }
    }
    return this.getPlan(schoolId, planId);
  }

  async removeGroup(schoolId: string, planId: string, groupId: string): Promise<any> {
    await this._requireDraft(schoolId, planId);
    await DB.query(singleLineString`delete from club_plan_assignment where plan_id = $1 and group_id = $2`, [planId, groupId]);
    await DB.query(singleLineString`delete from club_plan_group_member where plan_group_id = $1`, [groupId]);
    await DB.query(singleLineString`delete from club_plan_group where uuid = $1 and plan_id = $2`, [groupId, planId]);
    return this.getPlan(schoolId, planId);
  }

  // Generate one group per base teaching class (scope=whole) with a strength snapshot.
  async generateGroups(schoolId: string, planId: string, _userId: string): Promise<any> {
    const plan = await this._requireDraft(schoolId, planId);
    const classes = await DB.query(
      singleLineString`select c.uuid, c.name,
          (select count(*) from student_class sc where sc.class_id = c.uuid and sc.academic_year_id = $2 and sc.status = 'active') as strength
        from class c
        where c.school_id = $1 and c.class_group_id is null and c.base_class_id is null
        order by c.name`,
      [schoolId, plan.academicYearId],
    );
    for (const c of classes) {
      const exists = await DB.query(
        singleLineString`select uuid from club_plan_group where plan_id = $1 and source_type = 'class' and source_ref = $2`,
        [planId, c.uuid],
      );
      if (exists.length) continue;
      await DB.query(
        singleLineString`insert into club_plan_group (uuid, school_id, plan_id, source_type, source_ref, label_snapshot, strength_snapshot)
          values ($1,$2,$3,'class',$4,$5,$6)`,
        [generateShortUuid(12), schoolId, planId, c.uuid, c.name, c.strength != null ? Number(c.strength) : null],
      );
    }
    return this.getPlan(schoolId, planId);
  }

  // ── Assignments ─────────────────────────────────────────────────────────────
  // Upsert (group,slot) -> activity version + teacher + venue. On a DRAFT plan this is plain
  // editing; on a PUBLISHED plan it is a controlled "change" (audited). Club is derived from
  // the activity, never contradicts it.
  async upsertAssignment(schoolId: string, planId: string, body: AssignmentRequest, userId: string): Promise<any | null> {
    const plan = await this._plan(schoolId, planId);
    if (!plan) return null;
    if (!["draft", "published"].includes(plan.status)) throw new BusinessErrorResult(ErrorCode.BusinessError, "Plan is not editable");
    if (!body.slotId || !body.groupId || !body.activityVersionId) {
      throw new BusinessErrorResult(ErrorCode.InvalidInput, "slotId, groupId and activityVersionId are required");
    }
    const ver = await DB.query(
      singleLineString`select v.uuid, v.status, a.uuid as activity_id, a.club_id, a.availability
        from club_activity_version v join club_activity a on a.uuid = v.activity_id
        where v.uuid = $1 and v.school_id = $2`,
      [body.activityVersionId, schoolId],
    );
    if (!ver.length) throw new BusinessErrorResult(ErrorCode.InvalidInput, "Activity version not found");
    if (body.teacherEmployeeId) {
      const emp = await findEmployee(schoolId, body.teacherEmployeeId);
      if (!emp) throw new BusinessErrorResult(ErrorCode.InvalidInput, "Teacher not found");
    }

    const existing = await DB.query(
      singleLineString`select uuid from club_plan_assignment where plan_id = $1 and slot_id = $2 and group_id = $3 and state = 'scheduled'`,
      [planId, body.slotId, body.groupId],
    );
    let assignmentId: string;
    if (existing.length) {
      assignmentId = existing[0].uuid;
      await DB.query(
        singleLineString`update club_plan_assignment set
            activity_version_id = $3, club_id = $4, teacher_employee_id = $5, venue_ref = $6, venue_name_snapshot = $7,
            updatedby_userid = $8, updated_at = now()
          where uuid = $1 and plan_id = $2`,
        [assignmentId, planId, body.activityVersionId, ver[0].clubId, body.teacherEmployeeId || null, body.venueRef || null, body.venueName || null, userId],
      );
    } else {
      assignmentId = generateShortUuid(12);
      await DB.query(
        singleLineString`insert into club_plan_assignment
            (uuid, school_id, plan_id, slot_id, group_id, activity_version_id, club_id, teacher_employee_id, venue_ref, venue_name_snapshot, state, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'scheduled',$11,now())`,
        [assignmentId, schoolId, planId, body.slotId, body.groupId, body.activityVersionId, ver[0].clubId, body.teacherEmployeeId || null, body.venueRef || null, body.venueName || null, userId],
      );
    }
    if (plan.status === "published") {
      await writeAudit(schoolId, userId, "plan.change", "assignment", assignmentId, { after: body });
    }
    return this.getPlan(schoolId, planId);
  }

  async cancelAssignment(schoolId: string, assignmentId: string, reason: string, userId: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`update club_plan_assignment set state = 'cancelled', cancel_reason = $2, updatedby_userid = $3, updated_at = now()
        where uuid = $1 and state = 'scheduled' returning plan_id, school_id`,
      [assignmentId, reason || null, userId],
    );
    if (!rows.length) return null;
    await writeAudit(rows[0].schoolId, userId, "assignment.cancel", "assignment", assignmentId, { reason });
    return this.getPlan(rows[0].schoolId, rows[0].planId);
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  async validate(schoolId: string, planId: string): Promise<PlanValidation> {
    const plan = await this.getPlan(schoolId, planId);
    const blockers: Alert[] = [], warnings: Alert[] = [], info: Alert[] = [];
    if (!plan) return { blockers, warnings, info, coverage: { inScope: 0, assigned: 0, unassigned: 0 }, ready: false };

    const slotById = new Map<string, any>(plan.slots.map((s: any) => [s.uuid, s]));
    const live = plan.assignments.filter((a: any) => a.state === "scheduled");

    // Activity must be Available + an Approved version (Trial allowed only in trial mode — not checked here).
    for (const a of live) {
      const v = await DB.query(
        singleLineString`select v.status, act.availability from club_activity_version v
          join club_activity act on act.uuid = v.activity_id where v.uuid = $1`,
        [a.activityVersionId],
      );
      if (!v.length || v[0].availability !== "available" || v[0].status !== "approved") {
        blockers.push({ severity: "blocker", code: "activity-unavailable", message: `Activity "${a.activityTitle || a.activityVersionId}" is not an available, approved version`, assignmentId: a.uuid, groupId: a.groupId });
      }
    }

    // Teacher / venue double-booking across overlapping slots.
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const sa = slotById.get(a.slotId), sb = slotById.get(b.slotId);
        if (!sa || !sb || !overlaps(sa.startTime, sa.endTime, sb.startTime, sb.endTime)) continue;
        if (a.teacherEmployeeId && a.teacherEmployeeId === b.teacherEmployeeId) {
          blockers.push({ severity: "blocker", code: "teacher-conflict", message: `${a.teacherName || "A teacher"} is assigned to two overlapping activities`, assignmentId: b.uuid });
        }
        if (a.venueRef && a.venueRef === b.venueRef) {
          blockers.push({ severity: "blocker", code: "venue-conflict", message: `Venue "${a.venueNameSnapshot || a.venueRef}" is double-booked in overlapping slots`, assignmentId: b.uuid });
        }
      }
    }

    // Roster-backed duplicate-student across overlapping slots (mixed/selected groups).
    const memberRows = await DB.query(
      singleLineString`select m.student_id, m.plan_group_id, m.student_name_snapshot
        from club_plan_group_member m join club_plan_group g on g.uuid = m.plan_group_id where g.plan_id = $1`,
      [planId],
    );
    if (memberRows.length) {
      const byGroup = new Map<string, Array<{ id: string; name: string }>>();
      for (const m of memberRows) {
        const arr = byGroup.get(m.planGroupId) || [];
        arr.push({ id: m.studentId, name: m.studentNameSnapshot });
        byGroup.set(m.planGroupId, arr);
      }
      for (let i = 0; i < live.length; i++) {
        for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j];
          const sa = slotById.get(a.slotId), sb = slotById.get(b.slotId);
          if (!sa || !sb || !overlaps(sa.startTime, sa.endTime, sb.startTime, sb.endTime)) continue;
          const as = new Set((byGroup.get(a.groupId) || []).map((x) => x.id));
          const dupe = (byGroup.get(b.groupId) || []).find((x) => as.has(x.id));
          if (dupe) blockers.push({ severity: "blocker", code: "student-conflict", message: `${dupe.name || "A student"} is in two overlapping activities`, assignmentId: b.uuid });
        }
      }
    }

    // Coverage: in Complete mode every group must have a scheduled assignment per slot.
    const totalGroups = plan.groups.length;
    const assignedGroupIds = new Set(live.map((a: any) => a.groupId));
    const coverage = { inScope: totalGroups, assigned: assignedGroupIds.size, unassigned: Math.max(0, totalGroups - assignedGroupIds.size) };
    if (plan.coverage === "complete") {
      for (const g of plan.groups) {
        if (!assignedGroupIds.has(g.uuid)) {
          blockers.push({ severity: "blocker", code: "unassigned-group", message: `Group "${g.labelSnapshot}" has no activity`, groupId: g.uuid });
        }
      }
    }

    if (!plan.slots.length) warnings.push({ severity: "warning", code: "no-slots", message: "The plan has no time slots yet" });
    return { blockers, warnings, info, coverage, ready: blockers.length === 0 };
  }

  // ── Publish / lifecycle ───────────────────────────────────────────────────────
  // Atomic + idempotent: re-publishing a published plan is a no-op (no dup). Blocked unless
  // validation passes. Notifications are the caller's concern (fire-after-commit).
  async publish(schoolId: string, planId: string, rowVersion: number | undefined, userId: string): Promise<any> {
    const plan = await this._plan(schoolId, planId);
    if (!plan) throw new BusinessErrorResult(ErrorCode.InvalidId, "Plan not found");
    if (plan.status === "published") return this.getPlan(schoolId, planId); // idempotent
    if (plan.status !== "draft") throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot publish a ${plan.status} plan`);
    if (rowVersion != null) this._assertRowVersion(plan, rowVersion);

    const v = await this.validate(schoolId, planId);
    if (!v.ready) {
      const e: any = new BusinessErrorResult(ErrorCode.BusinessError, `Cannot publish: ${v.blockers.length} blocker(s) must be resolved`);
      e.blockers = v.blockers;
      throw e;
    }
    const rows = await DB.query(
      singleLineString`update club_plan set status = 'published', published_at = now(), publishedby_userid = $3,
          row_version = row_version + 1, updated_at = now()
        where uuid = $1 and school_id = $2 and status = 'draft' returning uuid`,
      [planId, schoolId, userId],
    );
    if (!rows.length) return this.getPlan(schoolId, planId); // lost race -> already published
    await writeAudit(schoolId, userId, "plan.publish", "plan", planId, { after: { status: "published" } });
    return this.getPlan(schoolId, planId);
  }

  async close(schoolId: string, planId: string, userId: string): Promise<any> {
    const plan = await this._plan(schoolId, planId);
    if (!plan) throw new BusinessErrorResult(ErrorCode.InvalidId, "Plan not found");
    if (plan.status === "closed") return this.getPlan(schoolId, planId);
    if (plan.status !== "published") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a published plan can be closed");
    const open = await DB.query(
      singleLineString`select a.uuid from club_plan_assignment a
        left join club_plan_completion c on c.assignment_id = a.uuid
        where a.plan_id = $1 and a.state = 'scheduled' and c.uuid is null`,
      [planId],
    );
    if (open.length) throw new BusinessErrorResult(ErrorCode.BusinessError, `${open.length} assignment(s) still need a closure outcome`);
    await DB.query(
      singleLineString`update club_plan set status = 'closed', closed_at = now(), closedby_userid = $3, row_version = row_version + 1, updated_at = now()
        where uuid = $1 and school_id = $2`,
      [planId, schoolId, userId],
    );
    await writeAudit(schoolId, userId, "plan.close", "plan", planId, {});
    return this.getPlan(schoolId, planId);
  }

  async reopen(schoolId: string, planId: string, userId: string): Promise<any> {
    const plan = await this._plan(schoolId, planId);
    if (!plan) throw new BusinessErrorResult(ErrorCode.InvalidId, "Plan not found");
    if (plan.status !== "closed") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a closed plan can be reopened");
    await DB.query(
      singleLineString`update club_plan set status = 'published', closed_at = null, closedby_userid = null, row_version = row_version + 1, updated_at = now()
        where uuid = $1 and school_id = $2`,
      [planId, schoolId],
    );
    await writeAudit(schoolId, userId, "plan.reopen", "plan", planId, {});
    return this.getPlan(schoolId, planId);
  }

  async cancelPlan(schoolId: string, planId: string, reason: string, userId: string): Promise<any> {
    const plan = await this._plan(schoolId, planId);
    if (!plan) throw new BusinessErrorResult(ErrorCode.InvalidId, "Plan not found");
    await DB.query(
      singleLineString`update club_plan set status = 'cancelled', cancel_reason = $3, row_version = row_version + 1, updated_at = now()
        where uuid = $1 and school_id = $2`,
      [planId, schoolId, reason || null],
    );
    await writeAudit(schoolId, userId, "plan.cancel", "plan", planId, { reason });
    return this.getPlan(schoolId, planId);
  }

  // ── Completion (used by admin close-on-behalf and the teacher /me surface) ──────
  async upsertCompletion(schoolId: string, assignmentId: string, body: CompletionRequest, userId: string): Promise<any> {
    const a = await DB.query(
      singleLineString`select uuid, plan_id, activity_version_id from club_plan_assignment where uuid = $1 and school_id = $2 and state = 'scheduled'`,
      [assignmentId, schoolId],
    );
    if (!a.length) throw new BusinessErrorResult(ErrorCode.InvalidId, "Assignment not found or cancelled");
    if (!body.outcome || !["fully", "partly", "not"].includes(body.outcome)) {
      throw new BusinessErrorResult(ErrorCode.InvalidInput, "outcome (fully/partly/not) is required");
    }
    if (body.outcome === "not" && !(body.notConductedReason && body.notConductedReason.trim())) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "A reason is required when the activity was not conducted");
    }
    const planId = a[0].planId;
    const existing = await DB.query(singleLineString`select uuid from club_plan_completion where assignment_id = $1`, [assignmentId]);
    const common: any[] = [
      body.outcome, body.participationAsPlanned ?? null, body.participationActual ?? null,
      body.issueType || "none", body.qualitySignal || null, body.notConductedReason || null, body.note || null, userId,
    ];
    if (existing.length) {
      await DB.query(
        singleLineString`update club_plan_completion set outcome=$2, participation_as_planned=$3, participation_actual=$4,
            issue_type=$5, quality_signal=$6, not_conducted_reason=$7, note=$8, updatedby_userid=$9, updated_at=now()
          where assignment_id=$1`,
        [assignmentId, ...common],
      );
    } else {
      await DB.query(
        singleLineString`insert into club_plan_completion
            (uuid, school_id, assignment_id, plan_id, outcome, participation_as_planned, participation_actual,
             issue_type, quality_signal, not_conducted_reason, note, closedby_userid, closed_at, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now(),$12,now())`,
        [generateShortUuid(12), schoolId, assignmentId, planId, ...common],
      );
    }
    // Safety issue or "needs review" opens an activity review (blueprint §22/§23).
    if (body.issueType === "safety" || body.qualitySignal === "needs-review") {
      await this._openReview(schoolId, a[0].activityVersionId, assignmentId, body.issueType === "safety" ? "safety" : "needs-review", userId);
    }
    return { ok: true };
  }

  // ── Teacher /me conduct surface ────────────────────────────────────────────────
  // A teacher's own assignments on a given date (published plans only), guide-ready.
  async myAssignments(schoolId: string, employeeId: string, date: string): Promise<any[]> {
    return DB.query(
      singleLineString`select a.uuid, a.slot_id, a.venue_name_snapshot, a.venue_ref,
          p.plan_date, p.uuid as plan_id,
          s.start_time, s.end_time, s.label as slot_label,
          g.label_snapshot as group_label,
          v.title as activity_title, cl.name as club_name,
          c.outcome as completion_outcome
        from club_plan_assignment a
        join club_plan p on p.uuid = a.plan_id
        left join club_plan_slot s on s.uuid = a.slot_id
        left join club_plan_group g on g.uuid = a.group_id
        left join club_activity_version v on v.uuid = a.activity_version_id
        left join club cl on cl.uuid = a.club_id
        left join club_plan_completion c on c.assignment_id = a.uuid
        where a.school_id = $1 and a.teacher_employee_id = $2 and a.state = 'scheduled'
          and p.status in ('published','closed') and p.plan_date = $3
        order by s.start_time nulls last`,
      [schoolId, employeeId, date],
    );
  }

  // The conduct guide for a teacher's own assignment (ownership enforced).
  async myGuide(schoolId: string, employeeId: string, assignmentId: string): Promise<any | null> {
    const a = await DB.query(
      singleLineString`select a.uuid, a.activity_version_id, a.venue_name_snapshot,
          g.label_snapshot as group_label, s.start_time, s.end_time, cl.name as club_name
        from club_plan_assignment a
        left join club_plan_group g on g.uuid = a.group_id
        left join club_plan_slot s on s.uuid = a.slot_id
        left join club cl on cl.uuid = a.club_id
        where a.uuid = $1 and a.school_id = $2 and a.teacher_employee_id = $3 and a.state = 'scheduled'`,
      [assignmentId, schoolId, employeeId],
    );
    if (!a.length) return null;
    const v = await DB.query(
      singleLineString`select title, grade_level, category, activity_mode, est_duration, learning_outcome,
          teacher_preparation, procedure, risk_safety, safety_level, assessment_checklist,
          materials_summary, material_quantity_plan, evidence_note, support_enrichment, cleanup_storage
        from club_activity_version where uuid = $1`,
      [a[0].activityVersionId],
    );
    const materials = await DB.query(
      singleLineString`select item, quantity_note, provided_by from club_activity_material where version_id = $1 order by seq nulls last, item`,
      [a[0].activityVersionId],
    );
    return { assignment: a[0], version: v[0] || null, materials };
  }

  // Teacher closes their OWN assignment (ownership enforced), then delegates to upsertCompletion.
  async completeOwn(schoolId: string, employeeId: string, assignmentId: string, body: CompletionRequest, userId: string): Promise<any> {
    const a = await DB.query(
      singleLineString`select uuid from club_plan_assignment where uuid = $1 and school_id = $2 and teacher_employee_id = $3 and state = 'scheduled'`,
      [assignmentId, schoolId, employeeId],
    );
    if (!a.length) throw new BusinessErrorResult(ErrorCode.InvalidId, "Not your assignment, or it was cancelled");
    return this.upsertCompletion(schoolId, assignmentId, body, userId);
  }

  // ── private ─────────────────────────────────────────────────────────────────
  private async _plan(schoolId: string, planId: string): Promise<any | null> {
    const r = await DB.query(
      singleLineString`select uuid, academic_year_id, status, row_version from club_plan where uuid = $1 and school_id = $2`,
      [planId, schoolId],
    );
    return r.length ? r[0] : null;
  }
  private async _requireDraft(schoolId: string, planId: string): Promise<any> {
    const p = await this._plan(schoolId, planId);
    if (!p) throw new BusinessErrorResult(ErrorCode.InvalidId, "Plan not found");
    if (p.status !== "draft") throw new BusinessErrorResult(ErrorCode.BusinessError, "Only a draft plan can be edited");
    return p;
  }
  private _assertRowVersion(plan: any, rowVersion: number): void {
    if (rowVersion != null && Number(plan.rowVersion) !== Number(rowVersion)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "This plan was changed by someone else — reload and try again");
    }
  }
  private async _openReview(schoolId: string, activityVersionId: string, sourceRef: string, signal: string, userId: string): Promise<void> {
    const v = await DB.query(singleLineString`select activity_id from club_activity_version where uuid = $1`, [activityVersionId]);
    if (!v.length) return;
    await DB.query(
      singleLineString`insert into club_activity_review
          (uuid, school_id, activity_id, version_id, signal, source, source_ref, status, raisedby_userid, raised_at)
        values ($1,$2,$3,$4,$5,'completion',$6,'open',$7,now())`,
      [generateShortUuid(12), schoolId, v[0].activityId, activityVersionId, signal, sourceRef, userId],
    );
  }
}

export const clubPlanService = new ClubPlanService();
