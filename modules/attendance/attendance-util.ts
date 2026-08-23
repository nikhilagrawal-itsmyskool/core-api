import { DB, singleLineString } from '../../shared/lib/db';
import { ABSENT_TEMPLATE_KEY } from './attendance-constants';
const { serviceAuthHeader } = require('../../shared/util/service-token.js');

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export interface DayFlags {
  date: string;
  weekday: string;
  isWeeklyOff: boolean;               // Sunday (weekly-off rule; Saturdays are working)
  holiday: { name?: string | null; kind: string } | null;
  isNonTeaching: boolean;            // weekly-off OR a full holiday
  warning: string | null;            // human message when non-teaching, else null
}

// Resolve holiday / weekly-off flags for a date from the academic-calendar module.
// Attendance is "warn but allow": this never blocks — it returns a warning the UI
// shows. Reads calendar_holiday directly (same DB, no FK); wrapped defensively so
// attendance never fails when the calendar module isn't installed.
export async function resolveDayFlags(
  schoolId: string, academicYearId: string, date: string,
): Promise<DayFlags> {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekday = WEEKDAYS[dow];
  const isWeeklyOff = (await weeklyOffDays(schoolId, academicYearId)).includes(dow);
  let holiday: { name?: string | null; kind: string } | null = null;
  try {
    const rows = await DB.query(
      singleLineString`select name, kind from calendar_holiday
        where school_id = $1 and academic_year_id = $2 and holiday_date = $3 and status = 'active' limit 1`,
      [schoolId, academicYearId, date],
    );
    if (rows.length > 0) holiday = { name: rows[0].name, kind: rows[0].kind };
  } catch {
    /* calendar module not installed — treat as no declared holiday */
  }
  const isNonTeaching = isWeeklyOff || holiday?.kind === 'full';
  let warning: string | null = null;
  if (holiday?.kind === 'full') warning = `${holiday.name || 'Holiday'} — school is closed on this date`;
  else if (isWeeklyOff) warning = `${WEEKDAY_NAMES[dow]} — weekly off`;
  else if (holiday?.kind === 'restricted') warning = `${holiday.name || 'Restricted holiday'} (optional)`;
  return { date, weekday, isWeeklyOff, holiday, isNonTeaching, warning };
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The academic year's weekly-off weekday numbers (0=Sun..6=Sat). Reads the shared
// academic_year.weekly_off column (owned by the academic-calendar module); null -> [0]
// (Sunday). Wrapped defensively so a missing column never breaks attendance.
export async function weeklyOffDays(schoolId: string, academicYearId: string): Promise<number[]> {
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

// The set of non-teaching dates in a range (full holidays + weekly-off weekdays),
// used to exclude them from attendance-% denominators with certainty. Defensive.
export async function nonTeachingDateSet(schoolId: string, academicYearId: string, from: string, to: string): Promise<Set<string>> {
  const set = new Set<string>();
  const weeklyOff = await weeklyOffDays(schoolId, academicYearId);
  try {
    const rows = await DB.query(
      singleLineString`select to_char(holiday_date,'YYYY-MM-DD') as d from calendar_holiday
        where school_id = $1 and academic_year_id = $2 and status = 'active' and kind = 'full'
          and holiday_date >= $3 and holiday_date <= $4`,
      [schoolId, academicYearId, from, to],
    );
    for (const r of rows) set.add(r.d);
  } catch { /* calendar not installed */ }
  if (weeklyOff.length) {
    let cur = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    while (cur.getTime() <= end.getTime()) {
      if (weeklyOff.includes(cur.getUTCDay())) set.add(cur.toISOString().slice(0, 10));
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  return set;
}

// Base URL of the communication module. Points at the gateway in deployed envs;
// override with COMM_BASE_URL to target the module's own port for standalone runs.
const COMM_BASE_URL = process.env.COMM_BASE_URL || 'http://localhost:3000';

// Fire-and-forget absence notification. Enqueues a communication job for the
// absent students; never throws so a notify failure can't fail finalize (delivery
// is async anyway). Returns the created jobId when known.
export async function notifyAbsences(
  schoolCode: string,
  absentStudentIds: string[],
  context: Record<string, any>,
): Promise<string | null> {
  if (!absentStudentIds.length) return null;
  try {
    const res = await fetch(`${COMM_BASE_URL}/communication/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-School-Code': schoolCode,
        // Service token so this call passes the API authorizer once communication is protected.
        Authorization: serviceAuthHeader({ name: 'attendance' }),
      },
      body: JSON.stringify({
        templateKey: ABSENT_TEMPLATE_KEY,
        source: 'attendance',
        audience: { students: { studentIds: absentStudentIds } },
        context,
      }),
    });
    if (!res.ok) {
      console.error(`[attendance] absence notify failed: HTTP ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    console.log(`[attendance] absence notify enqueued job ${data.jobId} for ${absentStudentIds.length} student(s)`);
    return data.jobId || null;
  } catch (err: any) {
    console.error(`[attendance] absence notify error: ${err.message}`);
    return null;
  }
}
