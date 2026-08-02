import { DB, singleLineString } from '../../shared/lib/db';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

export interface CreateTransportSlabRequest {
  academicYearId: string;
  name?: string;
  fromKm?: number;
  toKm?: number;
  amountPerMonth: number;
}

export interface UpdateTransportSlabRequest {
  name?: string;
  fromKm?: number;
  toKm?: number;
  amountPerMonth?: number;
}

class TransportSlabService {
  public async create(data: CreateTransportSlabRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    }
    if (data.amountPerMonth === undefined || data.amountPerMonth === null) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'amountPerMonth is required');
    }

    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into fee_transport_slab
      (uuid, school_id, academic_year_id, name, from_km, to_km, amount_per_month, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.academicYearId,
      data.name ?? null,
      data.fromKm ?? null,
      data.toKm ?? null,
      data.amountPerMonth,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return results[0];
  }

  public async update(id: string, data: UpdateTransportSlabRequest, schoolId: string, userId: string): Promise<any | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.name !== undefined) { updates.push(`name = $${i++}`); params.push(data.name); }
    if (data.fromKm !== undefined) { updates.push(`from_km = $${i++}`); params.push(data.fromKm); }
    if (data.toKm !== undefined) { updates.push(`to_km = $${i++}`); params.push(data.toKm); }
    if (data.amountPerMonth !== undefined) { updates.push(`amount_per_month = $${i++}`); params.push(data.amountPerMonth); }

    if (updates.length === 0) {
      return this.getById(id, schoolId);
    }

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update fee_transport_slab set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;

    const results = await DB.query(query, params);
    return results.length > 0 ? results[0] : null;
  }

  public async remove(id: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_transport_slab set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async getById(id: string, schoolId: string): Promise<any | null> {
    const results = await DB.query(
      singleLineString`select * from fee_transport_slab where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async list(schoolId: string, academicYearId?: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId];
    let sql = `select * from fee_transport_slab where school_id = $1`;
    if (!includeDeleted) { sql += ` and status = 'active'`; }
    if (academicYearId) { params.push(academicYearId); sql += ` and academic_year_id = $${params.length}`; }
    sql += ` order by from_km nulls last, name`;
    return DB.query(sql, params);
  }
}

export const transportSlabService = new TransportSlabService();
