import { DB, singleLineString } from '../../shared/lib/db';
import { MedicalItem, CreateMedicalItemRequest, UpdateMedicalItemRequest } from './medical-interfaces';
import { DEFAULTS } from './medical-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class MedicalItemService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async create(
    data: CreateMedicalItemRequest,
    schoolId: string,
    userId: string
  ): Promise<MedicalItem> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into medical_item
      (uuid, name, unit, reorder_level, current_stock, comments, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning *
    `;

    const params = [
      uuid,
      data.name,
      data.unit,
      data.reorderLevel ?? DEFAULTS.REORDER_LEVEL,
      DEFAULTS.CURRENT_STOCK,
      data.comments || null,
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
    data: UpdateMedicalItemRequest,
    schoolId: string,
    userId: string
  ): Promise<MedicalItem | null> {
    const now = new Date();

    // Build dynamic update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(data.name);
    }
    if (data.unit !== undefined) {
      updates.push(`unit = $${paramIndex++}`);
      params.push(data.unit);
    }
    if (data.reorderLevel !== undefined) {
      updates.push(`reorder_level = $${paramIndex++}`);
      params.push(data.reorderLevel);
    }
    if (data.comments !== undefined) {
      updates.push(`comments = $${paramIndex++}`);
      params.push(data.comments);
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
      update medical_item
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++} and status = 'active'
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
      update medical_item
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `;

    const results = await DB.query(query, [userId, now, id, schoolId]);
    return true;
  }

  public async getById(id: string, schoolId: string): Promise<MedicalItem | null> {
    const query = singleLineString`
      select * from medical_item
      where uuid = $1 and school_id = $2 and status = 'active'
    `;

    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async search(
    schoolId: string,
    searchTerm?: string,
    includeDeleted?: boolean
  ): Promise<MedicalItem[]> {
    const statusFilter = includeDeleted ? "('active', 'deleted')" : "('active')";

    if (searchTerm && searchTerm.trim()) {
      const query = singleLineString`
        select * from medical_item
        where school_id = $1 and status in ${statusFilter}
          and (lower(name) like lower($2) or lower(comments) like lower($2))
        order by name
      `;
      return DB.query(query, [schoolId, `%${searchTerm.trim()}%`]);
    }

    const query = singleLineString`
      select * from medical_item
      where school_id = $1 and status in ${statusFilter}
      order by name
    `;
    return DB.query(query, [schoolId]);
  }
}

export const medicalItemService = new MedicalItemService();
