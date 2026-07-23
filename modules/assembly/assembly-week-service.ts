import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblyWeek, AssemblyWeekDetail, WeekSummary, RosterSlot, RosterDayView,
  RosterParticipantView, RosterParticipantInput, AssemblyNodeDetail,
  SaveRosterRequest,
} from './assembly-interfaces';
import { WEEKDAY_VALUES, Weekday, WeekStatus, RESPONSIBLE_TARGET_TYPE_VALUES } from './assembly-constants';
import { isValidDate, findEmployee, findClass, resolveStudentInfo } from './assembly-common';
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

interface ResolvedParticipant {
  targetType: string; targetId: string | null; targetName: string | null;
  targetClass: string | null; targetText: string | null;
}

class AssemblyWeekService {
  // ── Week lifecycle ───────────────────────────────────────────────────────────

  // Ensure a draft roster week exists for (plan, week). Idempotent — returns the
  // existing week untouched if present. Snapshots the house-on-duty + deadline.
  public async ensureWeek(planId: string, weekStartInput: string, schoolId: string, userId: string): Promise<AssemblyWeekDetail> {
    if (!isValidDate(weekStartInput)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid week date (yyyy-mm-dd) is required');
    const plan = await this.planRow(planId, schoolId);
    const weekStart = mondayOf(weekStartInput);

    const existing = await DB.query(singleLineString`select uuid, house_id, locked from assembly_week where plan_id = $1 and week_start = $2`, [planId, weekStart]);
    if (existing.length > 0) {
      // Self-heal: a week ensured BEFORE its rotation was pinned snapshotted a null
      // house. While still unlocked, re-resolve the house-on-duty and backfill it so
      // duty derivation (myDuties / canEditWeek) recognises the correct house.
      if (!existing[0].houseId && existing[0].locked !== true) {
        const resolved = await assemblyHouseService.houseForWeek(planId, schoolId, weekStart);
        if (resolved?.houseId) {
          await DB.query(
            singleLineString`update assembly_week set house_id = $1, house_name = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
            [resolved.houseId, resolved.houseName ?? null, new Date(), existing[0].uuid, schoolId],
          );
        }
      }
      return (await this.getWeek(existing[0].uuid, schoolId))!;
    }

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

    // Slot state (opted/content) keyed (date|node).
    const entryRows = await DB.query(singleLineString`select entry_date::text as entry_date, node_id, opted, content from assembly_roster_entry where week_id = $1`, [weekId]);
    const entryByKey = new Map<string, any>();
    for (const r of entryRows) entryByKey.set(`${r.entryDate}|${r.nodeId}`, r);

    // Participants: day-scope keyed by date; entry-scope keyed (date|node).
    const partRows = await DB.query(
      singleLineString`select entry_date::text as entry_date, scope, node_id, role, target_type, target_id, target_name, target_class, target_text, sort_order from assembly_roster_participant where week_id = $1 order by sort_order`,
      [weekId],
    );
    const dayParts = new Map<string, any[]>();       // date -> rows (scope='day')
    const entryParts = new Map<string, any[]>();      // date|node -> rows (scope='entry')
    for (const r of partRows) {
      if (r.scope === 'day') { (dayParts.get(r.entryDate) || dayParts.set(r.entryDate, []).get(r.entryDate)!).push(r); }
      else { const k = `${r.entryDate}|${r.nodeId}`; (entryParts.get(k) || entryParts.set(k, []).get(k)!).push(r); }
    }
    const view = (r: any): RosterParticipantView => ({
      role: r.role || undefined, targetType: r.targetType, targetId: r.targetId || undefined,
      targetName: r.targetName || undefined, targetClass: r.targetClass || undefined,
      targetText: r.targetText || undefined, sortOrder: r.sortOrder,
    });

    const days: RosterDayView[] = [];
    for (const { wd, date } of dates) {
      const slots = (await this.fillableSlots(week.planId, schoolId, wd)).map(s => {
        const e = entryByKey.get(`${date}|${s.nodeId}`);
        return {
          ...s,
          opted: e ? e.opted !== false : true,
          content: e?.content || undefined,
          participants: (entryParts.get(`${date}|${s.nodeId}`) || []).map(view),
        } as RosterSlot;
      });
      const dp = dayParts.get(date) || [];
      days.push({
        date, weekday: wd,
        anchors: dp.filter(r => r.role === 'anchor').map(view),
        owners: dp.filter(r => r.role === 'day-owner').map(view),
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
    const fillableByDate = new Map<string, Set<string>>();
    for (const date of validDates) {
      const slots = await this.fillableSlots(week.planId, schoolId, weekdayOf(date));
      fillableByDate.set(date, new Set(slots.map(s => s.nodeId)));
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    const insertParticipant = (scope: 'day' | 'entry', date: string, nodeId: string | null, role: string | undefined, p: ResolvedParticipant, idx: number) => {
      queries.push(singleLineString`insert into assembly_roster_participant (uuid, school_id, week_id, entry_date, scope, node_id, role, target_type, target_id, target_name, target_class, target_text, sort_order, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`);
      params.push([generateShortUuid(12), schoolId, weekId, date, scope, nodeId, role ?? null, p.targetType, p.targetId, p.targetName, p.targetClass, p.targetText, idx, userId, now]);
    };

    if (Array.isArray(data.days)) {
      queries.push(singleLineString`delete from assembly_roster_participant where week_id = $1 and scope = 'day'`); params.push([weekId]);
      for (const day of data.days) {
        if (!validDates.has(day.date)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Date ${day.date} is not an assembly day of this week`);
        let idx = 0;
        for (const a of day.anchors || []) insertParticipant('day', day.date, null, a.role || 'anchor', await this.resolveParticipant(schoolId, a, week.academicYearId), idx++);
        for (const o of day.owners || []) insertParticipant('day', day.date, null, o.role || 'day-owner', await this.resolveParticipant(schoolId, o, week.academicYearId), idx++);
      }
    }

    if (Array.isArray(data.entries)) {
      queries.push(singleLineString`delete from assembly_roster_entry where week_id = $1`); params.push([weekId]);
      queries.push(singleLineString`delete from assembly_roster_participant where week_id = $1 and scope = 'entry'`); params.push([weekId]);
      for (const e of data.entries) {
        if (!validDates.has(e.date)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Date ${e.date} is not an assembly day of this week`);
        if (!fillableByDate.get(e.date)!.has(e.nodeId)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Node ${e.nodeId} is not a roster slot on ${e.date}`);
        const content = (e.content ?? '').toString().trim() || null;
        const opted = e.opted === undefined ? true : !!e.opted;
        const parts = e.participants || [];
        // Only persist a slot that carries signal: opted-out, content, or people.
        if (opted && !content && parts.length === 0) continue;
        queries.push(singleLineString`insert into assembly_roster_entry (uuid, school_id, week_id, entry_date, node_id, opted, content, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`);
        params.push([generateShortUuid(12), schoolId, weekId, e.date, e.nodeId, opted, content, userId, now]);
        let idx = 0;
        for (const p of parts) insertParticipant('entry', e.date, e.nodeId, p.role, await this.resolveParticipant(schoolId, p, week.academicYearId), idx++);
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

  // Manually lock a week (admin) — no further roster edits until unlocked. Works on
  // any not-yet-locked week, independent of the submit/approve flow.
  public async lock(weekId: string, schoolId: string, userId: string): Promise<AssemblyWeekDetail | null> {
    const week = await this.weekOr404(weekId, schoolId); if (!week) return null;
    if (week.locked) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Week is already locked');
    const now = new Date();
    await DB.query(singleLineString`update assembly_week set locked = true, updatedby_userid = $1, updated_at = $2 where uuid = $3`, [userId, now, weekId]);
    return this.getWeek(weekId, schoolId);
  }

  // Re-open a locked (approved) or past-deadline week for late edits. Recorded. Once
  // unlocked the Wed-deadline auto-lock no longer applies (late_unlocked) — only a
  // manual lock will close it again.
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

  // The roster slots for a weekday = every LEAF segment that runs that day. Each
  // carries its per-weekday hint (day-content); the house fills the actual content
  // + performer, and may opt any leaf out for the day. Containers (blocks) recurse.
  private async fillableSlots(planId: string, schoolId: string, weekday: Weekday): Promise<Omit<RosterSlot, 'opted' | 'content' | 'participants'>[]> {
    const tree = await assemblyNodeService.getFilteredTree(planId, schoolId, weekday);
    const out: Omit<RosterSlot, 'opted' | 'content' | 'participants'>[] = [];
    const walk = (nodes: AssemblyNodeDetail[]) => {
      for (const n of nodes) {
        if (n.children && n.children.length) { walk(n.children); continue; } // container → recurse
        out.push({
          nodeId: n.uuid, title: n.title, description: n.description || undefined,
          depth: n.depth, parentId: n.parentId || undefined,
          fillMode: n.fillMode, isOptional: n.isOptional === true, options: n.options || [],
          dayHint: (n.dayContent || []).find((c) => c.weekday === weekday)?.content,
        });
      }
    };
    walk(tree);
    return out;
  }

  // Validate + denormalize one participant (mirrors assembly_node_responsible rules).
  private async resolveParticipant(schoolId: string, e: RosterParticipantInput, ay: string): Promise<ResolvedParticipant> {
    if (!RESPONSIBLE_TARGET_TYPE_VALUES.includes(e.targetType)) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid targetType: ${e.targetType}`);
    if (e.targetType === 'text') {
      if (!e.targetText || !e.targetText.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'targetText is required for a text participant');
      return { targetType: 'text', targetId: null, targetName: null, targetClass: null, targetText: e.targetText.trim() };
    }
    if (!e.targetId) throw new BusinessErrorResult(ErrorCode.BusinessError, `targetId is required for a ${e.targetType} participant`);
    if (e.targetType === 'student') {
      const info = await resolveStudentInfo(schoolId, e.targetId, ay);
      if (!info) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid student id: ${e.targetId}`);
      return { targetType: 'student', targetId: e.targetId, targetName: info.name, targetClass: info.className ?? null, targetText: null };
    }
    if (e.targetType === 'employee') {
      const emp = await findEmployee(schoolId, e.targetId);
      if (!emp) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid employee id: ${e.targetId}`);
      return { targetType: 'employee', targetId: e.targetId, targetName: emp.name, targetClass: null, targetText: null };
    }
    const cls = await findClass(schoolId, e.targetId);
    if (!cls) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid class id: ${e.targetId}`);
    return { targetType: 'class', targetId: e.targetId, targetName: cls.name, targetClass: null, targetText: null };
  }
}

export const assemblyWeekService = new AssemblyWeekService();
