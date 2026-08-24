import { DB, singleLineString } from '../../shared/lib/db';
import { BadRequestResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { istToday } from '../../shared/util/datetime';
import { dueBuckets } from './fees-util';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// A ledger entry row (camelCase, as returned by DB.query).
interface LedgerRow {
  uuid: string;
  studentId: string | null;
  academicYearId: string;
  entryDate: string;
  category: string;
  feeHeadId: string | null;
  cycleId: string | null;
  headLabel: string | null;
  cycleLabel: string | null;
  kind: string; // charge | concession | payment | waiver | adjust
  debit: number | null;
  credit: number | null;
  settlesEntryId: string | null;
  sourceModule: string | null;
  sourceRef: string | null;
  remarks: string | null;
  status: string;
}

const n = (v: any): number => (v == null ? 0 : Number(v));

class FeesLedgerService {
  // ---- READ: full ledger for a student (optionally a single year) ----
  // includeCancelled: also return the meaningful cancelled/superseded entries (charges, concessions,
  // waivers, receipt-voided payments) so the UI can show a history trail — e.g. an exam-only rollback
  // or a concession change. Reallocation churn (updatedby='reallocate') is excluded as noise. Active
  // lines/totals are unaffected (dues never count cancelled rows).
  public async studentLedger(schoolId: string, studentId: string, academicYearId?: string, includeCancelled = false) {
    const params: any[] = [schoolId, studentId];
    let where = `school_id = $1 and student_id = $2 and status = 'active'`;
    if (academicYearId) { params.push(academicYearId); where += ` and academic_year_id = $3`; }
    const rows: LedgerRow[] = await DB.query(
      singleLineString`select * from student_ledger_entry where ${where} order by entry_date, created_at`,
      params
    );

    // cycle due dates (by name) so each line can be flagged due-now vs not-yet-due. Migrated
    // charges carry cycle_label (not cycle_id), so we map by name. A line with no cycle / no due
    // date counts as due now (one-time heads tied to TOA, etc.).
    const nrm = (s: any) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    // pg returns `date` columns as JS Date objects (local midnight). Format with local getters —
    // toISOString() would shift the calendar day back in IST. Already-string values are sliced.
    const ymd = (v: any): string | null => {
      if (!v) return null;
      if (v instanceof Date) {
        return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
      }
      return String(v).slice(0, 10);
    };
    const cycleDue: Record<string, string | null> = {};
    // cycle + head display order (fee_cycle.sort_order / fee_head.sort_order), keyed by id AND name
    // (migrated charges carry labels, not always ids) — so the ledger reads chronologically everywhere.
    const cycleOrdById: Record<string, number> = {}, cycleOrdByName: Record<string, number> = {};
    const headOrdById: Record<string, number> = {}, headOrdByName: Record<string, number> = {};
    if (academicYearId) {
      const cyc: any[] = await DB.query(
        singleLineString`select uuid, name, due_date, sort_order from fee_cycle where school_id = $1 and academic_year_id = $2 and status = 'active'`,
        [schoolId, academicYearId]
      );
      cyc.forEach((c) => { cycleDue[nrm(c.name)] = ymd(c.dueDate); const o = c.sortOrder == null ? 999 : Number(c.sortOrder); cycleOrdById[c.uuid] = o; cycleOrdByName[nrm(c.name)] = o; });
      const hds: any[] = await DB.query(
        singleLineString`select uuid, name, sort_order from fee_head where school_id = $1 and academic_year_id = $2 and status = 'active'`,
        [schoolId, academicYearId]
      );
      hds.forEach((h) => { const o = h.sortOrder == null ? 999 : Number(h.sortOrder); headOrdById[h.uuid] = o; headOrdByName[nrm(h.name)] = o; });
    }
    const bkt = dueBuckets(); // due-now (<= end of month) / this-or-next quarter / later

    // credits grouped by the charge they settle
    const bySettle: Record<string, LedgerRow[]> = {};
    for (const r of rows) if (r.settlesEntryId) (bySettle[r.settlesEntryId] ||= []).push(r);

    const lines = rows
      .filter((r) => r.kind === 'charge')
      .map((c) => {
        const applied = bySettle[c.uuid] || [];
        const concession = applied.filter((a) => a.kind === 'concession').reduce((s, a) => s + n(a.credit), 0);
        const waiver = applied.filter((a) => a.kind === 'waiver').reduce((s, a) => s + n(a.credit), 0);
        const paid = applied.filter((a) => a.kind === 'payment').reduce((s, a) => s + n(a.credit), 0);
        const net = n(c.debit) - concession - waiver;
        const remaining = Math.max(0, net - paid);
        const status = remaining <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
        const dueDate = c.cycleLabel ? (cycleDue[nrm(c.cycleLabel)] ?? null) : null;
        // bucket: due now (<= end of this month, incl. no-date one-time), this/next quarter, or later
        const bucket = !dueDate || dueDate <= bkt.endOfMonth ? 'due' : dueDate <= bkt.quarterEnd ? 'quarter' : 'later';
        const due = bucket === 'due';
        return {
          chargeId: c.uuid, category: c.category, feeHeadId: c.feeHeadId, cycleId: c.cycleId,
          headLabel: c.headLabel, cycleLabel: c.cycleLabel, entryDate: c.entryDate,
          charged: n(c.debit), concession, waiver, paid, net, remaining, status, dueDate, due, bucket,
        };
      });

    // order chronologically by cycle then head (sort_order), keeping the whole fees UI consistent
    if (academicYearId) {
      const co = (l: any) => cycleOrdById[l.cycleId] ?? cycleOrdByName[nrm(l.cycleLabel)] ?? 999;
      const ho = (l: any) => headOrdById[l.feeHeadId] ?? headOrdByName[nrm(l.headLabel)] ?? 999;
      lines.sort((a, b) => co(a) - co(b) || ho(a) - ho(b) || String(a.headLabel || '').localeCompare(String(b.headLabel || '')));
    }

    const totalDebit = rows.reduce((s, r) => s + n(r.debit), 0);
    const totalCredit = rows.reduce((s, r) => s + n(r.credit), 0);
    const outstanding = totalDebit - totalCredit;
    const dueNow = lines.filter((l) => l.bucket === 'due').reduce((s, l) => s + l.remaining, 0);
    const thisQuarter = lines.filter((l) => l.bucket === 'quarter').reduce((s, l) => s + l.remaining, 0);
    const upcoming = lines.filter((l) => l.bucket !== 'due').reduce((s, l) => s + l.remaining, 0);
    const totals = {
      charged: rows.filter((r) => r.kind === 'charge').reduce((s, r) => s + n(r.debit), 0),
      concession: rows.filter((r) => r.kind === 'concession').reduce((s, r) => s + n(r.credit), 0),
      waiver: rows.filter((r) => r.kind === 'waiver').reduce((s, r) => s + n(r.credit), 0),
      paid: rows.filter((r) => r.kind === 'payment').reduce((s, r) => s + n(r.credit), 0),
      outstanding: Math.max(0, outstanding),
      advance: Math.max(0, -outstanding),
      dueNow,       // remaining due through end of this month (overdue + current month)
      thisQuarter,  // remaining due later this quarter (disjoint) — kept for internal grouping
      dueQuarter: dueNow + thisQuarter, // CUMULATIVE: due through end of the quarter
      upcoming,     // remaining not yet due (this quarter + later) — full-year minus due-now
      quarterLabel: bkt.label,
      monthEndLabel: bkt.monthEndLabel,     // e.g. "till Aug end"
      quarterEndLabel: bkt.quarterEndLabel, // e.g. "till Sep end"
      yearEndLabel: bkt.yearEndLabel,       // "till Mar end"
    };
    // cancelled/superseded entries (opt-in) — the audit trail for rollbacks & concession changes.
    // Excludes reallocation churn so only real cancellations surface.
    let cancelledEntries: any[] = [];
    if (includeCancelled) {
      const cp: any[] = [schoolId, studentId];
      let cwhere = `school_id = $1 and student_id = $2 and status = 'cancelled' and coalesce(updatedby_userid,'') <> 'reallocate'`;
      if (academicYearId) { cp.push(academicYearId); cwhere += ` and academic_year_id = $3`; }
      cancelledEntries = await DB.query(
        singleLineString`select uuid, kind, head_label, cycle_label, debit, credit, remarks, entry_date, updated_at, updatedby_userid, source_ref from student_ledger_entry where ${cwhere} order by entry_date, kind, head_label`,
        cp
      );
    }
    return { studentId, academicYearId: academicYearId || null, lines, entries: rows, totals, cancelledEntries };
  }

  public async studentSummary(schoolId: string, studentId: string, academicYearId?: string) {
    const led = await this.studentLedger(schoolId, studentId, academicYearId);
    const dueLines = led.lines.filter((l) => l.remaining > 0);
    return {
      studentId,
      charged: led.totals.charged,
      paid: led.totals.paid,
      concession: led.totals.concession,
      outstanding: led.totals.outstanding,
      advance: led.totals.advance,
      dueNow: led.totals.dueNow,
      thisQuarter: led.totals.thisQuarter,
      dueQuarter: led.totals.dueQuarter,
      upcoming: led.totals.upcoming,
      quarterLabel: led.totals.quarterLabel,
      monthEndLabel: led.totals.monthEndLabel,
      quarterEndLabel: led.totals.quarterEndLabel,
      yearEndLabel: led.totals.yearEndLabel,
      walletBalance: 0, // supplies wallet deferred
      dueComponents: dueLines.length,
    };
  }

  // ---- WRITE: post charges (accrue-per-cycle) for a year ----
  // opts: { academicYearId, cycleId?, classId?, studentIds?, asOf? }
  public async chargeRun(schoolId: string, opts: any, userId: string) {
    if (!opts?.academicYearId) throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    const ay = opts.academicYearId;
    const asOf: string = opts.asOf || istToday();
    const dryRun = !!opts.dryRun; // preview: compute what would be posted, write nothing
    // fullYear posts every cycle in the structure (matches the migrated full-year model);
    // default accrual only posts cycles that have started as of asOf.
    const fullYear = !!opts.fullYear;

    // 1. target students + their class
    let enrolWhere = `sc.school_id = $1 and sc.academic_year_id = $2`;
    const enrolParams: any[] = [schoolId, ay];
    if (opts.classId) { enrolParams.push(opts.classId); enrolWhere += ` and sc.class_id = $${enrolParams.length}`; }
    if (Array.isArray(opts.studentIds) && opts.studentIds.length) {
      const ph = opts.studentIds.map((_: any, i: number) => `$${enrolParams.length + i + 1}`).join(',');
      enrolWhere += ` and sc.student_id in (${ph})`;
      enrolParams.push(...opts.studentIds);
    }
    // exam-only students (enrolled here, studying elsewhere) never accrue demands.
    const students: any[] = await DB.query(
      singleLineString`select sc.student_id, sc.class_id from student_class sc
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id
        where ${enrolWhere} and coalesce(s.exam_only, false) = false`,
      enrolParams
    );
    if (!students.length) return { posted: 0, students: 0 };

    // 2. reference config for the year
    const cycles: any[] = await DB.query(
      singleLineString`select uuid, name, from_date, due_date, sort_order from fee_cycle where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ay]
    );
    const cycleById: Record<string, any> = {}; cycles.forEach((c) => (cycleById[c.uuid] = c));
    // cycle order (by id) so a bounded concession is only applied within its from/to cycle span
    const cycleOrd: Record<string, number> = {}; cycles.forEach((c, i) => (cycleOrd[c.uuid] = c.sortOrder == null ? i : Number(c.sortOrder)));
    const heads: any[] = await DB.query(
      singleLineString`select uuid, name, kind, one_time from fee_head where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ay]
    );
    const headById: Record<string, any> = {}; heads.forEach((h) => (headById[h.uuid] = h));

    const queries: string[] = []; const params: any[][] = [];
    let charges = 0, concessions = 0, waivers = 0;
    let totalCharge = 0, totalConcession = 0, totalWaiver = 0;
    const affectedMap: Record<string, { charges: number; amount: number }> = {};

    for (const s of students) {
      // structure for the class + per-student overrides (override wins)
      const cls: any[] = await DB.query(
        singleLineString`select fee_head_id, cycle_id, amount from fee_structure where school_id = $1 and academic_year_id = $2 and class_id = $3 and status = 'active'`,
        [schoolId, ay, s.classId]
      );
      const ov: any[] = await DB.query(
        singleLineString`select fee_head_id, cycle_id, amount from fee_structure_student where school_id = $1 and academic_year_id = $2 and student_id = $3 and status = 'active'`,
        [schoolId, ay, s.studentId]
      );
      const amt: Record<string, number> = {};
      cls.forEach((r) => (amt[`${r.feeHeadId}|${r.cycleId}`] = n(r.amount)));
      ov.forEach((r) => (amt[`${r.feeHeadId}|${r.cycleId}`] = n(r.amount)));

      // already-posted charges (idempotency)
      const existing: any[] = await DB.query(
        singleLineString`select fee_head_id, cycle_id from student_ledger_entry where school_id = $1 and student_id = $2 and academic_year_id = $3 and kind = 'charge' and status = 'active'`,
        [schoolId, s.studentId, ay]
      );
      const done = new Set(existing.map((e) => `${e.feeHeadId}|${e.cycleId}`));

      // student's active concessions (by head), carrying cycle bounds so a stopped scheme
      // isn't re-applied to out-of-range cycles by a later charge run.
      const concs: any[] = await DB.query(
        singleLineString`select c.fee_head_id, c.value_type, c.value, c.name, cs.effective_from_cycle, cs.effective_to_cycle from fee_concession_student cs join fee_concession c on c.uuid = cs.concession_id and c.status = 'active' where cs.school_id = $1 and cs.student_id = $2 and c.academic_year_id = $3 and cs.status = 'active'`,
        [schoolId, s.studentId, ay]
      );
      const concByHead: Record<string, any> = {}; concs.forEach((c) => (concByHead[c.feeHeadId] = c));
      // waivers (by head|cycle)
      const wvs: any[] = await DB.query(
        singleLineString`select fee_head_id, cycle_id from fee_waiver where school_id = $1 and student_id = $2 and academic_year_id = $3 and status = 'active'`,
        [schoolId, s.studentId, ay]
      );
      const waived = new Set(wvs.map((w) => `${w.feeHeadId}|${w.cycleId}`));

      for (const key of Object.keys(amt)) {
        if (done.has(key)) continue;
        const [headId, cycleId] = key.split('|');
        const head = headById[headId]; const cyc = cycleById[cycleId];
        if (!head) continue;
        // accrue: one-time heads always; recurring only once the cycle has started (unless fullYear)
        const started = head.oneTime || (cyc && cyc.fromDate && new Date(cyc.fromDate).getTime() <= new Date(asOf).getTime());
        if (!fullYear && !started) continue;
        const amount = amt[key];
        const now = new Date();
        const category = head.kind === 'transport' ? 'transport' : 'fee';
        const chargeId = generateShortUuid(12);
        charges++; totalCharge += amount;
        (affectedMap[s.studentId] ||= { charges: 0, amount: 0 }).charges++;
        affectedMap[s.studentId].amount += amount;
        if (!dryRun) {
          queries.push(singleLineString`
            insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, debit, source_module, allocation, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'charge',$11,'fees','explicit','active',$12,$13)`);
          params.push([chargeId, schoolId, s.studentId, ay, asOf, category, headId, cycleId, head.name, cyc ? cyc.name : null, amount, userId, now]);
        }

        // concession on this head — only within the assignment's cycle bounds (if any)
        const conc = concByHead[headId];
        const cOrd = cycleOrd[cycleId];
        const inBounds = !conc ? false : (
          (conc.effectiveFromCycle == null || cOrd == null || cOrd >= (cycleOrd[conc.effectiveFromCycle] ?? -Infinity)) &&
          (conc.effectiveToCycle == null || cOrd == null || cOrd <= (cycleOrd[conc.effectiveToCycle] ?? Infinity))
        );
        if (conc && inBounds) {
          const cval = conc.valueType === 'percent' ? (amount * n(conc.value)) / 100 : Math.min(n(conc.value), amount);
          if (cval > 0) {
            concessions++; totalConcession += cval;
            if (!dryRun) {
              queries.push(singleLineString`
                insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, allocation, status, createdby_userid, created_at)
                values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'concession',$11,$12,'fees','explicit','active',$13,$14)`);
              params.push([generateShortUuid(12), schoolId, s.studentId, ay, asOf, category, headId, cycleId, conc.name, cyc ? cyc.name : null, cval, chargeId, userId, now]);
            }
          }
        }
        // waiver on this (head, cycle) → waive the full amount
        if (waived.has(key)) {
          waivers++; totalWaiver += amount;
          if (!dryRun) {
            queries.push(singleLineString`
              insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, allocation, status, createdby_userid, created_at)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'waiver',$11,$12,'fees','explicit','active',$13,$14)`);
            params.push([generateShortUuid(12), schoolId, s.studentId, ay, asOf, category, headId, cycleId, 'Waiver', cyc ? cyc.name : null, amount, chargeId, userId, now]);
          }
        }
      }
    }

    if (!dryRun && queries.length) await DB.queriesInTransaction(queries, params);

    // enrich affected students with name + class for the preview / result
    const affectedIds = Object.keys(affectedMap);
    let affected: any[] = [];
    if (affectedIds.length) {
      const ph = affectedIds.map((_, i) => `$${i + 3}`).join(',');
      const info: any[] = await DB.query(
        singleLineString`select s.uuid, s.name, s.admission_number, c.name as class_name from student s left join student_class sc on sc.student_id = s.uuid and sc.academic_year_id = $2 and sc.school_id = $1 left join class c on c.uuid = sc.class_id where s.uuid in (${ph})`,
        [schoolId, ay, ...affectedIds]
      );
      const byId: Record<string, any> = {}; info.forEach((r) => (byId[r.uuid] = r));
      affected = affectedIds.map((id) => ({
        studentId: id, name: byId[id]?.name || null, admissionNumber: byId[id]?.admissionNumber || null,
        className: byId[id]?.className || null, charges: affectedMap[id].charges, amount: affectedMap[id].amount,
      }));
      affected.sort((a, b) => (a.className || '').localeCompare(b.className || '') || (a.name || '').localeCompare(b.name || ''));
    }

    return {
      dryRun, academicYearId: ay, fullYear,
      students: students.length, studentsAffected: affectedIds.length,
      posted: dryRun ? 0 : charges,
      charges, concessions, waivers,
      totalCharge, totalConcession, totalWaiver,
      affected,
    };
  }
}

export const feesLedgerService = new FeesLedgerService();
