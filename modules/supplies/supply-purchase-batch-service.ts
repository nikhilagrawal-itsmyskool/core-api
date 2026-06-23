import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService, StoredFileWithData } from '../../shared/lib/file-storage';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { DEFAULTS } from './supply-constants';
import { normalizeName } from './supply-util';
import { supplyItemService } from './supply-item-service';
import {
  SupplyPurchaseBatch, SupplyPurchaseLog,
  CreateBulkPurchaseRequest, UpdatePurchaseBatchRequest,
  NeedsConfirmationResult,
} from './supply-interfaces';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SupplyPurchaseBatchService {
  // Resolve every purchase line to a concrete item_id, creating new items inline
  // (with the hygiene guard) where needed. Returns either the resolved plan or a
  // needs-confirmation result if any new-item line has unconfirmed near-matches.
  // No writes happen until the whole batch is resolved cleanly.
  private async resolveLines(
    data: CreateBulkPurchaseRequest,
    schoolId: string
  ): Promise<
    | { resolvedItemIds: string[]; newItemInserts: { uuid: string; categoryId: string; name: string; unit: string; itemType: string; reorderLevel: number }[] }
    | NeedsConfirmationResult
  > {
    const lines = data.items;

    // Validate referenced existing item ids in one query.
    const existingIds = lines.filter((l) => l.itemId).map((l) => l.itemId as string);
    const validIds = new Set<string>();
    if (existingIds.length > 0) {
      const rows = await DB.query(
        singleLineString`select uuid from supply_item where school_id = $1 and status = 'active' and uuid = any($2)`,
        [schoolId, existingIds]
      );
      for (const r of rows) validIds.add(r.uuid);
    }

    const catItemsCache = new Map<string, any[]>();
    const loadCatItems = async (categoryId: string): Promise<any[]> => {
      if (!catItemsCache.has(categoryId)) {
        const items = await DB.query(
          singleLineString`select uuid, name, unit, current_stock from supply_item where school_id = $1 and category_id = $2 and status = 'active'`,
          [schoolId, categoryId]
        );
        catItemsCache.set(categoryId, items);
      }
      return catItemsCache.get(categoryId)!;
    };

    const resolvedItemIds: string[] = new Array(lines.length);
    const newItemInserts: { uuid: string; categoryId: string; name: string; unit: string; itemType: string; reorderLevel: number }[] = [];
    const conflicts: NeedsConfirmationResult['conflicts'] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.itemId) {
        if (!validIds.has(line.itemId)) {
          throw new BusinessErrorResult(ErrorCode.InvalidId, `items[${i}].itemId not found`);
        }
        resolvedItemIds[i] = line.itemId;
        continue;
      }

      const ni = line.newItem!;
      if (!(await supplyItemService.categoryExists(ni.categoryId, schoolId))) {
        throw new BusinessErrorResult(ErrorCode.InvalidId, `items[${i}].newItem.categoryId not found`);
      }
      const catItems = await loadCatItems(ni.categoryId);
      const { exact, candidates } = supplyItemService.guardName(ni.name, catItems);

      if (exact) {
        resolvedItemIds[i] = exact.uuid; // reuse existing/just-created item
        continue;
      }
      if (candidates.length > 0 && !line.confirmNewItem) {
        conflicts.push({ lineIndex: i, proposedName: ni.name, candidates });
        continue;
      }

      // Create new item; register it in the cache so later lines reuse it.
      const uuid = generateShortUuid(12);
      newItemInserts.push({
        uuid, categoryId: ni.categoryId, name: ni.name.trim(), unit: ni.unit,
        itemType: ni.itemType || DEFAULTS.ITEM_TYPE, reorderLevel: ni.reorderLevel ?? DEFAULTS.REORDER_LEVEL,
      });
      catItems.push({ uuid, name: ni.name.trim(), unit: ni.unit, currentStock: 0 });
      resolvedItemIds[i] = uuid;
    }

    if (conflicts.length > 0) {
      return { needsConfirmation: true, conflicts };
    }
    return { resolvedItemIds, newItemInserts };
  }

  public async createBulk(
    data: CreateBulkPurchaseRequest,
    schoolId: string,
    userId: string
  ): Promise<SupplyPurchaseBatch | NeedsConfirmationResult> {
    const resolution = await this.resolveLines(data, schoolId);
    if ('needsConfirmation' in resolution) {
      return resolution;
    }
    const { resolvedItemIds, newItemInserts } = resolution;

    const batchId = generateShortUuid(12);
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // 1. Create any new inline items (stock starts at 0; purchase below adds it).
    for (const ni of newItemInserts) {
      queries.push(singleLineString`
        insert into supply_item
        (uuid, school_id, category_id, name, item_type, unit, current_stock, reorder_level, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `);
      params.push([ni.uuid, schoolId, ni.categoryId, ni.name, ni.itemType, ni.unit, 0, ni.reorderLevel, DEFAULTS.STATUS, userId, now]);
    }

    // 2. Batch header.
    queries.push(singleLineString`
      insert into supply_purchase_batch
      (uuid, school_id, purchase_date, supplier, invoice_number, batch_no, notes, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `);
    params.push([batchId, schoolId, data.purchaseDate, data.supplier || null, data.invoiceNumber || null, data.batchNo || null, data.notes || null, DEFAULTS.STATUS, userId, now]);

    // 3. Line items + stock increments.
    for (let i = 0; i < data.items.length; i++) {
      const line = data.items[i];
      const itemId = resolvedItemIds[i];
      const purchaseId = generateShortUuid(12);
      const effectiveBatchNo = line.batchNo ?? data.batchNo ?? null;

      queries.push(singleLineString`
        insert into supply_purchase_log
        (uuid, school_id, batch_id, item_id, purchase_date, quantity, cost_per_unit, supplier, invoice_number, batch_no, remarks, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `);
      params.push([purchaseId, schoolId, batchId, itemId, data.purchaseDate, line.quantity, line.costPerUnit || null, data.supplier || null, data.invoiceNumber || null, effectiveBatchNo, line.remarks || null, DEFAULTS.STATUS, userId, now]);

      queries.push(singleLineString`
        update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `);
      params.push([line.quantity, userId, now, itemId, schoolId]);
    }

    await DB.queriesInTransaction(queries, params);

    if (data.bill) {
      const stored = await fileStorageService.upload({
        fileName: data.bill.fileName, mimeType: data.bill.mimeType, base64Data: data.bill.base64Data,
        entityType: 'supply_purchase_batch', entityId: batchId, schoolId, userId,
      });
      await DB.query(`update supply_purchase_batch set file_id = $1 where uuid = $2 and school_id = $3`, [stored.uuid, batchId, schoolId]);
    }

    return (await this.getBatchById(batchId, schoolId))!;
  }

  public async listBatches(params: {
    schoolId: string; startDate?: string; endDate?: string; includeDeleted?: boolean; itemId?: string;
  }): Promise<SupplyPurchaseBatch[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";
    const queryParams: any[] = [params.schoolId];
    let idx = 2;
    let dateFilter = '';
    let itemFilter = '';

    if (params.startDate) { queryParams.push(params.startDate); dateFilter += ` and b.purchase_date >= $${idx++}`; }
    if (params.endDate) { queryParams.push(params.endDate); dateFilter += ` and b.purchase_date <= $${idx++}`; }
    if (params.itemId) {
      queryParams.push(params.itemId);
      itemFilter = `and exists (select 1 from supply_purchase_log p2 where p2.batch_id = b.uuid and p2.item_id = $${idx} and p2.status = b.status and (b.status = 'active' or p2.updated_at::timestamp(0) = b.updated_at::timestamp(0)))`;
      idx++;
    }

    const query = `
      select b.*,
        (select count(*) from supply_purchase_log p where p.batch_id = b.uuid and p.status = b.status and (b.status = 'active' or p.updated_at::timestamp(0) = b.updated_at::timestamp(0)))::int as item_count,
        (select sum(p.quantity * p.cost_per_unit) from supply_purchase_log p where p.batch_id = b.uuid and p.status = b.status and (b.status = 'active' or p.updated_at::timestamp(0) = b.updated_at::timestamp(0))) as total_cost
      from supply_purchase_batch b
      where b.school_id = $1 and b.status in ${statusFilter}
        ${dateFilter}
        ${itemFilter}
      order by b.purchase_date desc, b.created_at desc
    `;
    return DB.query(query, queryParams);
  }

  public async getBatchById(batchId: string, schoolId: string): Promise<SupplyPurchaseBatch | null> {
    const batches = await DB.query(
      singleLineString`select * from supply_purchase_batch where uuid = $1 and school_id = $2 and status in ('active', 'deleted')`,
      [batchId, schoolId]
    );
    if (batches.length === 0) return null;
    const batch = batches[0];

    const items: SupplyPurchaseLog[] = await DB.query(
      singleLineString`
        select p.*, i.name as item_name
        from supply_purchase_log p
        left join supply_item i on p.item_id = i.uuid
        where p.batch_id = $1 and p.school_id = $2 and p.status = $3
          and ($3 = 'active' or p.updated_at::timestamp(0) = $4::timestamp(0))
        order by p.created_at asc
      `,
      [batchId, schoolId, batch.status, batch.updatedAt]
    );
    return { ...batch, items };
  }

  public async update(
    batchId: string,
    data: UpdatePurchaseBatchRequest,
    schoolId: string,
    userId: string
  ): Promise<SupplyPurchaseBatch | null> {
    const existing = await this.getBatchById(batchId, schoolId);
    if (!existing || existing.status !== 'active') return null;

    const hasHeader = ['purchaseDate', 'supplier', 'invoiceNumber', 'batchNo', 'notes'].some((k) => (data as any)[k] !== undefined);
    const hasItems = data.items !== undefined;
    if (!hasHeader && !hasItems) return existing;

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    if (hasHeader) {
      const updates: string[] = [];
      const hp: any[] = [];
      let p = 1;
      if (data.purchaseDate !== undefined) { updates.push(`purchase_date = $${p++}`); hp.push(data.purchaseDate); }
      if (data.supplier !== undefined) { updates.push(`supplier = $${p++}`); hp.push(data.supplier); }
      if (data.invoiceNumber !== undefined) { updates.push(`invoice_number = $${p++}`); hp.push(data.invoiceNumber); }
      if (data.batchNo !== undefined) { updates.push(`batch_no = $${p++}`); hp.push(data.batchNo); }
      if (data.notes !== undefined) { updates.push(`notes = $${p++}`); hp.push(data.notes); }
      updates.push(`updatedby_userid = $${p++}`); hp.push(userId);
      updates.push(`updated_at = $${p++}`); hp.push(now);
      hp.push(batchId); hp.push(schoolId);
      queries.push(singleLineString`update supply_purchase_batch set ${updates.join(', ')} where uuid = $${p++} and school_id = $${p++} and status = 'active'`);
      params.push(hp);
    }

    if (hasItems) {
      const existingItems = existing.items || [];
      const incoming = data.items || [];
      const incomingUuids = new Set(incoming.filter((l) => l.uuid).map((l) => l.uuid));

      // Removed lines: soft-delete + reverse stock.
      for (const prev of existingItems) {
        if (!incomingUuids.has(prev.uuid)) {
          queries.push(singleLineString`update supply_purchase_log set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`);
          params.push([userId, now, prev.uuid, schoolId]);
          queries.push(singleLineString`update supply_item set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
          params.push([prev.quantity, userId, now, prev.itemId, schoolId]);
        }
      }

      for (const line of incoming) {
        if (line.uuid) {
          const prev = existingItems.find((e) => e.uuid === line.uuid);
          if (!prev) continue;
          queries.push(singleLineString`update supply_purchase_log set item_id = $1, quantity = $2, cost_per_unit = $3, batch_no = $4, remarks = $5, updatedby_userid = $6, updated_at = $7 where uuid = $8 and school_id = $9 and status = 'active'`);
          params.push([line.itemId, line.quantity, line.costPerUnit ?? null, line.batchNo ?? null, line.remarks ?? null, userId, now, line.uuid, schoolId]);

          if (line.itemId === prev.itemId) {
            const diff = line.quantity - prev.quantity;
            if (diff !== 0) {
              queries.push(singleLineString`update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
              params.push([diff, userId, now, line.itemId, schoolId]);
            }
          } else {
            queries.push(singleLineString`update supply_item set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
            params.push([prev.quantity, userId, now, prev.itemId, schoolId]);
            queries.push(singleLineString`update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
            params.push([line.quantity, userId, now, line.itemId, schoolId]);
          }
        } else {
          const purchaseId = generateShortUuid(12);
          queries.push(singleLineString`
            insert into supply_purchase_log
            (uuid, school_id, batch_id, item_id, purchase_date, quantity, cost_per_unit, supplier, invoice_number, batch_no, remarks, status, createdby_userid, created_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `);
          params.push([purchaseId, schoolId, batchId, line.itemId, data.purchaseDate ?? existing.purchaseDate, line.quantity, line.costPerUnit ?? null, data.supplier ?? existing.supplier ?? null, data.invoiceNumber ?? existing.invoiceNumber ?? null, line.batchNo ?? data.batchNo ?? existing.batchNo ?? null, line.remarks ?? null, DEFAULTS.STATUS, userId, now]);
          queries.push(singleLineString`update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
          params.push([line.quantity, userId, now, line.itemId, schoolId]);
        }
      }
    }

    if (queries.length === 0) return existing;
    await DB.queriesInTransaction(queries, params);
    return this.getBatchById(batchId, schoolId);
  }

  public async deleteBatch(batchId: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getBatchById(batchId, schoolId);
    if (!existing || existing.status !== 'active') return false;

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    for (const item of existing.items || []) {
      queries.push(singleLineString`update supply_purchase_log set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`);
      params.push([userId, now, item.uuid, schoolId]);
      queries.push(singleLineString`update supply_item set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
      params.push([item.quantity, userId, now, item.itemId, schoolId]);
    }
    queries.push(singleLineString`update supply_purchase_batch set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`);
    params.push([userId, now, batchId, schoolId]);

    await DB.queriesInTransaction(queries, params);
    return true;
  }

  public async restoreBatch(batchId: string, schoolId: string, userId: string): Promise<SupplyPurchaseBatch | null> {
    const batchRows = await DB.query(
      singleLineString`select uuid, updated_at from supply_purchase_batch where uuid = $1 and school_id = $2 and status = 'deleted'`,
      [batchId, schoolId]
    );
    if (batchRows.length === 0) return null;
    const deletedAt = batchRows[0].updatedAt;

    const items = await DB.query(
      singleLineString`select uuid, item_id, quantity from supply_purchase_log where batch_id = $1 and school_id = $2 and status = 'deleted' and updated_at::timestamp(0) = $3::timestamp(0)`,
      [batchId, schoolId, deletedAt]
    );

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    for (const item of items) {
      queries.push(singleLineString`update supply_purchase_log set status = 'active', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'deleted'`);
      params.push([userId, now, item.uuid, schoolId]);
      queries.push(singleLineString`update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`);
      params.push([item.quantity, userId, now, item.itemId, schoolId]);
    }
    queries.push(singleLineString`update supply_purchase_batch set status = 'active', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'deleted'`);
    params.push([userId, now, batchId, schoolId]);

    await DB.queriesInTransaction(queries, params);
    return this.getBatchById(batchId, schoolId);
  }

  public async uploadBill(batchId: string, bill: { fileName: string; mimeType: string; base64Data: string }, schoolId: string, userId: string): Promise<SupplyPurchaseBatch | null> {
    const batch = await this.getBatchById(batchId, schoolId);
    if (!batch || batch.status !== 'active') return null;
    if (batch.fileId) await fileStorageService.delete(batch.fileId, schoolId);
    const stored = await fileStorageService.upload({
      fileName: bill.fileName, mimeType: bill.mimeType, base64Data: bill.base64Data,
      entityType: 'supply_purchase_batch', entityId: batchId, schoolId, userId,
    });
    await DB.query(`update supply_purchase_batch set file_id = $1 where uuid = $2 and school_id = $3`, [stored.uuid, batchId, schoolId]);
    return this.getBatchById(batchId, schoolId);
  }

  public async getBill(batchId: string, schoolId: string): Promise<StoredFileWithData | null> {
    const batch = await this.getBatchById(batchId, schoolId);
    if (!batch?.fileId) return null;
    return fileStorageService.getWithData(batch.fileId, schoolId);
  }

  public async deleteBill(batchId: string, schoolId: string, userId: string): Promise<void> {
    const batch = await this.getBatchById(batchId, schoolId);
    if (!batch?.fileId) return;
    await fileStorageService.delete(batch.fileId, schoolId);
    await DB.query(`update supply_purchase_batch set file_id = null where uuid = $1 and school_id = $2`, [batchId, schoolId]);
  }
}

export const supplyPurchaseBatchService = new SupplyPurchaseBatchService();
