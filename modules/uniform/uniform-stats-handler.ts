import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { DB, singleLineString } from '../../shared/lib/db';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { uniformItemService } from './uniform-item-service';
import { istToday } from '../../shared/util/datetime';

export const getStats = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
  _context.callbackWaitsForEmptyEventLoop = false;
  try {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await uniformItemService.getSchoolIdByCode(schoolCode);
    if (!schoolId) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback); return; }

    const today = istToday();
    const monthStart = today.slice(0, 7) + '-01';

    const [
      itemsRow, stockRow, salesTodayRow, salesMonthRow, pendingRow,
      totalCostRow, discountedStockRow, totalCollectionRow, hotItemsRows,
    ] = await Promise.all([
      DB.query(`select count(*)::int as count from uniform_item where school_id = $1 and status = 'active'`, [schoolId]),
      DB.query(singleLineString`
        select count(*)::int as size_count, coalesce(sum(uis.current_stock * uis.mrp), 0)::numeric as stock_value
        from uniform_item_size uis
        join uniform_item ui on uis.item_id = ui.uuid
        where uis.school_id = $1 and uis.status = 'active' and ui.status = 'active' and uis.mrp is not null
      `, [schoolId]),
      DB.query(`select count(*)::int as count from uniform_sale where school_id = $1 and sale_date = $2 and status = 'active'`, [schoolId, today]),
      DB.query(`select count(*)::int as count from uniform_sale where school_id = $1 and sale_date >= $2 and status = 'active'`, [schoolId, monthStart]),
      DB.query(`select coalesce(sum(total_amount - amount_paid), 0)::numeric as total from uniform_sale where school_id = $1 and payment_status in ('partial', 'due') and status = 'active'`, [schoolId]),
      DB.query(`select coalesce(sum(total_amount), 0)::numeric as total from uniform_purchase_batch where school_id = $1 and status = 'active'`, [schoolId]),
      DB.query(singleLineString`
        select coalesce(sum(uis.current_stock * uis.mrp * (1 - coalesce(uis.student_discount_pct, 0) / 100)), 0)::numeric as discounted_value
        from uniform_item_size uis
        join uniform_item ui on uis.item_id = ui.uuid
        where uis.school_id = $1 and uis.status = 'active' and ui.status = 'active' and uis.mrp is not null
      `, [schoolId]),
      DB.query(`select coalesce(sum(amount_paid), 0)::numeric as total from uniform_sale where school_id = $1 and status = 'active'`, [schoolId]),
      DB.query(singleLineString`
        select ui.uuid as item_id, ui.name as item_name,
          to_char(us.sale_date, 'YYYY-MM') as month,
          sum(usi.quantity)::int as quantity_sold
        from uniform_sale_item usi
        join uniform_item ui on usi.item_id = ui.uuid
        join uniform_sale us on usi.sale_id = us.uuid
        where us.school_id = $1 and us.status = 'active' and usi.status = 'active'
          and us.sale_date >= date_trunc('month', current_date) - interval '5 months'
        group by ui.uuid, ui.name, to_char(us.sale_date, 'YYYY-MM')
        order by ui.uuid, month
      `, [schoolId]),
    ]);

    // Build hot selling items: pick top 5 by total qty, reshape into chart series
    const totals: Record<string, { name: string; total: number }> = {};
    for (const row of hotItemsRows) {
      if (!totals[row.itemId]) totals[row.itemId] = { name: row.itemName, total: 0 };
      totals[row.itemId].total += row.quantitySold;
    }
    const top5Ids = Object.entries(totals)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 5)
      .map(([id]) => id);

    // Build full 6-month axis
    const months: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today);
      d.setMonth(d.getMonth() - i);
      months.push(d.toISOString().slice(0, 7));
    }

    const series = top5Ids.map(itemId => {
      const rows = hotItemsRows.filter((r: any) => r.itemId === itemId);
      const byMonth: Record<string, number> = {};
      for (const r of rows) byMonth[r.month] = r.quantitySold;
      return {
        name: totals[itemId].name,
        data: months.map(m => byMonth[m] || 0),
      };
    });

    ResponseBuilder.ok({
      totalItems: itemsRow[0]?.count || 0,
      totalSizesInStock: stockRow[0]?.sizeCount || 0,
      totalStockValue: parseFloat(stockRow[0]?.stockValue ?? 0),
      totalCost: parseFloat(totalCostRow[0]?.total ?? 0),
      discountedStockValue: parseFloat(discountedStockRow[0]?.discountedValue ?? 0),
      totalCollection: parseFloat(totalCollectionRow[0]?.total ?? 0),
      pendingCollection: parseFloat(pendingRow[0]?.total ?? 0),
      salesToday: salesTodayRow[0]?.count || 0,
      salesThisMonth: salesMonthRow[0]?.count || 0,
      hotSellingItems: { months, series },
    }, callback);
  } catch (err: any) {
    ResponseBuilder.handleError(err, callback);
  }
};
