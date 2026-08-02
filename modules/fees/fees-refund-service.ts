import { DB, singleLineString } from '../../shared/lib/db';
import { BadRequestResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { REFUND_STATUSES } from './fees-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class FeesRefundService {
  public async create(schoolId: string, body: any, userId: string) {
    if (!body?.studentId) throw new BadRequestResult(ErrorCode.InvalidInput, 'studentId is required');
    if (!body.academicYearId) throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    if (body.amount == null || Number(body.amount) <= 0) throw new BadRequestResult(ErrorCode.InvalidInput, 'amount is required');
    const refundStatus = body.refundStatus || 'not_refunded';
    if (!REFUND_STATUSES.includes(refundStatus)) throw new BadRequestResult(ErrorCode.InvalidInput, 'Invalid refund status');
    const uuid = generateShortUuid(12); const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into fee_refund (uuid, school_id, academic_year_id, student_id, fee_head_id, amount, refund_date, refund_status, reference_receipt_id, remarks, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12) returning *`,
      [uuid, schoolId, body.academicYearId, body.studentId, body.feeHeadId || null, body.amount, body.refundDate || null, refundStatus, body.referenceReceiptId || null, body.remarks || null, userId, now]
    );
    return rows[0];
  }

  public async list(schoolId: string, q: any) {
    const params: any[] = [schoolId]; let where = `school_id = $1 and status = 'active'`;
    if (q?.studentId) { params.push(q.studentId); where += ` and student_id = $${params.length}`; }
    if (q?.academicYearId) { params.push(q.academicYearId); where += ` and academic_year_id = $${params.length}`; }
    if (q?.refundStatus) { params.push(q.refundStatus); where += ` and refund_status = $${params.length}`; }
    return DB.query(singleLineString`select * from fee_refund where ${where} order by created_at desc`, params);
  }
}

export const feesRefundService = new FeesRefundService();
