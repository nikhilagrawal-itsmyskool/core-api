import { DB, singleLineString } from '../../shared/lib/db';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Accepts pre-transformed rows from the migration loader and inserts them idempotently.
// body: {
//   ledgerEntries: [{ studentId, academicYearId, entryDate, category, feeHeadId?, cycleId?, headLabel?, cycleLabel?, kind, debit?, credit?, settlesEntryId?, sourceModule?, sourceRef?, remarks?, allocation? }],
//   receipts: [{ legacyReceiptNo, academicYearId, studentId?, receiptDate, type, payerName?, payerClassSnapshot?, fatherName?, motherName?, admissionNoSnapshot?, cycleSet?, totalDue?, totalPaid?, balance?, paymentMode?, remarks?, transportRemark?, cancelled?, cancelReason?, lines: [{ feeHeadId?, headLabel?, cycleLabel?, amount, isConcession? }] }]
// }
class FeesMigrationService {
  public async importData(schoolId: string, body: any, userId: string) {
    const now = new Date();
    let ledgerInserted = 0, receiptsInserted = 0, receiptsSkipped = 0, linesInserted = 0;

    // --- ledger entries ---
    const lQ: string[] = []; const lP: any[][] = [];
    for (const e of body.ledgerEntries || []) {
      lQ.push(singleLineString`
        insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, debit, credit, settles_entry_id, source_module, source_ref, remarks, legacy_source, allocation, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'schoolpad',$18,'active',$19,$20)`);
      lP.push([e.uuid || generateShortUuid(12), schoolId, e.studentId || null, e.academicYearId, e.entryDate, e.category || 'fee',
        e.feeHeadId || null, e.cycleId || null, e.headLabel || null, e.cycleLabel || null, e.kind, e.debit ?? null, e.credit ?? null,
        e.settlesEntryId || null, e.sourceModule || 'fees', e.sourceRef || null, e.remarks || null, e.allocation || 'fifo-reconstructed', userId, now]);
    }
    if (lQ.length) { await DB.queriesInTransaction(lQ, lP); ledgerInserted = lQ.length; }

    // --- receipts (idempotent on legacy_receipt_no) ---
    for (const r of body.receipts || []) {
      if (r.legacyReceiptNo) {
        const existing = await DB.query(singleLineString`select 1 from fee_receipt where school_id = $1 and legacy_receipt_no = $2 limit 1`, [schoolId, r.legacyReceiptNo]);
        if (existing.length) { receiptsSkipped++; continue; }
      }
      const receiptId = generateShortUuid(12);
      const q: string[] = []; const p: any[][] = [];
      q.push(singleLineString`
        insert into fee_receipt (uuid, school_id, academic_year_id, student_id, receipt_no, legacy_receipt_no, receipt_date, type, payer_name, payer_class_snapshot, father_name, mother_name, admission_no_snapshot, cycle_set, total_due, total_paid, balance, payment_mode, remarks, transport_remark, status, cancel_reason, source, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'schoolpad',$23,$24)`);
      p.push([receiptId, schoolId, r.academicYearId, r.studentId || null, r.legacyReceiptNo || generateShortUuid(12), r.legacyReceiptNo || null,
        r.receiptDate, r.type || 'fee', r.payerName || null, r.payerClassSnapshot || null, r.fatherName || null, r.motherName || null,
        r.admissionNoSnapshot || null, r.cycleSet || null, r.totalDue ?? null, r.totalPaid ?? null, r.balance ?? null,
        r.paymentMode || null, r.remarks || null, r.transportRemark || null, r.cancelled ? 'cancelled' : 'active', r.cancelReason || null, userId, now]);
      for (const l of r.lines || []) {
        q.push(singleLineString`insert into fee_receipt_line (uuid, school_id, receipt_id, fee_head_id, head_label, cycle_label, amount, is_concession, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`);
        p.push([generateShortUuid(12), schoolId, receiptId, l.feeHeadId || null, l.headLabel || null, l.cycleLabel || null, l.amount, !!l.isConcession, userId, now]);
        linesInserted++;
      }
      await DB.queriesInTransaction(q, p);
      receiptsInserted++;
    }

    return { ledgerInserted, receiptsInserted, receiptsSkipped, linesInserted };
  }
}

export const feesMigrationService = new FeesMigrationService();
