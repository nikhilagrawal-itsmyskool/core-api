import { DB, singleLineString } from '../../shared/lib/db';
import { Lab, CreateLabRequest, UpdateLabRequest } from './lab-interfaces';
import { DEFAULTS } from './lab-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class LabService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async create(
    data: CreateLabRequest,
    schoolId: string,
    userId: string
  ): Promise<Lab> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into lab
      (uuid, name, type, location, in_charge_id, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning *
    `;

    const params = [
      uuid,
      data.name,
      data.type,
      data.location || null,
      data.inChargeId || null,
      DEFAULTS.STATUS,
      schoolId,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return results[0];
  }

  public async update(
    id: string,
    data: UpdateLabRequest,
    schoolId: string,
    userId: string
  ): Promise<Lab | null> {
    const now = new Date();

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(data.name);
    }
    if (data.type !== undefined) {
      updates.push(`type = $${paramIndex++}`);
      params.push(data.type);
    }
    if (data.location !== undefined) {
      updates.push(`location = $${paramIndex++}`);
      params.push(data.location);
    }
    if (data.inChargeId !== undefined) {
      updates.push(`in_charge_id = $${paramIndex++}`);
      params.push(data.inChargeId);
    }
    if (data.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(data.status);
    }

    if (updates.length === 0) {
      return this.getById(id, schoolId);
    }

    updates.push(`updatedby_userid = $${paramIndex++}`);
    params.push(userId);
    updates.push(`updated_at = $${paramIndex++}`);
    params.push(now);

    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update lab
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++} and status != 'deleted'
      returning *
    `;

    const results = await DB.query(query, params);
    return results.length > 0 ? results[0] : null;
  }

  public async delete(
    id: string,
    schoolId: string,
    userId: string
  ): Promise<boolean> {
    const now = new Date();

    const query = singleLineString`
      update lab
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status != 'deleted'
    `;

    await DB.query(query, [userId, now, id, schoolId]);
    return true;
  }

  public async getById(id: string, schoolId: string): Promise<Lab | null> {
    const query = singleLineString`
      select * from lab
      where uuid = $1 and school_id = $2 and status != 'deleted'
    `;

    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async list(schoolId: string): Promise<Lab[]> {
    const query = singleLineString`
      select * from lab
      where school_id = $1 and status != 'deleted'
      order by name
    `;
    return DB.query(query, [schoolId]);
  }
}

export const labService = new LabService();
