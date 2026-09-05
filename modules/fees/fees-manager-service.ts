import { DB, singleLineString } from '../../shared/lib/db';
import { istToday } from '../../shared/util/datetime';
import { dueBuckets } from './fees-util';
import { getSignedPhotoUrl } from '../../shared/lib/file-storage';

// A deliberately tiny, read-only surface for the "Collection Desk" — a simplified fees view for
// a non-technical manager. Just: dues-now per academic year (+ grand total), today's collection
// split into Fees vs Transport, and the list of students who owe in a chosen year (by class).
// "Due now" mirrors the Dues report / overview: remaining on charges due by end of THIS month.
class FeesManagerService {
  // Collapse the many payment_mode codes into the three buckets the manager reasons about:
  // cash (he physically counts it), cheque (cheque / DD / draft — a paper instrument), and
  // everything-else-is-online (neft/card/ecs/bank-deposit/online/rte).
  private modeBucket(m?: string): 'cash' | 'cheque' | 'online' {
    const x = String(m || '').toLowerCase();
    if (x === 'cash') return 'cash';
    if (x === 'cheque' || x === 'draft' || x === 'dd') return 'cheque';
    return 'online';
  }

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

    // Today's collection broken down two ways off the same rows: by kind (Fees vs Transport) and by
    // payment mode (Cash / Cheque / Online) — the manager counts the cash tally against the drawer.
    const todayRows: any[] = await DB.query(
      singleLineString`
        select case when type = 'transport' then 'transport' else 'fees' end as grp,
          payment_mode, count(*) as receipts, coalesce(sum(total_paid), 0) as amount
        from fee_receipt
        where school_id = $1 and receipt_date = $2 and status = 'active'
        group by grp, payment_mode`,
      [schoolId, today]
    );
    const roll = (pred: (r: any) => boolean) =>
      todayRows.filter(pred).reduce(
        (a, r) => ({ amount: a.amount + Number(r.amount || 0), receipts: a.receipts + Number(r.receipts || 0) }),
        { amount: 0, receipts: 0 }
      );
    const fees = roll((r) => r.grp === 'fees'), transport = roll((r) => r.grp === 'transport');
    const modes = {
      cash: roll((r) => this.modeBucket(r.paymentMode) === 'cash'),
      cheque: roll((r) => this.modeBucket(r.paymentMode) === 'cheque'),
      online: roll((r) => this.modeBucket(r.paymentMode) === 'online'),
    };

    const grandTotalDueNow = years.reduce((s, y) => s + Number(y.dueNow || 0), 0);
    return {
      years: years.map((y) => ({ academicYearId: y.academicYearId, name: y.name, dueNow: Number(y.dueNow || 0), students: Number(y.students || 0) })),
      grandTotalDueNow,
      today: {
        date: today,
        fees, transport, modes,
        total: fees.amount + transport.amount,
        receipts: fees.receipts + transport.receipts,
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
    const mode = (b: string) => {
      const hit = rows.filter((r) => this.modeBucket(r.paymentMode) === b);
      return { amount: hit.reduce((a, r) => a + r.amount, 0), receipts: hit.length };
    };
    return {
      date: day,
      fees: { amount: sum('fees'), receipts: cnt('fees') },
      transport: { amount: sum('transport'), receipts: cnt('transport') },
      modes: { cash: mode('cash'), cheque: mode('cheque'), online: mode('online') },
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
        select st.student_id, st.due_now, s.name, s.gender, cls.name as class_name, s.admission_number,
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
      gender: r.gender || null,
      className: r.className || '—',
      admissionNumber: r.admissionNumber || null,
      fatherName: r.fatherName || null,
      dueNow: Number(r.dueNow || 0),
      photoUrl: r.photoKey ? await getSignedPhotoUrl(r.photoKey, 3600) : null,
    })));
  }

  // Name/admission search for the "find a student" box. Simplified from student omniSearch:
  // name-or-admission match, most-recent enrollment for class, father name + photo. Read-only.
  public async searchStudents(schoolId: string, q?: string, limit = 15): Promise<any[]> {
    const term = (q || '').trim();
    if (term.length < 1) return [];
    const like = `%${term}%`, prefix = `${term}%`;
    const lim = Math.min(Math.max(Number(limit) || 15, 1), 30);
    const rows: any[] = await DB.query(
      singleLineString`
        select s.uuid as student_id, s.name, s.gender, s.admission_number,
          cl.class_name, gf.father_name, ph.photo_key
        from student s
        left join lateral (
          select c.name as class_name from student_class sc
          left join class c on c.uuid = sc.class_id
          left join academic_year ay on ay.uuid = sc.academic_year_id
          where sc.student_id = s.uuid and sc.school_id = s.school_id and sc.status <> 'deleted'
          order by ay.start_date desc nulls last limit 1
        ) cl on true
        left join lateral (
          select g.name as father_name from student_guardian g
          where g.student_id = s.uuid and g.school_id = s.school_id and g.relation = 'father' and g.status = 'active'
          order by g.is_primary_contact desc nulls last limit 1
        ) gf on true
        left join lateral (
          select fs.storage_key as photo_key from file_storage fs
          where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id
            and (fs.variant = 'original' or fs.variant is null) and fs.storage_key is not null
          order by fs.created_at desc limit 1
        ) ph on true
        where s.school_id = $1 and s.status <> 'deleted' and (s.name ilike $2 or s.admission_number ilike $2)
        order by (s.admission_number ilike $3) desc, (s.name ilike $3) desc, s.name
        limit $4`,
      [schoolId, like, prefix, lim]
    );
    return Promise.all(rows.map(async (r) => ({
      studentId: r.studentId,
      name: r.name,
      gender: r.gender || null,
      className: r.className || '—',
      admissionNumber: r.admissionNumber || null,
      fatherName: r.fatherName || null,
      photoUrl: r.photoKey ? await getSignedPhotoUrl(r.photoKey, 3600) : null,
    })));
  }

  // One student's dues, year by year: Due now (charges due by end of this month, matches the desk)
  // and Full year (all remaining charges, incl. not-yet-due cycles). Read-only.
  public async studentDues(schoolId: string, studentId: string): Promise<any> {
    const eom = dueBuckets().endOfMonth;
    const [header] = await DB.query(
      singleLineString`
        select s.uuid as student_id, s.name, s.gender, s.admission_number,
          (select c.name from student_class sc left join class c on c.uuid = sc.class_id
             left join academic_year ay on ay.uuid = sc.academic_year_id
             where sc.student_id = s.uuid and sc.school_id = s.school_id and sc.status <> 'deleted'
             order by ay.start_date desc nulls last limit 1) as class_name,
          (select g.name from student_guardian g
             where g.student_id = s.uuid and g.school_id = s.school_id and g.relation = 'father' and g.status = 'active'
             order by g.is_primary_contact desc nulls last limit 1) as father_name,
          (select fs.storage_key from file_storage fs
             where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id
               and (fs.variant = 'original' or fs.variant is null) and fs.storage_key is not null
             order by fs.created_at desc limit 1) as photo_key
        from student s where s.uuid = $2 and s.school_id = $1`,
      [schoolId, studentId]
    );

    const years: any[] = await DB.query(
      singleLineString`
        select ch.academic_year_id, ay.name as year_name,
          coalesce(sum(greatest(0, ch.debit - coalesce(pd.paid, 0))) filter (where ch.due_date is null or ch.due_date <= $3), 0) as due_now,
          coalesce(sum(greatest(0, ch.debit - coalesce(pd.paid, 0))), 0) as full_year
        from (
          select e.uuid, e.academic_year_id, e.debit, fc.due_date
          from student_ledger_entry e
          left join fee_cycle fc on fc.uuid = e.cycle_id and fc.status = 'active'
          where e.school_id = $1 and e.student_id = $2 and e.kind = 'charge' and e.status = 'active'
        ) ch
        left join (
          select settles_entry_id, sum(credit) as paid from student_ledger_entry
          where school_id = $1 and student_id = $2 and status = 'active' and settles_entry_id is not null group by settles_entry_id
        ) pd on pd.settles_entry_id = ch.uuid
        left join academic_year ay on ay.uuid = ch.academic_year_id
        group by ch.academic_year_id, ay.name
        having sum(greatest(0, ch.debit - coalesce(pd.paid, 0))) > 0.5
        order by ay.name desc`,
      [schoolId, studentId, eom]
    );

    const yearRows = years.map((y) => ({
      academicYearId: y.academicYearId,
      name: y.yearName,
      dueNow: Number(y.dueNow || 0),
      fullYear: Number(y.fullYear || 0),
    }));
    return {
      student: header ? {
        studentId: header.studentId,
        name: header.name,
        gender: header.gender || null,
        className: header.className || '—',
        admissionNumber: header.admissionNumber || null,
        fatherName: header.fatherName || null,
        photoUrl: header.photoKey ? await getSignedPhotoUrl(header.photoKey, 3600) : null,
      } : null,
      years: yearRows,
      owesNow: yearRows.reduce((a, y) => a + y.dueNow, 0),
      totalRemaining: yearRows.reduce((a, y) => a + y.fullYear, 0),
    };
  }
}

export const feesManagerService = new FeesManagerService();
