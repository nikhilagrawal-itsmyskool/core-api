import { DB, singleLineString } from '../../shared/lib/db';
import { LabItem, CreateLabItemRequest, UpdateLabItemRequest } from './lab-interfaces';
import { DEFAULTS } from './lab-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class LabItemService {
  public async create(
    data: CreateLabItemRequest,
    schoolId: string,
    userId: string
  ): Promise<LabItem> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into lab_item
      (uuid, lab_id, name, category, item_type, unit, current_stock, reorder_level, location, item_condition, cost_per_unit, comments, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      returning *
    `;

    const params = [
      uuid,
      data.labId,
      data.name,
      data.category || null,
      data.itemType,
      data.unit,
      DEFAULTS.CURRENT_STOCK,
      data.reorderLevel ?? DEFAULTS.REORDER_LEVEL,
      data.location || null,
      data.itemCondition || (data.itemType === 'equipment' ? DEFAULTS.ITEM_CONDITION : null),
      data.costPerUnit || null,
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
    data: UpdateLabItemRequest,
    schoolId: string,
    userId: string
  ): Promise<LabItem | null> {
    const now = new Date();

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(data.name);
    }
    if (data.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      params.push(data.category);
    }
    if (data.itemType !== undefined) {
      updates.push(`item_type = $${paramIndex++}`);
      params.push(data.itemType);
    }
    if (data.unit !== undefined) {
      updates.push(`unit = $${paramIndex++}`);
      params.push(data.unit);
    }
    if (data.reorderLevel !== undefined) {
      updates.push(`reorder_level = $${paramIndex++}`);
      params.push(data.reorderLevel);
    }
    if (data.location !== undefined) {
      updates.push(`location = $${paramIndex++}`);
      params.push(data.location);
    }
    if (data.itemCondition !== undefined) {
      updates.push(`item_condition = $${paramIndex++}`);
      params.push(data.itemCondition);
    }
    if (data.costPerUnit !== undefined) {
      updates.push(`cost_per_unit = $${paramIndex++}`);
      params.push(data.costPerUnit);
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
      update lab_item
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
      update lab_item
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `;

    await DB.query(query, [userId, now, id, schoolId]);
    return true;
  }

  public async getById(id: string, schoolId: string): Promise<LabItem | null> {
    const query = singleLineString`
      select li.*, l.name as lab_name
      from lab_item li
      left join lab l on li.lab_id = l.uuid
      where li.uuid = $1 and li.school_id = $2 and li.status = 'active'
    `;

    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async search(
    schoolId: string,
    labId?: string,
    category?: string,
    itemType?: string,
    searchTerm?: string,
    includeDeleted?: boolean
  ): Promise<LabItem[]> {
    const statusFilter = includeDeleted ? "('active', 'deleted')" : "('active')";

    let query = `
      select li.*, l.name as lab_name
      from lab_item li
      left join lab l on li.lab_id = l.uuid
      where li.school_id = $1 and li.status in ${statusFilter}
    `;
    const params: any[] = [schoolId];
    let paramIndex = 2;

    if (labId) {
      query += ` and li.lab_id = $${paramIndex++}`;
      params.push(labId);
    }

    if (category) {
      query += ` and lower(li.category) = lower($${paramIndex++})`;
      params.push(category);
    }

    if (itemType) {
      query += ` and li.item_type = $${paramIndex++}`;
      params.push(itemType);
    }

    if (searchTerm && searchTerm.trim()) {
      query += ` and (lower(li.name) like lower($${paramIndex}) or lower(li.comments) like lower($${paramIndex}))`;
      params.push(`%${searchTerm.trim()}%`);
      paramIndex++;
    }

    query += ` order by li.name`;

    return DB.query(query, params);
  }
}

export const labItemService = new LabItemService();
