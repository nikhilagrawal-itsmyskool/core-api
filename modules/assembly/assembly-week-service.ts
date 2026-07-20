import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblyWeek, AssemblyWeekDetail, WeekSummary, RosterSlot, RosterDayView,
  SaveRosterRequest, SaveRosterDayInput, AssemblyNodeDetail,
} from './assembly-interfaces';
import { WEEKDAY_VALUES, Weekday, WeekStatus } from './assembly-constants';
import { isValidDate, findEmployee, resolveStudentInfo } from './assembly-common';
import { assemblyHouseService } from './assembly-house-service';
import { assemblyNodeService } from './assembly-node-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const mondayOf = (s: string) => { const d = parse(s); const dow = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow)); return iso(d); };

const DOW: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const weekdayOf = (dateStr: string): Weekday => DOW[parse(dateStr).getUTCDay()];
// The date of a weekday within a Monday-anchored week (mon..sun order).
const dateInWeek = (weekStart: string, wd: Weekday) => addDays(weekStart, WEEKDAY_VALUES.indexOf(wd));

// The submission deadline: 14:00 on the Wednesday of the week immediately before
// (Monday - 5 days). NOTE: stored/compared as UTC 14:00; refine to school-local
// time when the reminder/notify scheduler (deferred) lands.
const deadlineFor = (weekStart: string) => new Date(`${addDays(weekStart, -5)}T14:00:00Z`);

const WEEK_COLS = singleLineString`
  uuid, plan_id, academic_year_id, week_start::text as week_start, house_id, house_name,
  status, locked, late_unlocked, deadline_at, submittedby_userid, submitted_at,
  approvedby_userid, approved_at
`;

class AssemblyWeekService {
  // ── Week lifecycle ───────────────────────────────────────────────────────────

  // Ensure a draft roster week exists for (plan, week). Idempotent — returns the
  // existing week untouched if present. Snapshots the house-on-duty + deadline.
  public async ensureWeek(planId: string, weekStartInput: string, schoolId: string, userId: string): Promise<AssemblyWeekDetail> {
    if (!isValidDate(weekStartInput)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid week date (yyyy-mm-dd) is required');
    const plan = await this.planRow(planId, schoolId);
    const weekStart = mondayOf(weekStartInput);

    const existing = await DB.query(singleLineString`select uuid from assembly_week where plan_id = $1 and week_start = $2`, [planId, weekStart]);
    if (existing.length > 0) return (await this.getWeek(existing[0].uuid, schoolId))!;

    const house = await assemblyHouseService.houseForWeek(planId, schoolId, weekStart);
    const now = new Date();
    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`
        insert into assembly_week
        (uuid, school_id, plan_id, academic_year_id, week_start, house_id, house_name, status, locked, late_unlocked, deadline_at, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,'draft',false,false,$8,$9,$10)
      `,
      [uuid, schoolId, planId, plan.academicYearId, weekStart, house?.houseId ?? null, house?.houseName ?? null, deadlineFor(weekStart), userId, now],
    );
    return (await this.getWeek(uuid, schoolId))!;
  }

  public async getWeek(weekId: string, schoolId: string): Promise<AssemblyWeekDetail | null> {
    const rows = await DB.query(singleLineString`select ${WEEK_COLS} from assembly_week where uuid = $1 and school_id = $2`, [weekId, schoolId]);
    if (rows.length === 0) return null;
    const week = this.toWeek(rows[0]);

    const planDays = await this.planDays(week.planId, schoolId);
    const dates = WEEKDAY_VALUES.filter(wd => planDays.includes(wd)).map(wd => ({ wd, date: dateInWeek(week.weekStart, wd) }));

    // Saved day headers + entries, keyed for merge.
    const dayRows = await DB.query(singleLineString`select entry_date::text as entry_date, anchor1_student_id, anchor1_name, anchor1_class, anchor2_student_id, anchor2_name, anchor2_class, day_owner_employee_id, day_owner_name from assembly_roster_day where week_id = $1`, [weekId]);
    const daysByDate = new Map<string, any>();
    for (const r of dayRows) daysByDate.set(r.entryDate, r);
    const entryRows = await DB.query(singleLineString`select entry_date::text as entry_date, node_id, opted, content, student_id, student_name, student_class, owner_employee_id, owner_name from assembly_roster_entry where week_id = $1`, [weekId]);
    const entriesByKey = new Map<string, any>();
    for (const r of entryRows) entriesByKey.set(`${r.entryDate}|${r.nodeId}`, r);

    const days: RosterDayView[] = [];
    for (const { wd, date } of dates) {
      const slots = (await this.fillableSlots(week.planId, schoolId, wd)).map(s => {
        const e = entriesByKey.get(`${date}|${s.nodeId}`);
        return {
          ...s,
          opted: e ? e.opted !== false : true,
          content: e?.content || undefined,
          studentId: e?.studentId || undefined,
          studentName: e?.studentName || undefined,
          studentClass: e?.studentClass || undefined,
          ownerEmployeeId: e?.ownerEmployeeId || undefined,
          ownerName: e?.ownerName || undefined,
        } as RosterSlot;
      });
      const d = daysByDate.get(date);
      days.push({
        date, weekday: wd,
        anchor1StudentId: d?.anchor1StudentId || undefined, anchor1Name: d?.anchor1Name || undefined, anchor1Class: d?.anchor1Class || undefined,
        anchor2StudentId: d?.anchor2StudentId || undefined, anchor2Name: d?.anchor2Name || undefined, anchor2Class: d?.anchor2Class || undefined,
        dayOwnerEmployeeId: d?.dayOwnerEmployeeId || undefined, dayOwnerName: d?.dayOwnerName || undefined,
        slots,
      });
    }
    return { ...week, days };
  }

  public async listWeeks(planId: string, schoolId: string, from: string, to: string): Promise<WeekSummary[]> {
    await this.planRow(planId, schoolId);
    const fromWk = mondayOf(from); const toWk = mondayOf(to);
    const rows = await DB.query(
      singleLineString`select ${WEEK_COLS} from assembly_week where plan_id = $1 and school_id = $2 and week_start >= $3 and week_start <= $4 order by week_start`,
      [planId, schoolId, fromWk, toWk],
    );
    return rows.map((r: any) => {
      const w = this.toWeek(r);
      return { uuid: w.uuid, planId: w.planId, weekStart: w.weekStart, houseId: w.houseId, houseName: w.houseName, status: w.status, locked: w.locked, editable: w.editable, pastDeadline: w.pastDeadline, deadlineAt: w.deadlineAt };
    });
  }

  // ── Roster editing (bulk, replace-per-kind) ──────────────────────────────────

  public async saveRoster(weekId: string, data: SaveRosterRequest, schoolId: string, userId: string): Promise<AssemblyWeekDetail | null> {
    const rows = await DB.query(singleLineString`select ${WEEK_COLS} from assembly_week where uuid = $1 and school_id = $2`, [weekId, schoolId]);
    if (rows.length === 0) return null;
    const week = this.toWeek(rows[0]);
    if (!week.editable) throw new BusinessErrorResult(ErrorCode.BusinessError, this.notEditableReason(week));

    const planDays = await this.planDays(week.planId, schoolId);
    const validDates = new Set(WEEKDAY_VALUES.filter(wd => planDays.includes(wd)).map(wd => dateInWeek(week.weekStart, wd)));
    // Fillable node ids per weekday, to validate entries target real roster slots.
    const fillableByDate = new Map<string, Set<string>>();
    for (const date of validDates) {
      const slots = await this.fillableSlots(week.planId, schoolId, weekdayOf(date));
      fillableByDate.set(date, new Set(slots.map(s => s.nodeId)));
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    if (Array.isArray(data.days)) {
      queries.push(singleLineString`delete from assembly_roster_day where week_id = $1`); params.push([weekId]);
      for (const day of data.days) {
        if (!validDates.has(day.date)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Date ${day.date} is not an assembly day of this week`);
        const a1 = await this.student(schoolId, day.anchor1StudentId, week.academicYearId);
        const a2 = await this.student(schoolId, day.anchor2StudentId, week.academicYearId);
        const owner = await this.employee(schoolId, day.dayOwnerEmployeeId);
        if (this.dayEmpty(day, a1, a2, owner)) continue;
        queries.push(singleLineString`insert into assembly_roster_day (uuid, school_id, week_id, entry_date, anchor1_student_id, anchor1_name, anchor1_class, anchor2_student_id, anchor2_name, anchor2_class, day_owner_employee_id, day_owner_name, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`);
        params.push([generateShortUuid(12), schoolId, weekId, day.date, a1?.id ?? null, a1?.name ?? null, a1?.className ?? null, a2?.id ?? null, a2?.name ?? null, a2?.className ?? null, owner?.id ?? null, owner?.name ?? null, userId, now]);
      }
    }

    if (Array.isArray(data.entries)) {
      queries.push(singleLineString`delete from assembly_roster_entry where week_id = $1`); params.push([weekId]);
      for (const e of data.entries) {
        if (!validDates.has(e.date)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Date ${e.date} is not an assembly day of this week`);
        if (!fillableByDate.get(e.date)!.has(e.nodeId)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Node ${e.nodeId} is not a roster slot on ${e.date}`);
        const speaker = await this.student(schoolId, e.studentId, week.academicYearId);
        const owner = await this.employee(schoolId, e.ownerEmployeeId);
        const content = (e.content ?? '').toString().trim() || null;
        const opted = e.opted === undefined ? true : !!e.opted;
        if (this.entryEmpty(opted, content, speaker, owner)) continue;
        queries.push(singleLineString`insert into assembly_roster_entry (uuid, school_id, week_id, entry_date, node_id, opted, content, student_id, student_name, student_class, owner_employee_id, owner_name, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`);
        params.push([generateShortUuid(12), schoolId, weekId, e.date, e.nodeId, opted, content, speaker?.id ?? null, speaker?.name ?? null, speaker?.className ?? null, owner?.id ?? null, owner?.name ?? null, userId, now]);
      }
    }

    if (queries.length) {
      queries.push(singleLineString`update assembly_week set updatedby_userid = $1, updated_at = $2 where uuid = $3`);
      params.push([userId, now, weekId]);
      await DB.queriesInTransaction(queries, params);
    }
    return this.getWeek(weekId, schoolId);
  }

  // ── Workflow: submit / approve / unlock ──────────────────────────────────────

  public async submit(weekId: string, schoolId: string, userId: string): Promise<AssemblyWeekDetail | null> {
    const week = await this.weekOr404(weekId, schoolId); if (!week) return null;
    if (week.status === 'approved' || week.locked) throw new BusinessErrorResult(ErrorCode.BusinessError, 'An approved/locked roster cannot be resubmitted');
    if (!week.editable) throw new BusinessErrorResult(ErrorCode.BusinessError, this.notEditableReason(week));
    const now = new Date();
    await DB.query(singleLineString`update assembly_week set status = 'submitted', submittedby_userid = $1, submitted_at = $2, updatedby_userid = $1, updated_at = $2 where uuid = $3`, [userId, now, weekId]);
    return this.getWeek(weekId, schoolId);
  }

  public async approve(weekId: string, schoolId: string, userId: string): Promise<AssemblyWeekDetail | null> {
    const week = await this.weekOr404(weekId, schoolId); if (!week) return null;
    if (week.status === 'approved' || week.locked) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Roster is already approved');
    const now = new Date();
    await DB.query(singleLineString`update assembly_week set status = 'approved', locked = true, approvedby_userid = $1, approved_at = $2, updatedby_userid = $1, updated_at = $2 where uuid = $3`, [userId, now, weekId]);
    return this.getWeek(weekId, schoolId);
  }

  // Re-open a locked (approved) or past-deadline week for late edits. Recorded.
  public async unlock(weekId: string, reason: string | undefined, schoolId: string, userId: string): Promise<AssemblyWeekDetail | null> {
    const week = await this.weekOr404(weekId, schoolId); if (!week) return null;
    if (!week.locked && !week.pastDeadline) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Week is already open for editing');
    const now = new Date();
    await DB.queriesInTransaction(
      [
        singleLineString`update assembly_week set status = 'draft', locked = false, late_unlocked = true, updatedby_userid = $1, updated_at = $2 where uuid = $3`,
        singleLineString`insert into assembly_week_unlock (uuid, school_id, week_id, reason, unlockedby_userid, unlocked_at) values ($1,$2,$3,$4,$5,$6)`,
      ],
      [
        [userId, now, weekId],
        [generateShortUuid(12), schoolId, weekId, reason?.trim() || null, userId, now],
      ],
    );
    return this.getWeek(weekId, schoolId);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  private async weekOr404(weekId: string, schoolId: string): Promise<AssemblyWeek | null> {
    const rows = await DB.query(singleLineString`select ${WEEK_COLS} from assembly_week where uuid = $1 and school_id = $2`, [weekId, schoolId]);
    return rows.length === 0 ? null : this.toWeek(rows[0]);
  }

  private toWeek(r: any): AssemblyWeek {
    const status = r.status as WeekStatus;
    const locked = !!r.locked;
    const lateUnlocked = !!r.lateUnlocked;
    const deadline: Date | null = r.deadlineAt ? new Date(r.deadlineAt) : null;
    const now = new Date();
    const pastDeadline = !!deadline && now.getTime() > deadline.getTime();
    const editable = !locked && status !== 'approved' && (!pastDeadline || lateUnlocked);
    return {
      uuid: r.uuid, planId: r.planId, academicYearId: r.academicYearId, weekStart: r.weekStart,
      houseId: r.houseId || undefined, houseName: r.houseName || undefined,
      status, locked, lateUnlocked,
      deadlineAt: deadline ? deadline.toISOString() : undefined, pastDeadline, editable,
      submittedbyUserid: r.submittedbyUserid || undefined, submittedAt: r.submittedAt ? new Date(r.submittedAt).toISOString() : undefined,
      approvedbyUserid: r.approvedbyUserid || undefined, approvedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : undefined,
    };
  }

  private notEditableReason(week: AssemblyWeek): string {
    if (week.locked || week.status === 'approved') return 'Roster is approved/locked; ask an assembly-incharge to unlock it';
    if (week.pastDeadline) return 'The submission deadline has passed; ask an assembly-incharge to unlock this week';
    return 'Roster is not editable';
  }

  private async planRow(planId: string, schoolId: string): Promise<{ academicYearId: string }> {
    const rows = await DB.query(singleLineString`select academic_year_id from assembly_plan where uuid = $1 and school_id = $2 and status = 'active'`, [planId, schoolId]);
    if (rows.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid plan id');
    return { academicYearId: rows[0].academicYearId };
  }

  private async planDays(planId: string, schoolId: string): Promise<Weekday[]> {
    const rows = await DB.query(singleLineString`select weekday from assembly_plan_day where plan_id = $1 and school_id = $2`, [planId, schoolId]);
    const set = rows.map((r: any) => r.weekday);
    return WEEKDAY_VALUES.filter(w => set.includes(w)) as Weekday[];
  }

  // The template nodes the house fills for a weekday: fill_mode='roster' or optional.
  private async fillableSlots(planId: string, schoolId: string, weekday: Weekday): Promise<RosterSlot[]> {
    const tree = await assemblyNodeService.getFilteredTree(planId, schoolId, weekday);
    const out: RosterSlot[] = [];
    const walk = (nodes: AssemblyNodeDetail[]) => {
      for (const n of nodes) {
        if (n.fillMode === 'roster' || n.isOptional === true) {
          out.push({
            nodeId: n.uuid, title: n.title, depth: n.depth, parentId: n.parentId || undefined,
            fillMode: n.fillMode, isOptional: n.isOptional === true, options: n.options || [],
            opted: true,
          });
        }
        if (n.children && n.children.length) walk(n.children);
      }
    };
    walk(tree);
    return out;
  }

  private async student(schoolId: string, studentId: string | null | undefined, ay: string): Promise<{ id: string; name?: string; className?: string } | null> {
    if (!studentId) return null;
    const info = await resolveStudentInfo(schoolId, studentId, ay);
    if (!info) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid student id: ${studentId}`);
    return { id: studentId, name: info.name, className: info.className };
  }

  private async employee(schoolId: string, employeeId: string | null | undefined): Promise<{ id: string; name?: string } | null> {
    if (!employeeId) return null;
    const found = await findEmployee(schoolId, employeeId);
    if (!found) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid employee id: ${employeeId}`);
    return { id: employeeId, name: found.name };
  }

  private dayEmpty(day: SaveRosterDayInput, a1: any, a2: any, owner: any): boolean {
    return !a1 && !a2 && !owner;
  }

  private entryEmpty(opted: boolean, content: string | null, speaker: any, owner: any): boolean {
    // An opted-OUT optional slot is meaningful (it hides the segment) — keep it.
    return opted && !content && !speaker && !owner;
  }
}

export const assemblyWeekService = new AssemblyWeekService();
