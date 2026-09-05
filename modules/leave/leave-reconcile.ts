import { DB, singleLineString } from "../../shared/lib/db";
import {
  getCurrentAcademicYearId,
  weeklyOffDays,
  fullHolidaysInRange,
  monthBounds,
  datesInRange,
} from "./leave-common";

// The single source of truth that folds biometric attendance, approved leave, and the
// academic calendar into a per-day status. Powers the teacher month view, the god
// per-teacher drill-down, the day-view, AND the Phase-3 deduction ladder. See DESIGN §4.

export type DayStatus =
  | "present"          // punched in, no leave
  | "present_on_leave" // punched in despite an approved leave (leave should be refunded)
  | "leave_paid"       // absent, on an approved paid leave (CL/ML/OD/COMP/MAT/EMERG)
  | "absence_counted"  // absent on approved LWP (counts toward the deduction ladder)
  | "unauthorized"     // absent, no approved leave (counts toward the ladder, harshest)
  | "holiday"          // full holiday (academic-calendar)
  | "off"              // weekly-off (e.g. Sunday)
  | "suspect"          // biometric device-down day, held for review
  | "unknown"          // a past working day with no attendance imported yet
  | "future";          // a working day in the future

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface ReconciledDay {
  date: string;
  weekday: string;
  status: DayStatus;
  leaveTypeCode: string | null;
  leaveApplicationId: string | null;
  holidayName: string | null;
  firstIn: string | null;
  lastOut: string | null;
  minutesWorked: number | null;
}

export interface MonthCounts {
  present: number;
  paidLeave: number;
  countedAbsence: number; // absence_counted + unauthorized (the ladder inputs)
  unauthorized: number;
  holidays: number;
  off: number;
  suspect: number;
  unknown: number;
}

export interface MonthReconciliation {
  employeeId: string;
  year: number;
  month: number; // 1-12
  monthLabel: string; // YYYY-MM
  days: ReconciledDay[];
  counts: MonthCounts;
  countedDates: string[]; // ordered dates that feed the deduction ladder
}

// `month` is 1-12. `today` (YYYY-MM-DD) marks the future boundary.
export async function reconcileMonth(
  schoolId: string,
  employeeId: string,
  year: number,
  month: number,
  today: string,
): Promise<MonthReconciliation> {
  const monthLabel = `${year}-${String(month).padStart(2, "0")}`;
  const { first, last } = monthBounds(`${monthLabel}-01`);

  const ay = await getCurrentAcademicYearId(schoolId);
  const weeklyOff = ay ? await weeklyOffDays(schoolId, ay) : [0];
  const holidays = await fullHolidaysInRange(schoolId, first, last);

  // Attendance rows for the month.
  const attRows = await DB.query(
    singleLineString`select att_date::text as att_date, status, first_in::text as first_in, last_out::text as last_out, minutes_worked
      from employee_attendance_day where school_id = $1 and employee_id = $2 and att_date >= $3 and att_date <= $4`,
    [schoolId, employeeId, first, last],
  );
  const attByDate = new Map<string, any>(attRows.map((r: any) => [r.attDate, r]));

  // Approved leave overlapping the month, joined to its type's paid flag.
  const leaveRows = await DB.query(
    singleLineString`select a.uuid, a.leave_type_code, a.from_date::text as from_date, a.to_date::text as to_date, t.paid
      from leave_application a
      left join leave_type t on lower(t.code) = lower(a.leave_type_code) and t.school_id = a.school_id
      where a.school_id = $1 and a.employee_id = $2 and a.status = 'approved'
        and a.from_date <= $4 and a.to_date >= $3`,
    [schoolId, employeeId, first, last],
  );
  const leaveByDate = new Map<string, { code: string; paid: string; appId: string }>();
  for (const lr of leaveRows) {
    for (const d of datesInRange(lr.fromDate, lr.toDate)) {
      if (d >= first && d <= last && !leaveByDate.has(d)) {
        leaveByDate.set(d, { code: lr.leaveTypeCode, paid: lr.paid || "no", appId: lr.uuid });
      }
    }
  }

  const days: ReconciledDay[] = [];
  const counts: MonthCounts = { present: 0, paidLeave: 0, countedAbsence: 0, unauthorized: 0, holidays: 0, off: 0, suspect: 0, unknown: 0 };
  const countedDates: string[] = [];

  for (const date of datesInRange(first, last)) {
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekday = WEEKDAY_NAMES[dow];
    const att = attByDate.get(date);
    const leave = leaveByDate.get(date);
    const base: ReconciledDay = {
      date, weekday, status: "unknown", leaveTypeCode: leave?.code || null,
      leaveApplicationId: leave?.appId || null, holidayName: null,
      firstIn: att?.firstIn || null, lastOut: att?.lastOut || null, minutesWorked: att?.minutesWorked ?? null,
    };

    if (weeklyOff.includes(dow)) {
      base.status = "off"; counts.off++;
    } else if (holidays.has(date)) {
      base.status = "holiday"; base.holidayName = holidays.get(date) || "Holiday"; counts.holidays++;
    } else if (att?.status === "present") {
      base.status = leave ? "present_on_leave" : "present"; counts.present++;
    } else if (att?.status === "suspect") {
      base.status = "suspect"; counts.suspect++;
    } else if (att?.status === "absent") {
      if (leave) {
        if (leave.paid === "yes" || leave.paid === "discretionary") { base.status = "leave_paid"; counts.paidLeave++; }
        else { base.status = "absence_counted"; counts.countedAbsence++; countedDates.push(date); }
      } else {
        base.status = "unauthorized"; counts.unauthorized++; counts.countedAbsence++; countedDates.push(date);
      }
    } else {
      // No attendance row (or 'unknown'/'off' source). Trust an approved leave; else
      // it's future or not-yet-imported.
      if (leave) {
        if (leave.paid === "yes" || leave.paid === "discretionary") { base.status = "leave_paid"; counts.paidLeave++; }
        else { base.status = "absence_counted"; counts.countedAbsence++; countedDates.push(date); }
      } else if (date > today) {
        base.status = "future";
      } else {
        base.status = "unknown"; counts.unknown++;
      }
    }
    days.push(base);
  }

  return { employeeId, year, month, monthLabel, days, counts, countedDates };
}
