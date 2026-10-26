// Pure attendance derivation — no DB, so it is directly unit-testable. Turns a day's
// punch times + resolved policy + day-type context into a status.

export interface Policy {
  expectedIn: string;   // 'HH:MM'
  expectedOut: string;  // 'HH:MM'
  graceMin: number;
  halfDayAfterMin: number | null; // worked < this -> half day (null = no half-day rule)
  seasonName: string | null;
}

export interface SeasonRow {
  name: string;
  startMonth: number; startDay: number;
  endMonth: number; endDay: number;
  expectedIn: string; expectedOut: string;
  graceMin: number; halfDayAfterMin: number | null;
  sortOrder: number | null;
}

export interface ConfigRow {
  expectedIn: string; expectedOut: string;
  graceMin: number; halfDayAfterMin: number | null;
}

export type DayType = 'working' | 'weekly_off' | 'holiday' | 'leave';

export interface ApprovedReg { claimedIn: string | null; claimedOut: string | null; }

export interface DayResult {
  date: string;
  status: 'present' | 'late' | 'half_day' | 'missing_punch' | 'absent' | 'regularized' | 'on_leave' | 'holiday' | 'weekly_off';
  firstIn: string | null;   // 'HH:MM'
  lastOut: string | null;   // 'HH:MM'
  lateByMin: number;
  earlyOutByMin: number;
  workedMin: number;
  expectedIn: string | null;
  expectedOut: string | null;
  seasonName: string | null;
  leaveType?: string | null;
  note?: string | null;
}

// 'HH:MM' or 'HH:MM:SS' -> minutes since midnight. Returns NaN on bad input.
export function toMinutes(hhmm: string | null | undefined): number {
  if (!hhmm) return NaN;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm.trim());
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function hhmm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// Does a (month,day) fall within a season window? Handles year-end wrap (e.g. Nov->Feb).
export function monthDayInSeason(month: number, day: number, s: SeasonRow): boolean {
  const v = month * 100 + day;
  const start = s.startMonth * 100 + s.startDay;
  const end = s.endMonth * 100 + s.endDay;
  return start <= end ? v >= start && v <= end : v >= start || v <= end;
}

// Resolve the policy for a date: first matching active season (by sortOrder), else config.
export function resolvePolicyForDate(date: string, config: ConfigRow, seasons: SeasonRow[]): Policy {
  const d = new Date(`${date}T00:00:00Z`);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const ordered = [...seasons].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const s of ordered) {
    if (monthDayInSeason(month, day, s)) {
      return { expectedIn: s.expectedIn, expectedOut: s.expectedOut, graceMin: s.graceMin, halfDayAfterMin: s.halfDayAfterMin, seasonName: s.name };
    }
  }
  return { expectedIn: config.expectedIn, expectedOut: config.expectedOut, graceMin: config.graceMin, halfDayAfterMin: config.halfDayAfterMin, seasonName: null };
}

// Derive one day. `punchTimes` are 'HH:MM:SS' strings sorted ascending.
export function deriveDay(
  date: string,
  dayType: DayType,
  policy: Policy,
  punchTimes: string[],
  reg: ApprovedReg | null,
  leaveType?: string | null,
): DayResult {
  const base: DayResult = {
    date, status: 'absent', firstIn: null, lastOut: null, lateByMin: 0, earlyOutByMin: 0,
    workedMin: 0, expectedIn: policy.expectedIn, expectedOut: policy.expectedOut, seasonName: policy.seasonName,
  };

  if (dayType === 'weekly_off') return { ...base, status: 'weekly_off', expectedIn: null, expectedOut: null };
  if (dayType === 'holiday') return { ...base, status: 'holiday', expectedIn: null, expectedOut: null };
  if (dayType === 'leave') return { ...base, status: 'on_leave', expectedIn: null, expectedOut: null, leaveType: leaveType ?? null };

  // Approved regularization overrides the punch-derived status (times forgiven).
  if (reg && (reg.claimedIn || reg.claimedOut)) {
    const inMin = toMinutes(reg.claimedIn);
    const outMin = toMinutes(reg.claimedOut);
    return {
      ...base,
      status: 'regularized',
      firstIn: reg.claimedIn ? hhmm(inMin) : null,
      lastOut: reg.claimedOut ? hhmm(outMin) : null,
      workedMin: !isNaN(inMin) && !isNaN(outMin) ? Math.max(0, outMin - inMin) : 0,
      note: 'Regularized',
    };
  }

  if (punchTimes.length === 0) return base; // absent

  const expInMin = toMinutes(policy.expectedIn);
  const expOutMin = toMinutes(policy.expectedOut);
  const inMin = toMinutes(punchTimes[0]);
  const firstIn = hhmm(inMin);
  const lateByMin = Math.max(0, inMin - (expInMin + (policy.graceMin || 0)));

  // A single punch = only an in (no out).
  if (punchTimes.length === 1) {
    return { ...base, status: 'missing_punch', firstIn, lastOut: null, lateByMin, note: 'Missing check-out' };
  }

  const outMin = toMinutes(punchTimes[punchTimes.length - 1]);
  const lastOut = hhmm(outMin);
  const workedMin = Math.max(0, outMin - inMin);
  const earlyOutByMin = Math.max(0, expOutMin - outMin);

  let status: DayResult['status'];
  if (policy.halfDayAfterMin != null && workedMin < policy.halfDayAfterMin) status = 'half_day';
  else if (lateByMin > 0) status = 'late';
  else status = 'present';

  return { ...base, status, firstIn, lastOut, lateByMin, earlyOutByMin, workedMin };
}
