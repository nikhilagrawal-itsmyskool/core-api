import { DB, singleLineString } from '../../shared/lib/db';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
import { LATE_FEE_MODES } from './fees-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

export interface CreateLateFeeRuleRequest {
  academicYearId: string;
  appliesToKind?: string;
  graceDays?: number;
  mode: string;
  amount: number;
  cap?: number;
}

export interface UpdateLateFeeRuleRequest {
  appliesToKind?: string;
  graceDays?: number;
  mode?: string;
  amount?: number;
  cap?: number;
}

class LateFeeRuleService {
  public async create(data: CreateLateFeeRuleRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    }
    if (!data.mode || !LATE_FEE_MODES.includes(data.mode as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `mode must be one of: ${LATE_FEE_MODES.join(', ')}`);
    }
    if (data.amount === undefined || data.amount === null) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'amount is required');
    }

    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into fee_late_fee_rule
      (uuid, school_id, academic_year_id, applies_to_kind, grace_days, mode, amount, cap, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.academicYearId,
      data.appliesToKind ?? null,
      data.graceDays ?? null,
      data.mode,
      data.amount,
      data.cap ?? null,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return results[0];
  }

  public async update(id: string, data: UpdateLateFeeRuleRequest, schoolId: string, userId: string): Promise<any | null> {
    if (data.mode !== undefined && !LATE_FEE_MODES.includes(data.mode as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `mode must be one of: ${LATE_FEE_MODES.join(', ')}`);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.appliesToKind !== undefined) { updates.push(`applies_to_kind = $${i++}`); params.push(data.appliesToKind); }
    if (data.graceDays !== undefined) { updates.push(`grace_days = $${i++}`); params.push(data.graceDays); }
    if (data.mode !== undefined) { updates.push(`mode = $${i++}`); params.push(data.mode); }
    if (data.amount !== undefined) { updates.push(`amount = $${i++}`); params.push(data.amount); }
    if (data.cap !== undefined) { updates.push(`cap = $${i++}`); params.push(data.cap); }

    if (updates.length === 0) {
      return this.getById(id, schoolId);
    }

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update fee_late_fee_rule set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;

    const results = await DB.query(query, params);
    return results.length > 0 ? results[0] : null;
  }

  public async remove(id: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_late_fee_rule set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async getById(id: string, schoolId: string): Promise<any | null> {
    const results = await DB.query(
      singleLineString`select * from fee_late_fee_rule where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async list(schoolId: string, academicYearId?: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId];
    let sql = `select * from fee_late_fee_rule where school_id = $1`;
    if (!includeDeleted) { sql += ` and status = 'active'`; }
    if (academicYearId) { params.push(academicYearId); sql += ` and academic_year_id = $${params.length}`; }
    sql += ` order by applies_to_kind nulls first`;
    return DB.query(sql, params);
  }
}

export const lateFeeRuleService = new LateFeeRuleService();
