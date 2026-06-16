import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService } from '../../shared/lib/file-storage';
import { StoredFileWithData } from '../../shared/lib/file-storage';
import { DEFAULTS } from './lab-constants';
import {
  LabPurchaseBatch,
  LabPurchaseLog,
  LabAlertItem,
  CreateBulkLabPurchaseRequest,
  UpdateLabPurchaseBatchRequest,
} from './lab-interfaces';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class LabPurchaseBatchService {
  public async createBulk(
    data: CreateBulkLabPurchaseRequest,
    schoolId: string,
    userId: string
  ): Promise<LabPurchaseBatch> {
    const batchId = generateShortUuid(12);
    const now = new Date();

    const queries: string[] = [];
    const params: any[][] = [];

    // Insert batch header
    queries.push(singleLineString`
      insert into lab_purchase_batch
      (uuid, purchase_date, supplier, invoice_number, batch_no, expiry_date, warranty_end_date, notes, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `);
    params.push([
      batchId,
      data.purchaseDate,
      data.supplier || null,
      data.invoiceNumber || null,
      data.batchNo || null,
      data.expiryDate || null,
      data.warrantyEndDate || null,
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
      const effectiveExpiryDate = item.expiryDate ?? data.expiryDate ?? null;
      const effectiveWarrantyEndDate = item.warrantyEndDate ?? data.warrantyEndDate ?? null;

      queries.push(singleLineString`
        insert into lab_purchase_log
        (uuid, item_id, lab_id, purchase_date, quantity, cost_per_unit, supplier, invoice_number, batch_no, expiry_date, warranty_end_date, remarks, batch_id, status, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `);
      params.push([
        purchaseId,
        item.itemId,
        item.labId,
        data.purchaseDate,
        item.quantity,
        item.costPerUnit || null,
        data.supplier || null,
        data.invoiceNumber || null,
        effectiveBatchNo,
        effectiveExpiryDate,
        effectiveWarrantyEndDate,
        item.remarks || null,
        batchId,
        DEFAULTS.STATUS,
        schoolId,
        userId,
        now,
      ]);

      queries.push(singleLineString`
        update lab_item
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
        entityType: 'lab_purchase_batch',
        entityId: batchId,
        schoolId,
        userId,
      });
      await DB.query(
        `update lab_purchase_batch set file_id = $1 where uuid = $2 and school_id = $3`,
        [stored.uuid, batchId, schoolId]
      );
    }

    return this.getBatchById(batchId, schoolId) as Promise<LabPurchaseBatch>;
  }

  public async listBatches(params: {
    schoolId: string;
    startDate?: string;
    endDate?: string;
    includeDeleted?: boolean;
    labId?: string;
    itemId?: string;
  }): Promise<LabPurchaseBatch[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";

    const queryParams: any[] = [params.schoolId];
    let paramIndex = 2;
    let batchDateFilter = '';
    let purchaseDateFilter = '';
    let batchLabFilter = '';
    let batchItemFilter = '';
    let purchaseLabFilter = '';
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
    if (params.labId) {
      queryParams.push(params.labId);
      batchLabFilter = `and exists (select 1 from lab_purchase_log p2 where p2.batch_id = b.uuid and p2.lab_id = $${paramIndex} and p2.status = 'active')`;
      purchaseLabFilter = `and p.lab_id = $${paramIndex}`;
      paramIndex++;
    }
    if (params.itemId) {
      queryParams.push(params.itemId);
      batchItemFilter = `and exists (select 1 from lab_purchase_log p2 where p2.batch_id = b.uuid and p2.item_id = $${paramIndex} and p2.status = 'active')`;
      purchaseItemFilter = `and p.item_id = $${paramIndex}`;
      paramIndex++;
    }

    const query = `
      select
        b.uuid, b.purchase_date, b.supplier, b.invoice_number, b.batch_no, b.notes, b.file_id, b.status,
        b.school_id, b.createdby_userid, b.created_at, b.updatedby_userid, b.updated_at,
        'batch' as record_type,
        (select count(*) from lab_purchase_log p where p.batch_id = b.uuid and p.status = 'active')::int as item_count,
        (select sum(p.quantity * p.cost_per_unit) from lab_purchase_log p where p.batch_id = b.uuid and p.status = 'active') as total_cost,
        (select p3.expiry_date from lab_purchase_log p3 where p3.batch_id = b.uuid and p3.status = 'active' order by p3.created_at asc limit 1) as expiry_date,
        (select p3.warranty_end_date from lab_purchase_log p3 where p3.batch_id = b.uuid and p3.status = 'active' order by p3.created_at asc limit 1) as warranty_end_date,
        (select sum(p3.quantity) from lab_purchase_log p3 where p3.batch_id = b.uuid and p3.status = 'active')::int as quantity,
        (select p3.cost_per_unit from lab_purchase_log p3 where p3.batch_id = b.uuid and p3.status = 'active' order by p3.created_at asc limit 1) as cost_per_unit,
        (select i.name from lab_purchase_log p3 join lab_item i on p3.item_id = i.uuid where p3.batch_id = b.uuid and p3.status = 'active' order by p3.created_at asc limit 1) as item_name,
        (select l.name from lab_purchase_log p3 join lab l on p3.lab_id = l.uuid where p3.batch_id = b.uuid and p3.status = 'active' order by p3.created_at asc limit 1) as lab_name
      from lab_purchase_batch b
      where b.school_id = $1
        and b.status in ${statusFilter}
        ${batchDateFilter}
        ${batchLabFilter}
        ${batchItemFilter}

      union all

      select
        p.uuid, p.purchase_date, p.supplier, p.invoice_number, p.batch_no,
        null as notes, null as file_id, p.status,
        p.school_id, p.createdby_userid, p.created_at, p.updatedby_userid, p.updated_at,
        'purchase' as record_type,
        1 as item_count,
        p.quantity * p.cost_per_unit as total_cost,
        p.expiry_date,
        p.warranty_end_date,
        p.quantity,
        p.cost_per_unit,
        i.name as item_name,
        l.name as lab_name
      from lab_purchase_log p
      left join lab_item i on p.item_id = i.uuid
      left join lab l on p.lab_id = l.uuid
      where p.school_id = $1
        and p.batch_id is null
        and p.status in ${statusFilter}
        ${purchaseDateFilter}
        ${purchaseLabFilter}
        ${purchaseItemFilter}

      order by purchase_date desc, created_at desc
    `;

    return DB.query(query, queryParams);
  }

  public async getBatchById(batchId: string, schoolId: string): Promise<LabPurchaseBatch | null> {
    // Try batch header first
    const batchQuery = singleLineString`
      select * from lab_purchase_batch
      where uuid = $1 and school_id = $2 and status = 'active'
    `;
    const batches = await DB.query(batchQuery, [batchId, schoolId]);

    if (batches.length > 0) {
      const batch = batches[0];
      const itemsQuery = singleLineString`
        select p.*, i.name as item_name, l.name as lab_name
        from lab_purchase_log p
        left join lab_item i on p.item_id = i.uuid
        left join lab l on p.lab_id = l.uuid
        where p.batch_id = $1 and p.school_id = $2 and p.status = 'active'
        order by p.created_at asc
      `;
      const items: LabPurchaseLog[] = await DB.query(itemsQuery, [batchId, schoolId]);
      return { ...batch, items, recordType: 'batch' };
    }

    // Fall through to pre-batch individual purchase
    const purchaseQuery = singleLineString`
      select p.*, i.name as item_name, l.name as lab_name
      from lab_purchase_log p
      left join lab_item i on p.item_id = i.uuid
      left join lab l on p.lab_id = l.uuid
      where p.uuid = $1 and p.school_id = $2 and p.batch_id is null and p.status = 'active'
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
    data: UpdateLabPurchaseBatchRequest,
    schoolId: string,
    userId: string
  ): Promise<LabPurchaseBatch | null> {
    const existing = await this.getBatchById(batchId, schoolId);
    if (!existing) return null;

    const headerKeys: (keyof UpdateLabPurchaseBatchRequest)[] = [
      'purchaseDate', 'supplier', 'invoiceNumber', 'batchNo', 'expiryDate', 'warrantyEndDate', 'notes',
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
        insert into lab_purchase_batch
        (uuid, purchase_date, supplier, invoice_number, batch_no, expiry_date, warranty_end_date, notes, status, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `);
      params.push([
        workingBatchId,
        data.purchaseDate ?? existing.purchaseDate,
        data.supplier ?? existing.supplier ?? null,
        data.invoiceNumber ?? existing.invoiceNumber ?? null,
        data.batchNo ?? existing.batchNo ?? null,
        data.expiryDate ?? null,
        data.warrantyEndDate ?? null,
        data.notes ?? null,
        DEFAULTS.STATUS,
        schoolId,
        userId,
        now,
      ]);

      // Attach the legacy purchase log row to the new batch.
      queries.push(singleLineString`
        update lab_purchase_log
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
      if (data.expiryDate !== undefined) { updates.push(`expiry_date = $${p++}`); headerParams.push(data.expiryDate); }
      if (data.warrantyEndDate !== undefined) { updates.push(`warranty_end_date = $${p++}`); headerParams.push(data.warrantyEndDate); }
      if (data.notes !== undefined) { updates.push(`notes = $${p++}`); headerParams.push(data.notes); }

      updates.push(`updatedby_userid = $${p++}`);
      headerParams.push(userId);
      updates.push(`updated_at = $${p++}`);
      headerParams.push(now);
      headerParams.push(workingBatchId);
      headerParams.push(schoolId);

      queries.push(singleLineString`
        update lab_purchase_batch
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
            update lab_purchase_log
            set status = 'deleted', updatedby_userid = $1, updated_at = $2
            where uuid = $3 and school_id = $4 and status = 'active'
          `);
          params.push([userId, now, prev.uuid, schoolId]);

          queries.push(singleLineString`
            update lab_item
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
            update lab_purchase_log
            set item_id = $1, lab_id = $2, quantity = $3, cost_per_unit = $4, batch_no = $5,
                expiry_date = $6, warranty_end_date = $7, remarks = $8, updatedby_userid = $9, updated_at = $10
            where uuid = $11 and school_id = $12 and status = 'active'
          `);
          params.push([
            item.itemId,
            item.labId,
            item.quantity,
            item.costPerUnit ?? null,
            item.batchNo ?? null,
            item.expiryDate ?? null,
            item.warrantyEndDate ?? null,
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
                update lab_item
                set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
                where uuid = $4 and school_id = $5
              `);
              params.push([diff, userId, now, item.itemId, schoolId]);
            }
          } else {
            // Item reassigned: remove old item's qty, add new item's qty.
            queries.push(singleLineString`
              update lab_item
              set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
              where uuid = $4 and school_id = $5
            `);
            params.push([prev.quantity, userId, now, prev.itemId, schoolId]);
            queries.push(singleLineString`
              update lab_item
              set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
              where uuid = $4 and school_id = $5
            `);
            params.push([item.quantity, userId, now, item.itemId, schoolId]);
          }
        } else {
          // New item added to the batch.
          const purchaseId = generateShortUuid(12);
          queries.push(singleLineString`
            insert into lab_purchase_log
            (uuid, item_id, lab_id, purchase_date, quantity, cost_per_unit, supplier, invoice_number, batch_no, expiry_date, warranty_end_date, remarks, batch_id, status, school_id, createdby_userid, created_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          `);
          params.push([
            purchaseId,
            item.itemId,
            item.labId,
            data.purchaseDate ?? existing.purchaseDate,
            item.quantity,
            item.costPerUnit ?? null,
            data.supplier ?? existing.supplier ?? null,
            data.invoiceNumber ?? existing.invoiceNumber ?? null,
            item.batchNo ?? data.batchNo ?? existing.batchNo ?? null,
            item.expiryDate ?? data.expiryDate ?? null,
            item.warrantyEndDate ?? data.warrantyEndDate ?? null,
            item.remarks ?? null,
            workingBatchId,
            DEFAULTS.STATUS,
            schoolId,
            userId,
            now,
          ]);

          queries.push(singleLineString`
            update lab_item
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
        update lab_purchase_log
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `);
      params.push([userId, now, item.uuid, schoolId]);

      queries.push(singleLineString`
        update lab_item
        set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `);
      params.push([item.quantity, userId, now, item.itemId, schoolId]);
    }

    if (existing.recordType !== 'purchase') {
      queries.push(singleLineString`
        update lab_purchase_batch
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `);
      params.push([userId, now, batchId, schoolId]);
    }

    await DB.queriesInTransaction(queries, params);
    return true;
  }

  public async listAlerts(schoolId: string, days: number): Promise<LabAlertItem[]> {
    const sql = `
      select
        i.uuid as item_id,
        i.name as item_name,
        l.uuid as lab_id,
        l.name as lab_name,
        i.unit,
        i.current_stock,
        min(case when p.expiry_date between current_date and current_date + ($2 * interval '1 day')
            then p.expiry_date end) as nearest_expiry,
        (min(case when p.expiry_date between current_date and current_date + ($2 * interval '1 day')
            then p.expiry_date end) - current_date)::int as expiry_days_left,
        min(case when p.warranty_end_date between current_date and current_date + ($2 * interval '1 day')
            then p.warranty_end_date end) as nearest_warranty_end,
        (min(case when p.warranty_end_date between current_date and current_date + ($2 * interval '1 day')
            then p.warranty_end_date end) - current_date)::int as warranty_days_left
      from lab_item i
      join lab l on i.lab_id = l.uuid
      join lab_purchase_log p on p.item_id = i.uuid and p.status = 'active'
      where i.school_id = $1
        and i.status = 'active'
        and (
          p.expiry_date between current_date and current_date + ($2 * interval '1 day')
          or p.warranty_end_date between current_date and current_date + ($2 * interval '1 day')
        )
      group by i.uuid, i.name, l.uuid, l.name, i.unit, i.current_stock
      order by least(
        min(case when p.expiry_date >= current_date then p.expiry_date end),
        min(case when p.warranty_end_date >= current_date then p.warranty_end_date end)
      ) asc nulls last
    `;
    return DB.query(sql, [schoolId, days]) as Promise<LabAlertItem[]>;
  }

  public async uploadBill(
    batchId: string,
    bill: { fileName: string; mimeType: string; base64Data: string },
    schoolId: string,
    userId: string
  ): Promise<LabPurchaseBatch | null> {
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
      entityType: 'lab_purchase_batch',
      entityId: batchId,
      schoolId,
      userId,
    });

    await DB.query(
      `update lab_purchase_batch set file_id = $1 where uuid = $2 and school_id = $3`,
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
      `update lab_purchase_batch set file_id = null where uuid = $1 and school_id = $2`,
      [batchId, schoolId]
    );
  }
}

export const labPurchaseBatchService = new LabPurchaseBatchService();
