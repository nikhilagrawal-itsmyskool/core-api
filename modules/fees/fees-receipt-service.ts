import { DB, singleLineString } from '../../shared/lib/db';
import { BadRequestResult, NotFoundResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { nextReceiptNo } from './fees-util';
import { RECEIPT_SERIES, DEFAULTS, PAYMENT_MODES } from './fees-constants';
import { buildReceiptHtml } from './fees-receipt-template';
import { notifyReceipt } from './fees-notify';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');
const QRCode = require('qrcode');
// Base for the public receipt-verify page the QR links to. Per-school portal domain.
const VERIFY_BASE = process.env.PORTAL_BASE_URL || 'https://dbpasn.itsmyskool.com';

const n = (v: any): number => (v == null ? 0 : Number(v));

interface Allocation { ledgerId: string; amount: number; reason?: string; }
interface CollectRequest {
  studentId: string; academicYearId: string; receiptDate?: string;
  paymentMode?: string; receivedFrom?: string; txnRef?: string; remarks?: string;
  type?: string; allocations: Allocation[]; advanceApplied?: number;
  waivers?: Allocation[]; waiveReason?: string; // ad-hoc settlement: forgive the leftover on a charge
  storeAsAdvance?: number; // deliberate overpayment kept as advance for a future receipt
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
    const storeAsAdvance = n(body.storeAsAdvance);
    if (storeAsAdvance < 0) throw new BadRequestResult(ErrorCode.InvalidInput, 'storeAsAdvance cannot be negative');
    if (!allocations.length && !waivers.length && !(storeAsAdvance > 0))
      throw new BadRequestResult(ErrorCode.InvalidInput, 'At least one payment or waiver is required');
    // A reason is required per waiver — either a per-item reason (fine exemptions carry their own) or a
    // single body.waiveReason for the batch.
    if (waivers.some((a) => !a.reason) && !body.waiveReason)
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
    const waiveReasonByCharge: Record<string, string> = {}; waivers.forEach((a) => { if (a.reason) waiveReasonByCharge[a.ledgerId] = a.reason; });
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
    const cash = settled - advanceApplied + storeAsAdvance; // total money received now (allocations cash + advance stored)

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
      const reason = waiveReasonByCharge[id] || body.waiveReason || (/late/i.test(String(c.headLabel)) ? 'Fine exemption' : 'Settlement waiver');
      params.push([generateShortUuid(12), schoolId, body.studentId, body.academicYearId, receiptDate, c.category, c.feeHeadId, c.cycleId, c.headLabel, c.cycleLabel, waive, id, receiptId, reason, userId, now]);
    }

    // draw down the advance: an 'adjust' debit offsets the advance credit consumed, so the
    // ledger's net credit rises only by the cash received (payments settled = cash + advance).
    if (advanceApplied > 0) {
      queries.push(singleLineString`
        insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, head_label, kind, debit, source_module, source_ref, allocation, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,'fee','Advance applied','adjust',$6,'fees',$7,'explicit','active',$8,$9)`);
      params.push([generateShortUuid(12), schoolId, body.studentId, body.academicYearId, receiptDate, advanceApplied, receiptId, userId, now]);
    }

    // store an explicit overpayment as advance: a floating credit (no settles_entry_id) raises the
    // student's advance balance for a future receipt. Deliberate — never created automatically.
    if (storeAsAdvance > 0) {
      queries.push(singleLineString`
        insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, head_label, kind, credit, source_module, source_ref, allocation, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,'fee','Advance','payment',$6,'fees',$7,'advance','active',$8,$9)`);
      params.push([generateShortUuid(12), schoolId, body.studentId, body.academicYearId, receiptDate, storeAsAdvance, receiptId, userId, now]);
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

  // ---- TRANSPORT collection (interim, before stop/distance charges): a per-student transport
  // receipt (type='transport'), month-tagged so it can reconcile to charges once they exist. No
  // ledger entries — transport has no charges in the fee ledger yet.
  public async collectTransport(schoolId: string, body: any, userId: string, schoolCode: string) {
    if (!body?.studentId) throw new BadRequestResult(ErrorCode.InvalidInput, 'studentId is required');
    if (!body?.academicYearId) throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    const amount = n(body.amount);
    if (!(amount > 0)) throw new BadRequestResult(ErrorCode.InvalidInput, 'Amount must be positive');
    if (body.paymentMode && !PAYMENT_MODES.includes(body.paymentMode)) throw new BadRequestResult(ErrorCode.InvalidInput, 'Invalid payment mode');
    const snap = await this.studentSnapshot(schoolId, body.studentId, body.academicYearId);
    const receiptNo = await nextReceiptNo(schoolId, RECEIPT_SERIES.transport, body.academicYearId);
    const receiptId = generateShortUuid(12); const now = new Date();
    const receiptDate = body.receiptDate || now.toISOString().slice(0, 10);
    await DB.query(
      singleLineString`
        insert into fee_receipt (uuid, school_id, academic_year_id, student_id, receipt_no, receipt_date, type,
          payer_name, payer_class_snapshot, admission_no_snapshot, cycle_set, total_due, total_paid, balance, concession_total,
          payment_mode, received_from, remarks, transport_remark, collected_by_userid, status, source, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,'transport',$7,$8,$9,$10,$11,$11,0,0,$12,$13,$14,$15,$16,'active','native',$16,$17)`,
      [receiptId, schoolId, body.academicYearId, body.studentId, receiptNo, receiptDate,
        snap.name || null, snap.className || null, snap.admissionNumber || null, body.month || null, amount,
        body.paymentMode || 'cash', body.receivedFrom || null, body.remark || null, body.month || null, userId, now]
    );
    notifyReceipt(schoolCode, body.studentId, { studentName: snap.name, receiptNo, amount: money(amount), date: receiptDate });
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
    if (q?.academicYearId) { params.push(q.academicYearId); where += ` and academic_year_id = $${params.length}`; }
    if (q?.collectedBy) { params.push(q.collectedBy); where += ` and collected_by_userid = $${params.length}`; }
    if (q?.type) { params.push(q.type); where += ` and type = $${params.length}`; }
    if (q?.from) { params.push(q.from); where += ` and receipt_date >= $${params.length}`; }
    if (q?.to) { params.push(q.to); where += ` and receipt_date <= $${params.length}`; }
    if (q?.search) { params.push(`%${String(q.search).trim()}%`); const p = `$${params.length}`; where += ` and (receipt_no ilike ${p} or legacy_receipt_no ilike ${p} or payer_name ilike ${p} or admission_no_snapshot ilike ${p})`; }
    if (q?.includeCancelled !== 'true') where += ` and status = 'active'`;
    const limit = Math.min(1000, Math.max(1, parseInt(q?.limit, 10) || 500));
    return DB.query(singleLineString`select * from fee_receipt where ${where} order by receipt_date desc, created_at desc limit ${limit}`, params);
  }

  public async printHtml(schoolId: string, receiptId: string, format?: string): Promise<string> {
    const r: any = await this.getById(schoolId, receiptId);
    const school = await DB.query(singleLineString`select name from school where uuid = $1`, [schoolId]);
    // Resolve the collector id to a name where we can (in-app receipts); migrated receipts have none.
    let issuer: string | null = r.collectedByUserid || null;
    if (issuer) {
      const emp = await DB.query(singleLineString`select name from employee where school_id = $1 and uuid = $2`, [schoolId, issuer]).catch(() => []);
      if (emp[0]?.name) issuer = emp[0].name;
    }
    // Native/transport receipts don't snapshot father/mother — pull them live so every receipt carries
    // the full parent dataset. Names live in student_guardian (relation father/mother); honorific stripped.
    let stu: any = null; let guardians: any[] = [];
    if (r.studentId) {
      const s = await DB.query(singleLineString`select name, admission_number from student where school_id = $1 and uuid = $2`, [schoolId, r.studentId]).catch(() => []);
      stu = s[0] || null;
      guardians = await DB.query(singleLineString`select relation, name from student_guardian where school_id = $1 and student_id = $2 and status = 'active'`, [schoolId, r.studentId]).catch(() => []);
    }
    const gname = (rel: string) => {
      const g = guardians.find((x: any) => new RegExp(rel, 'i').test(x.relation || ''));
      return g?.name ? String(g.name).replace(/^(mr|mrs|ms|dr|smt|shri|sri|master|kum)\.?\s*/i, '').trim() : null;
    };
    // Verification QR: fee/adhoc → a PUBLIC verify URL (any phone camera opens it); transport/refund
    // → a staff-only token that only the staff PWA scanner resolves. Never blocks printing on failure.
    const isPublicVerify = r.type === 'fee' || r.type === 'adhoc';
    const qrPayload = isPublicVerify ? `${VERIFY_BASE}/verify/receipt/${r.uuid}` : `imsk:${String(r.type || 'r').toUpperCase()}:${r.uuid}`;
    let qrDataUri: string | null = null;
    try { qrDataUri = await QRCode.toDataURL(qrPayload, { margin: 1, width: 220, color: { dark: '#0f172a', light: '#ffffff' } }); } catch { qrDataUri = null; }

    const data: any = {
      schoolName: (school[0] && school[0].name) || 'School',
      qrDataUri, qrCaption: isPublicVerify ? 'Scan to verify' : 'Staff verify',
      receiptNo: r.receiptNo, legacyReceiptNo: r.legacyReceiptNo, date: r.receiptDate, receiptType: r.type,
      studentName: r.payerName || stu?.name, admissionNo: r.admissionNoSnapshot || stu?.admissionNumber, className: r.payerClassSnapshot,
      fatherName: r.fatherName || gname('father'), motherName: r.motherName || gname('mother'), feeCycle: r.cycleSet,
      paymentMode: r.paymentMode, receivedFrom: r.receivedFrom || 'father', description: r.transportRemark,
      collectedBy: issuer, remarks: r.remarks, native: r.source === 'native',
      lines: (r.lines || []).map((l: any) => ({ headLabel: l.headLabel, cycleLabel: l.cycleLabel, amount: n(l.amount), isConcession: l.isConcession })),
      totalDue: n(r.totalDue), totalPaid: n(r.totalPaid), concessionTotal: n(r.concessionTotal),
      advanceApplied: n(r.advanceApplied), waiverTotal: n(r.waiverTotal), balance: n(r.balance),
      status: r.status, cancelReason: r.cancelReason,
    };

    // Statement (SchoolPad waterfall) view on an in-app receipt: reconstruct the cumulative figures
    // (gross bill for the paid cycles, prior-paid = "Last Paid", concession) from the ledger — since a
    // native receipt only stores this transaction's delta. No-op for migrated receipts (already waterfall).
    if (format === 'waterfall' && r.source === 'native') {
      const cycles = [...new Set((r.lines || []).map((l: any) => l.cycleLabel).filter(Boolean))].map((c: any) => String(c).trim().toLowerCase());
      if (cycles.length) {
        const agg = await DB.query(singleLineString`
          select coalesce(sum(debit) filter (where kind = 'charge'), 0) gross,
                 coalesce(sum(credit) filter (where kind = 'concession'), 0) concession,
                 coalesce(sum(credit) filter (where kind = 'payment'), 0) paid
          from student_ledger_entry
          where school_id = $1 and student_id = $2 and academic_year_id = $3 and status = 'active' and lower(trim(cycle_label)) = any($4::text[])`,
          [schoolId, r.studentId, r.academicYearId, cycles]);
        const gross = n(agg[0].gross), concession = n(agg[0].concession), allPaid = n(agg[0].paid);
        const lastPaid = Math.max(0, allPaid - n(r.totalPaid));
        data.native = false;
        data.lines = [{ headLabel: 'Composite Fee', amount: gross, isConcession: false }];
        if (concession > 0) data.lines.push({ headLabel: 'Concessions', amount: -concession, isConcession: true });
        data.concessionTotal = concession;
        data.totalDue = gross - concession - lastPaid;   // template derives "Last Paid" = gross − conc − totalDue
        data.balance = gross - concession - allPaid;
      }
    }
    return buildReceiptHtml(data);
  }

  // PUBLIC receipt verification (no auth) — keyed on the unguessable receipt uuid from the QR.
  // Returns minimal, non-sensitive proof for FEE/ADHOC receipts only; transport/refund are refused
  // (they verify staff-side). Reflects cancellation so a voided receipt never reads as genuine.
  public async verifyReceipt(uuid: string): Promise<any> {
    if (!uuid || !/^[a-z0-9]{6,16}$/i.test(uuid)) return { found: false };
    const rows = await DB.query(
      singleLineString`select r.receipt_no, r.receipt_date, r.type, r.total_paid, r.balance, r.status,
          r.payer_name, r.payer_class_snapshot, sc.name as school_name
        from fee_receipt r left join school sc on sc.uuid = r.school_id where r.uuid = $1`,
      [uuid]
    );
    const r = rows[0];
    if (!r) return { found: false };
    if (!(r.type === 'fee' || r.type === 'adhoc')) return { found: false, restricted: true }; // staff-only types
    return {
      found: true,
      cancelled: r.status === 'cancelled',
      genuine: r.status !== 'cancelled',
      receiptNo: r.receiptNo,
      date: r.receiptDate,
      amount: n(r.totalPaid),
      fullyPaid: n(r.balance) <= 0.5,
      studentName: r.payerName ? String(r.payerName).trim().split(/\s+/)[0] : null, // first name only
      className: r.payerClassSnapshot,
      schoolName: r.schoolName,
    };
  }
}

function money(v: number) { return Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

export const feesReceiptService = new FeesReceiptService();
