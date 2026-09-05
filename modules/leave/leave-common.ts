import { DB, singleLineString } from "../../shared/lib/db";

// Shared cross-entity lookups (no FKs — validated in app code). Mirrors the small
// helpers homework/syllabus use so the leave module stays self-contained.

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// "Current" academic year = the year whose date range contains today, else the
// latest-starting year. Used to resolve the weekly-off set for working-day counts.
export async function getCurrentAcademicYearId(schoolId: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from academic_year where school_id = $1
      order by (case when current_date between start_date and end_date then 0 else 1 end),
               start_date desc nulls last
      limit 1`,
    [schoolId],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// An active employee by uuid, or null.
export async function findEmployee(
  schoolId: string,
  employeeId: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from employee where uuid = $1 and school_id = $2 and status <> 'deleted'`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// Employee ids with an approver role (god/admin) — the leave approvers. Best-effort:
// wrapped defensively so a missing role table never breaks the apply flow.
export async function approverEmployeeIds(schoolId: string): Promise<string[]> {
  try {
    const rows = await DB.query(
      singleLineString`select distinct er.employee_id from employee_role er
        join role r on r.uuid = er.role_id
        where er.school_id = $1 and lower(r.name) in ('god', 'admin')`,
      [schoolId],
    );
    return rows.map((r: any) => r.employeeId).filter(Boolean);
  } catch {
    return [];
  }
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The academic year's weekly-off weekday numbers (0=Sun..6=Sat). Reads the shared
// academic_year.weekly_off column (owned by academic-calendar); null -> [0] (Sunday).
// Defensive so a missing column never breaks leave.
export async function weeklyOffDays(schoolId: string, academicYearId: string): Promise<number[]> {
  try {
    const rows = await DB.query(
      singleLineString`select weekly_off from academic_year where uuid = $1 and school_id = $2`,
      [academicYearId, schoolId],
    );
    if (!rows.length || rows[0].weeklyOff == null) return [0];
    const s = String(rows[0].weeklyOff).trim();
    if (s === "") return [];
    return s.split(",").map((x) => parseInt(x, 10)).filter((n) => n >= 0 && n <= 6);
  } catch {
    return [0];
  }
}

// Full holidays (kind='full') in [from, to] inclusive as date(YYYY-MM-DD) -> name.
// Defensive against a missing academic-calendar module.
export async function fullHolidaysInRange(schoolId: string, from: string, to: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = await DB.query(
      singleLineString`select to_char(holiday_date,'YYYY-MM-DD') as d, name from calendar_holiday
        where school_id = $1 and status = 'active' and kind = 'full' and holiday_date >= $2 and holiday_date <= $3`,
      [schoolId, from, to],
    );
    for (const r of rows) map.set(r.d, r.name || "Holiday");
  } catch {
    /* calendar module not installed */
  }
  return map;
}

// Working days in [from, to] inclusive: calendar days minus weekly-offs minus full
// holidays (calendar_holiday). Both YYYY-MM-DD. Defensive against a missing calendar
// module. Returns 0 if the range is inverted.
export async function workingDaysBetween(
  schoolId: string,
  from: string,
  to: string,
): Promise<number> {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end.getTime() < start.getTime()) return 0;

  const ay = await getCurrentAcademicYearId(schoolId);
  const weeklyOff = ay ? await weeklyOffDays(schoolId, ay) : [0];

  const holidays = new Set<string>();
  try {
    const rows = await DB.query(
      singleLineString`select to_char(holiday_date,'YYYY-MM-DD') as d from calendar_holiday
        where school_id = $1 and status = 'active' and kind = 'full'
          and holiday_date >= $2 and holiday_date <= $3`,
      [schoolId, from, to],
    );
    for (const r of rows) holidays.add(r.d);
  } catch {
    /* calendar module not installed — count only weekly-off exclusions */
  }

  let count = 0;
  const cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    const iso = cur.toISOString().slice(0, 10);
    if (!weeklyOff.includes(cur.getUTCDay()) && !holidays.has(iso)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

// Each calendar date (YYYY-MM-DD) in [from, to] inclusive. Used for the per-day cap.
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

// First + last day of the calendar month a date falls in (YYYY-MM-DD).
export function monthBounds(date: string): { first: string; last: string; month: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth(); // 0-based
  const first = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const month = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { first, last, month };
}

export { WEEKDAY_NAMES };
