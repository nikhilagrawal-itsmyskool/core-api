import { DB, singleLineString } from '../../shared/lib/db';
import { MedicalPurchaseLog, CreatePurchaseLogRequest, UpdatePurchaseLogRequest } from './medical-interfaces';
import { DEFAULTS } from './medical-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class MedicalPurchaseService {
  public async create(
    data: CreatePurchaseLogRequest,
    schoolId: string,
    userId: string
  ): Promise<MedicalPurchaseLog> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    // Use transaction to insert purchase and update stock
    const insertQuery = singleLineString`
      insert into medical_purchase_log
      (uuid, item_id, purchase_date, batch_no, expiry_date, quantity, supplier, invoice_number, cost_per_unit, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `;

    const updateStockQuery = singleLineString`
      update medical_item
      set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;

    const insertParams = [
      uuid,
      data.itemId,
      data.purchaseDate,
      data.batchNo || null,
      data.expiryDate || null,
      data.quantity,
      data.supplier || null,
      data.invoiceNumber || null,
      data.costPerUnit || null,
      DEFAULTS.STATUS,
      schoolId,
      userId,
      now,
    ];

    const updateStockParams = [data.quantity, userId, now, data.itemId, schoolId];

    await DB.queriesInTransaction(
      [insertQuery, updateStockQuery],
      [insertParams, updateStockParams]
    );

    return this.getById(uuid, schoolId) as Promise<MedicalPurchaseLog>;
  }

  public async update(
    id: string,
    data: UpdatePurchaseLogRequest,
    schoolId: string,
    userId: string
  ): Promise<MedicalPurchaseLog | null> {
    const now = new Date();

    // Get existing purchase to calculate stock difference
    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return null;
    }

    // Build dynamic update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.purchaseDate !== undefined) {
      updates.push(`purchase_date = $${paramIndex++}`);
      params.push(data.purchaseDate);
    }
    if (data.batchNo !== undefined) {
      updates.push(`batch_no = $${paramIndex++}`);
      params.push(data.batchNo);
    }
    if (data.expiryDate !== undefined) {
      updates.push(`expiry_date = $${paramIndex++}`);
      params.push(data.expiryDate);
    }
    if (data.quantity !== undefined) {
      updates.push(`quantity = $${paramIndex++}`);
      params.push(data.quantity);
    }
    if (data.supplier !== undefined) {
      updates.push(`supplier = $${paramIndex++}`);
      params.push(data.supplier);
    }
    if (data.invoiceNumber !== undefined) {
      updates.push(`invoice_number = $${paramIndex++}`);
      params.push(data.invoiceNumber);
    }
    if (data.costPerUnit !== undefined) {
      updates.push(`cost_per_unit = $${paramIndex++}`);
      params.push(data.costPerUnit);
    }

    if (updates.length === 0 && data.quantity === undefined) {
      return existing;
    }

    updates.push(`updatedby_userid = $${paramIndex++}`);
    params.push(userId);
    updates.push(`updated_at = $${paramIndex++}`);
    params.push(now);

    params.push(id);
    params.push(schoolId);

    const updateQuery = singleLineString`
      update medical_purchase_log
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++} and status = 'active'
    `;

    // If quantity changed, update stock
    if (data.quantity !== undefined && data.quantity !== existing.quantity) {
      const stockDiff = data.quantity - existing.quantity;
      const updateStockQuery = singleLineString`
        update medical_item
        set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `;

      await DB.queriesInTransaction(
        [updateQuery, updateStockQuery],
        [params, [stockDiff, userId, now, existing.itemId, schoolId]]
      );
    } else {
      await DB.query(updateQuery, params);
    }

    return this.getById(id, schoolId);
  }

  public async delete(
    id: string,
    schoolId: string,
    userId: string
  ): Promise<boolean> {
    const now = new Date();

    // Get existing purchase to reverse stock
    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return false;
    }

    const deleteQuery = singleLineString`
      update medical_purchase_log
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `;

    const updateStockQuery = singleLineString`
      update medical_item
      set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;

    await DB.queriesInTransaction(
      [deleteQuery, updateStockQuery],
      [
        [userId, now, id, schoolId],
        [existing.quantity, userId, now, existing.itemId, schoolId],
      ]
    );

    return true;
  }

  public async getById(id: string, schoolId: string): Promise<MedicalPurchaseLog | null> {
    const query = singleLineString`
      select p.*, i.name as item_name
      from medical_purchase_log p
      left join medical_item i on p.item_id = i.uuid
      where p.uuid = $1 and p.school_id = $2 and p.status = 'active'
    `;

    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async listByItem(itemId: string, schoolId: string): Promise<MedicalPurchaseLog[]> {
    const query = singleLineString`
      select p.*, i.name as item_name
      from medical_purchase_log p
      left join medical_item i on p.item_id = i.uuid
      where p.item_id = $1 and p.school_id = $2 and p.status = 'active'
      order by p.purchase_date desc
    `;
    return DB.query(query, [itemId, schoolId]);
  }

  public async search(params: {
    schoolId: string;
    itemId?: string;
    startDate: string;
    endDate: string;
    includeDeleted?: boolean;
  }): Promise<MedicalPurchaseLog[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";

    let query = `
      select p.*, i.name as item_name
      from medical_purchase_log p
      left join medical_item i on p.item_id = i.uuid
      where p.school_id = $1
        and p.status in ${statusFilter}
        and p.purchase_date >= $2
        and p.purchase_date <= $3
    `;
    const queryParams: any[] = [params.schoolId, params.startDate, params.endDate];

    if (params.itemId) {
      query += ` and p.item_id = $4`;
      queryParams.push(params.itemId);
    }

    query += ` order by p.purchase_date desc`;

    return DB.query(query, queryParams);
  }
}

export const medicalPurchaseService = new MedicalPurchaseService();
