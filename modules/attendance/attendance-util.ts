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
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const isWeeklyOff = weekday === 'sun';
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
  else if (isWeeklyOff) warning = 'Sunday — weekly off';
  else if (holiday?.kind === 'restricted') warning = `${holiday.name || 'Restricted holiday'} (optional)`;
  return { date, weekday, isWeeklyOff, holiday, isNonTeaching, warning };
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
