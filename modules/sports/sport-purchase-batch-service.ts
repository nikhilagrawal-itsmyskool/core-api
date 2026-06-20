import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService } from '../../shared/lib/file-storage';
import { StoredFileWithData } from '../../shared/lib/file-storage';
import { DEFAULTS } from './sport-constants';
import {
  SportPurchaseBatch,
  SportPurchaseLog,
  CreateBulkSportPurchaseRequest,
  UpdateSportPurchaseBatchRequest,
} from './sport-interfaces';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SportPurchaseBatchService {
  public async createBulk(
    data: CreateBulkSportPurchaseRequest,
    schoolId: string,
    userId: string
  ): Promise<SportPurchaseBatch> {
    const batchId = generateShortUuid(12);
    const now = new Date();

    const queries: string[] = [];
    const params: any[][] = [];

    // Insert batch header
    queries.push(singleLineString`
      insert into sport_purchase_batch
      (uuid, purchase_date, supplier, invoice_number, batch_no, notes, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `);
    params.push([
      batchId,
      data.purchaseDate,
      data.supplier || null,
      data.invoiceNumber || null,
      data.batchNo || null,
      data.notes || null,
      DEFAULTS.STATUS,
      schoolId,
      userId,
      now,
    ]);

    // Insert each purchase log item and update stock
    for (const item of data.items) {
      const purchaseId = generateShortUuid(12);
      const effectiveBatchNo = item.batchNo ?? data.batchNo ?? null;

      queries.push(singleLineString`
        insert into sport_purchase_log
        (uuid, item_id, sport_type, purchase_date, quantity, cost_per_unit, supplier, invoice_number, batch_no, remarks, batch_id, status, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `);
      params.push([
        purchaseId,
        item.itemId,
        item.sportType,
        data.purchaseDate,
        item.quantity,
        item.costPerUnit || null,
        data.supplier || null,
        data.invoiceNumber || null,
        effectiveBatchNo,
        item.remarks || null,
        batchId,
        DEFAULTS.STATUS,
        schoolId,
        userId,
        now,
      ]);

      queries.push(singleLineString`
        update sport_item
        set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `);
      params.push([item.quantity, userId, now, item.itemId, schoolId]);
    }

    await DB.queriesInTransaction(queries, params);

    // Upload bill if provided
    if (data.bill) {
      const stored = await fileStorageService.upload({
        fileName: data.bill.fileName,
        mimeType: data.bill.mimeType,
        base64Data: data.bill.base64Data,
        entityType: 'sport_purchase_batch',
        entityId: batchId,
        schoolId,
        userId,
      });
      await DB.query(
        `update sport_purchase_batch set file_id = $1 where uuid = $2 and school_id = $3`,
        [stored.uuid, batchId, schoolId]
      );
    }

    return this.getBatchById(batchId, schoolId) as Promise<SportPurchaseBatch>;
  }

  public async listBatches(params: {
    schoolId: string;
    startDate?: string;
    endDate?: string;
    includeDeleted?: boolean;
    sportType?: string;
    itemId?: string;
  }): Promise<SportPurchaseBatch[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";

    const queryParams: any[] = [params.schoolId];
    let paramIndex = 2;
    let batchDateFilter = '';
    let purchaseDateFilter = '';
    let batchSportFilter = '';
    let batchItemFilter = '';
    let purchaseSportFilter = '';
    let purchaseItemFilter = '';

    if (params.startDate) {
      queryParams.push(params.startDate);
      batchDateFilter += ` and b.purchase_date >= $${paramIndex}`;
      purchaseDateFilter += ` and p.purchase_date >= $${paramIndex}`;
      paramIndex++;
    }
    if (params.endDate) {
      queryParams.push(params.endDate);
      batchDateFilter += ` and b.purchase_date <= $${paramIndex}`;
      purchaseDateFilter += ` and p.purchase_date <= $${paramIndex}`;
      paramIndex++;
    }
    if (params.sportType) {
      queryParams.push(params.sportType);
      batchSportFilter = `and exists (select 1 from sport_purchase_log p2 where p2.batch_id = b.uuid and p2.sport_type = $${paramIndex} and p2.status = b.status and (b.status = 'active' or p2.updated_at::timestamp(0) = b.updated_at::timestamp(0)))`;
      purchaseSportFilter = `and p.sport_type = $${paramIndex}`;
      paramIndex++;
    }
    if (params.itemId) {
      queryParams.push(params.itemId);
      batchItemFilter = `and exists (select 1 from sport_purchase_log p2 where p2.batch_id = b.uuid and p2.item_id = $${paramIndex} and p2.status = b.status and (b.status = 'active' or p2.updated_at::timestamp(0) = b.updated_at::timestamp(0)))`;
      purchaseItemFilter = `and p.item_id = $${paramIndex}`;
      paramIndex++;
    }

    const query = `
      select
        b.uuid, b.purchase_date, b.supplier, b.invoice_number, b.batch_no, b.notes, b.file_id, b.status,
        b.school_id, b.createdby_userid, b.created_at, b.updatedby_userid, b.updated_at,
        'batch' as record_type,
        (select count(*) from sport_purchase_log p where p.batch_id = b.uuid and p.status = b.status and (b.status = 'active' or p.updated_at::timestamp(0) = b.updated_at::timestamp(0)))::int as item_count,
        (select sum(p.quantity * p.cost_per_unit) from sport_purchase_log p where p.batch_id = b.uuid and p.status = b.status and (b.status = 'active' or p.updated_at::timestamp(0) = b.updated_at::timestamp(0))) as total_cost,
        (select sum(p3.quantity) from sport_purchase_log p3 where p3.batch_id = b.uuid and p3.status = b.status and (b.status = 'active' or p3.updated_at::timestamp(0) = b.updated_at::timestamp(0)))::int as quantity,
        (select p3.cost_per_unit from sport_purchase_log p3 where p3.batch_id = b.uuid and p3.status = b.status and (b.status = 'active' or p3.updated_at::timestamp(0) = b.updated_at::timestamp(0)) order by p3.created_at asc limit 1) as cost_per_unit,
        (select i.name from sport_purchase_log p3 join sport_item i on p3.item_id = i.uuid where p3.batch_id = b.uuid and p3.status = b.status and (b.status = 'active' or p3.updated_at::timestamp(0) = b.updated_at::timestamp(0)) order by p3.created_at asc limit 1) as item_name,
        (select p3.sport_type from sport_purchase_log p3 where p3.batch_id = b.uuid and p3.status = b.status and (b.status = 'active' or p3.updated_at::timestamp(0) = b.updated_at::timestamp(0)) order by p3.created_at asc limit 1) as sport_type
      from sport_purchase_batch b
      where b.school_id = $1
        and b.status in ${statusFilter}
        ${batchDateFilter}
        ${batchSportFilter}
        ${batchItemFilter}

      union all

      select
        p.uuid, p.purchase_date, p.supplier, p.invoice_number, p.batch_no,
        null as notes, null as file_id, p.status,
        p.school_id, p.createdby_userid, p.created_at, p.updatedby_userid, p.updated_at,
        'purchase' as record_type,
        1 as item_count,
        p.quantity * p.cost_per_unit as total_cost,
        p.quantity,
        p.cost_per_unit,
        i.name as item_name,
        p.sport_type
      from sport_purchase_log p
      left join sport_item i on p.item_id = i.uuid
      where p.school_id = $1
        and p.batch_id is null
        and p.status in ${statusFilter}
        ${purchaseDateFilter}
        ${purchaseSportFilter}
        ${purchaseItemFilter}

      order by purchase_date desc, created_at desc
    `;

    return DB.query(query, queryParams);
  }

  public async getBatchById(batchId: string, schoolId: string): Promise<SportPurchaseBatch | null> {
    // Try batch header first (active or deleted, so deleted rows can be re-read)
    const batchQuery = singleLineString`
      select * from sport_purchase_batch
      where uuid = $1 and school_id = $2 and status in ('active', 'deleted')
    `;
    const batches = await DB.query(batchQuery, [batchId, schoolId]);

    if (batches.length > 0) {
      const batch = batches[0];
      // For an active batch show active items; for a deleted batch show only the
      // items deleted together with it (same updated_at), excluding edit-removed ones.
      const itemsQuery = singleLineString`
        select p.*, i.name as item_name
        from sport_purchase_log p
        left join sport_item i on p.item_id = i.uuid
        where p.batch_id = $1 and p.school_id = $2 and p.status = $3
          and ($3 = 'active' or p.updated_at::timestamp(0) = $4::timestamp(0))
        order by p.created_at asc
      `;
      const items: SportPurchaseLog[] = await DB.query(itemsQuery, [batchId, schoolId, batch.status, batch.updatedAt]);
      return { ...batch, items, recordType: 'batch' };
    }

    // Fall through to pre-batch individual purchase (active or deleted)
    const purchaseQuery = singleLineString`
      select p.*, i.name as item_name
      from sport_purchase_log p
      left join sport_item i on p.item_id = i.uuid
      where p.uuid = $1 and p.school_id = $2 and p.batch_id is null and p.status in ('active', 'deleted')
    `;
    const purchases = await DB.query(purchaseQuery, [batchId, schoolId]);
    if (purchases.length === 0) {
      return null;
    }
    const purchase = purchases[0];
    return {
      uuid: purchase.uuid,
      purchaseDate: purchase.purchaseDate,
      supplier: purchase.supplier,
      invoiceNumber: purchase.invoiceNumber,
      batchNo: purchase.batchNo,
      status: purchase.status,
      schoolId: purchase.schoolId,
      createdbyUserid: purchase.createdbyUserid,
      createdAt: purchase.createdAt,
      updatedbyUserid: purchase.updatedbyUserid,
      updatedAt: purchase.updatedAt,
      items: [purchase],
      recordType: 'purchase',
    };
  }

  public async update(
    batchId: string,
    data: UpdateSportPurchaseBatchRequest,
    schoolId: string,
    userId: string
  ): Promise<SportPurchaseBatch | null> {
    const existing = await this.getBatchById(batchId, schoolId);
    if (!existing) return null;

    const headerKeys: (keyof UpdateSportPurchaseBatchRequest)[] = [
      'purchaseDate', 'supplier', 'invoiceNumber', 'batchNo', 'notes',
    ];
    const hasHeaderUpdate = headerKeys.some((k) => data[k] !== undefined);
    const hasItems = data.items !== undefined;
    const isLegacy = existing.recordType !== 'batch';

    // Nothing to do — avoid upgrading a legacy purchase on an empty request.
    if (!hasHeaderUpdate && !hasItems) return existing;

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Determine the working batch id; upgrade a legacy single purchase into a batch.
    let workingBatchId = batchId;

    if (isLegacy) {
      workingBatchId = generateShortUuid(12);
      // Create the batch header, preferring update values over the legacy purchase's values.
      queries.push(singleLineString`
        insert into sport_purchase_batch
        (uuid, purchase_date, supplier, invoice_number, batch_no, notes, status, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `);
      params.push([
        workingBatchId,
        data.purchaseDate ?? existing.purchaseDate,
        data.supplier ?? existing.supplier ?? null,
        data.invoiceNumber ?? existing.invoiceNumber ?? null,
        data.batchNo ?? existing.batchNo ?? null,
        data.notes ?? null,
        DEFAULTS.STATUS,
        schoolId,
        userId,
        now,
      ]);

      // Attach the legacy purchase log row to the new batch.
      queries.push(singleLineString`
        update sport_purchase_log
        set batch_id = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and status = 'active'
      `);
      params.push([workingBatchId, userId, now, batchId, schoolId]);
    } else if (hasHeaderUpdate) {
      // Existing batch: apply header field updates.
      const updates: string[] = [];
      const headerParams: any[] = [];
      let p = 1;
      if (data.purchaseDate !== undefined) { updates.push(`purchase_date = $${p++}`); headerParams.push(data.purchaseDate); }
      if (data.supplier !== undefined) { updates.push(`supplier = $${p++}`); headerParams.push(data.supplier); }
      if (data.invoiceNumber !== undefined) { updates.push(`invoice_number = $${p++}`); headerParams.push(data.invoiceNumber); }
      if (data.batchNo !== undefined) { updates.push(`batch_no = $${p++}`); headerParams.push(data.batchNo); }
      if (data.notes !== undefined) { updates.push(`notes = $${p++}`); headerParams.push(data.notes); }

      updates.push(`updatedby_userid = $${p++}`);
      headerParams.push(userId);
      updates.push(`updated_at = $${p++}`);
      headerParams.push(now);
      headerParams.push(workingBatchId);
      headerParams.push(schoolId);

      queries.push(singleLineString`
        update sport_purchase_batch
        set ${updates.join(', ')}
        where uuid = $${p++} and school_id = $${p++} and status = 'active'
      `);
      params.push(headerParams);
    }

    // Item-level edits (declarative: payload is the desired final list of items).
    if (hasItems) {
      const existingItems = existing.items || [];
      const incoming = data.items || [];
      const incomingUuids = new Set(incoming.filter((i) => i.uuid).map((i) => i.uuid));

      // 1. Soft-delete existing items absent from the incoming list + reverse stock.
      for (const prev of existingItems) {
        if (!incomingUuids.has(prev.uuid)) {
          queries.push(singleLineString`
            update sport_purchase_log
            set status = 'deleted', updatedby_userid = $1, updated_at = $2
            where uuid = $3 and school_id = $4 and status = 'active'
          `);
          params.push([userId, now, prev.uuid, schoolId]);

          queries.push(singleLineString`
            update sport_item
            set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
            where uuid = $4 and school_id = $5
          `);
          params.push([prev.quantity, userId, now, prev.itemId, schoolId]);
        }
      }

      // 2. Update existing items / 3. insert new items.
      for (const item of incoming) {
        if (item.uuid) {
          const prev = existingItems.find((e) => e.uuid === item.uuid);
          if (!prev) continue; // unknown uuid — ignore defensively

          queries.push(singleLineString`
            update sport_purchase_log
            set item_id = $1, sport_type = $2, quantity = $3, cost_per_unit = $4, batch_no = $5,
                remarks = $6, updatedby_userid = $7, updated_at = $8
            where uuid = $9 and school_id = $10 and status = 'active'
          `);
          params.push([
            item.itemId,
            item.sportType,
            item.quantity,
            item.costPerUnit ?? null,
            item.batchNo ?? null,
            item.remarks ?? null,
            userId,
            now,
            item.uuid,
            schoolId,
          ]);

          // Stock adjustment.
          if (item.itemId === prev.itemId) {
            const diff = item.quantity - prev.quantity;
            if (diff !== 0) {
              queries.push(singleLineString`
                update sport_item
                set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
                where uuid = $4 and school_id = $5
              `);
              params.push([diff, userId, now, item.itemId, schoolId]);
            }
          } else {
            // Item reassigned: remove old item's qty, add new item's qty.
            queries.push(singleLineString`
              update sport_item
              set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
              where uuid = $4 and school_id = $5
            `);
            params.push([prev.quantity, userId, now, prev.itemId, schoolId]);
            queries.push(singleLineString`
              update sport_item
              set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
              where uuid = $4 and school_id = $5
            `);
            params.push([item.quantity, userId, now, item.itemId, schoolId]);
          }
        } else {
          // New item added to the batch.
          const purchaseId = generateShortUuid(12);
          queries.push(singleLineString`
            insert into sport_purchase_log
            (uuid, item_id, sport_type, purchase_date, quantity, cost_per_unit, supplier, invoice_number, batch_no, remarks, batch_id, status, school_id, createdby_userid, created_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          `);
          params.push([
            purchaseId,
            item.itemId,
            item.sportType,
            data.purchaseDate ?? existing.purchaseDate,
            item.quantity,
            item.costPerUnit ?? null,
            data.supplier ?? existing.supplier ?? null,
            data.invoiceNumber ?? existing.invoiceNumber ?? null,
            item.batchNo ?? data.batchNo ?? existing.batchNo ?? null,
            item.remarks ?? null,
            workingBatchId,
            DEFAULTS.STATUS,
            schoolId,
            userId,
            now,
          ]);

          queries.push(singleLineString`
            update sport_item
            set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
            where uuid = $4 and school_id = $5
          `);
          params.push([item.quantity, userId, now, item.itemId, schoolId]);
        }
      }
    }

    if (queries.length === 0) return existing;

    await DB.queriesInTransaction(queries, params);
    return this.getBatchById(workingBatchId, schoolId);
  }

  public async deleteBatch(batchId: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getBatchById(batchId, schoolId);
    if (!existing) return false;

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    const items = existing.items || [];
    for (const item of items) {
      queries.push(singleLineString`
        update sport_purchase_log
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `);
      params.push([userId, now, item.uuid, schoolId]);

      queries.push(singleLineString`
        update sport_item
        set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `);
      params.push([item.quantity, userId, now, item.itemId, schoolId]);
    }

    if (existing.recordType !== 'purchase') {
      queries.push(singleLineString`
        update sport_purchase_batch
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `);
      params.push([userId, now, batchId, schoolId]);
    }

    await DB.queriesInTransaction(queries, params);
    return true;
  }

  public async restoreBatch(batchId: string, schoolId: string, userId: string): Promise<SportPurchaseBatch | null> {
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Batch case: restore the header and exactly the items deleted alongside it.
    const batchRows = await DB.query(
      singleLineString`
        select uuid, updated_at from sport_purchase_batch
        where uuid = $1 and school_id = $2 and status = 'deleted'
      `,
      [batchId, schoolId]
    );

    if (batchRows.length > 0) {
      const deletedAt = batchRows[0].updatedAt;
      const items = await DB.query(
        singleLineString`
          select uuid, item_id, quantity from sport_purchase_log
          where batch_id = $1 and school_id = $2 and status = 'deleted'
            and updated_at::timestamp(0) = $3::timestamp(0)
        `,
        [batchId, schoolId, deletedAt]
      );

      for (const item of items) {
        queries.push(singleLineString`
          update sport_purchase_log
          set status = 'active', updatedby_userid = $1, updated_at = $2
          where uuid = $3 and school_id = $4 and status = 'deleted'
        `);
        params.push([userId, now, item.uuid, schoolId]);

        queries.push(singleLineString`
          update sport_item
          set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
          where uuid = $4 and school_id = $5
        `);
        params.push([item.quantity, userId, now, item.itemId, schoolId]);
      }

      queries.push(singleLineString`
        update sport_purchase_batch
        set status = 'active', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'deleted'
      `);
      params.push([userId, now, batchId, schoolId]);

      await DB.queriesInTransaction(queries, params);
      return this.getBatchById(batchId, schoolId);
    }

    // Legacy case: a deleted pre-batch single purchase.
    const purchaseRows = await DB.query(
      singleLineString`
        select uuid, item_id, quantity from sport_purchase_log
        where uuid = $1 and school_id = $2 and batch_id is null and status = 'deleted'
      `,
      [batchId, schoolId]
    );

    if (purchaseRows.length > 0) {
      const purchase = purchaseRows[0];
      queries.push(singleLineString`
        update sport_purchase_log
        set status = 'active', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'deleted'
      `);
      params.push([userId, now, batchId, schoolId]);

      queries.push(singleLineString`
        update sport_item
        set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `);
      params.push([purchase.quantity, userId, now, purchase.itemId, schoolId]);

      await DB.queriesInTransaction(queries, params);
      return this.getBatchById(batchId, schoolId);
    }

    return null;
  }

  public async uploadBill(
    batchId: string,
    bill: { fileName: string; mimeType: string; base64Data: string },
    schoolId: string,
    userId: string
  ): Promise<SportPurchaseBatch | null> {
    const batch = await this.getBatchById(batchId, schoolId);
    if (!batch || batch.recordType !== 'batch') return null;

    // Delete existing bill if present
    if (batch.fileId) {
      await fileStorageService.delete(batch.fileId, schoolId);
    }

    const stored = await fileStorageService.upload({
      fileName: bill.fileName,
      mimeType: bill.mimeType,
      base64Data: bill.base64Data,
      entityType: 'sport_purchase_batch',
      entityId: batchId,
      schoolId,
      userId,
    });

    await DB.query(
      `update sport_purchase_batch set file_id = $1 where uuid = $2 and school_id = $3`,
      [stored.uuid, batchId, schoolId]
    );

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
    await DB.query(
      `update sport_purchase_batch set file_id = null where uuid = $1 and school_id = $2`,
      [batchId, schoolId]
    );
  }
}

export const sportPurchaseBatchService = new SportPurchaseBatchService();
