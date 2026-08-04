import { DB, singleLineString } from '../../shared/lib/db';
import { BadRequestResult, NotFoundResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { nextReceiptNo } from './fees-util';
import { RECEIPT_SERIES, DEFAULTS, PAYMENT_MODES } from './fees-constants';
import { buildReceiptHtml } from './fees-receipt-template';
import { notifyReceipt } from './fees-notify';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const n = (v: any): number => (v == null ? 0 : Number(v));

interface Allocation { ledgerId: string; amount: number; }
interface CollectRequest {
  studentId: string; academicYearId: string; receiptDate?: string;
  paymentMode?: string; receivedFrom?: string; txnRef?: string; remarks?: string;
  type?: string; allocations: Allocation[]; advanceApplied?: number;
  waivers?: Allocation[]; waiveReason?: string; // ad-hoc settlement: forgive the leftover on a charge
}

class FeesReceiptService {
  private async studentSnapshot(schoolId: string, studentId: string, academicYearId: string) {
    const rows = await DB.query(
      singleLineString`
        select s.name, s.admission_number, c.name as class_name
        from student s
        left join student_class sc on sc.student_id = s.uuid and sc.academic_year_id = $2 and sc.school_id = $3
        left join class c on c.uuid = sc.class_id
        where s.uuid = $1`,
      [studentId, academicYearId, schoolId]
    );
    return rows[0] || {};
  }

  // ---- COLLECT: create a receipt and post allocated payment credits ----
  public async collect(schoolId: string, body: CollectRequest, userId: string, schoolCode: string) {
    if (!body?.studentId) throw new BadRequestResult(ErrorCode.InvalidInput, 'studentId is required');
    if (!body.academicYearId) throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    const allocations = Array.isArray(body.allocations) ? body.allocations.filter((a) => n(a.amount) > 0) : [];
    const waivers = Array.isArray(body.waivers) ? body.waivers.filter((a) => n(a.amount) > 0) : [];
    if (!allocations.length && !waivers.length)
      throw new BadRequestResult(ErrorCode.InvalidInput, 'At least one payment or waiver is required');
    if (waivers.length && !body.waiveReason)
      throw new BadRequestResult(ErrorCode.InvalidInput, 'A reason is required to waive an amount');
    if (body.paymentMode && !PAYMENT_MODES.includes(body.paymentMode as any))
      throw new BadRequestResult(ErrorCode.InvalidInput, 'Invalid payment mode');

    const ids = [...new Set([...allocations, ...waivers].map((a) => a.ledgerId))];
    const phCharges = ids.map((_, i) => `$${i + 3}`).join(',');
    const charges: any[] = await DB.query(
      singleLineString`select * from student_ledger_entry where school_id = $1 and student_id = $2 and uuid in (${phCharges}) and kind = 'charge' and status = 'active'`,
      [schoolId, body.studentId, ...ids]
    );
    const chargeById: Record<string, any> = {}; charges.forEach((c) => (chargeById[c.uuid] = c));
    // remaining per charge = debit - sum(active credits settling it)
    const phCredits = ids.map((_, i) => `$${i + 1}`).join(',');
    const credits: any[] = await DB.query(
      singleLineString`select settles_entry_id, coalesce(sum(credit),0) as paid from student_ledger_entry where settles_entry_id in (${phCredits}) and status = 'active' group by settles_entry_id`,
      [...ids]
    );
    const paidBy: Record<string, number> = {};
    credits.forEach((r) => (paidBy[r.settlesEntryId] = n(r.paid)));

    const payByCharge: Record<string, number> = {}; allocations.forEach((a) => (payByCharge[a.ledgerId] = (payByCharge[a.ledgerId] || 0) + n(a.amount)));
    const waiveByCharge: Record<string, number> = {}; waivers.forEach((a) => (waiveByCharge[a.ledgerId] = (waiveByCharge[a.ledgerId] || 0) + n(a.amount)));
    let settled = 0; let waived = 0; let totalDue = 0;
    for (const id of ids) {
      const c = chargeById[id];
      if (!c) throw new BadRequestResult(ErrorCode.InvalidId, `Charge not found: ${id}`);
      const remaining = n(c.debit) - (paidBy[id] || 0);
      const pay = payByCharge[id] || 0; const waive = waiveByCharge[id] || 0;
      if (pay + waive > remaining + 0.001)
        throw new BadRequestResult(ErrorCode.InvalidInput, `Payment + waiver ${money(pay + waive)} exceeds remaining ${money(remaining)} on a component`);
      settled += pay; waived += waive; totalDue += remaining;
    }

    // advance drawdown: fund part of `settled` from the student's existing advance credit.
    const advanceApplied = n(body.advanceApplied);
    if (advanceApplied < 0) throw new BadRequestResult(ErrorCode.InvalidInput, 'advanceApplied cannot be negative');
    if (advanceApplied > 0) {
      if (advanceApplied > settled + 0.001)
        throw new BadRequestResult(ErrorCode.InvalidInput, 'Advance applied cannot exceed the amount being settled');
      const balRows: any[] = await DB.query(
        singleLineString`select coalesce(sum(credit),0) - coalesce(sum(debit),0) as net from student_ledger_entry where school_id = $1 and student_id = $2 and academic_year_id = $3 and status = 'active'`,
        [schoolId, body.studentId, body.academicYearId]
      );
      const advanceAvail = Math.max(0, n(balRows[0]?.net));
      if (advanceApplied > advanceAvail + 0.001)
        throw new BadRequestResult(ErrorCode.InvalidInput, `Advance applied ${money(advanceApplied)} exceeds available advance ${money(advanceAvail)}`);
    }
    const cash = settled - advanceApplied; // money actually received now

    const snap = await this.studentSnapshot(schoolId, body.studentId, body.academicYearId);
    const type = body.type && RECEIPT_SERIES[body.type as keyof typeof RECEIPT_SERIES] ? body.type : 'fee';
    const receiptNo = await nextReceiptNo(schoolId, RECEIPT_SERIES[type as keyof typeof RECEIPT_SERIES], body.academicYearId);
    const receiptId = generateShortUuid(12);
    const now = new Date();
    const receiptDate = body.receiptDate || now.toISOString().slice(0, 10);
    const balance = totalDue - settled - waived;

    const queries: string[] = []; const params: any[][] = [];
    queries.push(singleLineString`
      insert into fee_receipt (uuid, school_id, academic_year_id, student_id, receipt_no, receipt_date, type,
        payer_name, payer_class_snapshot, admission_no_snapshot, total_due, total_paid, balance, concession_total, advance_applied,
        payment_mode, txn_ref, received_from, remarks, collected_by_userid, status, source, createdby_userid, created_at)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,$14,$15,$16,$17,$18,$19,'active','native',$19,$20)`);
    params.push([receiptId, schoolId, body.academicYearId, body.studentId, receiptNo, receiptDate, type,
      snap.name || null, snap.className || null, snap.admissionNumber || null, totalDue, cash, balance, advanceApplied,
      body.paymentMode || 'cash', body.txnRef || null, body.receivedFrom || null, body.remarks || null, userId, now]);

    for (const a of allocations) {
      const c = chargeById[a.ledgerId];
      queries.push(singleLineString`
        insert into fee_receipt_line (uuid, school_id, receipt_id, fee_head_id, cycle_id, head_label, cycle_label, amount, is_concession, settles_ledger_id, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,false,$9,$10,$11)`);
      params.push([generateShortUuid(12), schoolId, receiptId, c.feeHeadId, c.cycleId, c.headLabel, c.cycleLabel, a.amount, a.ledgerId, userId, now]);
      queries.push(singleLineString`
        insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, source_ref, allocation, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'payment',$11,$12,'fees',$13,'explicit','active',$14,$15)`);
      params.push([generateShortUuid(12), schoolId, body.studentId, body.academicYearId, receiptDate, c.category, c.feeHeadId, c.cycleId, c.headLabel, c.cycleLabel, a.amount, a.ledgerId, receiptId, userId, now]);
    }

    // waiver / settlement write-off: forgive the leftover on a charge (no money received)
    for (const id of ids) {
      const waive = waiveByCharge[id] || 0;
      if (waive <= 0) continue;
      const c = chargeById[id];
      queries.push(singleLineString`
        insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, source_ref, remarks, allocation, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'waiver',$11,$12,'fees',$13,$14,'explicit','active',$15,$16)`);
      params.push([generateShortUuid(12), schoolId, body.studentId, body.academicYearId, receiptDate, c.category, c.feeHeadId, c.cycleId, c.headLabel, c.cycleLabel, waive, id, receiptId, body.waiveReason || 'Settlement waiver', userId, now]);
    }

    // draw down the advance: an 'adjust' debit offsets the advance credit consumed, so the
    // ledger's net credit rises only by the cash received (payments settled = cash + advance).
    if (advanceApplied > 0) {
      queries.push(singleLineString`
        insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, head_label, kind, debit, source_module, source_ref, allocation, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,'fee','Advance applied','adjust',$6,'fees',$7,'explicit','active',$8,$9)`);
      params.push([generateShortUuid(12), schoolId, body.studentId, body.academicYearId, receiptDate, advanceApplied, receiptId, userId, now]);
    }

    await DB.queriesInTransaction(queries, params);

    // fire-and-forget parent notification (cash actually received)
    notifyReceipt(schoolCode, body.studentId, {
      studentName: snap.name, receiptNo, amount: money(cash), date: receiptDate,
    });

    return this.getById(schoolId, receiptId);
  }

  public async adhoc(schoolId: string, body: any, userId: string) {
    if (!body?.academicYearId) throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    if (!Array.isArray(body.lines) || !body.lines.length) throw new BadRequestResult(ErrorCode.InvalidInput, 'At least one line is required');
    const totalPaid = body.lines.reduce((s: number, l: any) => s + n(l.amount), 0);
    const receiptNo = await nextReceiptNo(schoolId, RECEIPT_SERIES.adhoc, body.academicYearId);
    const receiptId = generateShortUuid(12); const now = new Date();
    const receiptDate = body.receiptDate || now.toISOString().slice(0, 10);
    const queries: string[] = []; const params: any[][] = [];
    queries.push(singleLineString`
      insert into fee_receipt (uuid, school_id, academic_year_id, student_id, receipt_no, receipt_date, type, payer_name, total_due, total_paid, balance, concession_total, payment_mode, remarks, collected_by_userid, status, source, createdby_userid, created_at)
      values ($1,$2,$3,null,$4,$5,'adhoc',$6,$7,$7,0,0,$8,$9,$10,'active','native',$10,$11)`);
    params.push([receiptId, schoolId, body.academicYearId, receiptNo, receiptDate, body.payerName || null, totalPaid, body.paymentMode || 'cash', body.remarks || null, userId, now]);
    for (const l of body.lines) {
      queries.push(singleLineString`insert into fee_receipt_line (uuid, school_id, receipt_id, head_label, amount, is_concession, createdby_userid, created_at) values ($1,$2,$3,$4,$5,false,$6,$7)`);
      params.push([generateShortUuid(12), schoolId, receiptId, l.headLabel || 'Adhoc', n(l.amount), userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    return this.getById(schoolId, receiptId);
  }

  public async cancel(schoolId: string, receiptId: string, reason: string, userId: string) {
    const rec = await DB.query(singleLineString`select uuid, status from fee_receipt where school_id = $1 and uuid = $2`, [schoolId, receiptId]);
    if (!rec.length) throw new NotFoundResult(ErrorCode.InvalidId, 'Receipt not found');
    if (rec[0].status === 'cancelled') throw new BadRequestResult(ErrorCode.InvalidInput, 'Receipt already cancelled');
    const now = new Date();
    await DB.queriesInTransaction(
      [
        singleLineString`update fee_receipt set status = 'cancelled', cancel_reason = $3, cancelledby_userid = $4, cancelled_at = $5, updated_at = $5 where school_id = $1 and uuid = $2`,
        singleLineString`update student_ledger_entry set status = 'cancelled', updatedby_userid = $3, updated_at = $4 where school_id = $1 and source_ref = $2 and kind in ('payment', 'adjust') and status = 'active'`,
      ],
      [
        [schoolId, receiptId, reason || null, userId, now],
        [schoolId, receiptId, userId, now],
      ]
    );
    return this.getById(schoolId, receiptId);
  }

  public async getById(schoolId: string, receiptId: string) {
    const rec = await DB.query(singleLineString`select * from fee_receipt where school_id = $1 and uuid = $2`, [schoolId, receiptId]);
    if (!rec.length) throw new NotFoundResult(ErrorCode.InvalidId, 'Receipt not found');
    const lines = await DB.query(singleLineString`select * from fee_receipt_line where receipt_id = $1 order by created_at`, [receiptId]);
    const wv = await DB.query(singleLineString`select coalesce(sum(credit),0) as t from student_ledger_entry where school_id = $1 and source_ref = $2 and kind = 'waiver' and status = 'active'`, [schoolId, receiptId]);
    return { ...rec[0], lines, waiverTotal: Number(wv[0]?.t || 0) };
  }

  public async list(schoolId: string, q: any) {
    const params: any[] = [schoolId]; let where = `school_id = $1`;
    if (q?.studentId) { params.push(q.studentId); where += ` and student_id = $${params.length}`; }
    if (q?.collectedBy) { params.push(q.collectedBy); where += ` and collected_by_userid = $${params.length}`; }
    if (q?.type) { params.push(q.type); where += ` and type = $${params.length}`; }
    if (q?.from) { params.push(q.from); where += ` and receipt_date >= $${params.length}`; }
    if (q?.to) { params.push(q.to); where += ` and receipt_date <= $${params.length}`; }
    if (q?.includeCancelled !== 'true') where += ` and status = 'active'`;
    return DB.query(singleLineString`select * from fee_receipt where ${where} order by receipt_date desc, created_at desc limit 500`, params);
  }

  public async printHtml(schoolId: string, receiptId: string): Promise<string> {
    const r: any = await this.getById(schoolId, receiptId);
    const school = await DB.query(singleLineString`select name from school where uuid = $1`, [schoolId]);
    return buildReceiptHtml({
      schoolName: (school[0] && school[0].name) || 'School',
      receiptNo: r.receiptNo, legacyReceiptNo: r.legacyReceiptNo, date: r.receiptDate,
      studentName: r.payerName, admissionNo: r.admissionNoSnapshot, className: r.payerClassSnapshot,
      fatherName: r.fatherName, paymentMode: r.paymentMode, receivedFrom: r.receivedFrom,
      collectedBy: r.collectedByUserid, remarks: r.remarks,
      lines: (r.lines || []).map((l: any) => ({ headLabel: l.headLabel, cycleLabel: l.cycleLabel, amount: n(l.amount) })),
      totalPaid: n(r.totalPaid), advanceApplied: n(r.advanceApplied), waiverTotal: n(r.waiverTotal), balance: n(r.balance),
    });
  }
}

function money(v: number) { return Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export const feesReceiptService = new FeesReceiptService();
