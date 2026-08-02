import { DB, singleLineString } from '../../shared/lib/db';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

export interface CreateFeeCycleRequest {
  academicYearId: string;
  name: string;
  abbreviation?: string;
  fromDate?: string;
  toDate?: string;
  dueDate?: string;
  sortOrder?: number;
}

export interface UpdateFeeCycleRequest {
  name?: string;
  abbreviation?: string;
  fromDate?: string;
  toDate?: string;
  dueDate?: string;
  sortOrder?: number;
}

class FeeCycleService {
  public async create(data: CreateFeeCycleRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required');
    }
    if (!data.name || !data.name.trim()) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'name is required');
    }

    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into fee_cycle
      (uuid, school_id, academic_year_id, name, abbreviation, from_date, to_date, due_date, sort_order, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $11)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.academicYearId,
      data.name,
      data.abbreviation ?? null,
      data.fromDate ?? null,
      data.toDate ?? null,
      data.dueDate ?? null,
      data.sortOrder ?? null,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return results[0];
  }

  public async update(id: string, data: UpdateFeeCycleRequest, schoolId: string, userId: string): Promise<any | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.name !== undefined) { updates.push(`name = $${i++}`); params.push(data.name); }
    if (data.abbreviation !== undefined) { updates.push(`abbreviation = $${i++}`); params.push(data.abbreviation); }
    if (data.fromDate !== undefined) { updates.push(`from_date = $${i++}`); params.push(data.fromDate); }
    if (data.toDate !== undefined) { updates.push(`to_date = $${i++}`); params.push(data.toDate); }
    if (data.dueDate !== undefined) { updates.push(`due_date = $${i++}`); params.push(data.dueDate); }
    if (data.sortOrder !== undefined) { updates.push(`sort_order = $${i++}`); params.push(data.sortOrder); }

    if (updates.length === 0) {
      return this.getById(id, schoolId);
    }

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update fee_cycle set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;

    const results = await DB.query(query, params);
    return results.length > 0 ? results[0] : null;
  }

  public async remove(id: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_cycle set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async getById(id: string, schoolId: string): Promise<any | null> {
    const results = await DB.query(
      singleLineString`select * from fee_cycle where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async list(schoolId: string, academicYearId?: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId];
    let sql = `select * from fee_cycle where school_id = $1`;
    if (!includeDeleted) { sql += ` and status = 'active'`; }
    if (academicYearId) { params.push(academicYearId); sql += ` and academic_year_id = $${params.length}`; }
    sql += ` order by sort_order nulls last, name`;
    return DB.query(sql, params);
  }
}

export const feeCycleService = new FeeCycleService();
