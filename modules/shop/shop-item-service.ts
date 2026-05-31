import { DB, singleLineString } from '../../shared/lib/db';
import {
  ShopItem,
  ShopItemWithPricing,
  CreateItemRequest,
  UpdateItemRequest,
} from './shop-interfaces';
import { DEFAULTS } from './shop-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class ShopItemService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const results = await DB.query(
      `select uuid from school where lower(code) = lower($1)`,
      [schoolCode]
    );
    return results.length > 0 ? results[0].uuid : null;
  }

  public async createItem(data: CreateItemRequest, schoolId: string, userId: string): Promise<ShopItem> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const query = singleLineString`
      insert into shop_item
      (uuid, school_id, name, type, subject, publisher, class_no, current_stock, description, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      returning *
    `;
    const results = await DB.query(query, [
      uuid, schoolId, data.name, data.type,
      data.subject || null, data.publisher || null, data.classNo || null,
      DEFAULTS.CURRENT_STOCK, data.description || null, DEFAULTS.STATUS, userId, now,
    ]);
    return this.parseNumericFields(results[0]);
  }

  public async updateItem(id: string, data: UpdateItemRequest, schoolId: string, userId: string): Promise<ShopItem | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.name !== undefined) { updates.push(`name = $${i++}`); params.push(data.name); }
    if (data.subject !== undefined) { updates.push(`subject = $${i++}`); params.push(data.subject || null); }
    if (data.publisher !== undefined) { updates.push(`publisher = $${i++}`); params.push(data.publisher || null); }
    if (data.classNo !== undefined) { updates.push(`class_no = $${i++}`); params.push(data.classNo || null); }
    if (data.description !== undefined) { updates.push(`description = $${i++}`); params.push(data.description || null); }

    if (updates.length === 0) return this.getItemById(id, schoolId);

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(id); params.push(schoolId);

    const query = singleLineString`
      update shop_item
      set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;
    const results = await DB.query(query, params);
    return results.length > 0 ? this.parseNumericFields(results[0]) : null;
  }

  public async deleteItem(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getItemById(id, schoolId);
    if (!existing) return false;
    const now = new Date();
    await DB.query(
      `update shop_item set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
      [userId, now, id, schoolId]
    );
    return true;
  }

  public async getItemById(id: string, schoolId: string): Promise<ShopItem | null> {
    const results = await DB.query(
      `select * from shop_item where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? this.parseNumericFields(results[0]) : null;
  }

  public async listItemsWithPricing(schoolId: string, filters: {
    type?: string;
    classNo?: number;
    academicSession?: string;
  }): Promise<ShopItemWithPricing[]> {
    let itemQuery = `select * from shop_item where school_id = $1 and status = 'active'`;
    const itemParams: any[] = [schoolId];
    let p = 2;

    if (filters.type) { itemQuery += ` and type = $${p++}`; itemParams.push(filters.type); }
    if (filters.classNo) { itemQuery += ` and class_no = $${p++}`; itemParams.push(filters.classNo); }
    itemQuery += ` order by type, class_no, name`;

    const items: ShopItem[] = await DB.query(itemQuery, itemParams);
    if (items.length === 0) return [];

    const itemIds = items.map((it: ShopItem) => it.uuid);

    // For each item, get the most recent purchase log pricing
    // Books: filter by academicSession if provided; notebooks/stationery: most recent overall
    let pricingQuery: string;
    let pricingParams: any[];

    if (filters.academicSession) {
      pricingQuery = singleLineString`
        select distinct on (pl.item_id)
          pl.item_id, pl.mrp, pl.student_discount_pct, pl.bulk_discount_pct, b.academic_session
        from shop_purchase_log pl
        join shop_purchase_batch b on pl.batch_id = b.uuid
        where pl.item_id = any($1) and pl.status = 'active'
          and (
            (b.academic_session = $2)
            or (b.academic_session is null)
          )
        order by pl.item_id, b.purchase_date desc, pl.created_at desc
      `;
      pricingParams = [itemIds, filters.academicSession];
    } else {
      pricingQuery = singleLineString`
        select distinct on (pl.item_id)
          pl.item_id, pl.mrp, pl.student_discount_pct, pl.bulk_discount_pct, b.academic_session
        from shop_purchase_log pl
        join shop_purchase_batch b on pl.batch_id = b.uuid
        where pl.item_id = any($1) and pl.status = 'active'
        order by pl.item_id, b.purchase_date desc, pl.created_at desc
      `;
      pricingParams = [itemIds];
    }

    const pricingRows = await DB.query(pricingQuery, pricingParams);
    const pricingMap = new Map<string, any>();
    for (const row of pricingRows) {
      pricingMap.set(row.itemId, row);
    }

    return items.map((item: ShopItem) => {
      const pricing = pricingMap.get(item.uuid);
      const mrp = pricing?.mrp != null ? parseFloat(pricing.mrp) : undefined;
      const discountPct = pricing?.studentDiscountPct != null ? parseFloat(pricing.studentDiscountPct) : undefined;
      const stock = item.currentStock || 0;
      const discountedPrice = mrp != null && discountPct != null
        ? parseFloat((mrp * (1 - discountPct / 100)).toFixed(2))
        : mrp;
      return {
        ...item,
        lastMrp: mrp,
        lastStudentDiscountPct: discountPct,
        lastBulkDiscountPct: pricing?.bulkDiscountPct != null ? parseFloat(pricing.bulkDiscountPct) : undefined,
        lastAcademicSession: pricing?.academicSession || undefined,
        discountedStockValue: discountedPrice != null ? parseFloat((discountedPrice * stock).toFixed(2)) : undefined,
      };
    });
  }

  private parseNumericFields(item: any): ShopItem {
    return {
      ...item,
      currentStock: item.currentStock != null ? parseInt(item.currentStock, 10) : 0,
    };
  }
}

export const shopItemService = new ShopItemService();
