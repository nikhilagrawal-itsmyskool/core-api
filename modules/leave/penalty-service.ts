import { DB, singleLineString } from '../../shared/lib/db';
import { NotFoundResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
// Source of truth for "what the day is" = the staff-attendance derivation (live biometric
// punches + policy/seasons + approved leave + holidays). Penalties live here (Leave module)
// because they own the LOP rules + payroll rollup; we consume the derived day statuses.
import { staffAttendanceService } from '../staff-attendance/staff-attendance-service';
// Penalty RULES (half-day LOP weight + late→LOP) are leave-side config.
import { leaveService } from './leave-service';

export interface PenaltyDay {
  date: string;
  status: string;          // staff-attendance status (present/late/absent/half_day/missing_punch/on_leave/holiday/weekly_off/regularized)
  firstIn: string | null;
  lastOut: string | null;
  lateByMin: number;
  leaveType: string | null;
  penaltyDays: number;     // LOP days charged for this day (0 if clean / off / paid leave)
  reason: string | null;   // why a penalty (null when none)
  kind: 'clean' | 'penalty' | 'off' | 'pending'; // UI hint: tick / reason / neutral / needs-action
}

function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const from = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${month}-${String(last).padStart(2, '0')}` };
}

class PenaltyService {
  // Per-day penalty breakdown + monthly LOP total for one employee, from the live
  // staff-attendance pipeline. LOP is expressed in DAYS (no money / no YTD — payroll converts later).
  async monthPenalty(schoolId: string, employeeId: string, month: string): Promise<any> {
    const { from, to } = monthBounds(month);
    const att = await staffAttendanceService.employeeDays(schoolId, employeeId, from, to);
    if (!att) throw new NotFoundResult(ErrorCode.InvalidId, 'Employee not found');

    const cfg = await leaveService.ensureConfig(schoolId); // penalty rules (half-day weight, late→LOP)
    const types = await DB.query(
      singleLineString`select code, paid from leave_type where school_id = $1 and status = 'active'`,
      [schoolId],
    );
    const paidMap = new Map<string, string>(types.map((t: any) => [t.code, t.paid]));
    const isPaidLeave = (code: string | null) => {
      const p = code ? paidMap.get(code) : undefined;
      return p === 'yes' || p === 'discretionary';
    };

    let totalLopDays = 0;
    let lateCount = 0;
    const days: PenaltyDay[] = (att.days || []).map((d: any) => {
      let penaltyDays = 0;
      let reason: string | null = null;
      let kind: PenaltyDay['kind'] = 'clean';

      switch (d.status) {
        case 'weekly_off':
          kind = 'off'; reason = 'Weekly off'; break;
        case 'holiday':
          kind = 'off'; reason = 'Holiday'; break;
        case 'on_leave':
          if (isPaidLeave(d.leaveType)) { kind = 'off'; reason = `On leave (${d.leaveType || 'paid'})`; }
          else { penaltyDays = 1; kind = 'penalty'; reason = `Unpaid leave (LWP${d.leaveType ? ' · ' + d.leaveType : ''})`; }
          break;
        case 'absent':
          penaltyDays = 1; kind = 'penalty'; reason = 'Absent — no approved leave'; break;
        case 'half_day':
          penaltyDays = cfg.halfDayLopWeight; kind = 'penalty'; reason = 'Half day — short hours'; break;
        case 'missing_punch':
          kind = 'pending'; reason = 'Missing check-out — regularize'; break;
        case 'late':
          // Lates roll up into a MONTHLY late penalty below; the day itself isn't a deduction.
          lateCount++; kind = 'clean'; reason = `Late ${d.lateByMin || 0}m`; break;
        case 'regularized':
          kind = 'clean'; reason = 'Regularized'; break;
        default: // present
          kind = 'clean'; break;
      }
      totalLopDays += penaltyDays;
      return {
        date: d.date, status: d.status, firstIn: d.firstIn, lastOut: d.lastOut,
        lateByMin: d.lateByMin || 0, leaveType: d.leaveType ?? null, penaltyDays, reason, kind,
      };
    });

    // Monthly late→LOP roll-up: every `lateLopEvery` late days = `lateLopDays` LOP (0 ⇒ off).
    const latePenaltyDays = cfg.lateLopEvery > 0
      ? Math.floor(lateCount / cfg.lateLopEvery) * cfg.lateLopDays
      : 0;
    totalLopDays += latePenaltyDays;

    return {
      employeeId,
      name: att.name,
      month,
      from,
      to,
      totalLopDays: Math.round(totalLopDays * 10) / 10,
      penaltyDayCount: days.filter((d) => d.penaltyDays > 0).length,
      lateCount,
      latePenaltyDays: Math.round(latePenaltyDays * 10) / 10,
      days,
    };
  }
}

export const penaltyService = new PenaltyService();
