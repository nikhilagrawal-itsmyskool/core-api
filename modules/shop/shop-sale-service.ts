import { DB, singleLineString } from '../../shared/lib/db';
import {
  ShopSale,
  ShopSaleDetail,
  CreateSaleRequest,
} from './shop-interfaces';
import { DEFAULTS } from './shop-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class ShopSaleService {
  public async createSale(data: CreateSaleRequest, schoolId: string, userId: string): Promise<ShopSaleDetail> {
    const saleUuid = generateShortUuid(12);
    const now = new Date();

    // Fetch current pricing for each item (most recent purchase log)
    const itemPricing = new Map<string, { mrp: number; studentDiscountPct: number | null }>();
    for (const item of data.items) {
      const rows = await DB.query(
        singleLineString`
          select pl.mrp, pl.student_discount_pct
          from shop_purchase_log pl
          join shop_purchase_batch b on pl.batch_id = b.uuid
          where pl.item_id = $1 and pl.status = 'active'
          order by b.purchase_date desc, pl.created_at desc
          limit 1
        `,
        [item.itemId]
      );
      itemPricing.set(item.itemId, {
        mrp: rows.length > 0 && rows[0].mrp != null ? parseFloat(rows[0].mrp) : 0,
        studentDiscountPct: rows.length > 0 && rows[0].studentDiscountPct != null
          ? parseFloat(rows[0].studentDiscountPct) : null,
      });
    }

    let totalMrp = 0;
    let totalDiscount = 0;
    let totalAmount = 0;

    const lineItems: Array<{
      item: (typeof data.items)[0];
      logUuid: string;
      mrp: number;
      discountPct: number | null;
      unitPrice: number;
      lineTotal: number;
    }> = [];

    for (const item of data.items) {
      const pricing = itemPricing.get(item.itemId)!;
      const mrp = pricing.mrp;
      const discountPct = pricing.studentDiscountPct;
      const unitPrice = discountPct != null
        ? parseFloat((mrp * (1 - discountPct / 100)).toFixed(2))
        : mrp;
      const lineTotal = parseFloat((unitPrice * item.quantity).toFixed(2));

      totalMrp += mrp * item.quantity;
      totalDiscount += (mrp - unitPrice) * item.quantity;
      totalAmount += lineTotal;

      lineItems.push({ item, logUuid: generateShortUuid(12), mrp, discountPct, unitPrice, lineTotal });
    }

    totalMrp = parseFloat(totalMrp.toFixed(2));
    totalDiscount = parseFloat(totalDiscount.toFixed(2));
    totalAmount = parseFloat(totalAmount.toFixed(2));

    const paymentStatus = data.amountPaid >= totalAmount ? 'paid'
      : data.amountPaid > 0 ? 'partial' : 'due';

    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into shop_sale
      (uuid, school_id, student_id, sale_date, set_id, academic_session,
       total_mrp, total_discount, total_amount, amount_paid, payment_status,
       notes, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `);
    params.push([
      saleUuid, schoolId, data.studentId, data.saleDate,
      data.setId || null, data.academicSession || null,
      totalMrp, totalDiscount, totalAmount, data.amountPaid,
      paymentStatus, data.notes || null, DEFAULTS.STATUS, userId, now,
    ]);

    for (const line of lineItems) {
      queries.push(singleLineString`
        insert into shop_sale_item
        (uuid, sale_id, school_id, item_id, quantity, mrp, discount_pct,
         unit_price, line_total, returned_quantity, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `);
      params.push([
        line.logUuid, saleUuid, schoolId, line.item.itemId,
        line.item.quantity, line.mrp, line.discountPct,
        line.unitPrice, line.lineTotal, DEFAULTS.RETURNED_QUANTITY,
        DEFAULTS.STATUS, userId, now,
      ]);

      // Decrement stock
      queries.push(`update shop_item set current_stock = current_stock - $1 where uuid = $2 and school_id = $3`);
      params.push([line.item.quantity, line.item.itemId, schoolId]);

      // Decrement remaining_quantity FIFO from oldest purchase log
      queries.push(singleLineString`
        update shop_purchase_log
        set remaining_quantity = greatest(0, remaining_quantity - $1)
        where uuid = (
          select pl.uuid from shop_purchase_log pl
          join shop_purchase_batch b on pl.batch_id = b.uuid
          where pl.item_id = $2 and pl.status = 'active' and pl.remaining_quantity > 0
          order by b.purchase_date asc, pl.created_at asc
          limit 1
        )
      `);
      params.push([line.item.quantity, line.item.itemId]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getSale(saleUuid, schoolId) as Promise<ShopSaleDetail>;
  }

  public async getSale(id: string, schoolId: string): Promise<ShopSaleDetail | null> {
    const sales = await DB.query(
      singleLineString`
        select s.*, st.name as student_name, st.admission_no as student_admission_no
        from shop_sale s
        left join student st on s.student_id = st.uuid
        where s.uuid = $1 and s.school_id = $2 and s.status = 'active'
      `,
      [id, schoolId]
    );
    if (sales.length === 0) return null;

    const items = await DB.query(
      singleLineString`
        select si.*, i.name as item_name, i.type as item_type, i.class_no as item_class_no
        from shop_sale_item si
        join shop_item i on si.item_id = i.uuid
        where si.sale_id = $1 and si.status = 'active'
        order by si.created_at asc
      `,
      [id]
    );

    return {
      ...this.parseSaleNumericFields(sales[0]),
      items: items.map((r: any) => this.parseSaleItemNumericFields(r)),
    };
  }

  public async listSales(schoolId: string, filters: {
    academicSession?: string;
    studentId?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<ShopSale[]> {
    let query = singleLineString`
      select s.*, st.name as student_name, st.admission_no as student_admission_no
      from shop_sale s
      left join student st on s.student_id = st.uuid
      where s.school_id = $1 and s.status = 'active'
    `;
    const queryParams: any[] = [schoolId];
    let p = 2;

    if (filters.academicSession) { query += ` and s.academic_session = $${p++}`; queryParams.push(filters.academicSession); }
    if (filters.studentId) { query += ` and s.student_id = $${p++}`; queryParams.push(filters.studentId); }
    if (filters.startDate) { query += ` and s.sale_date >= $${p++}`; queryParams.push(filters.startDate); }
    if (filters.endDate) { query += ` and s.sale_date <= $${p++}`; queryParams.push(filters.endDate); }

    query += ` order by s.sale_date desc, s.created_at desc`;
    const rows = await DB.query(query, queryParams);
    return rows.map((r: any) => this.parseSaleNumericFields(r));
  }

  private parseSaleNumericFields(sale: any): ShopSale {
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
}

export const shopSaleService = new ShopSaleService();
