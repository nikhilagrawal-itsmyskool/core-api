import { DB, singleLineString } from '../../shared/lib/db';
import { istToday } from '../../shared/util/datetime';
import { dueBuckets } from './fees-util';
import { getSignedPhotoUrl } from '../../shared/lib/file-storage';

// A deliberately tiny, read-only surface for the "Collection Desk" — a simplified fees view for
// a non-technical manager. Just: dues-now per academic year (+ grand total), today's collection
// split into Fees vs Transport, and the list of students who owe in a chosen year (by class).
// "Due now" mirrors the Dues report / overview: remaining on charges due by end of THIS month.
class FeesManagerService {
  // Landing: per-year due-now totals (newest first), the grand total, and today's collection/receipts
  // broken into Fees vs Transport.
  public async summary(schoolId: string): Promise<any> {
    const eom = dueBuckets().endOfMonth;
    const today = istToday();

    const years: any[] = await DB.query(
      singleLineString`
        select ay.uuid as academic_year_id, ay.name,
          coalesce(d.due_now, 0) as due_now, coalesce(d.students, 0) as students
        from academic_year ay
        left join (
          select ch.academic_year_id,
            sum(greatest(0, ch.debit - coalesce(pd.paid, 0))) as due_now,
            count(distinct case when greatest(0, ch.debit - coalesce(pd.paid, 0)) > 0.5 then ch.student_id end) as students
          from (
            select e.uuid, e.academic_year_id, e.student_id, e.debit, fc.due_date
            from student_ledger_entry e
            left join fee_cycle fc on fc.uuid = e.cycle_id and fc.status = 'active'
            where e.school_id = $1 and e.kind = 'charge' and e.status = 'active' and e.student_id is not null
          ) ch
          left join (
            select settles_entry_id, sum(credit) as paid from student_ledger_entry
            where school_id = $1 and status = 'active' and settles_entry_id is not null group by settles_entry_id
          ) pd on pd.settles_entry_id = ch.uuid
          where ch.due_date is null or ch.due_date <= $2
          group by ch.academic_year_id
        ) d on d.academic_year_id = ay.uuid
        where ay.school_id = $1
        order by ay.name desc`,
      [schoolId, eom]
    );

    // Today's collection + receipt count, split: transport vs everything-else (fees/adhoc).
    const todayRows: any[] = await DB.query(
      singleLineString`
        select case when type = 'transport' then 'transport' else 'fees' end as grp,
          count(*) as receipts, coalesce(sum(total_paid), 0) as amount
        from fee_receipt
        where school_id = $1 and receipt_date = $2 and status = 'active'
        group by grp`,
      [schoolId, today]
    );
    const pick = (g: string) => todayRows.find((r) => r.grp === g) || { receipts: 0, amount: 0 };
    const fees = pick('fees'), transport = pick('transport');

    const grandTotalDueNow = years.reduce((s, y) => s + Number(y.dueNow || 0), 0);
    return {
      years: years.map((y) => ({ academicYearId: y.academicYearId, name: y.name, dueNow: Number(y.dueNow || 0), students: Number(y.students || 0) })),
      grandTotalDueNow,
      today: {
        date: today,
        fees: { amount: Number(fees.amount || 0), receipts: Number(fees.receipts || 0) },
        transport: { amount: Number(transport.amount || 0), receipts: Number(transport.receipts || 0) },
        total: Number(fees.amount || 0) + Number(transport.amount || 0),
        receipts: Number(fees.receipts || 0) + Number(transport.receipts || 0),
      },
    };
  }

  // A single day's collection: split totals (Fees vs Transport) + the receipt list behind them.
  // Powers "tap a number to see the receipts" and the any-day stepper. `date` defaults to today (IST).
  public async dayCollection(schoolId: string, date?: string): Promise<any> {
    const day = date || istToday();
    const receipts: any[] = await DB.query(
      singleLineString`
        select receipt_no, legacy_receipt_no, payer_name, payer_class_snapshot, payment_mode,
          coalesce(total_paid, 0) as total_paid, type,
          to_char((created_at at time zone 'Asia/Kolkata'), 'HH24:MI') as time
        from fee_receipt
        where school_id = $1 and receipt_date = $2 and status = 'active'
        order by created_at desc`,
      [schoolId, day]
    );
    const rows = receipts.map((r) => ({
      receiptNo: r.receiptNo || r.legacyReceiptNo || '—',
      payerName: r.payerName || '—',
      className: r.payerClassSnapshot || '—',
      paymentMode: r.paymentMode || null,
      amount: Number(r.totalPaid || 0),
      type: r.type === 'transport' ? 'transport' : 'fees',
      time: r.time || '',
    }));
    const sum = (t: string) => rows.filter((r) => r.type === t).reduce((a, r) => a + r.amount, 0);
    const cnt = (t: string) => rows.filter((r) => r.type === t).length;
    return {
      date: day,
      fees: { amount: sum('fees'), receipts: cnt('fees') },
      transport: { amount: sum('transport'), receipts: cnt('transport') },
      total: rows.reduce((a, r) => a + r.amount, 0),
      receipts: rows.length,
      rows,
    };
  }

  // Students who owe (due-now > 0) in a given year, with class, father's name and photo — for the
  // by-class drill-down. Ordered by class then name; grade ordering is refined on the client.
  public async dueStudents(schoolId: string, academicYearId: string): Promise<any[]> {
    const eom = dueBuckets().endOfMonth;
    const rows: any[] = await DB.query(
      singleLineString`
        select st.student_id, st.due_now, s.name, cls.name as class_name, s.admission_number,
          (select g.name from student_guardian g
             where g.student_id = st.student_id and g.school_id = $1 and g.relation = 'father' and g.status = 'active'
             order by g.is_primary_contact desc nulls last limit 1) as father_name,
          (select fs.storage_key from file_storage fs
             where fs.entity_type = 'student' and fs.entity_id = st.student_id and fs.school_id = $1
               and (fs.variant = 'original' or fs.variant is null) and fs.storage_key is not null
             order by fs.created_at desc limit 1) as photo_key
        from (
          select ch.student_id, sum(greatest(0, ch.debit - coalesce(pd.paid, 0))) as due_now
          from (
            select e.uuid, e.student_id, e.debit, fc.due_date
            from student_ledger_entry e
            left join fee_cycle fc on fc.uuid = e.cycle_id and fc.status = 'active'
            where e.school_id = $1 and e.academic_year_id = $2 and e.kind = 'charge' and e.status = 'active' and e.student_id is not null
          ) ch
          left join (
            select settles_entry_id, sum(credit) as paid from student_ledger_entry
            where school_id = $1 and academic_year_id = $2 and status = 'active' and settles_entry_id is not null group by settles_entry_id
          ) pd on pd.settles_entry_id = ch.uuid
          where ch.due_date is null or ch.due_date <= $3
          group by ch.student_id
          having sum(greatest(0, ch.debit - coalesce(pd.paid, 0))) > 0.5
        ) st
        join student s on s.uuid = st.student_id and s.school_id = $1
        left join student_class sc on sc.student_id = st.student_id and sc.school_id = $1 and sc.academic_year_id = $2
        left join class cls on cls.uuid = sc.class_id
        order by cls.name nulls last, s.name`,
      [schoolId, academicYearId, eom]
    );

    // Presign photo URLs (local sign op; safe to do per row).
    return Promise.all(rows.map(async (r) => ({
      studentId: r.studentId,
      name: r.name,
      className: r.className || '—',
      admissionNumber: r.admissionNumber || null,
      fatherName: r.fatherName || null,
      dueNow: Number(r.dueNow || 0),
      photoUrl: r.photoKey ? await getSignedPhotoUrl(r.photoKey, 3600) : null,
    })));
  }
}

export const feesManagerService = new FeesManagerService();
