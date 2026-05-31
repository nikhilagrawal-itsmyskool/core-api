import { DB, singleLineString } from '../../shared/lib/db';
import {
  UniformItem,
  UniformItemSize,
  UniformItemWithSizes,
  CreateItemRequest,
  UpdateItemRequest,
  CreateSizeRequest,
  UpdateSizeRequest,
} from './uniform-interfaces';
import { DEFAULTS } from './uniform-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class UniformItemService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const results = await DB.query(
      `select uuid from school where lower(code) = lower($1)`,
      [schoolCode]
    );
    return results.length > 0 ? results[0].uuid : null;
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  public async createItem(data: CreateItemRequest, schoolId: string, userId: string): Promise<UniformItem> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const query = singleLineString`
      insert into uniform_item
      (uuid, school_id, name, category, gender, is_seeded, description, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, false, $6, $7, $8, $9)
      returning *
    `;
    const results = await DB.query(query, [
      uuid, schoolId, data.name, data.category, data.gender,
      data.description || null, DEFAULTS.STATUS, userId, now,
    ]);
    return results[0];
  }

  public async updateItem(id: string, data: UpdateItemRequest, schoolId: string, userId: string): Promise<UniformItem | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.name !== undefined) { updates.push(`name = $${i++}`); params.push(data.name); }
    if (data.category !== undefined) { updates.push(`category = $${i++}`); params.push(data.category); }
    if (data.gender !== undefined) { updates.push(`gender = $${i++}`); params.push(data.gender); }
    if (data.description !== undefined) { updates.push(`description = $${i++}`); params.push(data.description); }

    if (updates.length === 0) {
      return this.getItemById(id, schoolId);
    }

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(id); params.push(schoolId);

    const query = singleLineString`
      update uniform_item
      set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;
    const results = await DB.query(query, params);
    return results.length > 0 ? results[0] : null;
  }

  public async deleteItem(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getItemById(id, schoolId);
    if (!existing) return false;
    const now = new Date();
    // Soft-delete item and all its sizes
    await DB.queriesInTransaction([
      `update uniform_item_size set status = 'deleted', updatedby_userid = $1, updated_at = $2 where item_id = $3 and school_id = $4 and status = 'active'`,
      `update uniform_item set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
    ], [
      [userId, now, id, schoolId],
      [userId, now, id, schoolId],
    ]);
    return true;
  }

  public async getItemById(id: string, schoolId: string): Promise<UniformItem | null> {
    const results = await DB.query(
      `select * from uniform_item where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async listItemsWithSizes(schoolId: string, filters: {
    category?: string;
    gender?: string;
  }): Promise<UniformItemWithSizes[]> {
    let itemQuery = `select * from uniform_item where school_id = $1 and status = 'active'`;
    const itemParams: any[] = [schoolId];
    let p = 2;

    if (filters.category) { itemQuery += ` and category = $${p++}`; itemParams.push(filters.category); }
    if (filters.gender) { itemQuery += ` and gender = $${p++}`; itemParams.push(filters.gender); }
    itemQuery += ` order by category, gender, name`;

    const items: UniformItem[] = await DB.query(itemQuery, itemParams);
    if (items.length === 0) return [];

    const itemIds = items.map((it: UniformItem) => it.uuid);
    const sizes: UniformItemSize[] = await DB.query(
      `select * from uniform_item_size where item_id = ANY($1) and status = 'active' order by item_id, size_label`,
      [itemIds]
    );

    const sizesByItem = new Map<string, UniformItemSize[]>();
    for (const size of sizes) {
      const list = sizesByItem.get(size.itemId) || [];
      list.push(this.parseSizeNumericFields(size));
      sizesByItem.set(size.itemId, list);
    }

    return items.map((item: UniformItem) => ({
      ...item,
      sizes: sizesByItem.get(item.uuid) || [],
    }));
  }

  // ── Sizes ──────────────────────────────────────────────────────────────────

  public async createSize(itemId: string, data: CreateSizeRequest, schoolId: string, userId: string): Promise<UniformItemSize> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const query = singleLineString`
      insert into uniform_item_size
      (uuid, item_id, school_id, size_label, mrp, student_discount_pct, bulk_discount_pct, current_stock, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      returning *
    `;
    const results = await DB.query(query, [
      uuid, itemId, schoolId, data.sizeLabel,
      data.mrp ?? null, data.studentDiscountPct ?? null, data.bulkDiscountPct ?? null,
      DEFAULTS.CURRENT_STOCK, DEFAULTS.STATUS, userId, now,
    ]);
    return this.parseSizeNumericFields(results[0]);
  }

  public async updateSize(sizeId: string, data: UpdateSizeRequest, schoolId: string, userId: string): Promise<UniformItemSize | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.sizeLabel !== undefined) { updates.push(`size_label = $${i++}`); params.push(data.sizeLabel); }
    if (data.mrp !== undefined) { updates.push(`mrp = $${i++}`); params.push(data.mrp); }
    if (data.studentDiscountPct !== undefined) { updates.push(`student_discount_pct = $${i++}`); params.push(data.studentDiscountPct); }
    if (data.bulkDiscountPct !== undefined) { updates.push(`bulk_discount_pct = $${i++}`); params.push(data.bulkDiscountPct); }

    if (updates.length === 0) {
      const results = await DB.query(`select * from uniform_item_size where uuid = $1 and school_id = $2`, [sizeId, schoolId]);
      return results.length > 0 ? this.parseSizeNumericFields(results[0]) : null;
    }

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(sizeId); params.push(schoolId);

    const query = singleLineString`
      update uniform_item_size
      set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;
    const results = await DB.query(query, params);
    return results.length > 0 ? this.parseSizeNumericFields(results[0]) : null;
  }

  public async deleteSize(sizeId: string, schoolId: string, userId: string): Promise<boolean> {
    await DB.query(
      `update uniform_item_size set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, new Date(), sizeId, schoolId]
    );
    return true;
  }

  public async getSizeById(sizeId: string, schoolId: string): Promise<UniformItemSize | null> {
    const results = await DB.query(
      `select * from uniform_item_size where uuid = $1 and school_id = $2 and status = 'active'`,
      [sizeId, schoolId]
    );
    return results.length > 0 ? this.parseSizeNumericFields(results[0]) : null;
  }

  public async getSizesByItemId(itemId: string, schoolId: string): Promise<UniformItemSize[]> {
    const results = await DB.query(
      `select * from uniform_item_size where item_id = $1 and school_id = $2 and status = 'active' order by size_label`,
      [itemId, schoolId]
    );
    return results.map((r: any) => this.parseSizeNumericFields(r));
  }

  private parseSizeNumericFields(size: any): UniformItemSize {
    return {
      ...size,
      mrp: size.mrp != null ? parseFloat(size.mrp) : null,
      studentDiscountPct: size.studentDiscountPct != null ? parseFloat(size.studentDiscountPct) : null,
      bulkDiscountPct: size.bulkDiscountPct != null ? parseFloat(size.bulkDiscountPct) : null,
      currentStock: size.currentStock != null ? parseInt(size.currentStock, 10) : 0,
    };
  }
}

export const uniformItemService = new UniformItemService();
