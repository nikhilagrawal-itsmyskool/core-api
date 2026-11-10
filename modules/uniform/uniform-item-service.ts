import { DB, singleLineString } from '../../shared/lib/db';
import {
  UniformItem,
  UniformItemSize,
  UniformItemWithSizes,
  UniformPriceBand,
  CreateItemRequest,
  UpdateItemRequest,
  CreateSizeRequest,
  UpdateSizeRequest,
  CreateBandRequest,
  UpdateBandRequest,
  BreakSizesRequest,
  SetOpeningStockRequest,
  MoveStockRequest,
  PriceSuggestion,
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
    const sizingMode = data.sizingMode === 'unsized' ? 'unsized' : DEFAULTS.SIZING_MODE;

    const insertItem = singleLineString`
      insert into uniform_item
      (uuid, school_id, name, category, gender, sizing_mode, is_seeded, description, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, false, $7, $8, $9, $10)
    `;
    const itemParams = [
      uuid, schoolId, data.name, data.category, data.gender, sizingMode,
      data.description || null, DEFAULTS.STATUS, userId, now,
    ];

    if (sizingMode === 'unsized') {
      // An unsized item carries exactly one pool stock row (the bulk count).
      const poolUuid = generateShortUuid(12);
      const insertPool = singleLineString`
        insert into uniform_item_size
        (uuid, item_id, school_id, size_label, mrp, student_discount_pct, bulk_discount_pct, current_stock, is_pool, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, null, null, null, $5, true, $6, $7, $8)
      `;
      await DB.queriesInTransaction([insertItem, insertPool], [
        itemParams,
        [poolUuid, uuid, schoolId, DEFAULTS.POOL_SIZE_LABEL, DEFAULTS.CURRENT_STOCK, DEFAULTS.STATUS, userId, now],
      ]);
    } else {
      await DB.query(insertItem, itemParams);
    }

    const created = await this.getItemById(uuid, schoolId);
    return created as UniformItem;
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
    // Soft-delete item and all its sizes + price bands
    await DB.queriesInTransaction([
      `update uniform_item_size set status = 'deleted', updatedby_userid = $1, updated_at = $2 where item_id = $3 and school_id = $4 and status = 'active'`,
      `update uniform_price_band set status = 'deleted', updatedby_userid = $1, updated_at = $2 where item_id = $3 and school_id = $4 and status = 'active'`,
      `update uniform_item set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
    ], [
      [userId, now, id, schoolId],
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
    return results.length > 0 ? this.normalizeItem(results[0]) : null;
  }

  // Rows created before sizing_mode existed have null; treat as 'sized'.
  private normalizeItem(item: any): UniformItem {
    return { ...item, sizingMode: item.sizingMode || DEFAULTS.SIZING_MODE };
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
    const bands: UniformPriceBand[] = await DB.query(
      `select * from uniform_price_band where item_id = ANY($1) and status = 'active' order by item_id, sort_order nulls last, number_from`,
      [itemIds]
    );

    const sizesByItem = new Map<string, UniformItemSize[]>();
    for (const size of sizes) {
      const list = sizesByItem.get(size.itemId) || [];
      list.push(this.parseSizeNumericFields(size));
      sizesByItem.set(size.itemId, list);
    }
    const bandsByItem = new Map<string, UniformPriceBand[]>();
    for (const band of bands) {
      const list = bandsByItem.get(band.itemId) || [];
      list.push(this.parseBandNumericFields(band));
      bandsByItem.set(band.itemId, list);
    }

    return items.map((item: UniformItem) => ({
      ...this.normalizeItem(item),
      sizes: sizesByItem.get(item.uuid) || [],
      bands: bandsByItem.get(item.uuid) || [],
    }));
  }

  // ── Sizes ──────────────────────────────────────────────────────────────────

  public async createSize(itemId: string, data: CreateSizeRequest, schoolId: string, userId: string): Promise<UniformItemSize> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const query = singleLineString`
      insert into uniform_item_size
      (uuid, item_id, school_id, size_label, mrp, student_discount_pct, bulk_discount_pct, current_stock, is_unknown, note, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      returning *
    `;
    const results = await DB.query(query, [
      uuid, itemId, schoolId, data.sizeLabel,
      data.mrp ?? null, data.studentDiscountPct ?? null, data.bulkDiscountPct ?? null,
      DEFAULTS.CURRENT_STOCK, data.isUnknown === true, data.note ?? null, DEFAULTS.STATUS, userId, now,
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
    if (data.isUnknown !== undefined) { updates.push(`is_unknown = $${i++}`); params.push(data.isUnknown === true); }
    if (data.note !== undefined) { updates.push(`note = $${i++}`); params.push(data.note || null); }

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
      isPool: size.isPool === true,
      isUnknown: size.isUnknown === true,
    };
  }

  // ── Price bands (unsized items) ──────────────────────────────────────────────

  public async getBandsByItemId(itemId: string, schoolId: string): Promise<UniformPriceBand[]> {
    const rows = await DB.query(
      singleLineString`
        select * from uniform_price_band
        where item_id = $1 and school_id = $2 and status = 'active'
        order by sort_order nulls last, number_from
      `,
      [itemId, schoolId]
    );
    return rows.map((r: any) => this.parseBandNumericFields(r));
  }

  public async createBand(itemId: string, data: CreateBandRequest, schoolId: string, userId: string): Promise<UniformPriceBand> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const query = singleLineString`
      insert into uniform_price_band
      (uuid, item_id, school_id, number_from, number_to, mrp, student_discount_pct, bulk_discount_pct, sort_order, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      returning *
    `;
    const results = await DB.query(query, [
      uuid, itemId, schoolId, data.numberFrom, data.numberTo,
      data.mrp ?? null, data.studentDiscountPct ?? null, data.bulkDiscountPct ?? null,
      data.sortOrder ?? DEFAULTS.SORT_ORDER, DEFAULTS.STATUS, userId, now,
    ]);
    return this.parseBandNumericFields(results[0]);
  }

  public async updateBand(bandId: string, data: UpdateBandRequest, schoolId: string, userId: string): Promise<UniformPriceBand | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.numberFrom !== undefined) { updates.push(`number_from = $${i++}`); params.push(data.numberFrom); }
    if (data.numberTo !== undefined) { updates.push(`number_to = $${i++}`); params.push(data.numberTo); }
    if (data.mrp !== undefined) { updates.push(`mrp = $${i++}`); params.push(data.mrp); }
    if (data.studentDiscountPct !== undefined) { updates.push(`student_discount_pct = $${i++}`); params.push(data.studentDiscountPct); }
    if (data.bulkDiscountPct !== undefined) { updates.push(`bulk_discount_pct = $${i++}`); params.push(data.bulkDiscountPct); }
    if (data.sortOrder !== undefined) { updates.push(`sort_order = $${i++}`); params.push(data.sortOrder); }

    if (updates.length === 0) {
      const rows = await DB.query(`select * from uniform_price_band where uuid = $1 and school_id = $2`, [bandId, schoolId]);
      return rows.length > 0 ? this.parseBandNumericFields(rows[0]) : null;
    }

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(bandId); params.push(schoolId);

    const query = singleLineString`
      update uniform_price_band set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;
    const results = await DB.query(query, params);
    return results.length > 0 ? this.parseBandNumericFields(results[0]) : null;
  }

  public async deleteBand(bandId: string, schoolId: string, userId: string): Promise<boolean> {
    await DB.query(
      `update uniform_price_band set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, new Date(), bandId, schoolId]
    );
    return true;
  }

  // Suggested price for a judged number: first active band whose [from, to] covers it.
  public async suggestPrice(itemId: string, num: number, schoolId: string): Promise<PriceSuggestion> {
    const rows = await DB.query(
      singleLineString`
        select * from uniform_price_band
        where item_id = $1 and school_id = $2 and status = 'active'
          and $3 >= number_from and $3 <= number_to
        order by sort_order nulls last, number_from
        limit 1
      `,
      [itemId, schoolId, num]
    );
    if (rows.length === 0) {
      return { itemId, number: num, bandId: null, mrp: null, studentDiscountPct: null, bulkDiscountPct: null, matched: false };
    }
    const b = this.parseBandNumericFields(rows[0]);
    return {
      itemId, number: num, bandId: b.uuid,
      mrp: b.mrp ?? null,
      studentDiscountPct: b.studentDiscountPct ?? null,
      bulkDiscountPct: b.bulkDiscountPct ?? null,
      matched: true,
    };
  }

  // Break an unsized item's pool into per-number sized rows. Permanent: the pool is
  // retired and the item becomes 'sized'. sum(quantities) must equal the pool stock.
  public async breakIntoSizes(itemId: string, data: BreakSizesRequest, schoolId: string, userId: string): Promise<UniformItemWithSizes> {
    const item = await this.getItemById(itemId, schoolId);
    if (!item) throw new Error('Item not found');
    if (item.sizingMode !== 'unsized') throw new Error('Only unsized items can be broken into numbers');

    const breakdown = data.breakdown || [];
    if (breakdown.length === 0) throw new Error('breakdown is required');

    // Validate labels + quantities
    const seen = new Set<string>();
    for (const row of breakdown) {
      const label = (row.sizeLabel ?? '').toString().trim();
      if (!label) throw new Error('Each breakdown row needs a sizeLabel (number)');
      if (seen.has(label.toLowerCase())) throw new Error(`Duplicate number in breakdown: ${label}`);
      seen.add(label.toLowerCase());
      if (!(row.quantity > 0)) throw new Error(`Quantity for ${label} must be greater than 0`);
    }

    const pool = (await this.getSizesByItemId(itemId, schoolId)).find(s => s.isPool);
    if (!pool) throw new Error('Pool stock row not found for this item');

    const poolStock = pool.currentStock || 0;
    const sumQty = breakdown.reduce((acc, r) => acc + r.quantity, 0);
    if (sumQty !== poolStock) {
      throw new Error(`Breakdown total (${sumQty}) must equal pool stock (${poolStock})`);
    }

    const bands = await this.getBandsByItemId(itemId, schoolId);
    const priceFor = (label: string) => {
      const n = parseInt(label, 10);
      if (isNaN(n)) return undefined;
      return bands.find(b => n >= b.numberFrom && n <= b.numberTo);
    };

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    for (const row of breakdown) {
      const label = row.sizeLabel.toString().trim();
      const band = priceFor(label);
      const mrp = row.mrp ?? band?.mrp ?? null;
      const studentPct = row.studentDiscountPct ?? band?.studentDiscountPct ?? null;
      const bulkPct = row.bulkDiscountPct ?? band?.bulkDiscountPct ?? null;
      queries.push(singleLineString`
        insert into uniform_item_size
        (uuid, item_id, school_id, size_label, mrp, student_discount_pct, bulk_discount_pct, current_stock, is_pool, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10, $11)
      `);
      params.push([generateShortUuid(12), itemId, schoolId, label, mrp, studentPct, bulkPct, row.quantity, DEFAULTS.STATUS, userId, now]);
    }

    // Retire the pool row and flip the item to sized.
    queries.push(`update uniform_item_size set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`);
    params.push([userId, now, pool.uuid, schoolId]);
    queries.push(`update uniform_item set sizing_mode = 'sized', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`);
    params.push([userId, now, itemId, schoolId]);

    await DB.queriesInTransaction(queries, params);
    return this.getItemWithSizes(itemId, schoolId) as Promise<UniformItemWithSizes>;
  }

  // Move units from one size to another within a sized item (assign an Unknown-bucket
  // piece to a real number). Target is an existing size (toSizeId) or a new one created
  // from toSizeLabel (+ optional price). Decrements the source, credits the target.
  public async moveStock(itemId: string, data: MoveStockRequest, schoolId: string, userId: string): Promise<UniformItemWithSizes> {
    const item = await this.getItemById(itemId, schoolId);
    if (!item) throw new Error('Item not found');
    if (item.sizingMode === 'unsized') throw new Error('Move stock applies to sized items only');

    const qty = Number(data.quantity);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be a whole number greater than 0');

    const sizes = await this.getSizesByItemId(itemId, schoolId);
    const from = sizes.find(s => s.uuid === data.fromSizeId);
    if (!from) throw new Error('Source size not found');
    if ((from.currentStock || 0) < qty) throw new Error(`Only ${from.currentStock || 0} in stock to move from ${from.sizeLabel}`);

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Resolve the target: an existing size, or a new one created from the label.
    let targetId: string;
    if (data.toSizeId) {
      const to = sizes.find(s => s.uuid === data.toSizeId);
      if (!to) throw new Error('Target size not found');
      if (to.uuid === from.uuid) throw new Error('Source and target size are the same');
      targetId = to.uuid;
      queries.push(`update uniform_item_size set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
      params.push([qty, userId, now, targetId, schoolId]);
    } else {
      const label = (data.toSizeLabel ?? '').toString().trim();
      if (!label) throw new Error('Target size (number) is required');
      const existing = sizes.find(s => s.sizeLabel.toLowerCase() === label.toLowerCase() && !s.isPool);
      if (existing) {
        if (existing.uuid === from.uuid) throw new Error('Source and target size are the same');
        targetId = existing.uuid;
        queries.push(`update uniform_item_size set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
        params.push([qty, userId, now, targetId, schoolId]);
      } else {
        targetId = generateShortUuid(12);
        queries.push(singleLineString`
          insert into uniform_item_size
          (uuid, item_id, school_id, size_label, mrp, student_discount_pct, bulk_discount_pct, current_stock, is_unknown, note, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, false, null, $9, $10, $11)
        `);
        params.push([targetId, itemId, schoolId, label, data.mrp ?? null, data.studentDiscountPct ?? null, data.bulkDiscountPct ?? null, qty, DEFAULTS.STATUS, userId, now]);
      }
    }

    // Debit the source.
    queries.push(`update uniform_item_size set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
    params.push([qty, userId, now, from.uuid, schoolId]);

    await DB.queriesInTransaction(queries, params);
    return this.getItemWithSizes(itemId, schoolId) as Promise<UniformItemWithSizes>;
  }

  public async getItemWithSizes(itemId: string, schoolId: string): Promise<UniformItemWithSizes | null> {
    const item = await this.getItemById(itemId, schoolId);
    if (!item) return null;
    const [sizes, bands] = await Promise.all([
      this.getSizesByItemId(itemId, schoolId),
      this.getBandsByItemId(itemId, schoolId),
    ]);
    return { ...item, sizes, bands };
  }

  // Bulk opening-stock entry for a sized item: upsert each row's size by label and SET
  // its count (absolute). Price fields set only when provided. One transaction. No
  // purchase logs (opening counts carry no cost), mirroring break-into-numbers.
  public async setOpeningStock(itemId: string, data: SetOpeningStockRequest, schoolId: string, userId: string): Promise<UniformItemWithSizes> {
    const item = await this.getItemById(itemId, schoolId);
    if (!item) throw new Error('Item not found');
    if (item.sizingMode === 'unsized') throw new Error('Unsized items are stocked via their pool / break-into-numbers, not size counts');

    const rows = data.rows || [];
    if (rows.length === 0) throw new Error('rows is required');

    const seen = new Set<string>();
    for (const r of rows) {
      const label = (r.sizeLabel ?? '').toString().trim();
      if (!label) throw new Error('Each row needs a size (number)');
      if (seen.has(label.toLowerCase())) throw new Error(`Duplicate size in rows: ${label}`);
      seen.add(label.toLowerCase());
      const q = Number(r.quantity);
      if (!Number.isInteger(q) || q < 0) throw new Error(`Quantity for ${label} must be a whole number >= 0`);
    }

    const existing = await this.getSizesByItemId(itemId, schoolId);
    const byLabel = new Map(existing.map(s => [s.sizeLabel.toLowerCase(), s]));

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    for (const r of rows) {
      const label = r.sizeLabel.toString().trim();
      const ex = byLabel.get(label.toLowerCase());
      if (ex) {
        const sets = ['current_stock = $1', 'updatedby_userid = $2', 'updated_at = $3'];
        const p: any[] = [r.quantity, userId, now];
        let idx = 4;
        if (r.mrp !== undefined) { sets.push(`mrp = $${idx++}`); p.push(r.mrp); }
        if (r.studentDiscountPct !== undefined) { sets.push(`student_discount_pct = $${idx++}`); p.push(r.studentDiscountPct); }
        if (r.bulkDiscountPct !== undefined) { sets.push(`bulk_discount_pct = $${idx++}`); p.push(r.bulkDiscountPct); }
        p.push(ex.uuid, schoolId);
        queries.push(`update uniform_item_size set ${sets.join(', ')} where uuid = $${idx++} and school_id = $${idx++}`);
        params.push(p);
      } else {
        queries.push(singleLineString`
          insert into uniform_item_size
          (uuid, item_id, school_id, size_label, mrp, student_discount_pct, bulk_discount_pct, current_stock, is_pool, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, false, $9, $10, $11)
        `);
        params.push([generateShortUuid(12), itemId, schoolId, label, r.mrp ?? null, r.studentDiscountPct ?? null, r.bulkDiscountPct ?? null, r.quantity, DEFAULTS.STATUS, userId, now]);
      }
    }

    await DB.queriesInTransaction(queries, params);
    return this.getItemWithSizes(itemId, schoolId) as Promise<UniformItemWithSizes>;
  }

  private parseBandNumericFields(band: any): UniformPriceBand {
    return {
      ...band,
      numberFrom: band.numberFrom != null ? parseInt(band.numberFrom, 10) : null,
      numberTo: band.numberTo != null ? parseInt(band.numberTo, 10) : null,
      mrp: band.mrp != null ? parseFloat(band.mrp) : null,
      studentDiscountPct: band.studentDiscountPct != null ? parseFloat(band.studentDiscountPct) : null,
      bulkDiscountPct: band.bulkDiscountPct != null ? parseFloat(band.bulkDiscountPct) : null,
      sortOrder: band.sortOrder != null ? parseInt(band.sortOrder, 10) : 0,
    };
  }
}

export const uniformItemService = new UniformItemService();
