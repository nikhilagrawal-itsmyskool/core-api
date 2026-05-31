import { DB, singleLineString } from '../../shared/lib/db';
import {
  ShopSet,
  ShopSetDetail,
  ShopSetItem,
  CreateSetRequest,
  UpdateSetRequest,
} from './shop-interfaces';
import { DEFAULTS } from './shop-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class ShopSetService {
  public async createSet(data: CreateSetRequest, schoolId: string, userId: string): Promise<ShopSetDetail> {
    const setUuid = generateShortUuid(12);
    const now = new Date();

    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into shop_set
      (uuid, school_id, name, class_no, academic_session, description, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `);
    params.push([
      setUuid, schoolId, data.name, data.classNo, data.academicSession,
      data.description || null, DEFAULTS.STATUS, userId, now,
    ]);

    for (const item of (data.items || [])) {
      const itemUuid = generateShortUuid(12);
      queries.push(singleLineString`
        insert into shop_set_item
        (uuid, set_id, school_id, item_id, section, quantity, sort_order, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `);
      params.push([
        itemUuid, setUuid, schoolId, item.itemId, item.section,
        item.quantity, item.sortOrder ?? 0, DEFAULTS.STATUS, userId, now,
      ]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getSet(setUuid, schoolId) as Promise<ShopSetDetail>;
  }

  public async getSet(id: string, schoolId: string): Promise<ShopSetDetail | null> {
    const sets = await DB.query(
      `select * from shop_set where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    if (sets.length === 0) return null;

    const items = await DB.query(
      singleLineString`
        select si.*, s.name as item_name, s.type as item_type, s.subject as item_subject,
               s.publisher as item_publisher, s.class_no as item_class_no,
               lp.mrp as last_mrp, lp.student_discount_pct as last_student_discount_pct
        from shop_set_item si
        join shop_item s on si.item_id = s.uuid
        left join lateral (
          select pl.mrp, pl.student_discount_pct
          from shop_purchase_log pl
          join shop_purchase_batch b on pl.batch_id = b.uuid
          where pl.item_id = si.item_id and pl.status = 'active'
          order by b.purchase_date desc, pl.created_at desc
          limit 1
        ) lp on true
        where si.set_id = $1 and si.status = 'active'
        order by si.sort_order, si.created_at asc
      `,
      [id]
    );

    return {
      ...sets[0],
      items: items.map((r: any) => this.parseItemNumericFields(r)),
    };
  }

  public async listSets(schoolId: string, filters: {
    classNo?: number;
    academicSession?: string;
  }): Promise<ShopSet[]> {
    let query = `select * from shop_set where school_id = $1 and status = 'active'`;
    const queryParams: any[] = [schoolId];
    let p = 2;

    if (filters.classNo) { query += ` and class_no = $${p++}`; queryParams.push(filters.classNo); }
    if (filters.academicSession) { query += ` and academic_session = $${p++}`; queryParams.push(filters.academicSession); }

    query += ` order by academic_session desc, class_no asc`;
    return DB.query(query, queryParams);
  }

  public async updateSet(id: string, data: UpdateSetRequest, schoolId: string, userId: string): Promise<ShopSetDetail | null> {
    const existing = await this.getSet(id, schoolId);
    if (!existing) return null;

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    const updates: string[] = [];
    const updateParams: any[] = [];
    let i = 1;

    if (data.name !== undefined) { updates.push(`name = $${i++}`); updateParams.push(data.name); }
    if (data.description !== undefined) { updates.push(`description = $${i++}`); updateParams.push(data.description || null); }

    if (updates.length > 0) {
      updates.push(`updatedby_userid = $${i++}`); updateParams.push(userId);
      updates.push(`updated_at = $${i++}`); updateParams.push(now);
      updateParams.push(id); updateParams.push(schoolId);
      queries.push(`update shop_set set ${updates.join(', ')} where uuid = $${i++} and school_id = $${i++} and status = 'active'`);
      params.push(updateParams);
    }

    if (data.items !== undefined) {
      // Replace all items: soft-delete existing, insert new
      queries.push(`update shop_set_item set status = 'deleted' where set_id = $1 and school_id = $2 and status = 'active'`);
      params.push([id, schoolId]);

      for (const item of data.items) {
        const itemUuid = generateShortUuid(12);
        queries.push(singleLineString`
          insert into shop_set_item
          (uuid, set_id, school_id, item_id, section, quantity, sort_order, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `);
        params.push([
          itemUuid, id, schoolId, item.itemId, item.section,
          item.quantity, item.sortOrder ?? 0, DEFAULTS.STATUS, userId, now,
        ]);
      }
    }

    if (queries.length > 0) {
      await DB.queriesInTransaction(queries, params);
    }

    return this.getSet(id, schoolId);
  }

  public async deleteSet(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getSet(id, schoolId);
    if (!existing) return false;

    const now = new Date();
    await DB.queriesInTransaction([
      `update shop_set_item set status = 'deleted' where set_id = $1 and school_id = $2 and status = 'active'`,
      `update shop_set set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
    ], [
      [id, schoolId],
      [userId, now, id, schoolId],
    ]);
    return true;
  }

  private parseItemNumericFields(item: any): ShopSetItem {
    return {
      ...item,
      lastMrp: item.lastMrp != null ? parseFloat(item.lastMrp) : undefined,
      lastStudentDiscountPct: item.lastStudentDiscountPct != null ? parseFloat(item.lastStudentDiscountPct) : undefined,
    };
  }
}

export const shopSetService = new ShopSetService();
