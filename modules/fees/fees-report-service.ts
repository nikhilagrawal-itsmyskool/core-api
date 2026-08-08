import { DB, singleLineString } from '../../shared/lib/db';
import { BadRequestResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { dueBuckets } from './fees-util';
import { fileStorageService, getSignedPhotoUrl } from '../../shared/lib/file-storage';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

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
      const eom = dueBuckets().endOfMonth; // "due now" = due by end of THIS month (matches the Dues report)
      const dueRow = await DB.query(
        singleLineString`
          select coalesce(sum(greatest(0, ch.debit - coalesce(pd.paid, 0))), 0) as due_now
          from (
            select e.uuid, e.debit, fc.due_date
            from student_ledger_entry e
            left join fee_cycle fc on fc.uuid = e.cycle_id and fc.status = 'active'
            where e.school_id = $1 and e.academic_year_id = $2 and e.kind = 'charge' and e.status = 'active'
          ) ch
          left join (
            select settles_entry_id, sum(credit) as paid from student_ledger_entry
            where school_id = $1 and academic_year_id = $2 and status = 'active' and settles_entry_id is not null group by settles_entry_id
          ) pd on pd.settles_entry_id = ch.uuid
          where ch.due_date is null or ch.due_date <= $3`,
        [schoolId, ay, eom]
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

  // Class-wise dues report (collection console): per-student due-now / this-quarter / full-year,
  // plus prior-year dues (following the old-admission link), father's mobile and follow-up status.
  // mode 'due' (default) lists students with something due now; 'all' lists any outstanding.
  public async dues(schoolId: string, q: any) {
    const ay = q?.academicYearId;
    const bkt = dueBuckets();
    if (!ay) return { rows: [], totals: { dueNow: 0, thisQuarter: 0, fullYear: 0, prevYears: 0, students: 0 }, quarterLabel: bkt.label };
    const params: any[] = [schoolId, ay, bkt.endOfMonth, bkt.quarterEnd];
    let filter = '';
    if (q?.classId) { params.push(q.classId); filter += ` and sc.class_id = $${params.length}`; }
    if (q?.studentId) { params.push(q.studentId); filter += ` and ps.student_id = $${params.length}`; }
    const having = q?.mode === 'all' ? 'ps.full_year > 0.5' : 'ps.due_now > 0.5';

    const rows: any[] = await DB.query(
      singleLineString`
        with charges as (
          select e.student_id, e.uuid, e.debit,
            (fc.due_date is null or fc.due_date <= $3) as due_now,
            (fc.due_date is not null and fc.due_date > $3 and fc.due_date <= $4) as this_quarter
          from student_ledger_entry e
          left join fee_cycle fc on fc.uuid = e.cycle_id and fc.status = 'active'
          where e.school_id = $1 and e.academic_year_id = $2 and e.kind = 'charge' and e.status = 'active'
        ),
        paid as (
          select settles_entry_id, sum(credit) as c from student_ledger_entry
          where school_id = $1 and academic_year_id = $2 and status = 'active' and settles_entry_id is not null
          group by settles_entry_id
        ),
        per_charge as (
          select c.student_id, greatest(0, c.debit - coalesce(p.c, 0)) as remaining, c.due_now, c.this_quarter
          from charges c left join paid p on p.settles_entry_id = c.uuid
        ),
        ps as (
          select student_id,
            coalesce(sum(remaining), 0) as full_year,
            coalesce(sum(remaining) filter (where due_now), 0) as due_now,
            coalesce(sum(remaining) filter (where this_quarter), 0) as this_quarter
          from per_charge group by student_id
        )
        select ps.student_id, ps.due_now, ps.this_quarter, (ps.due_now + ps.this_quarter) as due_quarter, ps.full_year,
               s.name, s.admission_number, c.name as class_name,
               (select g.mobile from student_guardian g where g.school_id = $1 and g.student_id = ps.student_id
                  and g.relation = 'father' and g.status = 'active' order by g.is_primary_contact desc nulls last limit 1) as father_mobile,
               fu.status as followup_status, fu.note as followup_note, fu.promised_date as followup_promised,
               fu.created_at as followup_at, fu.cnt as followup_count
        from ps
        join student s on s.uuid = ps.student_id and s.school_id = $1
        left join student_class sc on sc.student_id = ps.student_id and sc.academic_year_id = $2 and sc.school_id = $1
        left join class c on c.uuid = sc.class_id
        left join lateral (
          select fe.status, fe.note, fe.promised_date, fe.created_at,
            (select count(*) from fee_followup_entry a where a.school_id = $1 and a.student_id = ps.student_id and a.academic_year_id = $2) as cnt
          from fee_followup_entry fe
          where fe.school_id = $1 and fe.student_id = ps.student_id and fe.academic_year_id = $2
          order by fe.created_at desc limit 1
        ) fu on true
        where ${having} ${filter}
        order by c.name nulls last, s.name`,
      params
    );

    // prior-year outstanding per shown student — includes the linked old-admission record's years
    const ids = rows.map((r) => r.studentId);
    const prevById: Record<string, number> = {};
    if (ids.length) {
      const pr: any[] = await DB.query(
        singleLineString`
          with targets as (
            select s.uuid as ref_id, s.uuid as owner_id from student s where s.school_id = $1 and s.uuid = any($2)
            union
            select prev.uuid as ref_id, cur.uuid as owner_id
            from student cur
            join student prev on prev.school_id = cur.school_id and lower(prev.admission_number) = lower(cur.old_admission_number)
            where cur.school_id = $1 and cur.uuid = any($2) and cur.old_admission_number is not null
          ),
          net as (
            select le.student_id, le.academic_year_id, sum(coalesce(le.debit,0)) - sum(coalesce(le.credit,0)) as net
            from student_ledger_entry le
            join academic_year ay_le on ay_le.uuid = le.academic_year_id
            where le.school_id = $1 and le.status = 'active'
              and le.student_id in (select ref_id from targets)
              and (substring(ay_le.name from '^[0-9]{4}'))::int
                  < (select (substring(name from '^[0-9]{4}'))::int from academic_year where uuid = $3)
            group by le.student_id, le.academic_year_id
          )
          select t.owner_id as student_id, coalesce(sum(greatest(0, n.net)), 0) as prev_dues
          from targets t left join net n on n.student_id = t.ref_id
          group by t.owner_id`,
        [schoolId, ids, ay]
      );
      pr.forEach((r) => (prevById[r.studentId] = Number(r.prevDues || 0)));
    }
    rows.forEach((r) => (r.prevYears = prevById[r.studentId] || 0));

    const totals = rows.reduce(
      (t: any, r: any) => ({
        dueNow: t.dueNow + Number(r.dueNow || 0),
        dueQuarter: t.dueQuarter + Number(r.dueQuarter || 0),
        fullYear: t.fullYear + Number(r.fullYear || 0),
        prevYears: t.prevYears + Number(r.prevYears || 0),
      }),
      { dueNow: 0, dueQuarter: 0, fullYear: 0, prevYears: 0 }
    );
    return {
      rows, totals: { ...totals, students: rows.length },
      quarterLabel: bkt.label, monthEndLabel: bkt.monthEndLabel, quarterEndLabel: bkt.quarterEndLabel, yearEndLabel: bkt.yearEndLabel,
    };
  }

  // Add a follow-up timeline entry (note + status + optional attachments). Many per student/year.
  public async setFollowup(schoolId: string, body: any, userId: string) {
    if (!body?.studentId || !body?.academicYearId) throw new BadRequestResult(ErrorCode.InvalidInput, 'studentId and academicYearId are required');
    const entryId = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`insert into fee_followup_entry (uuid, school_id, student_id, academic_year_id, status, note, promised_date, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [entryId, schoolId, body.studentId, body.academicYearId, body.status || null, body.note || null, body.promisedDate || null, userId, now]
    );
    for (const a of Array.isArray(body.attachments) ? body.attachments : []) {
      if (a?.base64Data && a?.fileName) {
        await fileStorageService.upload({ fileName: a.fileName, mimeType: a.mimeType || 'application/octet-stream', base64Data: a.base64Data, entityType: 'fee_followup', entityId: entryId, schoolId, userId });
      }
    }
    return { ok: true, entryId };
  }

  // Follow-up timeline for a student (newest first), each entry with its attachments (presigned URLs).
  public async getFollowup(schoolId: string, q: any) {
    if (!q?.studentId || !q?.academicYearId) return { entries: [] };
    const entries: any[] = await DB.query(
      singleLineString`select uuid, status, note, promised_date, createdby_userid, created_at from fee_followup_entry
        where school_id = $1 and student_id = $2 and academic_year_id = $3 order by created_at desc`,
      [schoolId, q.studentId, q.academicYearId]
    );
    for (const e of entries) {
      const files: any[] = await DB.query(
        singleLineString`select uuid, file_name, mime_type, storage_key from file_storage where school_id = $1 and entity_type = 'fee_followup' and entity_id = $2 order by created_at`,
        [schoolId, e.uuid]
      );
      e.attachments = await Promise.all(files.map(async (f) => ({ uuid: f.uuid, fileName: f.fileName, mimeType: f.mimeType, url: await getSignedPhotoUrl(f.storageKey) })));
    }
    return { entries };
  }
}

export const feesReportService = new FeesReportService();
