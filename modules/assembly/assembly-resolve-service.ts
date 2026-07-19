import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblyNodeDetail, ResolvedAssembly, ResolvedNode, NodeResponsibleView,
} from './assembly-interfaces';
import { Weekday } from './assembly-constants';
import { assemblyNodeService } from './assembly-node-service';
import { assemblyThemeService } from './assembly-theme-service';
import { isValidDate } from './assembly-common';

function weekdayOf(dateStr: string): Weekday {
  const map: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
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
      return {
        planId, date, weekday, held: true, source: 'special', specialId: sp[0].uuid, title: sp[0].title,
        themes, nodes: this.toResolved(nested, []),
      };
    }

    // Otherwise the day-filtered template, but only if the plan runs that weekday.
    const dayRows = await DB.query(
      singleLineString`select weekday from assembly_plan_day where plan_id = $1 and school_id = $2`,
      [planId, schoolId],
    );
    const planDays = dayRows.map((r: any) => r.weekday);
    if (!planDays.includes(weekday)) return notHeld();

    const nested = await assemblyNodeService.getFilteredTree(planId, schoolId, weekday);
    return { planId, date, weekday, held: true, source: 'template', themes, nodes: this.toResolved(nested, []) };
  }

  // The /me path: resolve the assembly for the app's active student by finding the
  // published plan whose class-set contains the student's enrollment class for that
  // year, then resolving (published-only). Returns a not-held shell when the student
  // has no published plan. Enrollment year is matched to the plan year via student_class.
  public async resolveForStudent(schoolId: string, studentId: string, date: string, academicYearId?: string): Promise<ResolvedAssembly> {
    if (!isValidDate(date)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid date (yyyy-mm-dd) is required');
    const params: any[] = [studentId, schoolId];
    let yearFilter = '';
    if (academicYearId) { params.push(academicYearId); yearFilter = ` and p.academic_year_id = $${params.length}`; }
    const rows = await DB.query(
      singleLineString`
        select pc.plan_id from student_class sc
        join assembly_plan_class pc on pc.class_id = sc.class_id and pc.academic_year_id = sc.academic_year_id
          and pc.school_id = sc.school_id and pc.status = 'active'
        join assembly_plan p on p.uuid = pc.plan_id and p.status = 'active' and p.publish_status = 'published'
        where sc.student_id = $1 and sc.school_id = $2 and sc.status = 'active'${yearFilter}
        order by sc.created_at desc limit 1
      `,
      params,
    );
    if (rows.length === 0) {
      return { planId: '', date, weekday: weekdayOf(date), held: false, source: 'template', themes: [], nodes: [] };
    }
    return (await this.resolve(rows[0].planId, date, schoolId, { publishedPlanOnly: true }))!;
  }

  // Produce the read model: each node's effective responsible = its own set, or the
  // nearest ancestor's set (all-or-nothing inheritance); resources are per-node.
  private toResolved(nodes: AssemblyNodeDetail[], inherited: NodeResponsibleView[]): ResolvedNode[] {
    return nodes.map(n => {
      const eff = n.responsible && n.responsible.length > 0 ? n.responsible : inherited;
      return {
        uuid: n.uuid,
        title: n.title,
        description: n.description,
        expectation: n.expectation,
        recommendation: n.recommendation,
        outcome: n.outcome,
        startTime: n.startTime,
        durationMinutes: n.durationMinutes,
        sortOrder: n.sortOrder,
        responsible: eff,
        resources: n.resources || [],
        children: this.toResolved(n.children || [], eff),
      };
    });
  }
}

export const assemblyResolveService = new AssemblyResolveService();
