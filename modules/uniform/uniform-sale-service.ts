import { DB, singleLineString } from '../../shared/lib/db';
import {
  UniformSale,
  UniformSaleDetail,
  UniformSalePayment,
  CreateSaleRequest,
  UniformReturn,
  CreateReturnRequest,
} from './uniform-interfaces';
import { DEFAULTS } from './uniform-constants';
import { fileStorageService } from '../../shared/lib/file-storage';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class UniformSaleService {
  public async create(data: CreateSaleRequest, schoolId: string, userId: string): Promise<UniformSaleDetail> {
    const saleUuid = generateShortUuid(12);
    const now = new Date();

    // Fetch sizes to get MRP and discount %
    const sizeIds = data.items.map(i => i.sizeId);
    const sizes = await DB.query(
      `select * from uniform_item_size where uuid = ANY($1) and school_id = $2`,
      [sizeIds, schoolId]
    );
    const sizeMap = new Map(sizes.map((s: any) => [s.uuid, s]));

    // Compute totals — discount always from size (studentDiscountPct for student, bulkDiscountPct for bulk)
    let totalMrp = 0;
    let totalDiscount = 0;

    const itemRows: Array<{
      uuid: string; sizeId: string; itemId: string; quantity: number;
      mrp: number; discountPct: number; unitPrice: number; lineTotal: number;
    }> = [];

    for (const item of data.items) {
      const size = sizeMap.get(item.sizeId) as any;
      const mrp = parseFloat(size?.mrp ?? 0);
      const discountPct = data.saleType === 'bulk'
        ? parseFloat(size?.bulkDiscountPct ?? 0)
        : parseFloat(size?.studentDiscountPct ?? 0);
      const unitPrice = parseFloat((mrp * (1 - discountPct / 100)).toFixed(2));
      const lineTotal = parseFloat((unitPrice * item.quantity).toFixed(2));
      totalMrp += mrp * item.quantity;
      totalDiscount += (mrp - unitPrice) * item.quantity;
      itemRows.push({ uuid: generateShortUuid(12), sizeId: item.sizeId, itemId: item.itemId, quantity: item.quantity, mrp, discountPct, unitPrice, lineTotal });
    }

    totalMrp = parseFloat(totalMrp.toFixed(2));
    totalDiscount = parseFloat(totalDiscount.toFixed(2));
    const totalAmount = parseFloat((totalMrp - totalDiscount).toFixed(2));
    const paymentStatus = data.amountPaid >= totalAmount ? 'paid'
      : data.amountPaid > 0 ? 'partial' : 'due';

    // Plan highest-MRP-first depletion of remaining_quantity in purchase logs
    const depletionQueries: string[] = [];
    const depletionParams: any[][] = [];
    for (const row of itemRows) {
      let toDeduct = row.quantity;
      const purchaseLogs = await DB.query(
        singleLineString`
          select uuid, remaining_quantity from uniform_purchase_log
          where size_id = $1 and school_id = $2 and remaining_quantity > 0 and status = 'active'
          order by mrp desc nulls last, created_at asc
        `,
        [row.sizeId, schoolId]
      );
      for (const log of purchaseLogs) {
        if (toDeduct <= 0) break;
        const deduct = Math.min(toDeduct, parseInt(log.remainingQuantity, 10));
        depletionQueries.push(`update uniform_purchase_log set remaining_quantity = remaining_quantity - $1 where uuid = $2`);
        depletionParams.push([deduct, log.uuid]);
        toDeduct -= deduct;
      }
    }

    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into uniform_sale
      (uuid, school_id, student_id, sale_date, sale_type, set_id, total_mrp, total_discount, total_amount, amount_paid, payment_status, notes, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `);
    params.push([
      saleUuid, schoolId, data.studentId, data.saleDate, data.saleType,
      data.setId || null, totalMrp, totalDiscount, totalAmount,
      data.amountPaid, paymentStatus, data.notes || null, DEFAULTS.STATUS, userId, now,
    ]);

    for (const row of itemRows) {
      queries.push(singleLineString`
        insert into uniform_sale_item
        (uuid, sale_id, school_id, item_id, size_id, quantity, mrp, discount_pct, unit_price, line_total, returned_quantity, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `);
      params.push([
        row.uuid, saleUuid, schoolId, row.itemId, row.sizeId, row.quantity,
        row.mrp, row.discountPct, row.unitPrice, row.lineTotal,
        DEFAULTS.RETURNED_QUANTITY, DEFAULTS.STATUS, userId, now,
      ]);

      // Deduct stock
      queries.push(`update uniform_item_size set current_stock = current_stock - $1 where uuid = $2 and school_id = $3`);
      params.push([row.quantity, row.sizeId, schoolId]);
    }

    // Append remaining_quantity depletion queries
    for (let i = 0; i < depletionQueries.length; i++) {
      queries.push(depletionQueries[i]);
      params.push(depletionParams[i]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getSale(saleUuid, schoolId) as Promise<UniformSaleDetail>;
  }

  public async getSale(id: string, schoolId: string): Promise<UniformSaleDetail | null> {
    const sales = await DB.query(
      singleLineString`
        select us.*, s.name as student_name, s.admission_number as student_admission_no
        from uniform_sale us
        left join student s on us.student_id = s.uuid
        where us.uuid = $1 and us.school_id = $2 and us.status = 'active'
      `,
      [id, schoolId]
    );
    if (sales.length === 0) return null;

    const items = await DB.query(
      singleLineString`
        select si.*, ui.name as item_name, ui.category as item_category, ui.gender as item_gender, uis.size_label
        from uniform_sale_item si
        join uniform_item ui on si.item_id = ui.uuid
        join uniform_item_size uis on si.size_id = uis.uuid
        where si.sale_id = $1 and si.status = 'active'
        order by si.created_at asc
      `,
      [id]
    );

    const returns = await DB.query(
      singleLineString`
        select ur.*, ui.name as item_name, uis.size_label,
          fs.file_name as return_file_name, fs.mime_type as return_mime_type
        from uniform_return ur
        join uniform_sale_item si on ur.sale_item_id = si.uuid
        join uniform_item ui on si.item_id = ui.uuid
        join uniform_item_size uis on si.size_id = uis.uuid
        left join file_storage fs on ur.file_id = fs.uuid
        where ur.sale_id = $1 and ur.school_id = $2 and ur.status = 'active'
        order by ur.created_at asc
      `,
      [id, schoolId]
    );

    const payments = await DB.query(
      singleLineString`
        select * from uniform_sale_payment
        where sale_id = $1 and school_id = $2 and status = 'active'
        order by payment_date asc, created_at asc
      `,
      [id, schoolId]
    );

    return {
      ...this.parseSaleNumericFields(sales[0]),
      items: items.map((r: any) => this.parseSaleItemNumericFields(r)),
      returns: returns.map((r: any) => this.parseReturnNumericFields(r)),
      payments: payments.map((r: any) => this.parsePaymentNumericFields(r)),
    };
  }

  public async listSales(schoolId: string, filters: {
    studentId?: string;
    paymentStatus?: string;
    saleType?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<UniformSale[]> {
    let query = singleLineString`
      select us.*, s.name as student_name, s.admission_number as student_admission_no
      from uniform_sale us
      left join student s on us.student_id = s.uuid
      where us.school_id = $1 and us.status = 'active'
    `;
    const queryParams: any[] = [schoolId];
    let p = 2;

    if (filters.studentId) { query += ` and us.student_id = $${p++}`; queryParams.push(filters.studentId); }
    if (filters.paymentStatus) { query += ` and us.payment_status = ANY($${p++})`; queryParams.push(filters.paymentStatus.split(',')); }
    if (filters.saleType) { query += ` and us.sale_type = $${p++}`; queryParams.push(filters.saleType); }
    if (filters.startDate) { query += ` and us.sale_date >= $${p++}`; queryParams.push(filters.startDate); }
    if (filters.endDate) { query += ` and us.sale_date <= $${p++}`; queryParams.push(filters.endDate); }
    if (filters.search?.trim()) { query += ` and lower(s.name) like lower($${p++})`; queryParams.push(`%${filters.search.trim()}%`); }

    query += ` order by us.sale_date desc, us.created_at desc`;
    const rows = await DB.query(query, queryParams);
    return rows.map((r: any) => this.parseSaleNumericFields(r));
  }

  public async addPayment(saleId: string, amount: number, paymentDate: string, notes: string | undefined, schoolId: string, userId: string): Promise<UniformSale> {
    const paymentUuid = generateShortUuid(12);
    const now = new Date();

    await DB.queriesInTransaction([
      singleLineString`
        insert into uniform_sale_payment (uuid, sale_id, school_id, amount, payment_date, notes, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, 'active', $7, $8)
      `,
      singleLineString`
        update uniform_sale
        set amount_paid = amount_paid + $1,
            payment_status = case
              when amount_paid + $1 >= total_amount then 'paid'
              when amount_paid + $1 > 0 then 'partial'
              else 'due'
            end,
            updatedby_userid = $2,
            updated_at = $3
        where uuid = $4 and school_id = $5
      `,
    ], [
      [paymentUuid, saleId, schoolId, amount, paymentDate, notes || null, userId, now],
      [amount, userId, now, saleId, schoolId],
    ]);

    const results = await DB.query(`select * from uniform_sale where uuid = $1 and school_id = $2`, [saleId, schoolId]);
    return this.parseSaleNumericFields(results[0]);
  }

  public async createReturn(saleId: string, data: CreateReturnRequest, schoolId: string, userId: string): Promise<UniformReturn> {
    const returnUuid = generateShortUuid(12);
    const now = new Date();

    // Get the sale item
    const saleItems = await DB.query(
      `select * from uniform_sale_item where uuid = $1 and sale_id = $2 and school_id = $3 and status = 'active'`,
      [data.saleItemId, saleId, schoolId]
    );
    if (saleItems.length === 0) throw new Error('Sale item not found');
    const saleItem = saleItems[0];

    const availableForReturn = saleItem.quantity - (saleItem.returnedQuantity || 0);
    if (data.quantity > availableForReturn) {
      throw new Error(`Cannot return ${data.quantity} — only ${availableForReturn} available`);
    }

    const refundAmount = parseFloat((parseFloat(saleItem.unitPrice) * data.quantity).toFixed(2));

    const mrpDeduction = parseFloat((parseFloat(saleItem.mrp) * data.quantity).toFixed(2));
    const discountDeduction = parseFloat(((parseFloat(saleItem.mrp) - parseFloat(saleItem.unitPrice)) * data.quantity).toFixed(2));

    // Upload evidence if provided
    let fileId: string | null = null;
    if (data.evidence) {
      const uploaded = await fileStorageService.upload({
        fileName: data.evidence.fileName,
        mimeType: data.evidence.mimeType,
        base64Data: data.evidence.base64Data,
        entityType: 'uniform_return',
        entityId: returnUuid,
        schoolId,
        userId,
      });
      fileId = uploaded.uuid;
    }

    await DB.queriesInTransaction([
      // Insert return record
      singleLineString`
        insert into uniform_return
        (uuid, school_id, sale_id, sale_item_id, return_date, quantity, refund_amount, reason, file_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      // Update returned_quantity on sale item
      `update uniform_sale_item set returned_quantity = returned_quantity + $1 where uuid = $2`,
      // Restore stock
      `update uniform_item_size set current_stock = current_stock + $1 where uuid = $2 and school_id = $3`,
      // Update sale totals and recalculate payment status
      singleLineString`
        update uniform_sale
        set total_amount   = total_amount - $1,
            total_mrp      = total_mrp - $2,
            total_discount = total_discount - $3,
            amount_paid    = greatest(0, amount_paid - $1),
            payment_status = case
              when greatest(0, amount_paid - $1) >= total_amount - $1 then 'paid'
              when greatest(0, amount_paid - $1) > 0 then 'partial'
              else 'due'
            end,
            updatedby_userid = $4,
            updated_at = $5
        where uuid = $6 and school_id = $7
      `,
    ], [
      [returnUuid, schoolId, saleId, data.saleItemId, data.returnDate, data.quantity, refundAmount, data.reason, fileId, DEFAULTS.STATUS, userId, now],
      [data.quantity, data.saleItemId],
      [data.quantity, saleItem.sizeId, schoolId],
      [refundAmount, mrpDeduction, discountDeduction, userId, now, saleId, schoolId],
    ]);

    const returns = await DB.query(`select * from uniform_return where uuid = $1`, [returnUuid]);
    return this.parseReturnNumericFields(returns[0]);
  }

  public async getReturnEvidence(returnId: string, schoolId: string) {
    const rows = await DB.query(
      `select file_id from uniform_return where uuid = $1 and school_id = $2 and status = 'active'`,
      [returnId, schoolId]
    );
    if (rows.length === 0 || !rows[0].fileId) return null;
    return fileStorageService.getWithData(rows[0].fileId, schoolId);
  }

  private parseSaleNumericFields(sale: any): UniformSale {
    return {
      ...sale,
      totalMrp: sale.totalMrp != null ? parseFloat(sale.totalMrp) : null,
      totalDiscount: sale.totalDiscount != null ? parseFloat(sale.totalDiscount) : null,
      totalAmount: sale.totalAmount != null ? parseFloat(sale.totalAmount) : null,
      amountPaid: sale.amountPaid != null ? parseFloat(sale.amountPaid) : null,
    };
  }

  private parseSaleItemNumericFields(item: any): any {
    return {
      ...item,
      mrp: item.mrp != null ? parseFloat(item.mrp) : null,
      discountPct: item.discountPct != null ? parseFloat(item.discountPct) : null,
      unitPrice: item.unitPrice != null ? parseFloat(item.unitPrice) : null,
      lineTotal: item.lineTotal != null ? parseFloat(item.lineTotal) : null,
      returnedQuantity: item.returnedQuantity != null ? parseInt(item.returnedQuantity, 10) : 0,
    };
  }

  private parsePaymentNumericFields(r: any): UniformSalePayment {
    return {
      ...r,
      amount: r.amount != null ? parseFloat(r.amount) : null,
    };
  }

  private parseReturnNumericFields(r: any): UniformReturn {
    return {
      ...r,
      refundAmount: r.refundAmount != null ? parseFloat(r.refundAmount) : null,
    };
  }
}

export const uniformSaleService = new UniformSaleService();
