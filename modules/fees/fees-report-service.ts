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

  // Dashboard headline aggregates for a school (optionally scoped to an academic year).
  public async overview(schoolId: string, q: any) {
    const ay = q?.academicYearId || null;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';

    const recWhere = (extra: string, params: any[]) => {
      let w = `school_id = $1 and status = 'active' ${extra}`;
      if (ay) { params.push(ay); w += ` and academic_year_id = $${params.length}`; }
      return w;
    };

    const todayParams: any[] = [schoolId, today];
    const collectedTodayRow = await DB.query(
      singleLineString`select coalesce(sum(total_paid),0) as total from fee_receipt where ${recWhere('and receipt_date = $2', todayParams)}`,
      todayParams
    );
    const monthParams: any[] = [schoolId, monthStart, today];
    const collectedMonthRow = await DB.query(
      singleLineString`select coalesce(sum(total_paid),0) as total from fee_receipt where ${recWhere('and receipt_date >= $2 and receipt_date <= $3', monthParams)}`,
      monthParams
    );

    // per-student net (debit - credit) floored → outstanding vs advance, scoped to the year
    const ledgerParams: any[] = [schoolId];
    let ledgerWhere = `school_id = $1 and status = 'active' and student_id is not null`;
    if (ay) { ledgerParams.push(ay); ledgerWhere += ` and academic_year_id = $${ledgerParams.length}`; }
    const balRow = await DB.query(
      singleLineString`
        select
          coalesce(sum(case when net > 0 then net else 0 end), 0) as outstanding,
          count(*) filter (where net > 0) as dues_students,
          coalesce(sum(case when net < 0 then -net else 0 end), 0) as advance,
          count(*) filter (where net < 0) as advance_students
        from (
          select student_id, coalesce(sum(debit),0) - coalesce(sum(credit),0) as net
          from student_ledger_entry where ${ledgerWhere} group by student_id
        ) t`,
      ledgerParams
    );

    const concParams: any[] = [schoolId];
    let concWhere = `school_id = $1 and status = 'active' and kind = 'concession'`;
    if (ay) { concParams.push(ay); concWhere += ` and academic_year_id = $${concParams.length}`; }
    const concRow = await DB.query(
      singleLineString`select coalesce(sum(credit),0) as total from student_ledger_entry where ${concWhere}`,
      concParams
    );

    const bal = balRow[0] || {};
    return {
      academicYearId: ay,
      collectedToday: Number(collectedTodayRow[0]?.total || 0),
      collectedMonth: Number(collectedMonthRow[0]?.total || 0),
      outstanding: Number(bal.outstanding || 0),
      duesStudents: Number(bal.duesStudents || 0),
      advance: Number(bal.advance || 0),
      advanceStudents: Number(bal.advanceStudents || 0),
      concessionYtd: Number(concRow[0]?.total || 0),
    };
  }
}

export const feesReportService = new FeesReportService();
