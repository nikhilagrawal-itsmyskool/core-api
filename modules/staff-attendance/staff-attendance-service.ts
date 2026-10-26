import { DB, singleLineString } from '../../shared/lib/db';
import {
  getEmployee, listActiveStaff, punchesInRange, getCurrentAcademicYearId, weeklyOffDays,
  fullHolidaysInRange, approvedLeaveByEmployee, onLeave, datesInRange, weekdayOf, StaffRow, PunchRow,
} from './staff-attendance-common';
import { policyService } from './policy-service';
import { deriveDay, resolvePolicyForDate, DayResult, DayType, ConfigRow, SeasonRow } from './staff-attendance-derive';

interface Context {
  config: ConfigRow;
  seasons: SeasonRow[];
  weeklyOff: number[];
  holidays: Map<string, string>;
  leaveByEmp: Map<string, { from: string; to: string; typeCode: string }[]>;
  regByEmpDate: Map<string, { claimedIn: string | null; claimedOut: string | null }>;
  punchByDevDate: Map<string, Map<string, string[]>>;
}

class StaffAttendanceService {
  // Build everything needed to derive [from,to] for the whole school in a few queries.
  private async buildContext(schoolId: string, from: string, to: string): Promise<Context> {
    const { config, seasons } = await policyService.loadContext(schoolId);
    const ay = await getCurrentAcademicYearId(schoolId);
    const [weeklyOff, holidays, leaveByEmp, punches, regs] = await Promise.all([
      weeklyOffDays(schoolId, ay),
      fullHolidaysInRange(schoolId, from, to),
      approvedLeaveByEmployee(schoolId, from, to),
      punchesInRange(schoolId, from, to),
      DB.query(
        singleLineString`select employee_id, to_char(att_date,'YYYY-MM-DD') as d, claimed_in, claimed_out
          from staff_attendance_regularization
          where school_id = $1 and status = 'approved' and att_date >= $2 and att_date <= $3`,
        [schoolId, from, to],
      ),
    ]);

    const punchByDevDate = new Map<string, Map<string, string[]>>();
    for (const p of punches as PunchRow[]) {
      let byDate = punchByDevDate.get(p.deviceNumber);
      if (!byDate) { byDate = new Map(); punchByDevDate.set(p.deviceNumber, byDate); }
      const list = byDate.get(p.d) || [];
      list.push(p.t);
      byDate.set(p.d, list);
    }

    const regByEmpDate = new Map<string, { claimedIn: string | null; claimedOut: string | null }>();
    for (const r of regs) regByEmpDate.set(`${r.employeeId}|${r.d}`, { claimedIn: r.claimedIn, claimedOut: r.claimedOut });

    return { config, seasons, weeklyOff, holidays, leaveByEmp, regByEmpDate, punchByDevDate };
  }

  private deriveEmployeeDay(staff: StaffRow, date: string, ctx: Context): DayResult {
    const policy = resolvePolicyForDate(date, ctx.config, ctx.seasons);
    let dayType: DayType = 'working';
    let leaveType: string | null = null;
    if (ctx.weeklyOff.includes(weekdayOf(date))) dayType = 'weekly_off';
    else if (ctx.holidays.has(date)) dayType = 'holiday';
    else {
      const lv = onLeave(ctx.leaveByEmp.get(staff.uuid), date);
      if (lv) { dayType = 'leave'; leaveType = lv.typeCode; }
    }
    const times = (staff.deviceNumber && ctx.punchByDevDate.get(staff.deviceNumber)?.get(date)) || [];
    const reg = ctx.regByEmpDate.get(`${staff.uuid}|${date}`) || null;
    return deriveDay(date, dayType, policy, times, reg, leaveType);
  }

  // Daily grid: every active staff member's status for one date.
  async dayView(schoolId: string, date: string): Promise<any> {
    const ctx = await this.buildContext(schoolId, date, date);
    const staff = await listActiveStaff(schoolId);
    const rows = staff.map((s) => ({
      employeeId: s.uuid, name: s.name, deviceNumber: s.deviceNumber,
      ...this.deriveEmployeeDay(s, date, ctx),
    }));
    return { date, count: rows.length, rows };
  }

  // Per-day list for one employee over a range (oversight + /me reuse this).
  async employeeDays(schoolId: string, employeeId: string, from: string, to: string): Promise<any> {
    const staff = await getEmployee(schoolId, employeeId);
    if (!staff) return null;
    const ctx = await this.buildContext(schoolId, from, to);
    const days = datesInRange(from, to).map((d) => this.deriveEmployeeDay(staff, d, ctx));
    return { employeeId, name: staff.name, deviceNumber: staff.deviceNumber, from, to, days, summary: summarize(days) };
  }

  // School-wide report over a range: one summary row per staff member.
  async report(schoolId: string, from: string, to: string, employeeId?: string): Promise<any> {
    const ctx = await this.buildContext(schoolId, from, to);
    const staff = employeeId
      ? [await getEmployee(schoolId, employeeId)].filter(Boolean) as StaffRow[]
      : await listActiveStaff(schoolId);
    const dates = datesInRange(from, to);
    const rows = staff.map((s) => {
      const days = dates.map((d) => this.deriveEmployeeDay(s, d, ctx));
      return { employeeId: s.uuid, name: s.name, deviceNumber: s.deviceNumber, ...summarize(days) };
    });
    return { from, to, count: rows.length, rows };
  }
}

// Aggregate a list of day results into counts + total late minutes.
function summarize(days: DayResult[]): any {
  const c: Record<string, number> = {};
  let lateMin = 0;
  let workingDays = 0;
  for (const d of days) {
    c[d.status] = (c[d.status] || 0) + 1;
    lateMin += d.lateByMin;
    if (!['weekly_off', 'holiday', 'on_leave'].includes(d.status)) workingDays++;
  }
  return {
    workingDays,
    present: c.present || 0,
    late: c.late || 0,
    halfDay: c.half_day || 0,
    absent: c.absent || 0,
    missingPunch: c.missing_punch || 0,
    regularized: c.regularized || 0,
    onLeave: c.on_leave || 0,
    holiday: c.holiday || 0,
    weeklyOff: c.weekly_off || 0,
    totalLateMin: lateMin,
  };
}

export const staffAttendanceService = new StaffAttendanceService();
