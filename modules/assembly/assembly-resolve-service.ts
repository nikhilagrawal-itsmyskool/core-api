import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblyNodeDetail, ResolvedAssembly, ResolvedNode, NodeResponsibleView, ResolvedAnchor,
} from './assembly-interfaces';
import { Weekday } from './assembly-constants';
import { assemblyNodeService } from './assembly-node-service';
import { assemblyThemeService } from './assembly-theme-service';
import { assemblyHouseService } from './assembly-house-service';
import { isValidDate } from './assembly-common';

function weekdayOf(dateStr: string): Weekday {
  const map: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return isoDate(d);
}

interface ResolveOptions {
  // When true (the /me path), only a published plan yields an assembly.
  publishedPlanOnly?: boolean;
}

class AssemblyResolveService {
  // The fully-resolved assembly for a plan on a date: a published special replaces
  // the day; otherwise the day-filtered template (if the plan runs that weekday).
  // Effective responsible parties are inherited down the tree; themes covering the
  // date (plan-specific + school-wide) are attached.
  public async resolve(planId: string, date: string, schoolId: string, opts: ResolveOptions = {}): Promise<ResolvedAssembly | null> {
    if (!isValidDate(date)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid date (yyyy-mm-dd) is required');
    const planRows = await DB.query(
      singleLineString`select uuid, academic_year_id, publish_status from assembly_plan where uuid = $1 and school_id = $2 and status = 'active'`,
      [planId, schoolId],
    );
    if (planRows.length === 0) return null;
    const plan = planRows[0];
    const weekday = weekdayOf(date);
    const themes = await assemblyThemeService.coveringDate(schoolId, plan.academicYearId, planId, date);

    const notHeld = (): ResolvedAssembly => ({ planId, date, weekday, held: false, source: 'template', themes, nodes: [] });

    if (opts.publishedPlanOnly && plan.publishStatus !== 'published') return notHeld();

    // A published special replaces the whole day (any weekday).
    const sp = await DB.query(
      singleLineString`
        select uuid, title from assembly_special
        where school_id = $1 and plan_id = $2 and special_date = $3 and status = 'active' and publish_status = 'published'
        limit 1
      `,
      [schoolId, planId, date],
    );
    if (sp.length > 0) {
      const nested = await assemblyNodeService.getTree('special', sp[0].uuid, schoolId);
      // A special replaces the day; no roster overlay, but still surface the house on duty.
      return this.withHouseMode({
        planId, date, weekday, held: true, source: 'special', specialId: sp[0].uuid, title: sp[0].title,
        themes, nodes: this.toResolved(nested, [], date),
      }, schoolId);
    }

    // Otherwise the day-filtered template, but only if the plan runs that weekday.
    const dayRows = await DB.query(
      singleLineString`select weekday from assembly_plan_day where plan_id = $1 and school_id = $2`,
      [planId, schoolId],
    );
    const planDays = dayRows.map((r: any) => r.weekday);
    if (!planDays.includes(weekday)) return notHeld();

    const nested = await assemblyNodeService.getFilteredTree(planId, schoolId, weekday);
    const result: ResolvedAssembly = { planId, date, weekday, held: true, source: 'template', themes, nodes: this.toResolved(nested, [], date) };
    return this.withHouseMode(result, schoolId);
  }

  // House-mode enrichment: attach the house on duty for the date's week and, when
  // an APPROVED roster exists, overlay it onto the template (fill 'roster' slots,
  // prune opted-out optional nodes, attach the day's anchors/owner). No-op for
  // template-mode schools. Specials get the house label but no roster overlay.
  private async withHouseMode(result: ResolvedAssembly, schoolId: string): Promise<ResolvedAssembly> {
    const config = await assemblyHouseService.getConfig(schoolId);
    if (config.mode !== 'house') return result;
    result.mode = 'house';

    const weekStart = mondayOf(result.date);
    const house = await assemblyHouseService.houseForWeek(result.planId, schoolId, weekStart);
    if (house?.houseId) { result.houseId = house.houseId; result.houseName = house.houseName; }

    const weekRows = await DB.query(
      singleLineString`select uuid, house_id, house_name from assembly_week where plan_id = $1 and school_id = $2 and week_start = $3 and status = 'approved'`,
      [result.planId, schoolId, weekStart],
    );
    if (weekRows.length === 0) { result.rosterApproved = false; return result; }
    const weekId = weekRows[0].uuid;
    // Prefer the roster's snapshot of the house on duty over the live rotation.
    if (weekRows[0].houseId) { result.houseId = weekRows[0].houseId; result.houseName = weekRows[0].houseName || result.houseName; }
    result.rosterApproved = true;

    const dayRows = await DB.query(
      singleLineString`
        select anchor1_student_id, anchor1_name, anchor1_class, anchor2_student_id, anchor2_name, anchor2_class,
          day_owner_employee_id, day_owner_name
        from assembly_roster_day where week_id = $1 and entry_date = $2
      `,
      [weekId, result.date],
    );
    if (dayRows.length > 0) {
      const d = dayRows[0];
      const anchors: ResolvedAnchor[] = [];
      if (d.anchor1StudentId || d.anchor1Name) anchors.push({ studentId: d.anchor1StudentId || undefined, name: d.anchor1Name || undefined, className: d.anchor1Class || undefined });
      if (d.anchor2StudentId || d.anchor2Name) anchors.push({ studentId: d.anchor2StudentId || undefined, name: d.anchor2Name || undefined, className: d.anchor2Class || undefined });
      if (anchors.length) result.anchors = anchors;
      if (d.dayOwnerEmployeeId || d.dayOwnerName) result.dayOwner = { employeeId: d.dayOwnerEmployeeId || undefined, name: d.dayOwnerName || undefined };
    }

    // Roster only overlays the recurring template — specials are standalone.
    if (result.source === 'template') {
      const entryRows = await DB.query(
        singleLineString`select node_id, opted, content, student_id, student_name, student_class, owner_employee_id, owner_name from assembly_roster_entry where week_id = $1 and entry_date = $2`,
        [weekId, result.date],
      );
      const byNode = new Map<string, any>();
      for (const r of entryRows) byNode.set(r.nodeId, r);
      result.nodes = this.overlayRoster(result.nodes, byNode);
    }
    return result;
  }

  // Walk the resolved tree applying an approved roster: drop opted-out optional
  // nodes (with their subtree), fill 'roster' slot content, and set the speaker/
  // owner as the effective responsible when the roster names them.
  private overlayRoster(nodes: ResolvedNode[], byNode: Map<string, any>): ResolvedNode[] {
    const out: ResolvedNode[] = [];
    for (const n of nodes) {
      const e = byNode.get(n.uuid);
      if (n.isOptional && e && e.opted === false) continue; // opted out → hide segment
      if (n.fillMode === 'roster' && e) {
        if (e.content) n.content = e.content;
        const rostered: NodeResponsibleView[] = [];
        if (e.studentId || e.studentName) rostered.push({ uuid: `roster-spk-${n.uuid}`, role: 'presenter', targetType: 'student', targetId: e.studentId || undefined, targetName: e.studentName || undefined, sortOrder: 0 });
        if (e.ownerEmployeeId || e.ownerName) rostered.push({ uuid: `roster-own-${n.uuid}`, role: 'in-charge', targetType: 'employee', targetId: e.ownerEmployeeId || undefined, targetName: e.ownerName || undefined, sortOrder: 1 });
        if (rostered.length) n.responsible = rostered;
      }
      n.children = this.overlayRoster(n.children || [], byNode);
      out.push(n);
    }
    return out;
  }

  // The /me path: resolve the assembly for the app's active student by finding the
  // published plan whose class-set contains the student's enrollment class for that
  // year, then resolving (published-only). Returns a not-held shell when the student
  // has no published plan. Enrollment year is matched to the plan year via student_class.
  public async resolveForStudent(schoolId: string, studentId: string, date: string, academicYearId?: string): Promise<ResolvedAssembly> {
    if (!isValidDate(date)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid date (yyyy-mm-dd) is required');
    // Among the student's published plans whose date range covers the day, pick the
    // NARROWEST (most specific) — a term plan loses to an exam-block plan loses to a
    // 1-day plan; priority breaks equal-span ties.
    const params: any[] = [studentId, schoolId, date];
    let yearFilter = '';
    if (academicYearId) { params.push(academicYearId); yearFilter = ` and p.academic_year_id = $${params.length}`; }
    const rows = await DB.query(
      singleLineString`
        select pc.plan_id from student_class sc
        join assembly_plan_class pc on pc.class_id = sc.class_id and pc.academic_year_id = sc.academic_year_id
          and pc.school_id = sc.school_id and pc.status = 'active'
        join assembly_plan p on p.uuid = pc.plan_id and p.status = 'active' and p.publish_status = 'published'
          and (p.start_date is null or p.start_date <= $3::date) and (p.end_date is null or p.end_date >= $3::date)
        where sc.student_id = $1 and sc.school_id = $2 and sc.status = 'active'${yearFilter}
        order by (coalesce(p.end_date, '9999-12-31')::date - coalesce(p.start_date, '0001-01-01')::date) asc,
                 p.priority desc nulls last, sc.created_at desc
        limit 1
      `,
      params,
    );
    if (rows.length === 0) {
      return { planId: '', date, weekday: weekdayOf(date), held: false, source: 'template', themes: [], nodes: [] };
    }
    return (await this.resolve(rows[0].planId, date, schoolId, { publishedPlanOnly: true }))!;
  }

  // Produce the read model: each node's effective responsible = its own rules resolved
  // for the date, or (if it has none) the nearest ancestor's resolved set. Resources
  // are per-node. Responsibility rules are date-aware (independent dated rows + rotating
  // groups).
  private toResolved(nodes: AssemblyNodeDetail[], inherited: NodeResponsibleView[], date: string): ResolvedNode[] {
    const wd = weekdayOf(date);
    return nodes.map(n => {
      const rules = n.responsible || [];
      const eff = rules.length > 0 ? this.resolveResponsibleForDate(rules, date) : inherited;
      return {
        uuid: n.uuid,
        title: n.title,
        content: (n.dayContent || []).find(c => c.weekday === wd)?.content,
        description: n.description,
        expectation: n.expectation,
        recommendation: n.recommendation,
        outcome: n.outcome,
        startTime: n.startTime,
        durationMinutes: n.durationMinutes,
        sortOrder: n.sortOrder,
        fillMode: n.fillMode,
        isOptional: n.isOptional === true ? true : undefined,
        responsible: eff,
        resources: n.resources || [],
        children: this.toResolved(n.children || [], eff, date),
      };
    });
  }

  // Resolve a node's responsibility rules for a date. A fixed/undated row shows when
  // its [start,end] covers the date; rows sharing a rule_group with mode='rotating'
  // collapse to one member chosen by the calendar cycle. Holidays are ignored.
  private resolveResponsibleForDate(rows: NodeResponsibleView[], date: string): NodeResponsibleView[] {
    const covers = (r: NodeResponsibleView) => (!r.startDate || date >= r.startDate) && (!r.endDate || date <= r.endDate);
    const concrete = (r: NodeResponsibleView): NodeResponsibleView => ({
      uuid: r.uuid, role: r.role, targetType: r.targetType, targetId: r.targetId,
      targetText: r.targetText, targetName: r.targetName, sortOrder: r.sortOrder,
    });
    const out: NodeResponsibleView[] = [];
    const rotGroups = new Map<string, NodeResponsibleView[]>();
    for (const r of rows) {
      if (r.mode === 'rotating' && r.ruleGroup) {
        if (!rotGroups.has(r.ruleGroup)) rotGroups.set(r.ruleGroup, []);
        rotGroups.get(r.ruleGroup)!.push(r);
      } else if (covers(r)) {
        out.push(concrete(r));
      }
    }
    for (const members of rotGroups.values()) {
      members.sort((a, b) => a.sortOrder - b.sortOrder);
      const meta = members[0];
      if (!covers(meta) || !meta.anchorDate || !meta.cycleUnit) continue;
      const idx = this.cycleIndex(date, meta.anchorDate, meta.cycleUnit);
      out.push(concrete(members[((idx % members.length) + members.length) % members.length]));
    }
    return out.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  private cycleIndex(date: string, anchor: string, unit: string): number {
    const d = new Date(`${date}T00:00:00Z`);
    const a = new Date(`${anchor}T00:00:00Z`);
    if (unit === 'monthly') {
      return (d.getUTCFullYear() - a.getUTCFullYear()) * 12 + (d.getUTCMonth() - a.getUTCMonth());
    }
    return Math.floor((d.getTime() - a.getTime()) / (7 * 86400000)); // weekly
  }
}

export const assemblyResolveService = new AssemblyResolveService();
