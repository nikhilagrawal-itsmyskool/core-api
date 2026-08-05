import { DB, singleLineString } from '../../shared/lib/db';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
import { CONCESSION_TYPES, CONCESSION_VALUE_TYPES } from './fees-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

export interface CreateConcessionRequest {
  academicYearId: string;
  name: string;
  type: string;
  valueType: string;
  value: number;
  feeHeadId?: string;
}

export interface UpdateConcessionRequest {
  name?: string;
  type?: string;
  valueType?: string;
  value?: number;
  feeHeadId?: string;
}

export interface AddConcessionStudentsRequest {
  studentIds: string[];
  cycleScope?: string;
  remarks?: string;
  attachmentFileId?: string;
}

class ConcessionService {
  public async create(data: CreateConcessionRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required'); }
    if (!data.name || !data.name.trim()) { throw new BadRequestResult(ErrorCode.InvalidInput, 'name is required'); }
    if (!data.type || !CONCESSION_TYPES.includes(data.type as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `type must be one of: ${CONCESSION_TYPES.join(', ')}`);
    }
    if (!data.valueType || !CONCESSION_VALUE_TYPES.includes(data.valueType as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `valueType must be one of: ${CONCESSION_VALUE_TYPES.join(', ')}`);
    }
    if (data.value === undefined || data.value === null) { throw new BadRequestResult(ErrorCode.InvalidInput, 'value is required'); }

    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into fee_concession
      (uuid, school_id, academic_year_id, name, type, value_type, value, fee_head_id, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $10)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.academicYearId,
      data.name,
      data.type,
      data.valueType,
      data.value,
      data.feeHeadId ?? null,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return results[0];
  }

  public async update(id: string, data: UpdateConcessionRequest, schoolId: string, userId: string): Promise<any | null> {
    if (data.type !== undefined && !CONCESSION_TYPES.includes(data.type as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `type must be one of: ${CONCESSION_TYPES.join(', ')}`);
    }
    if (data.valueType !== undefined && !CONCESSION_VALUE_TYPES.includes(data.valueType as any)) {
      throw new BadRequestResult(ErrorCode.InvalidInput, `valueType must be one of: ${CONCESSION_VALUE_TYPES.join(', ')}`);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.name !== undefined) { updates.push(`name = $${i++}`); params.push(data.name); }
    if (data.type !== undefined) { updates.push(`type = $${i++}`); params.push(data.type); }
    if (data.valueType !== undefined) { updates.push(`value_type = $${i++}`); params.push(data.valueType); }
    if (data.value !== undefined) { updates.push(`value = $${i++}`); params.push(data.value); }
    if (data.feeHeadId !== undefined) { updates.push(`fee_head_id = $${i++}`); params.push(data.feeHeadId); }

    if (updates.length === 0) {
      return this.getById(id, schoolId);
    }

    updates.push(`updatedby_userid = $${i++}`); params.push(userId);
    updates.push(`updated_at = $${i++}`); params.push(new Date());
    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update fee_concession set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;

    const results = await DB.query(query, params);
    // value/type/head change alters the discount → reconcile everyone on this concession
    if (results.length > 0 && (data.value !== undefined || data.valueType !== undefined || data.feeHeadId !== undefined)) {
      await this.syncFor(schoolId, id, null, userId);
    }
    return results.length > 0 ? results[0] : null;
  }

  public async remove(id: string, schoolId: string, userId: string): Promise<any | null> {
    // capture roster before the concession is deleted, then reconcile (expected discount → 0)
    const roster = await DB.query(singleLineString`select student_id from fee_concession_student where concession_id = $1 and school_id = $2 and status = 'active'`, [id, schoolId]);
    const query = singleLineString`
      update fee_concession set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    if (results.length > 0) {
      const ay = results[0].academicYearId;
      const ids = roster.map((r: any) => r.studentId);
      if (ay && ids.length) { await this.syncConcessions(schoolId, ay, ids, userId); }
    }
    return results.length > 0 ? results[0] : null;
  }

  public async getById(id: string, schoolId: string): Promise<any | null> {
    const results = await DB.query(
      singleLineString`select * from fee_concession where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async list(schoolId: string, academicYearId?: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId];
    // student_count joined in so the UI doesn't fetch every roster just to count it.
    let sql = singleLineString`
      select c.*, (select count(*) from fee_concession_student cs where cs.concession_id = c.uuid and cs.status = 'active') as student_count
      from fee_concession c where c.school_id = $1`;
    if (!includeDeleted) { sql += ` and c.status = 'active'`; }
    if (academicYearId) { params.push(academicYearId); sql += ` and c.academic_year_id = $${params.length}`; }
    sql += ` order by c.name`;
    return DB.query(sql, params);
  }

  // ---- Concession roster (fee_concession_student) ----

  // Roster with the student's name + this-year class (joined server-side so the UI doesn't
  // fire one lookup per student). class_name is null when the student isn't enrolled in the
  // concession's academic year (e.g. left the school) — the UI can flag/hide those.
  public async listStudents(concessionId: string, schoolId: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId, concessionId];
    let sql = singleLineString`
      select cs.*, s.name as student_name, s.admission_number, s.status as student_status,
             c.name as class_name, (sc.uuid is not null) as enrolled_this_year
      from fee_concession_student cs
      join fee_concession fc on fc.uuid = cs.concession_id
      left join student s on s.uuid = cs.student_id and s.school_id = cs.school_id
      left join student_class sc on sc.student_id = cs.student_id and sc.academic_year_id = fc.academic_year_id and sc.school_id = cs.school_id
      left join class c on c.uuid = sc.class_id
      where cs.school_id = $1 and cs.concession_id = $2`;
    if (!includeDeleted) { sql += ` and cs.status = 'active'`; }
    sql += ` order by s.name nulls last`;
    return DB.query(sql, params);
  }

  // Students attached to >1 active concession this year — audit for stacked discounts.
  // sameHead = two+ concessions on the SAME fee head (a real double-discount to review);
  // different-head combos (e.g. CAUTION waiver + a tuition discount) are normal.
  public async multiConcession(schoolId: string, academicYearId?: string): Promise<any[]> {
    if (!academicYearId) return [];
    const rows: any[] = await DB.query(
      singleLineString`
        select cs.student_id, s.name as student_name, s.admission_number, c.name as class_name,
               count(*) as concession_count, count(distinct fc.fee_head_id) as head_count,
               json_agg(json_build_object('name', fc.name, 'feeHeadId', fc.fee_head_id, 'valueType', fc.value_type, 'value', fc.value) order by fc.name) as concessions
        from fee_concession_student cs
        join fee_concession fc on fc.uuid = cs.concession_id and fc.status = 'active' and fc.academic_year_id = $2
        left join student s on s.uuid = cs.student_id and s.school_id = cs.school_id
        left join student_class sc on sc.student_id = cs.student_id and sc.academic_year_id = $2 and sc.school_id = cs.school_id
        left join class c on c.uuid = sc.class_id
        where cs.school_id = $1 and cs.status = 'active'
        group by cs.student_id, s.name, s.admission_number, c.name
        having count(*) > 1
        order by (count(*) - count(distinct fc.fee_head_id)) desc, count(*) desc, s.name`,
      [schoolId, academicYearId]
    );
    return rows.map((r) => ({ ...r, sameHead: Number(r.concessionCount) > Number(r.headCount) }));
  }

  public async addStudents(concessionId: string, data: AddConcessionStudentsRequest, schoolId: string, userId: string): Promise<any> {
    if (!Array.isArray(data.studentIds) || data.studentIds.length === 0) {
      throw new BadRequestResult(ErrorCode.InvalidInput, 'studentIds is required');
    }

    const existing = await DB.query(
      singleLineString`
        select student_id from fee_concession_student
        where school_id = $1 and concession_id = $2 and student_id = any($3) and status = 'active'
      `,
      [schoolId, concessionId, data.studentIds]
    );
    const existingSet = new Set<string>(existing.map((r: any) => r.studentId));

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();

    for (const studentId of data.studentIds) {
      if (existingSet.has(studentId)) { continue; }
      queries.push(singleLineString`
        insert into fee_concession_student
        (uuid, school_id, concession_id, student_id, cycle_scope, remarks, attachment_file_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
      `);
      params.push([
        generateShortUuid(12),
        schoolId,
        concessionId,
        studentId,
        data.cycleScope ?? null,
        data.remarks ?? null,
        data.attachmentFileId ?? null,
        userId,
        now,
      ]);
    }

    if (queries.length > 0) {
      await DB.queriesInTransaction(queries, params);
    }
    // reflect the newly-eligible discount on the students' existing charges
    await this.syncFor(schoolId, concessionId, data.studentIds, userId);
    return { added: queries.length };
  }

  public async removeStudent(concessionId: string, studentId: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_concession_student set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where school_id = $3 and concession_id = $4 and student_id = $5 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), schoolId, concessionId, studentId]);
    if (results.length > 0) { await this.syncFor(schoolId, concessionId, [studentId], userId); }
    return results.length > 0 ? results[0] : null;
  }

  // Resolve a concession's academic year + the given (or all active roster) students, then reconcile.
  private async syncFor(schoolId: string, concessionId: string, studentIds: string[] | null, userId: string) {
    const c = await DB.query(singleLineString`select academic_year_id from fee_concession where uuid = $1 and school_id = $2`, [concessionId, schoolId]);
    const ay = c[0]?.academicYearId;
    if (!ay) return;
    let ids = studentIds;
    if (!ids) {
      const roster = await DB.query(singleLineString`select student_id from fee_concession_student where concession_id = $1 and school_id = $2 and status = 'active'`, [concessionId, schoolId]);
      ids = roster.map((r: any) => r.studentId);
    }
    if (ids && ids.length) { await this.syncConcessions(schoolId, ay, ids, userId); }
  }

  // Reconcile concession credits on a student's existing charges to what their active concessions
  // imply. charge-run only applies concessions when it first creates a charge, so a late add/remove/
  // edit of a concession must be reflected here: void stale concession credits, post fresh ones.
  // Idempotent — a no-op when already in sync. settles_entry_id links each credit to its charge.
  public async syncConcessions(schoolId: string, academicYearId: string, studentIds: string[], userId: string) {
    const empty = { students: 0, chargesAdjusted: 0, concessionAdded: 0, concessionRemoved: 0 };
    if (!academicYearId || !studentIds || !studentIds.length) return empty;
    const n = (v: any) => (v == null ? 0 : Number(v));
    const round2 = (x: number) => Math.round(x * 100) / 100;

    const charges: any[] = await DB.query(
      singleLineString`select uuid, student_id, fee_head_id, cycle_id, category, head_label, cycle_label, debit
        from student_ledger_entry where school_id = $1 and academic_year_id = $2 and kind = 'charge' and status = 'active' and student_id = any($3)`,
      [schoolId, academicYearId, studentIds]
    );
    if (!charges.length) return empty;

    const concRows: any[] = await DB.query(
      singleLineString`select uuid, settles_entry_id, credit from student_ledger_entry
        where school_id = $1 and academic_year_id = $2 and kind = 'concession' and status = 'active' and settles_entry_id is not null and student_id = any($3)`,
      [schoolId, academicYearId, studentIds]
    );
    const byCharge: Record<string, { sum: number; ids: string[] }> = {};
    concRows.forEach((r) => { const e = (byCharge[r.settlesEntryId] ||= { sum: 0, ids: [] }); e.sum += n(r.credit); e.ids.push(r.uuid); });

    const defs: any[] = await DB.query(
      singleLineString`select cs.student_id, c.fee_head_id, c.value_type, c.value, c.name
        from fee_concession_student cs join fee_concession c on c.uuid = cs.concession_id and c.status = 'active'
        where cs.school_id = $1 and c.academic_year_id = $2 and cs.status = 'active' and cs.student_id = any($3)`,
      [schoolId, academicYearId, studentIds]
    );
    const byStuHead: Record<string, Record<string, any>> = {};
    defs.forEach((c) => ((byStuHead[c.studentId] ||= {})[c.feeHeadId] = c));

    const queries: string[] = []; const params: any[][] = []; const now = new Date();
    const today = now.toISOString().slice(0, 10);
    let chargesAdjusted = 0, added = 0, removed = 0; const touched = new Set<string>();

    for (const ch of charges) {
      if (!ch.feeHeadId) continue; // SAFETY: never reconcile a charge whose head isn't resolved (would spuriously strip)
      const conc = byStuHead[ch.studentId]?.[ch.feeHeadId];
      const expected = conc ? round2(conc.valueType === 'percent' ? (n(ch.debit) * n(conc.value)) / 100 : Math.min(n(conc.value), n(ch.debit))) : 0;
      const cur = round2(byCharge[ch.uuid]?.sum || 0);
      if (Math.abs(expected - cur) < 0.005) continue;
      for (const eid of (byCharge[ch.uuid]?.ids || [])) {
        queries.push(singleLineString`update student_ledger_entry set status = 'cancelled', updatedby_userid = $1, updated_at = $2 where uuid = $3`);
        params.push([userId, now, eid]);
      }
      if (cur > 0) removed = round2(removed + cur);
      if (expected > 0.005) {
        queries.push(singleLineString`
          insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, allocation, status, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'concession',$11,$12,'fees','resynced','active',$13,$14)`);
        params.push([generateShortUuid(12), schoolId, ch.studentId, academicYearId, today, ch.category, ch.feeHeadId, ch.cycleId, conc.name, ch.cycleLabel, expected, ch.uuid, userId, now]);
        added = round2(added + expected);
      }
      chargesAdjusted++; touched.add(ch.studentId);
    }
    if (queries.length) await DB.queriesInTransaction(queries, params);
    return { students: touched.size, chargesAdjusted, concessionAdded: added, concessionRemoved: removed };
  }
}

export const concessionService = new ConcessionService();
