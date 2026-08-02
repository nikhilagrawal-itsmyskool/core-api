import { DB, singleLineString } from '../../shared/lib/db';
import { BadRequestResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
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
  public async studentLedger(schoolId: string, studentId: string, academicYearId?: string) {
    const params: any[] = [schoolId, studentId];
    let where = `school_id = $1 and student_id = $2 and status = 'active'`;
    if (academicYearId) { params.push(academicYearId); where += ` and academic_year_id = $3`; }
    const rows: LedgerRow[] = await DB.query(
      singleLineString`select * from student_ledger_entry where ${where} order by entry_date, created_at`,
      params
    );

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
        return {
          chargeId: c.uuid, category: c.category, feeHeadId: c.feeHeadId, cycleId: c.cycleId,
          headLabel: c.headLabel, cycleLabel: c.cycleLabel, entryDate: c.entryDate,
          charged: n(c.debit), concession, waiver, paid, net, remaining, status,
        };
      });

    const totalDebit = rows.reduce((s, r) => s + n(r.debit), 0);
    const totalCredit = rows.reduce((s, r) => s + n(r.credit), 0);
    const outstanding = totalDebit - totalCredit;
    const totals = {
      charged: rows.filter((r) => r.kind === 'charge').reduce((s, r) => s + n(r.debit), 0),
      concession: rows.filter((r) => r.kind === 'concession').reduce((s, r) => s + n(r.credit), 0),
      waiver: rows.filter((r) => r.kind === 'waiver').reduce((s, r) => s + n(r.credit), 0),
      paid: rows.filter((r) => r.kind === 'payment').reduce((s, r) => s + n(r.credit), 0),
      outstanding: Math.max(0, outstanding),
      advance: Math.max(0, -outstanding),
    };
    return { studentId, academicYearId: academicYearId || null, lines, entries: rows, totals };
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
      walletBalance: 0, // supplies wallet deferred
      dueComponents: dueLines.length,
    };
  }

  // ---- WRITE: post charges (accrue-per-cycle) for a year ----
  // opts: { academicYearId, cycleId?, classId?, studentIds?, asOf? }
  public async chargeRun(schoolId: string, opts: any, userId: string) {
    if (!opts?.academicYearId) throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    const ay = opts.academicYearId;
    const asOf: string = opts.asOf || new Date().toISOString().slice(0, 10);

    // 1. target students + their class
    let enrolWhere = `sc.school_id = $1 and sc.academic_year_id = $2`;
    const enrolParams: any[] = [schoolId, ay];
    if (opts.classId) { enrolParams.push(opts.classId); enrolWhere += ` and sc.class_id = $${enrolParams.length}`; }
    if (Array.isArray(opts.studentIds) && opts.studentIds.length) {
      const ph = opts.studentIds.map((_: any, i: number) => `$${enrolParams.length + i + 1}`).join(',');
      enrolWhere += ` and sc.student_id in (${ph})`;
      enrolParams.push(...opts.studentIds);
    }
    const students: any[] = await DB.query(
      singleLineString`select sc.student_id, sc.class_id from student_class sc where ${enrolWhere}`,
      enrolParams
    );
    if (!students.length) return { posted: 0, students: 0 };

    // 2. reference config for the year
    const cycles: any[] = await DB.query(
      singleLineString`select uuid, name, from_date, due_date from fee_cycle where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ay]
    );
    const cycleById: Record<string, any> = {}; cycles.forEach((c) => (cycleById[c.uuid] = c));
    const heads: any[] = await DB.query(
      singleLineString`select uuid, name, kind, one_time from fee_head where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ay]
    );
    const headById: Record<string, any> = {}; heads.forEach((h) => (headById[h.uuid] = h));

    const queries: string[] = []; const params: any[][] = []; let posted = 0;

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

      // student's active concessions (by head)
      const concs: any[] = await DB.query(
        singleLineString`select c.fee_head_id, c.value_type, c.value, c.name from fee_concession_student cs join fee_concession c on c.uuid = cs.concession_id and c.status = 'active' where cs.school_id = $1 and cs.student_id = $2 and c.academic_year_id = $3 and cs.status = 'active'`,
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
        // accrue: one-time heads always; recurring only once the cycle has started
        const due = head.oneTime || (cyc && cyc.fromDate && new Date(cyc.fromDate).getTime() <= new Date(asOf).getTime());
        if (!due) continue;
        const amount = amt[key];
        const chargeId = generateShortUuid(12);
        const now = new Date();
        const category = head.kind === 'transport' ? 'transport' : 'fee';
        queries.push(singleLineString`
          insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, debit, source_module, allocation, status, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'charge',$11,'fees','explicit','active',$12,$13)`);
        params.push([chargeId, schoolId, s.studentId, ay, asOf, category, headId, cycleId, head.name, cyc ? cyc.name : null, amount, userId, now]);
        posted++;

        // concession on this head
        const conc = concByHead[headId];
        if (conc) {
          const cval = conc.valueType === 'percent' ? (amount * n(conc.value)) / 100 : Math.min(n(conc.value), amount);
          if (cval > 0) {
            queries.push(singleLineString`
              insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, allocation, status, createdby_userid, created_at)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'concession',$11,$12,'fees','explicit','active',$13,$14)`);
            params.push([generateShortUuid(12), schoolId, s.studentId, ay, asOf, category, headId, cycleId, conc.name, cyc ? cyc.name : null, cval, chargeId, userId, now]);
          }
        }
        // waiver on this (head, cycle) → waive the full amount
        if (waived.has(key)) {
          queries.push(singleLineString`
            insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, allocation, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'waiver',$11,$12,'fees','explicit','active',$13,$14)`);
          params.push([generateShortUuid(12), schoolId, s.studentId, ay, asOf, category, headId, cycleId, 'Waiver', cyc ? cyc.name : null, amount, chargeId, userId, now]);
        }
      }
    }

    if (queries.length) await DB.queriesInTransaction(queries, params);
    return { posted, students: students.length };
  }
}

export const feesLedgerService = new FeesLedgerService();
