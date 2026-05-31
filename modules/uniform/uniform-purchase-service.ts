import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService } from '../../shared/lib/file-storage';
import {
  UniformPurchaseBatch,
  UniformPurchaseBatchDetail,
  CreatePurchaseBatchRequest,
  UploadBillRequest,
} from './uniform-interfaces';
import { DEFAULTS } from './uniform-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class UniformPurchaseService {
  public async createBatch(data: CreatePurchaseBatchRequest, schoolId: string, userId: string): Promise<UniformPurchaseBatchDetail> {
    const batchUuid = generateShortUuid(12);
    const now = new Date();

    // Handle optional inline bill upload before starting DB work
    let fileId: string | null = null;
    if (data.bill) {
      const uploaded = await fileStorageService.upload({
        fileName: data.bill.fileName,
        mimeType: data.bill.mimeType,
        base64Data: data.bill.base64Data,
        entityType: 'uniform_purchase_batch',
        entityId: batchUuid,
        schoolId,
        userId,
      });
      fileId = uploaded.uuid;
    }

    // Compute costPerUnit and totalAmount from MRP + bulk discount
    let totalAmount = 0;
    const itemsData: Array<{ item: (typeof data.items)[0]; logUuid: string; costPerUnit: number }> = [];
    for (const item of data.items) {
      const logUuid = generateShortUuid(12);
      const bulkDiscountPct = item.bulkDiscountPct ?? 0;
      const costPerUnit = parseFloat((item.mrp * (1 - bulkDiscountPct / 100)).toFixed(2));
      totalAmount += costPerUnit * item.quantity;
      itemsData.push({ item, logUuid, costPerUnit });
    }
    totalAmount = parseFloat(totalAmount.toFixed(2));

    const queries: string[] = [];
    const params: any[][] = [];

    // Insert batch header
    queries.push(singleLineString`
      insert into uniform_purchase_batch
      (uuid, school_id, purchase_date, supplier, invoice_number, notes, total_amount, file_id, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    `);
    params.push([
      batchUuid, schoolId, data.purchaseDate,
      data.supplier || null, data.invoiceNumber || null, data.notes || null,
      totalAmount || null, fileId, DEFAULTS.STATUS, userId, now,
    ]);

    // Insert purchase log lines + update stock + update size pricing for each item
    for (const { item, logUuid, costPerUnit } of itemsData) {
      queries.push(singleLineString`
        insert into uniform_purchase_log
        (uuid, batch_id, school_id, item_id, size_id, quantity, mrp, student_discount_pct, bulk_discount_pct, cost_per_unit, remaining_quantity, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `);
      params.push([
        logUuid, batchUuid, schoolId, item.itemId, item.sizeId,
        item.quantity, item.mrp, item.studentDiscountPct ?? null, item.bulkDiscountPct ?? null,
        costPerUnit, item.quantity, DEFAULTS.STATUS, userId, now,
      ]);

      queries.push(`update uniform_item_size set current_stock = current_stock + $1 where uuid = $2 and school_id = $3`);
      params.push([item.quantity, item.sizeId, schoolId]);

      // Latest purchase sets current pricing on the size
      queries.push(singleLineString`
        update uniform_item_size
        set mrp = $1, student_discount_pct = $2, bulk_discount_pct = $3, updatedby_userid = $4, updated_at = $5
        where uuid = $6 and school_id = $7
      `);
      params.push([item.mrp, item.studentDiscountPct ?? null, item.bulkDiscountPct ?? null, userId, now, item.sizeId, schoolId]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getBatch(batchUuid, schoolId) as Promise<UniformPurchaseBatchDetail>;
  }

  public async getBatch(id: string, schoolId: string): Promise<UniformPurchaseBatchDetail | null> {
    const batches = await DB.query(
      `select * from uniform_purchase_batch where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    if (batches.length === 0) return null;

    const items = await DB.query(
      singleLineString`
        select pl.*, ui.name as item_name, ui.category as item_category, ui.gender as item_gender, us.size_label
        from uniform_purchase_log pl
        join uniform_item ui on pl.item_id = ui.uuid
        join uniform_item_size us on pl.size_id = us.uuid
        where pl.batch_id = $1 and pl.status = 'active'
        order by pl.created_at asc
      `,
      [id]
    );

    return {
      ...this.parseBatchNumericFields(batches[0]),
      items: items.map((r: any) => this.parseLogNumericFields(r)),
    };
  }

  public async listBatches(schoolId: string, filters: {
    startDate?: string;
    endDate?: string;
    supplier?: string;
  }): Promise<UniformPurchaseBatch[]> {
    let query = `select * from uniform_purchase_batch where school_id = $1 and status = 'active'`;
    const queryParams: any[] = [schoolId];
    let p = 2;

    if (filters.startDate) { query += ` and purchase_date >= $${p++}`; queryParams.push(filters.startDate); }
    if (filters.endDate) { query += ` and purchase_date <= $${p++}`; queryParams.push(filters.endDate); }
    if (filters.supplier) { query += ` and lower(supplier) like lower($${p++})`; queryParams.push(`%${filters.supplier}%`); }

    query += ` order by purchase_date desc, created_at desc`;
    const rows = await DB.query(query, queryParams);
    return rows.map((r: any) => this.parseBatchNumericFields(r));
  }

  public async deleteBatch(id: string, schoolId: string, userId: string): Promise<boolean> {
    const batch = await this.getBatch(id, schoolId);
    if (!batch) return false;

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Reverse stock + zero out remaining_quantity for each line item
    for (const item of batch.items) {
      queries.push(`update uniform_item_size set current_stock = current_stock - $1 where uuid = $2 and school_id = $3`);
      params.push([item.quantity, item.sizeId, schoolId]);

      queries.push(`update uniform_purchase_log set status = 'deleted', remaining_quantity = 0 where uuid = $1 and school_id = $2`);
      params.push([item.uuid, schoolId]);
    }

    queries.push(`update uniform_purchase_batch set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`);
    params.push([userId, now, id, schoolId]);

    await DB.queriesInTransaction(queries, params);

    // Delete bill file after transaction
    if (batch.fileId) {
      await fileStorageService.delete(batch.fileId, schoolId);
    }

    return true;
  }

  public async uploadBill(batchId: string, input: UploadBillRequest, schoolId: string, userId: string): Promise<UniformPurchaseBatchDetail | null> {
    const existing = await this.getBatch(batchId, schoolId);
    if (!existing) return null;

    // Replace semantics: delete old file first
    if (existing.fileId) {
      await fileStorageService.delete(existing.fileId, schoolId);
    }

    const uploaded = await fileStorageService.upload({
      fileName: input.fileName,
      mimeType: input.mimeType,
      base64Data: input.base64Data,
      entityType: 'uniform_purchase_batch',
      entityId: batchId,
      schoolId,
      userId,
    });

    const now = new Date();
    await DB.query(
      `update uniform_purchase_batch set file_id = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
      [uploaded.uuid, userId, now, batchId, schoolId]
    );

    return this.getBatch(batchId, schoolId);
  }

  public async getBill(batchId: string, schoolId: string) {
    const batch = await this.getBatch(batchId, schoolId);
    if (!batch || !batch.fileId) return null;
    return fileStorageService.getWithData(batch.fileId, schoolId);
  }

  public async deleteBill(batchId: string, schoolId: string, userId: string): Promise<boolean> {
    const batch = await this.getBatch(batchId, schoolId);
    if (!batch) return false;
    if (!batch.fileId) return true;

    await fileStorageService.delete(batch.fileId, schoolId);

    const now = new Date();
    await DB.query(
      `update uniform_purchase_batch set file_id = null, updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, now, batchId, schoolId]
    );

    return true;
  }

  private parseBatchNumericFields(batch: any): UniformPurchaseBatch {
    return {
      ...batch,
      totalAmount: batch.totalAmount != null ? parseFloat(batch.totalAmount) : null,
    };
  }

  private parseLogNumericFields(log: any): any {
    return {
      ...log,
      mrp: log.mrp != null ? parseFloat(log.mrp) : null,
      studentDiscountPct: log.studentDiscountPct != null ? parseFloat(log.studentDiscountPct) : null,
      bulkDiscountPct: log.bulkDiscountPct != null ? parseFloat(log.bulkDiscountPct) : null,
      costPerUnit: log.costPerUnit != null ? parseFloat(log.costPerUnit) : null,
      remainingQuantity: log.remainingQuantity != null ? parseInt(log.remainingQuantity, 10) : null,
    };
  }
}

export const uniformPurchaseService = new UniformPurchaseService();
