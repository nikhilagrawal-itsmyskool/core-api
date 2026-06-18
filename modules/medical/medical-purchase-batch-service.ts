import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService } from '../../shared/lib/file-storage';
import { BadRequestResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  MedicalPurchaseBatch,
  CreateBulkPurchaseRequest,
  UpdatePurchaseBatchRequest,
  UploadBillRequest,
  ExpiringPurchase,
} from './medical-interfaces';
import { DEFAULTS } from './medical-constants';
import { getDefaultStartDate, getDefaultEndDate } from '../../shared/util/datetime';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class MedicalPurchaseBatchService {
  public async createBulk(
    data: CreateBulkPurchaseRequest,
    schoolId: string,
    userId: string
  ): Promise<MedicalPurchaseBatch> {
    if (!data.items || data.items.length === 0) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'At least one item is required');
    }

    for (const item of data.items) {
      if (!item.itemId) {
        throw new BadRequestResult(ErrorCode.InvalidInput, 'Each item must have an itemId');
      }
      if (!item.quantity || item.quantity <= 0) {
        throw new BadRequestResult(ErrorCode.InvalidInput, 'Each item quantity must be greater than 0');
      }
    }

    // Validate all itemIds exist (single IN query, no N+1)
    const itemIds = data.items.map((i) => i.itemId);
    const placeholders = itemIds.map((_, idx) => `$${idx + 2}`).join(', ');
    const existingItems = await DB.query(
      `select uuid from medical_item where school_id = $1 and uuid in (${placeholders}) and status = 'active'`,
      [schoolId, ...itemIds]
    );
    const foundIds = new Set(existingItems.map((r: any) => r.uuid));
    const missingId = itemIds.find((id) => !foundIds.has(id));
    if (missingId) {
      throw new BadRequestResult(ErrorCode.InvalidId, `Item not found: ${missingId}`);
    }

    const batchUuid = generateShortUuid(12);
    const now = new Date();

    // Handle optional inline bill upload
    let fileId: string | null = null;
    if (data.bill) {
      const uploaded = await fileStorageService.upload({
        fileName: data.bill.fileName,
        mimeType: data.bill.mimeType,
        base64Data: data.bill.base64Data,
        entityType: 'medical_purchase_batch',
        entityId: batchUuid,
        schoolId,
        userId,
      });
      fileId = uploaded.uuid;
    }

    const insertBatchQuery = singleLineString`
      insert into medical_purchase_batch
      (uuid, purchase_date, supplier, invoice_number, batch_no, notes, file_id, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `;
    const insertBatchParams = [
      batchUuid,
      data.purchaseDate,
      data.supplier || null,
      data.invoiceNumber || null,
      data.batchNo || null,
      data.notes || null,
      fileId,
      DEFAULTS.STATUS,
      schoolId,
      userId,
      now,
    ];

    const queries: string[] = [insertBatchQuery];
    const params: any[][] = [insertBatchParams];

    for (const item of data.items) {
      const purchaseUuid = generateShortUuid(12);
      const effectiveBatchNo = item.batchNo || data.batchNo || null;

      const insertPurchaseQuery = singleLineString`
        insert into medical_purchase_log
        (uuid, item_id, purchase_date, batch_no, expiry_date, quantity, supplier, invoice_number, cost_per_unit, batch_id, status, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `;
      const insertPurchaseParams = [
        purchaseUuid,
        item.itemId,
        data.purchaseDate,
        effectiveBatchNo,
        item.expiryDate || null,
        item.quantity,
        data.supplier || null,
        data.invoiceNumber || null,
        item.costPerUnit || null,
        batchUuid,
        DEFAULTS.STATUS,
        schoolId,
        userId,
        now,
      ];

      const updateStockQuery = singleLineString`
        update medical_item
        set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `;
      const updateStockParams = [item.quantity, userId, now, item.itemId, schoolId];

      queries.push(insertPurchaseQuery, updateStockQuery);
      params.push(insertPurchaseParams, updateStockParams);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getBatchById(batchUuid, schoolId) as Promise<MedicalPurchaseBatch>;
  }

  public async getBatchById(batchId: string, schoolId: string): Promise<MedicalPurchaseBatch | null> {
    const batchQuery = singleLineString`
      select * from medical_purchase_batch
      where uuid = $1 and school_id = $2 and status in ('active', 'deleted')
    `;
    const batches = await DB.query(batchQuery, [batchId, schoolId]);

    if (batches.length > 0) {
      const batch = batches[0];
      // Active batch → active items; deleted batch → only the items deleted with it
      // (same updated_at), excluding items removed during an earlier edit.
      const itemsQuery = singleLineString`
        select p.*, i.name as item_name
        from medical_purchase_log p
        left join medical_item i on p.item_id = i.uuid
        where p.batch_id = $1 and p.school_id = $2 and p.status = $3
          and ($3 = 'active' or p.updated_at::timestamp(0) = $4::timestamp(0))
        order by p.created_at asc
      `;
      const items = await DB.query(itemsQuery, [batchId, schoolId, batch.status, batch.updatedAt]);
      batch.items = items;
      batch.recordType = 'batch';
      return batch;
    }

    // Fallback: pre-batch individual purchase (batch_id IS NULL), active or deleted
    const purchaseQuery = singleLineString`
      select p.*, i.name as item_name
      from medical_purchase_log p
      left join medical_item i on p.item_id = i.uuid
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

  public async listBatches(params: {
    schoolId: string;
    startDate?: string;
    endDate?: string;
    includeDeleted?: boolean;
    itemId?: string;
  }): Promise<MedicalPurchaseBatch[]> {
    const startDate = params.startDate || getDefaultStartDate();
    const endDate = params.endDate || getDefaultEndDate();
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";

    const queryParams: any[] = [params.schoolId, startDate, endDate];
    let itemFilter = '';
    if (params.itemId) {
      queryParams.push(params.itemId);
      const p = queryParams.length;
      itemFilter = `$${p}`;
    }

    const batchItemFilter = itemFilter
      ? `and exists (select 1 from medical_purchase_log p2 where p2.batch_id = b.uuid and p2.item_id = ${itemFilter} and p2.status = b.status and (b.status = 'active' or p2.updated_at::timestamp(0) = b.updated_at::timestamp(0)))`
      : '';
    const purchaseItemFilter = itemFilter ? `and p.item_id = ${itemFilter}` : '';

    const query = `
      select
        b.uuid, b.purchase_date, b.supplier, b.invoice_number, b.batch_no, b.notes, b.file_id, b.status,
        b.school_id, b.createdby_userid, b.created_at, b.updatedby_userid, b.updated_at,
        'batch' as record_type,
        (select count(*) from medical_purchase_log p where p.batch_id = b.uuid and p.status = b.status and (b.status = 'active' or p.updated_at::timestamp(0) = b.updated_at::timestamp(0)))::int as item_count,
        (select i.name from medical_purchase_log p
         join medical_item i on p.item_id = i.uuid
         where p.batch_id = b.uuid and p.status = b.status and (b.status = 'active' or p.updated_at::timestamp(0) = b.updated_at::timestamp(0))
         limit 1) as item_name,
        (select sum(p.quantity * p.cost_per_unit) from medical_purchase_log p where p.batch_id = b.uuid and p.status = b.status and (b.status = 'active' or p.updated_at::timestamp(0) = b.updated_at::timestamp(0))) as total_cost,
        (select sum(p2.quantity) from medical_purchase_log p2 where p2.batch_id = b.uuid and p2.status = b.status and (b.status = 'active' or p2.updated_at::timestamp(0) = b.updated_at::timestamp(0)))::int as quantity,
        (select p2.cost_per_unit from medical_purchase_log p2 where p2.batch_id = b.uuid and p2.status = b.status and (b.status = 'active' or p2.updated_at::timestamp(0) = b.updated_at::timestamp(0)) limit 1) as cost_per_unit,
        (select p2.expiry_date from medical_purchase_log p2 where p2.batch_id = b.uuid and p2.status = b.status and (b.status = 'active' or p2.updated_at::timestamp(0) = b.updated_at::timestamp(0)) limit 1) as expiry_date
      from medical_purchase_batch b
      where b.school_id = $1
        and b.status in ${statusFilter}
        and b.purchase_date >= $2
        and b.purchase_date <= $3
        ${batchItemFilter}

      union all

      select
        p.uuid, p.purchase_date, p.supplier, p.invoice_number, p.batch_no,
        null as notes, null as file_id, p.status,
        p.school_id, p.createdby_userid, p.created_at, p.updatedby_userid, p.updated_at,
        'purchase' as record_type,
        1 as item_count,
        i.name as item_name,
        p.quantity * p.cost_per_unit as total_cost,
        p.quantity,
        p.cost_per_unit,
        p.expiry_date
      from medical_purchase_log p
      left join medical_item i on p.item_id = i.uuid
      where p.school_id = $1
        and p.batch_id is null
        and p.status in ${statusFilter}
        and p.purchase_date >= $2
        and p.purchase_date <= $3
        ${purchaseItemFilter}

      order by purchase_date desc, created_at desc
    `;
    return DB.query(query, queryParams);
  }

  public async update(
    batchId: string,
    data: UpdatePurchaseBatchRequest,
    schoolId: string,
    userId: string
  ): Promise<MedicalPurchaseBatch | null> {
    const existing = await this.getBatchById(batchId, schoolId);
    if (!existing) {
      return null;
    }

    const headerKeys: (keyof UpdatePurchaseBatchRequest)[] = [
      'purchaseDate', 'supplier', 'invoiceNumber', 'batchNo', 'notes',
    ];
    const hasHeaderUpdate = headerKeys.some((k) => data[k] !== undefined);
    const hasItems = data.items !== undefined;
    const isLegacy = existing.recordType !== 'batch';

    if (!hasHeaderUpdate && !hasItems) return existing;

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Determine the working batch id; upgrade a legacy single purchase into a batch.
    let workingBatchId = batchId;

    if (isLegacy) {
      workingBatchId = generateShortUuid(12);
      queries.push(singleLineString`
        insert into medical_purchase_batch
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

      queries.push(singleLineString`
        update medical_purchase_log
        set batch_id = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and status = 'active'
      `);
      params.push([workingBatchId, userId, now, batchId, schoolId]);
    } else if (hasHeaderUpdate) {
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
        update medical_purchase_batch
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
            update medical_purchase_log
            set status = 'deleted', updatedby_userid = $1, updated_at = $2
            where uuid = $3 and school_id = $4 and status = 'active'
          `);
          params.push([userId, now, prev.uuid, schoolId]);

          queries.push(singleLineString`
            update medical_item
            set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
            where uuid = $4 and school_id = $5
          `);
          params.push([prev.quantity, userId, now, prev.itemId, schoolId]);
        }
      }

      // 2. Update existing items / 3. insert new items.
      for (const item of incoming) {
        if (item.uuid) {
          const prev = existingItems.find((e: any) => e.uuid === item.uuid);
          if (!prev) continue;

          queries.push(singleLineString`
            update medical_purchase_log
            set item_id = $1, quantity = $2, cost_per_unit = $3, batch_no = $4, expiry_date = $5,
                updatedby_userid = $6, updated_at = $7
            where uuid = $8 and school_id = $9 and status = 'active'
          `);
          params.push([
            item.itemId,
            item.quantity,
            item.costPerUnit ?? null,
            item.batchNo ?? null,
            item.expiryDate ?? null,
            userId,
            now,
            item.uuid,
            schoolId,
          ]);

          if (item.itemId === prev.itemId) {
            const diff = item.quantity - prev.quantity;
            if (diff !== 0) {
              queries.push(singleLineString`
                update medical_item
                set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
                where uuid = $4 and school_id = $5
              `);
              params.push([diff, userId, now, item.itemId, schoolId]);
            }
          } else {
            queries.push(singleLineString`
              update medical_item
              set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
              where uuid = $4 and school_id = $5
            `);
            params.push([prev.quantity, userId, now, prev.itemId, schoolId]);
            queries.push(singleLineString`
              update medical_item
              set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
              where uuid = $4 and school_id = $5
            `);
            params.push([item.quantity, userId, now, item.itemId, schoolId]);
          }
        } else {
          const purchaseId = generateShortUuid(12);
          queries.push(singleLineString`
            insert into medical_purchase_log
            (uuid, item_id, purchase_date, batch_no, expiry_date, quantity, supplier, invoice_number, cost_per_unit, batch_id, status, school_id, createdby_userid, created_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `);
          params.push([
            purchaseId,
            item.itemId,
            data.purchaseDate ?? existing.purchaseDate,
            item.batchNo ?? data.batchNo ?? existing.batchNo ?? null,
            item.expiryDate ?? null,
            item.quantity,
            data.supplier ?? existing.supplier ?? null,
            data.invoiceNumber ?? existing.invoiceNumber ?? null,
            item.costPerUnit ?? null,
            workingBatchId,
            DEFAULTS.STATUS,
            schoolId,
            userId,
            now,
          ]);

          queries.push(singleLineString`
            update medical_item
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
    if (!existing) {
      return false;
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Soft-delete all purchase log items and reverse stock for each
    const items = existing.items || [];
    for (const item of items) {
      queries.push(singleLineString`
        update medical_purchase_log
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `);
      params.push([userId, now, item.uuid, schoolId]);

      queries.push(singleLineString`
        update medical_item
        set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `);
      params.push([item.quantity, userId, now, item.itemId, schoolId]);
    }

    // Soft-delete the batch record (not applicable for pre-batch individual purchases)
    if (existing.recordType !== 'purchase') {
      queries.push(singleLineString`
        update medical_purchase_batch
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `);
      params.push([userId, now, batchId, schoolId]);
    }

    await DB.queriesInTransaction(queries, params);
    return true;
  }

  public async restoreBatch(batchId: string, schoolId: string, userId: string): Promise<MedicalPurchaseBatch | null> {
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Batch case: restore the header and exactly the items deleted alongside it.
    const batchRows = await DB.query(
      singleLineString`
        select uuid, updated_at from medical_purchase_batch
        where uuid = $1 and school_id = $2 and status = 'deleted'
      `,
      [batchId, schoolId]
    );

    if (batchRows.length > 0) {
      const deletedAt = batchRows[0].updatedAt;
      const items = await DB.query(
        singleLineString`
          select uuid, item_id, quantity from medical_purchase_log
          where batch_id = $1 and school_id = $2 and status = 'deleted'
            and updated_at::timestamp(0) = $3::timestamp(0)
        `,
        [batchId, schoolId, deletedAt]
      );

      for (const item of items) {
        queries.push(singleLineString`
          update medical_purchase_log
          set status = 'active', updatedby_userid = $1, updated_at = $2
          where uuid = $3 and school_id = $4 and status = 'deleted'
        `);
        params.push([userId, now, item.uuid, schoolId]);

        queries.push(singleLineString`
          update medical_item
          set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
          where uuid = $4 and school_id = $5
        `);
        params.push([item.quantity, userId, now, item.itemId, schoolId]);
      }

      queries.push(singleLineString`
        update medical_purchase_batch
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
        select uuid, item_id, quantity from medical_purchase_log
        where uuid = $1 and school_id = $2 and batch_id is null and status = 'deleted'
      `,
      [batchId, schoolId]
    );

    if (purchaseRows.length > 0) {
      const purchase = purchaseRows[0];
      queries.push(singleLineString`
        update medical_purchase_log
        set status = 'active', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'deleted'
      `);
      params.push([userId, now, batchId, schoolId]);

      queries.push(singleLineString`
        update medical_item
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
    input: UploadBillRequest,
    schoolId: string,
    userId: string
  ): Promise<MedicalPurchaseBatch | null> {
    const existing = await this.getBatchById(batchId, schoolId);
    if (!existing) {
      return null;
    }

    // Delete old file if present (replace semantics)
    if (existing.fileId) {
      await fileStorageService.delete(existing.fileId, schoolId);
    }

    const uploaded = await fileStorageService.upload({
      fileName: input.fileName,
      mimeType: input.mimeType,
      base64Data: input.base64Data,
      entityType: 'medical_purchase_batch',
      entityId: batchId,
      schoolId,
      userId,
    });

    const now = new Date();
    await DB.query(
      singleLineString`
        update medical_purchase_batch
        set file_id = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `,
      [uploaded.uuid, userId, now, batchId, schoolId]
    );

    return this.getBatchById(batchId, schoolId);
  }

  public async getBill(batchId: string, schoolId: string) {
    const batch = await this.getBatchById(batchId, schoolId);
    if (!batch || !batch.fileId) {
      return null;
    }
    return fileStorageService.getWithData(batch.fileId, schoolId);
  }

  public async deleteBill(batchId: string, schoolId: string, userId: string): Promise<boolean> {
    const batch = await this.getBatchById(batchId, schoolId);
    if (!batch) {
      return false;
    }
    if (!batch.fileId) {
      return true; // nothing to delete
    }

    await fileStorageService.delete(batch.fileId, schoolId);

    const now = new Date();
    await DB.query(
      singleLineString`
        update medical_purchase_batch
        set file_id = null, updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4
      `,
      [userId, now, batchId, schoolId]
    );

    return true;
  }
  public async listExpiring(schoolId: string, days: number): Promise<ExpiringPurchase[]> {
    const sql = singleLineString`
      select
        p.uuid,
        p.item_id,
        i.name as item_name,
        p.batch_no,
        p.expiry_date,
        (p.expiry_date - current_date)::int as days_until_expiry,
        p.quantity,
        p.purchase_date,
        p.supplier,
        p.batch_id
      from medical_purchase_log p
      join medical_item i on p.item_id = i.uuid
      where p.school_id = $1
        and p.status = 'active'
        and p.expiry_date is not null
        and p.expiry_date >= current_date
        and p.expiry_date <= current_date + ($2 * interval '1 day')
      order by p.expiry_date asc
    `;
    return DB.query(sql, [schoolId, days]) as Promise<ExpiringPurchase[]>;
  }
}

export const medicalPurchaseBatchService = new MedicalPurchaseBatchService();
