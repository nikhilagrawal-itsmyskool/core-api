import { DB, singleLineString } from '../../shared/lib/db';

class FeesReportService {
  // Per-cashier daily collection summary for a date (default today).
  public async dailyCollection(schoolId: string, q: any) {
    const date = q?.date || new Date().toISOString().slice(0, 10);
    const params: any[] = [schoolId, date]; let where = `school_id = $1 and receipt_date = $2 and status = 'active'`;
    if (q?.collectedBy) { params.push(q.collectedBy); where += ` and collected_by_userid = $${params.length}`; }

    const byCashier = await DB.query(
      singleLineString`select collected_by_userid, count(*) as receipts, coalesce(sum(total_paid),0) as total from fee_receipt where ${where} group by collected_by_userid order by total desc`,
      params
    );
    const byMode = await DB.query(
      singleLineString`select payment_mode, count(*) as receipts, coalesce(sum(total_paid),0) as total from fee_receipt where ${where} group by payment_mode order by total desc`,
      params
    );
    const totalRow = await DB.query(
      singleLineString`select count(*) as receipts, coalesce(sum(total_paid),0) as total from fee_receipt where ${where}`,
      params
    );
    return { date, byCashier, byMode, total: totalRow[0] };
  }
}

export const feesReportService = new FeesReportService();
