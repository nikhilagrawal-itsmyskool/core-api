import { DB, singleLineString } from '../../shared/lib/db';

// Cross-entity lookups (no FKs). Reads employee + biometric_punch + leave + calendar,
// each defensive so a missing sibling module never breaks a read.

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const rows = await DB.query(singleLineString`select uuid from school where lower(code) = lower($1)`, [schoolCode]);
  return rows.length > 0 ? rows[0].uuid : null;
}

export interface StaffRow {
  uuid: string;
  name: string;
  deviceNumber: string | null;
  employeeNumber: string | null;
}

export async function getEmployee(schoolId: string, id: string): Promise<StaffRow | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name, device_number, employee_number from employee
      where uuid = $1 and school_id = $2 and status <> 'deleted'`,
    [id, schoolId],
  );
  return rows.length ? rows[0] : null;
}

export async function listActiveStaff(schoolId: string): Promise<StaffRow[]> {
  return DB.query(
    singleLineString`select uuid, name, device_number, employee_number from employee
      where school_id = $1 and status = 'active' order by name`,
    [schoolId],
  );
}

export interface PunchRow { deviceNumber: string; d: string; t: string; }

// All punches in [from,to] (YYYY-MM-DD, inclusive) as device-local date + time strings
// (to_char avoids JS Date timezone drift on the naive wall-clock timestamp).
export async function punchesInRange(schoolId: string, from: string, to: string): Promise<PunchRow[]> {
  try {
    return await DB.query(
      singleLineString`select device_number,
          to_char(punched_at, 'YYYY-MM-DD') as d,
          to_char(punched_at, 'HH24:MI:SS') as t
        from biometric_punch
        where school_id = $1 and punched_at >= $2::date and punched_at < ($3::date + interval '1 day')
          and device_number is not null
        order by device_number, punched_at`,
      [schoolId, from, to],
    );
  } catch {
    return []; // biometric module not installed / no punches table
  }
}

// Current academic year (date range containing today, else latest). For weekly-off set.
export async function getCurrentAcademicYearId(schoolId: string): Promise<string | null> {
  try {
    const rows = await DB.query(
      singleLineString`select uuid from academic_year where school_id = $1
        order by (case when current_date between start_date and end_date then 0 else 1 end), start_date desc nulls last
        limit 1`,
      [schoolId],
    );
    return rows.length ? rows[0].uuid : null;
  } catch {
    return null;
  }
}

// Weekly-off weekday numbers (0=Sun..6=Sat); default [0] (Sunday). Mirrors leave-common.
export async function weeklyOffDays(schoolId: string, academicYearId: string | null): Promise<number[]> {
  if (!academicYearId) return [0];
  try {
    const rows = await DB.query(
      singleLineString`select weekly_off from academic_year where uuid = $1 and school_id = $2`,
      [academicYearId, schoolId],
    );
    if (!rows.length || rows[0].weeklyOff == null) return [0];
    const s = String(rows[0].weeklyOff).trim();
    if (s === '') return [];
    return s.split(',').map((x) => parseInt(x, 10)).filter((n) => n >= 0 && n <= 6);
  } catch {
    return [0];
  }
}

// Full staff holidays (kind='full', not staff_working) in [from,to] -> date->name.
export async function fullHolidaysInRange(schoolId: string, from: string, to: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = await DB.query(
      singleLineString`select to_char(holiday_date,'YYYY-MM-DD') as d, name from calendar_holiday
        where school_id = $1 and status = 'active' and kind = 'full' and coalesce(staff_working, false) = false
          and holiday_date >= $2 and holiday_date <= $3`,
      [schoolId, from, to],
    );
    for (const r of rows) map.set(r.d, r.name || 'Holiday');
  } catch { /* calendar module absent */ }
  return map;
}

// Approved-leave intervals per employee overlapping [from,to].
export interface LeaveInterval { from: string; to: string; typeCode: string; }
export async function approvedLeaveByEmployee(schoolId: string, from: string, to: string): Promise<Map<string, LeaveInterval[]>> {
  const map = new Map<string, LeaveInterval[]>();
  try {
    const rows = await DB.query(
      singleLineString`select employee_id,
          to_char(from_date,'YYYY-MM-DD') as from_d, to_char(to_date,'YYYY-MM-DD') as to_d, leave_type_code
        from leave_application
        where school_id = $1 and status = 'approved' and from_date <= $3 and to_date >= $2`,
      [schoolId, from, to],
    );
    for (const r of rows) {
      const list = map.get(r.employeeId) || [];
      list.push({ from: r.fromD, to: r.toD, typeCode: r.leaveTypeCode });
      map.set(r.employeeId, list);
    }
  } catch { /* leave module absent */ }
  return map;
}

export function onLeave(intervals: LeaveInterval[] | undefined, date: string): LeaveInterval | null {
  if (!intervals) return null;
  for (const iv of intervals) {
    if (date >= iv.from && date <= iv.to) return iv;
  }
  return null;
}

// Each date (YYYY-MM-DD) in [from,to] inclusive.
export function datesInRange(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() < start.getTime()) return out;
  const cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// UTC weekday (0=Sun) for a YYYY-MM-DD.
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
