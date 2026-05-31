import { DB, singleLineString } from '../../shared/lib/db';
import { ShopStats } from './shop-interfaces';

class ShopStatsService {
  public async getStats(schoolId: string): Promise<ShopStats> {
    const [itemStats, saleStats, collectionStats] = await Promise.all([
      DB.query(
        singleLineString`
          select
            count(*) filter (where status = 'active') as total_items
          from shop_item
          where school_id = $1
        `,
        [schoolId]
      ),
      DB.query(
        singleLineString`
          select
            coalesce(sum(total_amount) filter (where sale_date = current_date), 0) as sales_today,
            coalesce(sum(total_amount) filter (
              where date_trunc('month', sale_date) = date_trunc('month', current_date)
            ), 0) as sales_this_month
          from shop_sale
          where school_id = $1 and status = 'active'
        `,
        [schoolId]
      ),
      DB.query(
        singleLineString`
          select
            coalesce(sum(total_amount), 0) as total_collection,
            coalesce(sum(total_amount - amount_paid) filter (
              where payment_status in ('partial', 'due')
            ), 0) as pending_collection
          from shop_sale
          where school_id = $1 and status = 'active'
        `,
        [schoolId]
      ),
    ]);

    // Stock value: sum of (currentStock × last mrp × (1 - studentDiscountPct/100)) per item
    const stockValueRows = await DB.query(
      singleLineString`
        select
          coalesce(sum(
            si.current_stock * coalesce(
              lp.mrp * (1 - coalesce(lp.student_discount_pct, 0) / 100),
              0
            )
          ), 0) as total_stock_value
        from shop_item si
        left join lateral (
          select pl.mrp, pl.student_discount_pct
          from shop_purchase_log pl
          join shop_purchase_batch b on pl.batch_id = b.uuid
          where pl.item_id = si.uuid and pl.status = 'active'
          order by b.purchase_date desc, pl.created_at desc
          limit 1
        ) lp on true
        where si.school_id = $1 and si.status = 'active'
      `,
      [schoolId]
    );

    return {
      totalItems: parseInt(itemStats[0].totalItems, 10),
      totalStockValue: parseFloat(stockValueRows[0].totalStockValue),
      totalCollection: parseFloat(collectionStats[0].totalCollection),
      pendingCollection: parseFloat(collectionStats[0].pendingCollection),
      salesToday: parseFloat(saleStats[0].salesToday),
      salesThisMonth: parseFloat(saleStats[0].salesThisMonth),
    };
  }
}

export const shopStatsService = new ShopStatsService();
