import { DB, singleLineString } from '../../shared/lib/db';
import {
  UniformSet,
  UniformSetDetail,
  CreateSetRequest,
  UpdateSetRequest,
} from './uniform-interfaces';
import { DEFAULTS } from './uniform-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class UniformSetService {
  public async create(data: CreateSetRequest, schoolId: string, userId: string): Promise<UniformSetDetail> {
    const setUuid = generateShortUuid(12);
    const now = new Date();

    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into uniform_set (uuid, school_id, name, gender, description, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
    `);
    params.push([setUuid, schoolId, data.name, data.gender || null, data.description || null, DEFAULTS.STATUS, userId, now]);

    for (let idx = 0; idx < data.items.length; idx++) {
      const item = data.items[idx];
      const itemUuid = generateShortUuid(12);
      queries.push(singleLineString`
        insert into uniform_set_item (uuid, set_id, school_id, item_id, quantity, sort_order, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `);
      params.push([itemUuid, setUuid, schoolId, item.itemId, item.quantity, item.sortOrder ?? idx, DEFAULTS.STATUS, userId, now]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getById(setUuid, schoolId) as Promise<UniformSetDetail>;
  }

  public async update(id: string, data: UpdateSetRequest, schoolId: string, userId: string): Promise<UniformSetDetail | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    const now = new Date();
    const updates: string[] = [];
    const headerParams: any[] = [];
    let p = 1;

    if (data.name !== undefined) { updates.push(`name = $${p++}`); headerParams.push(data.name); }
    if (data.gender !== undefined) { updates.push(`gender = $${p++}`); headerParams.push(data.gender); }
    if (data.description !== undefined) { updates.push(`description = $${p++}`); headerParams.push(data.description); }

    const queries: string[] = [];
    const params: any[][] = [];

    if (updates.length > 0) {
      updates.push(`updatedby_userid = $${p++}`); headerParams.push(userId);
      updates.push(`updated_at = $${p++}`); headerParams.push(now);
      headerParams.push(id); headerParams.push(schoolId);
      queries.push(`update uniform_set set ${updates.join(', ')} where uuid = $${p++} and school_id = $${p++}`);
      params.push(headerParams);
    }

    // Replace items if provided
    if (data.items !== undefined) {
      // Soft-delete old items
      queries.push(`update uniform_set_item set status = 'deleted' where set_id = $1 and school_id = $2`);
      params.push([id, schoolId]);

      for (let idx = 0; idx < data.items.length; idx++) {
        const item = data.items[idx];
        const itemUuid = generateShortUuid(12);
        queries.push(singleLineString`
          insert into uniform_set_item (uuid, set_id, school_id, item_id, quantity, sort_order, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `);
        params.push([itemUuid, id, schoolId, item.itemId, item.quantity, item.sortOrder ?? idx, DEFAULTS.STATUS, userId, now]);
      }
    }

    if (queries.length > 0) {
      await DB.queriesInTransaction(queries, params);
    }

    return this.getById(id, schoolId);
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const now = new Date();
    await DB.queriesInTransaction([
      `update uniform_set_item set status = 'deleted' where set_id = $1 and school_id = $2`,
      `update uniform_set set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
    ], [
      [id, schoolId],
      [userId, now, id, schoolId],
    ]);
    return true;
  }

  public async getById(id: string, schoolId: string): Promise<UniformSetDetail | null> {
    const sets = await DB.query(
      `select * from uniform_set where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    if (sets.length === 0) return null;

    const items = await DB.query(
      singleLineString`
        select si.*, ui.name as item_name, ui.category as item_category, ui.gender as item_gender
        from uniform_set_item si
        join uniform_item ui on si.item_id = ui.uuid
        where si.set_id = $1 and si.status = 'active'
        order by si.sort_order, si.created_at
      `,
      [id]
    );

    return { ...sets[0], items };
  }

  public async list(schoolId: string, gender?: string): Promise<UniformSet[]> {
    let query = `select * from uniform_set where school_id = $1 and status = 'active'`;
    const params: any[] = [schoolId];
    if (gender) { query += ` and gender = $2`; params.push(gender); }
    query += ` order by name`;
    return DB.query(query, params);
  }

  // Expand a set into line items for the sale form (no sizes — chosen by user)
  public async expandSet(setId: string, schoolId: string): Promise<any[]> {
    const items = await DB.query(
      singleLineString`
        select si.item_id, si.quantity, si.sort_order,
          ui.name as item_name, ui.category as item_category, ui.gender as item_gender
        from uniform_set_item si
        join uniform_item ui on si.item_id = ui.uuid
        where si.set_id = $1 and si.status = 'active'
        order by si.sort_order, si.created_at
      `,
      [setId]
    );
    return items;
  }
}

export const uniformSetService = new UniformSetService();
