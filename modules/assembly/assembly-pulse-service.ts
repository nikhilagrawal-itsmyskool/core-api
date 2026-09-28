import { DB, singleLineString } from '../../shared/lib/db';
import { WEEKDAY_VALUES } from './assembly-constants';

// Director cockpit "heartbeat" for assembly: two per-day signals over a date range.
//  1. Checklist on-time — the day's sign-off time vs the school's configured due time.
//  2. Evaluator coverage — how many of the assigned evaluators graded that day (X of Y),
//     with the names still pending.
// School-level roll-up across all plans (Primary/Senior share one evaluator pool and one
// director view). On-time / late / missed classification is left to the frontend, which has
// the IST helpers to convert `signedAt` and compare against `dueTime`.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
// WEEKDAY_VALUES is Monday-first; JS getUTCDay() is Sunday-first (0=Sun).
const weekdayOf = (s: string) => WEEKDAY_VALUES[(parse(s).getUTCDay() + 6) % 7];
const mondayOf = (s: string) => addDays(s, -((parse(s).getUTCDay() + 6) % 7));

interface PulseDayChecklist { date: string; house: string | null; signedAt: string | null; }
interface PulseDayGrading { date: string; expected: number; submitted: number; missing: { employeeId: string; name: string | null }[]; }
export interface AssemblyPulse {
  from: string; to: string; dueTime: string | null;
  checklist: PulseDayChecklist[];
  grading: PulseDayGrading[];
}

class AssemblyPulseService {
  public async pulse(schoolId: string, from: string, to: string): Promise<AssemblyPulse> {
    const cfg = await DB.query(
      singleLineString`select checklist_due_time from assembly_school_config where school_id = $1`, [schoolId],
    );
    const dueTime: string | null = (cfg[0] && cfg[0].checklistDueTime) || null;

    // Which weekdays hold assembly anywhere in this school (union across plans).
    const wdRows = await DB.query(
      singleLineString`select distinct weekday from assembly_plan_day where school_id = $1`, [schoolId],
    );
    const assemblyWeekdays = new Set(wdRows.map((r: any) => r.weekday));

    // Active evaluators + their date-range membership.
    const evals = await DB.query(
      singleLineString`select employee_id, employee_name, start_date::text as start_date, end_date::text as end_date
        from assembly_evaluator where school_id = $1 and status = 'active'`, [schoolId],
    );

    // Grades submitted in range -> per-date set of distinct evaluators who graded.
    const grades = await DB.query(
      singleLineString`select grade_date::text as grade_date, evaluator_employee_id
        from assembly_grade where school_id = $1 and status = 'active' and grade_date >= $2::date and grade_date <= $3::date`,
      [schoolId, from, to],
    );
    const submittedByDate = new Map<string, Set<string>>();
    for (const g of grades) {
      const set = submittedByDate.get(g.gradeDate) || new Set<string>();
      set.add(g.evaluatorEmployeeId);
      submittedByDate.set(g.gradeDate, set);
    }

    // Day-level checklist sign-offs in range, with the on-duty house. If more than one plan
    // signs off on a date, keep the latest time (the "worst case" for on-time judging).
    const signoffs = await DB.query(
      singleLineString`select s.entry_date::text as entry_date, s.signed_at, w.house_name
        from assembly_checklist_signoff s
        join assembly_week w on w.uuid = s.week_id and w.school_id = s.school_id
        where s.school_id = $1 and s.entry_date is not null and s.entry_date >= $2::date and s.entry_date <= $3::date`,
      [schoolId, from, to],
    );
    const signByDate = new Map<string, { signedAt: string | null; house?: string }>();
    for (const s of signoffs) {
      const at = s.signedAt ? new Date(s.signedAt).toISOString() : null;
      const prev = signByDate.get(s.entryDate);
      if (!prev || (at && (!prev.signedAt || at > prev.signedAt))) {
        signByDate.set(s.entryDate, { signedAt: at, house: s.houseName || undefined });
      }
    }

    // House on duty per week (for banding days that have no sign-off yet).
    const weeks = await DB.query(
      singleLineString`select week_start::text as week_start, house_name
        from assembly_week where school_id = $1 and week_start >= $2::date and week_start <= $3::date`,
      [schoolId, mondayOf(from), to],
    );
    const houseByWeek = new Map<string, string>();
    for (const w of weeks) if (!houseByWeek.has(w.weekStart)) houseByWeek.set(w.weekStart, w.houseName || '');

    const checklist: PulseDayChecklist[] = [];
    const grading: PulseDayGrading[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (!assemblyWeekdays.has(weekdayOf(d))) continue;
      const sign = signByDate.get(d);
      checklist.push({
        date: d,
        house: (sign && sign.house) || houseByWeek.get(mondayOf(d)) || null,
        signedAt: (sign && sign.signedAt) || null,
      });
      const expected = evals.filter((e: any) => (!e.startDate || e.startDate <= d) && (!e.endDate || e.endDate >= d));
      const submitted = submittedByDate.get(d) || new Set<string>();
      const missing = expected
        .filter((e: any) => !submitted.has(e.employeeId))
        .map((e: any) => ({ employeeId: e.employeeId, name: e.employeeName || null }));
      grading.push({ date: d, expected: expected.length, submitted: submitted.size, missing });
    }

    return { from, to, dueTime, checklist, grading };
  }
}

export const assemblyPulseService = new AssemblyPulseService();
