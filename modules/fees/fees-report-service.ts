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

    // "due now" = remaining on charges whose cycle due date has passed (+ charges with no
    // cycle/due date). Migrated charges carry cycle_label (not cycle_id), so join fee_cycle by name.
    let dueNow = 0;
    if (ay) {
      const today = now.toISOString().slice(0, 10);
      const dueRow = await DB.query(
        singleLineString`
          select coalesce(sum(greatest(0, ch.debit - coalesce(pd.paid, 0))), 0) as due_now
          from (
            select e.uuid, e.debit, fc.due_date
            from student_ledger_entry e
            left join fee_cycle fc on fc.school_id = e.school_id and fc.academic_year_id = e.academic_year_id and lower(fc.name) = lower(e.cycle_label) and fc.status = 'active'
            where e.school_id = $1 and e.academic_year_id = $2 and e.kind = 'charge' and e.status = 'active'
          ) ch
          left join (
            select settles_entry_id, sum(credit) as paid from student_ledger_entry
            where school_id = $1 and academic_year_id = $2 and status = 'active' and settles_entry_id is not null group by settles_entry_id
          ) pd on pd.settles_entry_id = ch.uuid
          where ch.due_date is null or ch.due_date <= $3`,
        [schoolId, ay, today]
      );
      dueNow = Number(dueRow[0]?.dueNow || 0);
    }

    const bal = balRow[0] || {};
    return {
      academicYearId: ay,
      collectedToday: Number(collectedTodayRow[0]?.total || 0),
      collectedMonth: Number(collectedMonthRow[0]?.total || 0),
      outstanding: Number(bal.outstanding || 0),
      dueNow,
      duesStudents: Number(bal.duesStudents || 0),
      advance: Number(bal.advance || 0),
      advanceStudents: Number(bal.advanceStudents || 0),
      concessionYtd: Number(concRow[0]?.total || 0),
    };
  }

  // Students enrolled this year with NO fee charges yet — the candidates for charge generation
  // (new admissions, or anyone the charge-run hasn't been run for). Fast: one not-exists query.
  public async ungeneratedStudents(schoolId: string, q: any) {
    const ay = q?.academicYearId;
    if (!ay) return [];
    return DB.query(
      singleLineString`
        select s.uuid as student_id, s.name, s.admission_number, c.name as class_name
        from student_class sc
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id
        left join class c on c.uuid = sc.class_id
        where sc.school_id = $1 and sc.academic_year_id = $2
          and not exists (
            select 1 from student_ledger_entry le
            where le.school_id = sc.school_id and le.student_id = sc.student_id
              and le.academic_year_id = $2 and le.kind = 'charge' and le.status = 'active'
          )
        order by c.name nulls last, s.name`,
      [schoolId, ay]
    );
  }
}

export const feesReportService = new FeesReportService();
