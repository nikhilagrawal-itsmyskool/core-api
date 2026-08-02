import { DB, singleLineString } from '../../shared/lib/db';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
import { FEE_HEAD_KINDS } from './fees-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

export interface CreateFeeHeadRequest {
  academicYearId: string;
  name: string;
  abbreviation?: string;
  kind: string;
  refundable?: boolean;
  oneTime?: boolean;
  amountEditable?: boolean;
  sortOrder?: number;
}

export interface UpdateFeeHeadRequest {
  name?: string;
  abbreviation?: string;
  kind?: string;
  refundable?: boolean;
  oneTime?: boolean;
  amountEditable?: boolean;
  sortOrder?: number;
}

class FeeHeadService {
  public async create(data: CreateFeeHeadRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    }
    if (!data.name || !data.name.trim()) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'name is required');
    }
    if (!data.kind || !FEE_HEAD_KINDS.includes(data.kind as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `kind must be one of: ${FEE_HEAD_KINDS.join(', ')}`);
    }

    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into fee_head
      (uuid, school_id, academic_year_id, name, abbreviation, kind, refundable, one_time, amount_editable, sort_order, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.academicYearId,
      data.name,
      data.abbreviation ?? null,
      data.kind,
      data.refundable ?? null,
      data.oneTime ?? null,
      data.amountEditable ?? null,
      data.sortOrder ?? null,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return results[0];
  }

  public async update(id: string, data: UpdateFeeHeadRequest, schoolId: string, userId: string): Promise<any | null> {
    if (data.kind !== undefined && !FEE_HEAD_KINDS.includes(data.kind as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `kind must be one of: ${FEE_HEAD_KINDS.join(', ')}`);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.name !== undefined) { updates.push(`name = $${i++}`); params.push(data.name); }
    if (data.abbreviation !== undefined) { updates.push(`abbreviation = $${i++}`); params.push(data.abbreviation); }
    if (data.kind !== undefined) { updates.push(`kind = $${i++}`); params.push(data.kind); }
    if (data.refundable !== undefined) { updates.push(`refundable = $${i++}`); params.push(data.refundable); }
    if (data.oneTime !== undefined) { updates.push(`one_time = $${i++}`); params.push(data.oneTime); }
    if (data.amountEditable !== undefined) { updates.push(`amount_editable = $${i++}`); params.push(data.amountEditable); }
    if (data.sortOrder !== undefined) { updates.push(`sort_order = $${i++}`); params.push(data.sortOrder); }

    if (updates.length === 0) {
      return this.getById(id, schoolId);
    }

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update fee_head set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;

    const results = await DB.query(query, params);
    return results.length > 0 ? results[0] : null;
  }

  public async remove(id: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_head set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async getById(id: string, schoolId: string): Promise<any | null> {
    const results = await DB.query(
      singleLineString`select * from fee_head where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async list(schoolId: string, academicYearId?: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId];
    let sql = `select * from fee_head where school_id = $1`;
    if (!includeDeleted) { sql += ` and status = 'active'`; }
    if (academicYearId) { params.push(academicYearId); sql += ` and academic_year_id = $${params.length}`; }
    sql += ` order by sort_order nulls last, name`;
    return DB.query(sql, params);
  }
}

export const feeHeadService = new FeeHeadService();
