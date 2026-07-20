import { DB, singleLineString } from '../../shared/lib/db';
import { assemblyHouseService } from './assembly-house-service';
import { assemblyWeekService } from './assembly-week-service';

// The teacher-PWA "my duties" surface + the derived authorization that backs the
// employee-scoped /me/assembly/* endpoints. Roster/checklist access = being the
// in-charge / co-in-charge / MEMBER of the week's house-on-duty snapshot; grading
// access = an assembly_evaluator assignment covering the date.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

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
export interface GradingWeek {
  planId: string;
  planName: string;
  weekStart: string;
  weekId: string;
  houseId?: string;
  houseName?: string;
}
export interface MyDuties {
  rosterDuties: RosterDuty[];
  gradingWeeks: GradingWeek[];
  isHouseMember: boolean; // belongs to any house (in-charge/co-in-charge/member)
  isEvaluator: boolean;
  evaluatorRanges: { startDate?: string; endDate?: string }[];
}

class AssemblyDutiesService {
  // Houses this employee belongs to (in-charge, co-in-charge, or member) — the
  // population allowed to author the roster + checklist for that house's weeks.
  public async myHouseIds(schoolId: string, employeeId: string): Promise<Set<string>> {
    const rows = await DB.query(
      singleLineString`select distinct house_id from house_teacher where school_id = $1 and employee_id = $2 and role in ('incharge', 'coincharge', 'member') and status = 'active'`,
      [schoolId, employeeId],
    );
    return new Set(rows.map((r: any) => r.houseId));
  }

  // May this employee author/act on the given week? (belongs to its house-on-duty)
  public async canEditWeek(schoolId: string, employeeId: string, weekId: string): Promise<boolean> {
    const rows = await DB.query(singleLineString`select house_id from assembly_week where uuid = $1 and school_id = $2`, [weekId, schoolId]);
    if (rows.length === 0 || !rows[0].houseId) return false;
    const mine = await this.myHouseIds(schoolId, employeeId);
    return mine.has(rows[0].houseId);
  }

  // May this employee START (ensure) the week for (plan, weekStart)? (belongs to the
  // house on duty that week)
  public async canEnsure(schoolId: string, employeeId: string, planId: string, weekStart: string): Promise<boolean> {
    const house = await assemblyHouseService.houseForWeek(planId, schoolId, weekStart);
    if (!house?.houseId) return false;
    const mine = await this.myHouseIds(schoolId, employeeId);
    return mine.has(house.houseId);
  }

  public async isEvaluatorFor(schoolId: string, employeeId: string, date: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from assembly_evaluator where school_id = $1 and employee_id = $2 and status = 'active' and (start_date is null or start_date <= $3::date) and (end_date is null or end_date >= $3::date) limit 1`,
      [schoolId, employeeId, date],
    );
    return rows.length > 0;
  }

  // Roster duties (my house on duty) + grading weeks (I'm an evaluator whose range
  // covers the week) + evaluator status, over [from, to].
  public async myDuties(schoolId: string, employeeId: string, from: string, to: string): Promise<MyDuties> {
    const houseIds = await this.myHouseIds(schoolId, employeeId);
    const evals = await DB.query(
      singleLineString`select start_date::text as start_date, end_date::text as end_date from assembly_evaluator where school_id = $1 and employee_id = $2 and status = 'active'`,
      [schoolId, employeeId],
    );
    const isEvaluator = evals.length > 0;
    const rangeCoversWeek = (weekStart: string) => {
      const weekEnd = addDays(weekStart, 6);
      return evals.some((e: any) => (!e.startDate || e.startDate <= weekEnd) && (!e.endDate || e.endDate >= weekStart));
    };

    const rosterDuties: RosterDuty[] = [];
    const gradingWeeks: GradingWeek[] = [];

    if (houseIds.size > 0 || isEvaluator) {
      const plans = await DB.query(singleLineString`select uuid, name from assembly_plan where school_id = $1 and status = 'active'`, [schoolId]);
      for (const plan of plans) {
        const weeks = await assemblyWeekService.listWeeks(plan.uuid, schoolId, from, to);
        const byWeek = new Map(weeks.map((w) => [w.weekStart, w]));

        if (houseIds.size > 0) {
          for (const w of weeks) {
            if (w.houseId && houseIds.has(w.houseId)) {
              rosterDuties.push({
                planId: plan.uuid, planName: plan.name, weekStart: w.weekStart,
                houseId: w.houseId, houseName: w.houseName,
                weekId: w.uuid, status: w.status, editable: w.editable, deadlineAt: w.deadlineAt,
              });
            }
          }
          const cal = await assemblyHouseService.weekCalendar(plan.uuid, schoolId, from, to);
          for (const m of cal) {
            if (m.houseId && houseIds.has(m.houseId) && !byWeek.has(m.weekStart)) {
              rosterDuties.push({
                planId: plan.uuid, planName: plan.name, weekStart: m.weekStart,
                houseId: m.houseId, houseName: m.houseName, status: 'not-created', editable: false,
              });
            }
          }
        }

        if (isEvaluator) {
          for (const w of weeks) {
            if (rangeCoversWeek(w.weekStart)) {
              gradingWeeks.push({ planId: plan.uuid, planName: plan.name, weekStart: w.weekStart, weekId: w.uuid, houseId: w.houseId, houseName: w.houseName });
            }
          }
        }
      }
      rosterDuties.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.planName.localeCompare(b.planName));
      gradingWeeks.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.planName.localeCompare(b.planName));
    }

    return {
      rosterDuties, gradingWeeks, isEvaluator, isHouseMember: houseIds.size > 0,
      evaluatorRanges: evals.map((e: any) => ({ startDate: e.startDate || undefined, endDate: e.endDate || undefined })),
    };
  }
}

export const assemblyDutiesService = new AssemblyDutiesService();
