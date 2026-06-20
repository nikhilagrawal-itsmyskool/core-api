import { DB, singleLineString } from '../../shared/lib/db';
import { SportPurchaseLog, CreatePurchaseLogRequest, UpdatePurchaseLogRequest } from './sport-interfaces';
import { DEFAULTS } from './sport-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SportPurchaseService {
  public async create(
    data: CreatePurchaseLogRequest,
    schoolId: string,
    userId: string
  ): Promise<SportPurchaseLog> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    const insertQuery = singleLineString`
      insert into sport_purchase_log
      (uuid, item_id, sport_type, purchase_date, quantity, cost_per_unit, supplier, invoice_number, batch_no, remarks, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `;

    const updateStockQuery = singleLineString`
      update sport_item
      set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;

    const insertParams = [
      uuid,
      data.itemId,
      data.sportType,
      data.purchaseDate,
      data.quantity,
      data.costPerUnit || null,
      data.supplier || null,
      data.invoiceNumber || null,
      data.batchNo || null,
      data.remarks || null,
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

    return this.getById(uuid, schoolId) as Promise<SportPurchaseLog>;
  }

  public async update(
    id: string,
    data: UpdatePurchaseLogRequest,
    schoolId: string,
    userId: string
  ): Promise<SportPurchaseLog | null> {
    const now = new Date();

    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return null;
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.purchaseDate !== undefined) {
      updates.push(`purchase_date = $${paramIndex++}`);
      params.push(data.purchaseDate);
    }
    if (data.quantity !== undefined) {
      updates.push(`quantity = $${paramIndex++}`);
      params.push(data.quantity);
    }
    if (data.costPerUnit !== undefined) {
      updates.push(`cost_per_unit = $${paramIndex++}`);
      params.push(data.costPerUnit);
    }
    if (data.supplier !== undefined) {
      updates.push(`supplier = $${paramIndex++}`);
      params.push(data.supplier);
    }
    if (data.invoiceNumber !== undefined) {
      updates.push(`invoice_number = $${paramIndex++}`);
      params.push(data.invoiceNumber);
    }
    if (data.batchNo !== undefined) {
      updates.push(`batch_no = $${paramIndex++}`);
      params.push(data.batchNo);
    }
    if (data.remarks !== undefined) {
      updates.push(`remarks = $${paramIndex++}`);
      params.push(data.remarks);
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
      update sport_purchase_log
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++} and status = 'active'
    `;

    if (data.quantity !== undefined && data.quantity !== existing.quantity) {
      const stockDiff = data.quantity - existing.quantity;
      const updateStockQuery = singleLineString`
        update sport_item
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

    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return false;
    }

    const deleteQuery = singleLineString`
      update sport_purchase_log
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `;

    const updateStockQuery = singleLineString`
      update sport_item
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

  public async getById(id: string, schoolId: string): Promise<SportPurchaseLog | null> {
    const query = singleLineString`
      select p.*, i.name as item_name
      from sport_purchase_log p
      left join sport_item i on p.item_id = i.uuid
      where p.uuid = $1 and p.school_id = $2 and p.status = 'active'
    `;

    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async search(params: {
    schoolId: string;
    sportType?: string;
    itemId?: string;
    startDate?: string;
    endDate?: string;
    includeDeleted?: boolean;
  }): Promise<SportPurchaseLog[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";

    let query = `
      select p.*, i.name as item_name
      from sport_purchase_log p
      left join sport_item i on p.item_id = i.uuid
      where p.school_id = $1
        and p.status in ${statusFilter}
    `;
    const queryParams: any[] = [params.schoolId];
    let paramIndex = 2;

    if (params.startDate) {
      query += ` and p.purchase_date >= $${paramIndex++}`;
      queryParams.push(params.startDate);
    }

    if (params.endDate) {
      query += ` and p.purchase_date <= $${paramIndex++}`;
      queryParams.push(params.endDate);
    }

    if (params.sportType) {
      query += ` and p.sport_type = $${paramIndex++}`;
      queryParams.push(params.sportType);
    }

    if (params.itemId) {
      query += ` and p.item_id = $${paramIndex++}`;
      queryParams.push(params.itemId);
    }

    query += ` order by p.purchase_date desc`;

    return DB.query(query, queryParams);
  }
}

export const sportPurchaseService = new SportPurchaseService();
