import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService } from '../../shared/lib/file-storage';
import {
  ShopPurchaseBatch,
  ShopPurchaseBatchDetail,
  CreatePurchaseBatchRequest,
  UploadBillRequest,
} from './shop-interfaces';
import { DEFAULTS } from './shop-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class ShopPurchaseService {
  public async createBatch(data: CreatePurchaseBatchRequest, schoolId: string, userId: string): Promise<ShopPurchaseBatchDetail> {
    const batchUuid = generateShortUuid(12);
    const now = new Date();

    let fileId: string | null = null;
    if (data.bill) {
      const uploaded = await fileStorageService.upload({
        fileName: data.bill.fileName,
        mimeType: data.bill.mimeType,
        base64Data: data.bill.base64Data,
        entityType: 'shop_purchase_batch',
        entityId: batchUuid,
        schoolId,
        userId,
      });
      fileId = uploaded.uuid;
    }

    let totalAmount = 0;
    const itemsData: Array<{ item: (typeof data.items)[0]; logUuid: string; costPerUnit: number }> = [];

    for (const item of data.items) {
      const logUuid = generateShortUuid(12);
      const bulkDiscountPct = item.bulkDiscountPct ?? data.bulkDiscountPct ?? 0;
      const costPerUnit = item.costPerUnit != null
        ? item.costPerUnit
        : parseFloat((item.mrp * (1 - bulkDiscountPct / 100)).toFixed(2));
      totalAmount += costPerUnit * item.quantity;
      itemsData.push({ item, logUuid, costPerUnit });
    }
    totalAmount = parseFloat(totalAmount.toFixed(2));

    const queries: string[] = [];
    const params: any[][] = [];

    // Insert batch header
    queries.push(singleLineString`
      insert into shop_purchase_batch
      (uuid, school_id, purchase_date, academic_session, supplier, invoice_number, notes,
       total_amount, student_discount_pct, bulk_discount_pct, file_id, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `);
    params.push([
      batchUuid, schoolId, data.purchaseDate,
      data.academicSession || null, data.supplier || null,
      data.invoiceNumber || null, data.notes || null,
      totalAmount || null, data.studentDiscountPct ?? null, data.bulkDiscountPct ?? null,
      fileId, DEFAULTS.STATUS, userId, now,
    ]);

    // Insert purchase log lines and update stock
    for (const { item, logUuid, costPerUnit } of itemsData) {
      const effectiveStudentDiscount = item.studentDiscountPct ?? data.studentDiscountPct ?? null;
      const effectiveBulkDiscount = item.bulkDiscountPct ?? data.bulkDiscountPct ?? null;

      queries.push(singleLineString`
        insert into shop_purchase_log
        (uuid, batch_id, school_id, item_id, quantity, mrp, student_discount_pct,
         bulk_discount_pct, cost_per_unit, remaining_quantity, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `);
      params.push([
        logUuid, batchUuid, schoolId, item.itemId,
        item.quantity, item.mrp, effectiveStudentDiscount, effectiveBulkDiscount,
        costPerUnit, item.quantity, DEFAULTS.STATUS, userId, now,
      ]);

      queries.push(`update shop_item set current_stock = current_stock + $1 where uuid = $2 and school_id = $3`);
      params.push([item.quantity, item.itemId, schoolId]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getBatch(batchUuid, schoolId) as Promise<ShopPurchaseBatchDetail>;
  }

  public async getBatch(id: string, schoolId: string): Promise<ShopPurchaseBatchDetail | null> {
    const batches = await DB.query(
      `select * from shop_purchase_batch where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    if (batches.length === 0) return null;

    const items = await DB.query(
      singleLineString`
        select pl.*, si.name as item_name, si.type as item_type, si.class_no as item_class_no,
               b.academic_session
        from shop_purchase_log pl
        join shop_item si on pl.item_id = si.uuid
        join shop_purchase_batch b on pl.batch_id = b.uuid
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
    academicSession?: string;
    supplier?: string;
  }): Promise<ShopPurchaseBatch[]> {
    let query = `select * from shop_purchase_batch where school_id = $1 and status = 'active'`;
    const queryParams: any[] = [schoolId];
    let p = 2;

    if (filters.startDate) { query += ` and purchase_date >= $${p++}`; queryParams.push(filters.startDate); }
    if (filters.endDate) { query += ` and purchase_date <= $${p++}`; queryParams.push(filters.endDate); }
    if (filters.academicSession) { query += ` and academic_session = $${p++}`; queryParams.push(filters.academicSession); }
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

    for (const item of batch.items) {
      queries.push(`update shop_item set current_stock = current_stock - $1 where uuid = $2 and school_id = $3`);
      params.push([item.quantity, item.itemId, schoolId]);

      queries.push(`update shop_purchase_log set status = 'deleted', remaining_quantity = 0 where uuid = $1 and school_id = $2`);
      params.push([item.uuid, schoolId]);
    }

    queries.push(`update shop_purchase_batch set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`);
    params.push([userId, now, id, schoolId]);

    await DB.queriesInTransaction(queries, params);

    if (batch.fileId) {
      await fileStorageService.delete(batch.fileId, schoolId);
    }

    return true;
  }

  public async uploadBill(batchId: string, input: UploadBillRequest, schoolId: string, userId: string): Promise<ShopPurchaseBatchDetail | null> {
    const existing = await this.getBatch(batchId, schoolId);
    if (!existing) return null;

    if (existing.fileId) {
      await fileStorageService.delete(existing.fileId, schoolId);
    }

    const uploaded = await fileStorageService.upload({
      fileName: input.fileName,
      mimeType: input.mimeType,
      base64Data: input.base64Data,
      entityType: 'shop_purchase_batch',
      entityId: batchId,
      schoolId,
      userId,
    });

    const now = new Date();
    await DB.query(
      `update shop_purchase_batch set file_id = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
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
      `update shop_purchase_batch set file_id = null, updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      [userId, now, batchId, schoolId]
    );

    return true;
  }

  private parseBatchNumericFields(batch: any): ShopPurchaseBatch {
    return {
      ...batch,
      totalAmount: batch.totalAmount != null ? parseFloat(batch.totalAmount) : null,
      studentDiscountPct: batch.studentDiscountPct != null ? parseFloat(batch.studentDiscountPct) : null,
      bulkDiscountPct: batch.bulkDiscountPct != null ? parseFloat(batch.bulkDiscountPct) : null,
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

export const shopPurchaseService = new ShopPurchaseService();
