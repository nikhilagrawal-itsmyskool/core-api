import { DB, singleLineString } from '../../shared/lib/db';
import { assemblyHouseService } from './assembly-house-service';
import { assemblyWeekService } from './assembly-week-service';

// The teacher-PWA "my duties" surface + the derived authorization that backs the
// employee-scoped /me/assembly/* endpoints. A teacher may act on a roster week iff
// they are the in-charge (or co-in-charge) of that week's house-on-duty snapshot.

export interface RosterDuty {
  planId: string;
  planName: string;
  weekStart: string;
  houseId?: string;
  houseName?: string;
  weekId?: string;        // present once the week exists
  status: string;         // 'not-created' | draft | submitted | approved
  editable: boolean;
  deadlineAt?: string;
}
export interface MyDuties {
  rosterDuties: RosterDuty[];
  isEvaluator: boolean;
  evaluatorRanges: { startDate?: string; endDate?: string }[];
}

class AssemblyDutiesService {
  // Houses this employee leads (in-charge or co-in-charge).
  public async myHouseIds(schoolId: string, employeeId: string): Promise<Set<string>> {
    const rows = await DB.query(
      singleLineString`select distinct house_id from house_teacher where school_id = $1 and employee_id = $2 and role in ('incharge', 'coincharge') and status = 'active'`,
      [schoolId, employeeId],
    );
    return new Set(rows.map((r: any) => r.houseId));
  }

  // May this employee author/act on the given week? (in-charge of its house-on-duty)
  public async canEditWeek(schoolId: string, employeeId: string, weekId: string): Promise<boolean> {
    const rows = await DB.query(singleLineString`select house_id from assembly_week where uuid = $1 and school_id = $2`, [weekId, schoolId]);
    if (rows.length === 0 || !rows[0].houseId) return false;
    const mine = await this.myHouseIds(schoolId, employeeId);
    return mine.has(rows[0].houseId);
  }

  public async isEvaluatorFor(schoolId: string, employeeId: string, date: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from assembly_evaluator where school_id = $1 and employee_id = $2 and status = 'active' and (start_date is null or start_date <= $3::date) and (end_date is null or end_date >= $3::date) limit 1`,
      [schoolId, employeeId, date],
    );
    return rows.length > 0;
  }

  // My roster duties + evaluator status over [from, to]. Roster duties = weeks in
  // range (across all active wings) whose house-on-duty is one I lead.
  public async myDuties(schoolId: string, employeeId: string, from: string, to: string): Promise<MyDuties> {
    const houseIds = await this.myHouseIds(schoolId, employeeId);
    const rosterDuties: RosterDuty[] = [];

    if (houseIds.size > 0) {
      const plans = await DB.query(singleLineString`select uuid, name from assembly_plan where school_id = $1 and status = 'active'`, [schoolId]);
      for (const plan of plans) {
        const cal = await assemblyHouseService.weekCalendar(plan.uuid, schoolId, from, to);
        const mine = cal.filter((c) => c.houseId && houseIds.has(c.houseId));
        if (mine.length === 0) continue;
        const weeks = await assemblyWeekService.listWeeks(plan.uuid, schoolId, from, to);
        const byWeek = new Map(weeks.map((w) => [w.weekStart, w]));
        for (const m of mine) {
          const w = byWeek.get(m.weekStart);
          rosterDuties.push({
            planId: plan.uuid, planName: plan.name, weekStart: m.weekStart,
            houseId: m.houseId, houseName: m.houseName,
            weekId: w?.uuid, status: w?.status || 'not-created',
            editable: w?.editable ?? false, deadlineAt: w?.deadlineAt,
          });
        }
      }
      rosterDuties.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.planName.localeCompare(b.planName));
    }

    const evals = await DB.query(
      singleLineString`select start_date::text as start_date, end_date::text as end_date from assembly_evaluator where school_id = $1 and employee_id = $2 and status = 'active'`,
      [schoolId, employeeId],
    );
    return {
      rosterDuties,
      isEvaluator: evals.length > 0,
      evaluatorRanges: evals.map((e: any) => ({ startDate: e.startDate || undefined, endDate: e.endDate || undefined })),
    };
  }
}

export const assemblyDutiesService = new AssemblyDutiesService();
