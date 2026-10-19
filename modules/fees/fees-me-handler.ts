import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { DB, singleLineString } from '../../shared/lib/db';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guardActiveStudent } from '../auth/auth-utils';
import { resolveStudentEnrollment } from '../../shared/lib/student-context';
import { istToday } from '../../shared/util/datetime';
import { feesLedgerService } from './fees-ledger-service';
import { feesReportService } from './fees-report-service';

const nn = (v: any): number => (v == null ? 0 : Number(v));

// A late-fine ledger line is the "Late Fee Fine" head (apply-fine posts it with
// head_label 'Late Fee Fine'; the matcher there is `head_label ilike '%late%'`).
const isFine = (label: any): boolean => /late/i.test(String(label || ''));

// The parent-app fee summary for the active child. Built on the same
// feesLedgerService the Collection Desk uses, so dues/late-fine match the office.
class FeesMeHandler {
  // GET /fees/me  — current-year summary for the active child (X-Student-Id).
  public summary = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const schoolId = auth.token.school_id;
      const studentId = auth.activeStudentId;

      const enrol = await resolveStudentEnrollment(schoolId, studentId);
      const academicYearId = enrol?.academicYearId || undefined;

      // Full current-year ledger → due-line breakdown + late-fine subset. Passing the
      // year makes the due-date buckets (dueNow / overdue) accurate.
      const led = await feesLedgerService.studentLedger(schoolId, studentId, academicYearId);
      const t = led.totals;
      const today = istToday();

      const dueLines = led.lines.filter((l) => l.remaining > 0);
      const overdueLines = dueLines.filter((l) => l.dueDate && l.dueDate < today);
      const lateFine = led.lines.filter((l) => isFine(l.headLabel)).reduce((s, l) => s + l.remaining, 0);
      const oldestDueDate = overdueLines.map((l) => l.dueDate).filter(Boolean).sort()[0] || null;

      const outstanding = t.outstanding;
      const status: 'paid' | 'overdue' | 'due' | 'upcoming' =
        outstanding <= 0 ? 'paid' : overdueLines.length > 0 ? 'overdue' : t.dueNow > 0 ? 'due' : 'upcoming';

      // Active receipts for this child + year — proof-of-payment the parent can browse.
      const receiptRows = academicYearId
        ? await DB.query(
            singleLineString`
              select uuid, receipt_no, receipt_date::text as receipt_date, total_paid, payment_mode, type
              from fee_receipt
              where school_id = $1 and student_id = $2 and academic_year_id = $3 and status = 'active'
              order by receipt_date desc, created_at desc limit 50`,
            [schoolId, studentId, academicYearId],
          )
        : [];
      const receipts = receiptRows.map((r: any) => ({
        uuid: r.uuid,
        receiptNo: r.receiptNo,
        date: r.receiptDate,
        amount: nn(r.totalPaid),
        mode: r.paymentMode || null,
        type: r.type || null,
      }));

      // Carried-forward arrears: outstanding in any PRIOR academic year (not this one),
      // shown as a separate, clearly-labelled line so a parent knows the child is carrying
      // a balance from before. Same cross-year logic the Collect screen's "also owes" banner uses.
      const byYear = await feesReportService.duesByYear(schoolId, studentId);
      const priorYears = byYear
        .filter((r: any) => r.academicYearId !== academicYearId)
        .map((r: any) => ({ academicYearId: r.academicYearId, yearName: r.yearName || null, amount: nn(r.balance) }));
      const priorYearsDue = priorYears.reduce((s: number, y: any) => s + y.amount, 0);

      // Due-line breakdown the app can list under the summary (overdue first).
      const components = dueLines
        .map((l) => ({
          label: l.headLabel,
          cycleLabel: l.cycleLabel,
          remaining: l.remaining,
          dueDate: l.dueDate,
          overdue: !!(l.dueDate && l.dueDate < today),
          isFine: isFine(l.headLabel),
        }))
        .sort((a, b) => Number(b.overdue) - Number(a.overdue));

      ResponseBuilder.ok(
        {
          studentId,
          academicYearId: academicYearId || null,
          academicYearName: enrol?.academicYearName || null,
          className: enrol?.className || null,
          status,
          charged: t.charged,
          paid: t.paid,
          concession: t.concession,
          outstanding,
          advance: t.advance,
          dueNow: t.dueNow,
          dueQuarter: t.dueQuarter,
          upcoming: t.upcoming,
          lateFine,
          oldestDueDate,
          priorYearsDue,
          priorYears,
          monthEndLabel: t.monthEndLabel,
          quarterEndLabel: t.quarterEndLabel,
          components,
          receipts,
        },
        callback,
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

export const summary = new FeesMeHandler().summary;
