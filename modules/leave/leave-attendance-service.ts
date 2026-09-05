import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { findEmployee } from "./leave-common";
import { reconcileMonth, MonthReconciliation } from "./leave-reconcile";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const MANUAL_STATUSES = ["present", "absent", "holiday", "off", "suspect", "unknown"];

export interface DayLeaveRow {
  employeeId: string;
  employeeName: string | null;
  leaveTypeCode: string;
  leaveTypeName: string | null;
  status: string; // approved | pending
  fromDate: string;
  toDate: string;
  reason: string | null;
}

class LeaveAttendanceService {
  private parseMonth(month: string): { year: number; month: number } {
    if (!MONTH_RE.test(month)) throw new BusinessErrorResult(ErrorCode.BusinessError, "month must be YYYY-MM");
    const [y, m] = month.split("-").map((x) => parseInt(x, 10));
    return { year: y, month: m };
  }

  // Reconciled per-day view for one employee for a month (self view + god drill-down).
  async employeeMonth(schoolId: string, employeeId: string, month: string, today: string): Promise<MonthReconciliation> {
    const { year, month: m } = this.parseMonth(month);
    return reconcileMonth(schoolId, employeeId, year, m, today);
  }

  // Manual attendance mark / override (admin). Upserts one day. Also the interim way
  // to populate attendance before the biometric importer is wired to the device file.
  async mark(
    schoolId: string,
    employeeId: string,
    date: string,
    status: string,
    opts: { firstIn?: string; lastOut?: string; note?: string; userId?: string } = {},
  ): Promise<void> {
    if (!(await findEmployee(schoolId, employeeId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid employee");
    if (!DATE_RE.test(date)) throw new BusinessErrorResult(ErrorCode.BusinessError, "date must be YYYY-MM-DD");
    if (!MANUAL_STATUSES.includes(status)) throw new BusinessErrorResult(ErrorCode.BusinessError, `status must be one of ${MANUAL_STATUSES.join(", ")}`);
    const now = new Date();
    const firstIn = opts.firstIn ? new Date(opts.firstIn) : null;
    const lastOut = opts.lastOut ? new Date(opts.lastOut) : null;
    const minutes = firstIn && lastOut ? Math.max(0, Math.round((lastOut.getTime() - firstIn.getTime()) / 60000)) : null;
    await DB.query(
      singleLineString`insert into employee_attendance_day
        (uuid, school_id, employee_id, att_date, status, first_in, last_out, minutes_worked, source, override_note, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', $9, $10, $10)
        on conflict (school_id, employee_id, att_date) do update set
          status = excluded.status, first_in = excluded.first_in, last_out = excluded.last_out,
          minutes_worked = excluded.minutes_worked, source = 'manual', override_note = excluded.override_note, updated_at = excluded.updated_at`,
      [generateShortUuid(12), schoolId, employeeId, date, status, firstIn, lastOut, minutes, opts.note?.slice(0, 256) || null, now],
    );
  }

  // Who is on leave (and, if attendance is imported, who is absent) on a date.
  async dayView(schoolId: string, date: string): Promise<{ date: string; onLeave: DayLeaveRow[]; unauthorizedCount: number }> {
    if (!DATE_RE.test(date)) throw new BusinessErrorResult(ErrorCode.BusinessError, "date must be YYYY-MM-DD");
    const rows = await DB.query(
      singleLineString`select a.employee_id, e.name as employee_name, a.leave_type_code, t.name as leave_type_name, a.status,
          a.from_date::text as from_date, a.to_date::text as to_date, a.reason
        from leave_application a
        left join employee e on e.uuid = a.employee_id and e.school_id = a.school_id
        left join leave_type t on lower(t.code) = lower(a.leave_type_code) and t.school_id = a.school_id
        where a.school_id = $1 and a.status in ('approved', 'pending') and a.from_date <= $2 and a.to_date >= $2
        order by a.status, e.name`,
      [schoolId, date],
    );
    const unauth = await DB.query(
      singleLineString`select count(1)::int as n from employee_attendance_day d
        where d.school_id = $1 and d.att_date = $2 and d.status = 'absent'
          and not exists (select 1 from leave_application a
            where a.school_id = d.school_id and a.employee_id = d.employee_id and a.status = 'approved'
              and a.from_date <= $2 and a.to_date >= $2)`,
      [schoolId, date],
    );
    return {
      date,
      onLeave: rows.map((r: any) => ({
        employeeId: r.employeeId,
        employeeName: r.employeeName || null,
        leaveTypeCode: r.leaveTypeCode,
        leaveTypeName: r.leaveTypeName || null,
        status: r.status,
        fromDate: r.fromDate,
        toDate: r.toDate,
        reason: r.reason || null,
      })),
      unauthorizedCount: unauth[0].n,
    };
  }

  // ── Biometric enrollment-code mapping ────────────────────────────────────────
  async listMap(schoolId: string): Promise<{ enrollCode: string; employeeId: string; employeeName: string | null }[]> {
    const rows = await DB.query(
      singleLineString`select m.enroll_code, m.employee_id, e.name as employee_name
        from employee_biometric_map m
        left join employee e on e.uuid = m.employee_id and e.school_id = m.school_id
        where m.school_id = $1 and m.status = 'active' order by e.name nulls last, m.enroll_code`,
      [schoolId],
    );
    return rows.map((r: any) => ({ enrollCode: r.enrollCode, employeeId: r.employeeId, employeeName: r.employeeName || null }));
  }

  async mapEnroll(schoolId: string, enrollCode: string, employeeId: string, userId: string): Promise<void> {
    if (!enrollCode?.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, "enrollCode is required");
    if (!(await findEmployee(schoolId, employeeId))) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid employee");
    const now = new Date();
    await DB.query(
      singleLineString`update employee_biometric_map set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where school_id = $3 and enroll_code = $4 and status = 'active'`,
      [userId, now, schoolId, enrollCode.trim()],
    );
    await DB.query(
      singleLineString`insert into employee_biometric_map (uuid, school_id, enroll_code, employee_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, 'active', $5, $6)`,
      [generateShortUuid(12), schoolId, enrollCode.trim(), employeeId, userId, now],
    );
  }

  async resolveEnroll(schoolId: string): Promise<Map<string, string>> {
    const rows = await DB.query(
      singleLineString`select enroll_code, employee_id from employee_biometric_map where school_id = $1 and status = 'active'`,
      [schoolId],
    );
    return new Map<string, string>(rows.map((r: any) => [String(r.enrollCode), r.employeeId]));
  }
}

export const leaveAttendanceService = new LeaveAttendanceService();
