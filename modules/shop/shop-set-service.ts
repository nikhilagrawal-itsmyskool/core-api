import { DB, singleLineString } from '../../shared/lib/db';
import {
  ShopSet,
  ShopSetDetail,
  ShopSetItem,
  ShopSetStock,
  ShopLooseEntry,
  CreateSetRequest,
  UpdateSetRequest,
} from './shop-interfaces';
import { DEFAULTS, GRADE_ORDER } from './shop-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Parse the stored highlight_publishers JSON string into an array (safe on junk).
function parsePublishers(raw: any): string[] {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// unitPrice = mrp * (1 - discountPct/100); rounded to 2dp. Missing price -> 0.
function priceLine(mrp: number | null, discountPct: number | null, quantity: number) {
  const m = mrp != null ? mrp : 0;
  const d = discountPct != null ? discountPct : 0;
  const unitPrice = parseFloat((m * (1 - d / 100)).toFixed(2));
  const lineTotal = parseFloat((unitPrice * quantity).toFixed(2));
  return { unitPrice, lineTotal };
}

class ShopSetService {
  public async createSet(data: CreateSetRequest, schoolId: string, userId: string): Promise<ShopSetDetail> {
    const setUuid = generateShortUuid(12);
    const now = new Date();
    const name = data.name || `Class ${data.grade} Set ${data.academicSession}`;

    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into shop_set
      (uuid, school_id, name, grade, academic_session, description, highlight_publishers, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `);
    params.push([
      setUuid, schoolId, name, data.grade, data.academicSession,
      data.description || null,
      data.highlightPublishers?.length ? JSON.stringify(data.highlightPublishers) : null,
      DEFAULTS.STATUS, userId, now,
    ]);

    let sort = 0;
    for (const item of (data.items || [])) {
      const itemUuid = generateShortUuid(12);
      queries.push(singleLineString`
        insert into shop_set_item
        (uuid, set_id, school_id, item_id, section, quantity, mrp, discount_pct, sort_order, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `);
      params.push([
        itemUuid, setUuid, schoolId, item.itemId, item.section,
        item.quantity, item.mrp ?? null, item.discountPct ?? null,
        item.sortOrder ?? sort++, DEFAULTS.STATUS, userId, now,
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

    const rows = await DB.query(
      singleLineString`
        select si.*, s.name as item_name, s.type as item_type, s.subject as item_subject,
               s.publisher as item_publisher
        from shop_set_item si
        join shop_item s on si.item_id = s.uuid
        where si.set_id = $1 and si.status = 'active'
        order by si.sort_order, si.created_at asc
      `,
      [id]
    );

    let setPrice = 0;
    const items: ShopSetItem[] = rows.map((r: any) => {
      const mrp = r.mrp != null ? parseFloat(r.mrp) : null;
      const discountPct = r.discountPct != null ? parseFloat(r.discountPct) : null;
      const { unitPrice, lineTotal } = priceLine(mrp, discountPct, r.quantity);
      setPrice += lineTotal;
      return { ...r, mrp: mrp ?? undefined, discountPct: discountPct ?? undefined, unitPrice, lineTotal };
    });

    return {
      ...sets[0],
      highlightPublishers: parsePublishers(sets[0].highlightPublishers),
      items,
      setPrice: parseFloat(setPrice.toFixed(2)),
    };
  }

  public async listSets(schoolId: string, filters: {
    grade?: string;
    academicSession?: string;
  }): Promise<Array<ShopSet & { setPrice: number; itemCount: number; received: number; assigned: number; remaining: number }>> {
    let query = singleLineString`
      select s.*,
        (select count(*) from shop_set_item si where si.set_id = s.uuid and si.status = 'active') as item_count,
        (select coalesce(sum(i.qty_sets), 0) from shop_set_intake i where i.set_id = s.uuid and i.status = 'active') as received,
        (select count(*) from shop_sale sa where sa.set_id = s.uuid and sa.status = 'active') as assigned,
        (select coalesce(sum(si.quantity * si.mrp * (1 - coalesce(si.discount_pct,0)/100)), 0)
           from shop_set_item si where si.set_id = s.uuid and si.status = 'active') as set_price
      from shop_set s
      where s.school_id = $1 and s.status = 'active'
    `;
    const queryParams: any[] = [schoolId];
    let p = 2;
    if (filters.grade) { query += ` and s.grade = $${p++}`; queryParams.push(filters.grade); }
    if (filters.academicSession) { query += ` and s.academic_session = $${p++}`; queryParams.push(filters.academicSession); }
    query += ` order by s.academic_session desc`;

    const rows = await DB.query(query, queryParams);
    const mapped = rows.map((r: any) => {
      const received = parseInt(r.received, 10) || 0;
      const assigned = parseInt(r.assigned, 10) || 0;
      return {
        ...r,
        itemCount: parseInt(r.itemCount, 10) || 0,
        setPrice: r.setPrice != null ? parseFloat(parseFloat(r.setPrice).toFixed(2)) : 0,
        received,
        assigned,
        remaining: received - assigned,
      };
    });
    // Sort by grade order within the (already session-desc) list.
    mapped.sort((a: any, b: any) => {
      if (a.academicSession !== b.academicSession) return a.academicSession < b.academicSession ? 1 : -1;
      const ao = GRADE_ORDER[(a.grade || '').toLowerCase()] ?? 999;
      const bo = GRADE_ORDER[(b.grade || '').toLowerCase()] ?? 999;
      return ao - bo;
    });
    return mapped;
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
    if (data.highlightPublishers !== undefined) {
      updates.push(`highlight_publishers = $${i++}`);
      updateParams.push(data.highlightPublishers?.length ? JSON.stringify(data.highlightPublishers) : null);
    }

    if (updates.length > 0) {
      updates.push(`updatedby_userid = $${i++}`); updateParams.push(userId);
      updates.push(`updated_at = $${i++}`); updateParams.push(now);
      updateParams.push(id); updateParams.push(schoolId);
      queries.push(`update shop_set set ${updates.join(', ')} where uuid = $${i++} and school_id = $${i++} and status = 'active'`);
      params.push(updateParams);
    }

    if (data.items !== undefined) {
      // Replace all recipe lines: soft-delete existing, insert new
      queries.push(`update shop_set_item set status = 'deleted' where set_id = $1 and school_id = $2 and status = 'active'`);
      params.push([id, schoolId]);

      let sort = 0;
      for (const item of data.items) {
        const itemUuid = generateShortUuid(12);
        queries.push(singleLineString`
          insert into shop_set_item
          (uuid, set_id, school_id, item_id, section, quantity, mrp, discount_pct, sort_order, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `);
        params.push([
          itemUuid, id, schoolId, item.itemId, item.section,
          item.quantity, item.mrp ?? null, item.discountPct ?? null,
          item.sortOrder ?? sort++, DEFAULTS.STATUS, userId, now,
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

  // Stock summary for a set: received (intakes) / assigned (sales) / remaining,
  // plus the loose box for this set's grade+session.
  public async getSetStock(id: string, schoolId: string): Promise<ShopSetStock | null> {
    const sets = await DB.query(
      `select uuid, grade, academic_session from shop_set where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    if (sets.length === 0) return null;
    const set = sets[0];

    const recv = await DB.query(
      `select coalesce(sum(qty_sets), 0) as received from shop_set_intake where set_id = $1 and status = 'active'`,
      [id]
    );
    const asg = await DB.query(
      `select count(*) as assigned from shop_sale where set_id = $1 and status = 'active'`,
      [id]
    );
    const received = parseInt(recv[0].received, 10) || 0;
    const assigned = parseInt(asg[0].assigned, 10) || 0;

    const loose = await this.listLoose(schoolId, {
      grade: set.grade,
      academicSession: set.academicSession,
    });

    return { received, assigned, remaining: received - assigned, loose };
  }

  // Loose-box on-hand per item (sum of movements), filtered by grade/session.
  public async listLoose(schoolId: string, filters: {
    grade?: string;
    academicSession?: string;
  }): Promise<ShopLooseEntry[]> {
    let query = singleLineString`
      select m.item_id, i.name as item_name, i.type as item_type, sum(m.qty) as qty
      from shop_loose_movement m
      join shop_item i on m.item_id = i.uuid
      where m.school_id = $1 and m.status = 'active'
    `;
    const queryParams: any[] = [schoolId];
    let p = 2;
    if (filters.grade) { query += ` and m.grade = $${p++}`; queryParams.push(filters.grade); }
    if (filters.academicSession) { query += ` and m.academic_session = $${p++}`; queryParams.push(filters.academicSession); }
    query += ` group by m.item_id, i.name, i.type having sum(m.qty) <> 0 order by i.name asc`;

    const rows = await DB.query(query, queryParams);
    return rows.map((r: any) => ({
      itemId: r.itemId,
      itemName: r.itemName,
      itemType: r.itemType,
      qty: parseInt(r.qty, 10) || 0,
    }));
  }
}

export const shopSetService = new ShopSetService();
