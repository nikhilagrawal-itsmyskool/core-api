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
  effectiveFrom?: string; // apply only to cycles due on/after this date (null = whole year)
  effectiveFromCycle?: string; // cycle-bounded start (by sort_order); null = first cycle
  effectiveToCycle?: string;   // cycle-bounded end (inclusive); null = ongoing
  remarks?: string;
  attachmentFileId?: string;
}

class ConcessionService {
  // ---- Audit trail (fee_concession_audit) ----
  // Every concession mutation logs an immutable event with before/after JSON. auditSql/auditParams
  // build one insert so it can be appended to an existing DB.queriesInTransaction batch (atomic with
  // the mutation); writeAudit runs it standalone for the single-statement paths.
  private auditSql(): string {
    return singleLineString`insert into fee_concession_audit
      (uuid, school_id, academic_year_id, entity, action, scheme_id, student_id, assignment_id, before, after, change_reason, actor_userid, actor_name, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`;
  }
  private auditParams(a: any): any[] {
    return [
      generateShortUuid(12), a.schoolId, a.academicYearId ?? null, a.entity, a.action,
      a.schemeId ?? null, a.studentId ?? null, a.assignmentId ?? null,
      a.before == null ? null : JSON.stringify(a.before),
      a.after == null ? null : JSON.stringify(a.after),
      a.changeReason ?? null, a.actorUserid ?? null, a.actorName ?? null, a.createdAt ?? new Date(),
    ];
  }
  private async writeAudit(a: any): Promise<void> {
    await DB.query(this.auditSql(), this.auditParams(a));
  }
  private async actorName(schoolId: string, userId: string): Promise<string | null> {
    if (!userId) return null;
    const r = await DB.query(singleLineString`select display_name from employee_login where uuid = $1 and school_id = $2`, [userId, schoolId]);
    return r.length > 0 ? (r[0].displayName ?? null) : null;
  }

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
    await this.writeAudit({
      schoolId, academicYearId: data.academicYearId, entity: 'scheme', action: 'scheme_created',
      schemeId: uuid,
      after: { name: data.name, type: data.type, valueType: data.valueType, value: data.value, feeHeadId: data.feeHeadId ?? null },
      actorUserid: userId, actorName: await this.actorName(schoolId, userId), createdAt: now,
    });
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

    const before = await this.getById(id, schoolId); // snapshot for the audit before we overwrite

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
    if (results.length > 0) {
      const after = results[0];
      const prev: any = {}; const next: any = {};
      for (const f of ['name', 'type', 'valueType', 'value', 'feeHeadId']) {
        if ((data as any)[f] !== undefined && String(before?.[f] ?? '') !== String(after[f] ?? '')) {
          prev[f] = before?.[f] ?? null; next[f] = after[f] ?? null;
        }
      }
      if (Object.keys(next).length > 0) {
        await this.writeAudit({
          schoolId, academicYearId: after.academicYearId, entity: 'scheme', action: 'scheme_updated',
          schemeId: id, before: prev, after: next,
          actorUserid: userId, actorName: await this.actorName(schoolId, userId),
        });
      }
    }
    // value/type/head change alters the discount → reconcile everyone on this concession
    if (results.length > 0 && (data.value !== undefined || data.valueType !== undefined || data.feeHeadId !== undefined)) {
      await this.syncFor(schoolId, id, null, userId);
    }
    return results.length > 0 ? results[0] : null;
  }

  public async remove(id: string, schoolId: string, userId: string): Promise<any | null> {
    // capture roster + scheme before the concession is deleted, then reconcile (expected discount → 0)
    const roster = await DB.query(singleLineString`select student_id from fee_concession_student where concession_id = $1 and school_id = $2 and status = 'active'`, [id, schoolId]);
    const before = await this.getById(id, schoolId);
    const query = singleLineString`
      update fee_concession set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    if (results.length > 0) {
      const ay = results[0].academicYearId;
      const ids = roster.map((r: any) => r.studentId);
      await this.writeAudit({
        schoolId, academicYearId: ay, entity: 'scheme', action: 'scheme_deleted', schemeId: id,
        before: before ? { name: before.name, type: before.type, valueType: before.valueType, value: before.value, feeHeadId: before.feeHeadId } : null,
        after: { affectedStudents: ids.length },
        actorUserid: userId, actorName: await this.actorName(schoolId, userId),
      });
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

    // scheme (for the audit snapshot + academic year) + actor, resolved once
    const scheme = await this.getById(concessionId, schoolId);
    const actorName = await this.actorName(schoolId, userId);

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();
    let added = 0;

    for (const studentId of data.studentIds) {
      if (existingSet.has(studentId)) { continue; }
      const assignmentId = generateShortUuid(12);
      queries.push(singleLineString`
        insert into fee_concession_student
        (uuid, school_id, concession_id, student_id, cycle_scope, effective_from, effective_from_cycle, effective_to_cycle, remarks, attachment_file_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12)
      `);
      params.push([
        assignmentId,
        schoolId,
        concessionId,
        studentId,
        data.cycleScope ?? null,
        data.effectiveFrom ?? null,
        data.effectiveFromCycle ?? null,
        data.effectiveToCycle ?? null,
        data.remarks ?? null,
        data.attachmentFileId ?? null,
        userId,
        now,
      ]);
      queries.push(this.auditSql());
      params.push(this.auditParams({
        schoolId, academicYearId: scheme?.academicYearId, entity: 'assignment', action: 'assignment_added',
        schemeId: concessionId, studentId, assignmentId,
        after: {
          scheme: scheme?.name, valueType: scheme?.valueType, value: scheme?.value,
          cycleScope: data.cycleScope ?? null, effectiveFrom: data.effectiveFrom ?? null,
          effectiveFromCycle: data.effectiveFromCycle ?? null, effectiveToCycle: data.effectiveToCycle ?? null,
        },
        actorUserid: userId, actorName, createdAt: now,
      }));
      added++;
    }

    if (queries.length > 0) {
      await DB.queriesInTransaction(queries, params);
    }
    // reflect the newly-eligible discount on the students' existing charges
    await this.syncFor(schoolId, concessionId, data.studentIds, userId);
    return { added };
  }

  public async removeStudent(concessionId: string, studentId: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_concession_student set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where school_id = $3 and concession_id = $4 and student_id = $5 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), schoolId, concessionId, studentId]);
    if (results.length > 0) {
      const row = results[0];
      const scheme = await this.getById(concessionId, schoolId);
      await this.writeAudit({
        schoolId, academicYearId: scheme?.academicYearId, entity: 'assignment', action: 'assignment_removed',
        schemeId: concessionId, studentId, assignmentId: row.uuid,
        before: {
          scheme: scheme?.name, cycleScope: row.cycleScope, effectiveFrom: row.effectiveFrom,
          effectiveFromCycle: row.effectiveFromCycle, effectiveToCycle: row.effectiveToCycle, remarks: row.remarks,
        },
        actorUserid: userId, actorName: await this.actorName(schoolId, userId),
      });
      await this.syncFor(schoolId, concessionId, [studentId], userId);
    }
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

  // Reconcile concession credits on a student's existing charges to what their active concession
  // assignments imply. charge-run only applies concessions when it first creates a charge, so a late
  // add/remove/edit must be reflected here: void stale credits, post fresh ones. Idempotent — a
  // no-op when already in sync. settles_entry_id links each credit to its charge.
  //
  // Handles: (1) STACKING — a student may hold >1 concession on the same fee head (e.g. tuition
  // 350 + commerce 300); each is reconciled independently keyed by scheme name (head_label), and the
  // combined credit on a charge is capped at the charge amount. (2) effective_from — a concession
  // applies only to cycles due on/after that date (null = whole year). (3) cycle_scope — a comma list
  // of cycle names/ids restricting which cycles it applies to (null = all). Pass opts.dryRun to
  // compute the plan WITHOUT writing (used to prove safety before relying on the engine).
  // opts.assignmentsOverride: reconcile against an in-memory assignment set instead of the DB roster —
  // lets changeConcession PREVIEW the effect of not-yet-written bound changes with the exact same engine.
  // opts.remark: stamped onto the concession lines this run cancels/creates (the change reason trail).
  public async syncConcessions(schoolId: string, academicYearId: string, studentIds: string[], userId: string, opts: { dryRun?: boolean; assignmentsOverride?: any[]; remark?: string } = {}) {
    const empty = { students: 0, chargesAdjusted: 0, concessionAdded: 0, concessionRemoved: 0, plan: [] as any[] };
    if (!academicYearId || !studentIds || !studentIds.length) return empty;
    const n = (v: any) => (v == null ? 0 : Number(v));
    const round2 = (x: number) => Math.round(x * 100) / 100;
    const norm = (s: any) => String(s ?? '').trim().toLowerCase();

    // charges + each cycle's due date (for effective_from gating)
    const charges: any[] = await DB.query(
      singleLineString`select l.uuid, l.student_id, l.fee_head_id, l.cycle_id, l.category, l.head_label, l.cycle_label, l.debit,
          coalesce(fc.due_date, fc.from_date) as cycle_due
        from student_ledger_entry l left join fee_cycle fc on fc.uuid = l.cycle_id and fc.status = 'active'
        where l.school_id = $1 and l.academic_year_id = $2 and l.kind = 'charge' and l.status = 'active' and l.student_id = any($3)`,
      [schoolId, academicYearId, studentIds]
    );
    if (!charges.length) return empty;

    // existing concession credits keyed by charge -> scheme name so stacked schemes reconcile independently
    const concRows: any[] = await DB.query(
      singleLineString`select uuid, settles_entry_id, credit, head_label from student_ledger_entry
        where school_id = $1 and academic_year_id = $2 and kind = 'concession' and status = 'active' and settles_entry_id is not null and student_id = any($3)`,
      [schoolId, academicYearId, studentIds]
    );
    const byChargeScheme: Record<string, Record<string, { sum: number; ids: string[] }>> = {};
    concRows.forEach((r) => {
      const c = (byChargeScheme[r.settlesEntryId] ||= {});
      const e = (c[r.headLabel] ||= { sum: 0, ids: [] });
      e.sum += n(r.credit); e.ids.push(r.uuid);
    });

    // active assignments — possibly MANY per (student, head) for stacking; carry effective_from + cycle_scope
    // + cycle bounds (effective_from_cycle / effective_to_cycle, by fee_cycle.sort_order).
    // assignmentsOverride short-circuits the DB read (used by changeConcession preview).
    const defs: any[] = opts.assignmentsOverride ?? await DB.query(
      singleLineString`select cs.student_id, cs.effective_from, cs.cycle_scope, cs.effective_from_cycle, cs.effective_to_cycle, c.fee_head_id, c.value_type, c.value, c.name
        from fee_concession_student cs join fee_concession c on c.uuid = cs.concession_id and c.status = 'active'
        where cs.school_id = $1 and c.academic_year_id = $2 and cs.status = 'active' and cs.student_id = any($3)`,
      [schoolId, academicYearId, studentIds]
    );
    const byStuHead: Record<string, Record<string, any[]>> = {};
    defs.forEach((d) => { ((byStuHead[d.studentId] ||= {})[d.feeHeadId] ||= []).push(d); });

    // cycle order lookup (by id and by normalized name — migrated charges carry cycle_label, not cycle_id)
    // used to honor effective_from_cycle / effective_to_cycle bounds on each assignment.
    const cyc: any[] = await DB.query(
      singleLineString`select uuid, name, sort_order from fee_cycle where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, academicYearId]
    );
    const ordById: Record<string, number> = {}; const ordByName: Record<string, number> = {};
    cyc.forEach((c, i) => { const o = c.sortOrder == null ? i : Number(c.sortOrder); ordById[c.uuid] = o; ordByName[norm(c.name)] = o; });
    const chargeOrd = (ch: any): number | null => {
      const o = ordById[ch.cycleId]; if (o != null) return o;
      const o2 = ordByName[norm(ch.cycleLabel)]; return o2 == null ? null : o2;
    };

    const queries: string[] = []; const params: any[][] = []; const now = new Date();
    const today = now.toISOString().slice(0, 10);
    let chargesAdjusted = 0, added = 0, removed = 0; const touched = new Set<string>(); const plan: any[] = [];

    for (const ch of charges) {
      if (!ch.feeHeadId) continue; // SAFETY: never reconcile a charge whose head isn't resolved (would spuriously strip)
      const chOrd = chargeOrd(ch);
      const applicable = (byStuHead[ch.studentId]?.[ch.feeHeadId] || []).filter((d) => {
        if (d.effectiveFrom && ch.cycleDue && new Date(ch.cycleDue) < new Date(d.effectiveFrom)) return false;
        if (d.cycleScope) {
          const scope = String(d.cycleScope).split(',').map(norm).filter(Boolean);
          if (scope.length && !scope.includes(norm(ch.cycleLabel)) && !scope.includes(norm(ch.cycleId))) return false;
        }
        // cycle bounds (inclusive, by sort_order). only enforced when the charge's cycle order resolves;
        // an unresolvable cycle is left alone (never spuriously stripped).
        if (chOrd != null) {
          const fromO = d.effectiveFromCycle != null ? ordById[d.effectiveFromCycle] : undefined;
          const toO = d.effectiveToCycle != null ? ordById[d.effectiveToCycle] : undefined;
          if (fromO != null && chOrd < fromO) return false;
          if (toO != null && chOrd > toO) return false;
        }
        return true;
      });
      // desired discount per scheme; combined credit on a charge never exceeds the charge amount
      // (bigger discounts first, then name, for deterministic capping)
      const sorted = [...applicable].sort((a, b) => n(b.value) - n(a.value) || String(a.name).localeCompare(String(b.name)));
      const desired: Record<string, number> = {}; let remaining = n(ch.debit);
      for (const d of sorted) {
        const raw = d.valueType === 'percent' ? (n(ch.debit) * n(d.value)) / 100 : n(d.value);
        const amt = round2(Math.max(0, Math.min(raw, remaining)));
        if (amt <= 0.005) continue;
        desired[d.name] = round2((desired[d.name] || 0) + amt);
        remaining = round2(remaining - amt);
      }
      const cur = byChargeScheme[ch.uuid] || {};
      const schemeNames = new Set<string>([...Object.keys(desired), ...Object.keys(cur)]);
      let chargeTouched = false;
      for (const sName of schemeNames) {
        const want = round2(desired[sName] || 0);
        const have = round2(cur[sName]?.sum || 0);
        if (Math.abs(want - have) < 0.005) continue;
        const remark = opts.remark || null;
        for (const eid of (cur[sName]?.ids || [])) {
          queries.push(singleLineString`update student_ledger_entry set status = 'cancelled', updatedby_userid = $1, updated_at = $2,
            remarks = case when $4::text is null then remarks when remarks is null or remarks = '' then $4 else left(remarks || ' | ' || $4, 512) end
            where uuid = $3`);
          params.push([userId, now, eid, remark]);
        }
        if (have > 0) removed = round2(removed + have);
        if (want > 0.005) {
          queries.push(singleLineString`
            insert into student_ledger_entry (uuid, school_id, student_id, academic_year_id, entry_date, category, fee_head_id, cycle_id, head_label, cycle_label, kind, credit, settles_entry_id, source_module, allocation, remarks, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'concession',$11,$12,'fees','resynced',$15,'active',$13,$14)`);
          params.push([generateShortUuid(12), schoolId, ch.studentId, academicYearId, today, ch.category, ch.feeHeadId, ch.cycleId, sName, ch.cycleLabel, want, ch.uuid, userId, now, remark]);
          added = round2(added + want);
        }
        if (opts.dryRun) plan.push({ studentId: ch.studentId, chargeId: ch.uuid, cycleId: ch.cycleId, cycle: ch.cycleLabel, scheme: sName, from: have, to: want, debit: n(ch.debit) });
        chargeTouched = true;
      }
      if (chargeTouched) { chargesAdjusted++; touched.add(ch.studentId); }
    }
    if (!opts.dryRun && queries.length) await DB.queriesInTransaction(queries, params);
    return { students: touched.size, chargesAdjusted, concessionAdded: added, concessionRemoved: removed, plan };
  }

  // ---- Mid-year concession CHANGE: close a scheme at a cycle, open another (or none) from a cycle ----
  // One scheme-group at a time; retroactive allowed; adjusts paid cycles (remove => becomes due,
  // add => advance). dryRun returns the per-cycle impact preview WITHOUT writing. Reason is mandatory
  // and is stamped onto every ledger line the recompute touches.
  public async changeConcession(schoolId: string, data: any, userId: string) {
    const studentId = data.studentId; const academicYearId = data.academicYearId; const fromCycleId = data.fromCycleId;
    const dryRun = !!data.dryRun;
    const closeIds: string[] = Array.isArray(data.closeConcessionIds) ? data.closeConcessionIds : [];
    const openIds: string[] = Array.isArray(data.openConcessionIds) ? data.openConcessionIds : [];
    if (!studentId || !academicYearId || !fromCycleId) throw new BadRequestResult(ErrorCode.InvalidInput, 'studentId, academicYearId, fromCycleId are required');
    if (!data.reason || !String(data.reason).trim()) throw new BadRequestResult(ErrorCode.InvalidInput, 'reason is required');
    if (!closeIds.length && !openIds.length) throw new BadRequestResult(ErrorCode.InvalidInput, 'nothing to change (pick a scheme to stop and/or one to start)');
    const reasonTxt = String(data.reason).trim().slice(0, 200);

    // ordered cycles + the cycle just before the change point
    const cyc: any[] = await DB.query(singleLineString`select uuid, name, sort_order from fee_cycle where school_id = $1 and academic_year_id = $2 and status = 'active'`, [schoolId, academicYearId]);
    const ordById: Record<string, number> = {};
    const ordered = cyc.map((c: any, i: number) => ({ uuid: c.uuid, name: c.name, ord: c.sortOrder == null ? i : Number(c.sortOrder) })).sort((a, b) => a.ord - b.ord);
    ordered.forEach((c) => { ordById[c.uuid] = c.ord; });
    const fromOrd = ordById[fromCycleId];
    if (fromOrd == null) throw new BadRequestResult(ErrorCode.InvalidInput, 'fromCycleId not found in this year');
    const prev = ordered.filter((c) => c.ord < fromOrd).pop();
    const prevCycleId = prev ? prev.uuid : null;

    // current active assignments (+ concession detail) and the detail of schemes being opened
    const cur: any[] = await DB.query(singleLineString`
      select cs.uuid, cs.concession_id, cs.effective_from, cs.cycle_scope, cs.effective_from_cycle, cs.effective_to_cycle,
             c.fee_head_id, c.value_type, c.value, c.name
      from fee_concession_student cs join fee_concession c on c.uuid = cs.concession_id and c.status = 'active'
      where cs.school_id = $1 and c.academic_year_id = $2 and cs.status = 'active' and cs.student_id = $3`,
      [schoolId, academicYearId, studentId]);
    const openDefs: any[] = openIds.length
      ? await DB.query(singleLineString`select uuid, fee_head_id, value_type, value, name from fee_concession where school_id = $1 and academic_year_id = $2 and status = 'active' and uuid = any($3)`, [schoolId, academicYearId, openIds])
      : [];

    // build the resulting (post-change) assignment set + the DB write plan
    const closeSet = new Set(closeIds);
    const resultingDefs: any[] = []; const updates: any[] = []; const inserts: any[] = [];
    for (const a of cur) {
      if (closeSet.has(a.concessionId)) {
        const aFromOrd = a.effectiveFromCycle != null ? (ordById[a.effectiveFromCycle] ?? -Infinity) : -Infinity;
        if (prevCycleId == null || aFromOrd > (prev ? prev.ord : -Infinity)) {
          updates.push({ uuid: a.uuid, del: true }); // span empties → remove entirely
        } else {
          updates.push({ uuid: a.uuid, toCycle: prevCycleId, del: false });
          resultingDefs.push({ studentId, effectiveFrom: a.effectiveFrom, cycleScope: a.cycleScope, effectiveFromCycle: a.effectiveFromCycle, effectiveToCycle: prevCycleId, feeHeadId: a.feeHeadId, valueType: a.valueType, value: a.value, name: a.name });
        }
      } else {
        resultingDefs.push({ studentId, effectiveFrom: a.effectiveFrom, cycleScope: a.cycleScope, effectiveFromCycle: a.effectiveFromCycle, effectiveToCycle: a.effectiveToCycle, feeHeadId: a.feeHeadId, valueType: a.valueType, value: a.value, name: a.name });
      }
    }
    for (const od of openDefs) {
      inserts.push({ concessionId: od.uuid });
      resultingDefs.push({ studentId, effectiveFrom: null, cycleScope: null, effectiveFromCycle: fromCycleId, effectiveToCycle: null, feeHeadId: od.feeHeadId, valueType: od.valueType, value: od.value, name: od.name });
    }

    const closeNames = cur.filter((a) => closeSet.has(a.concessionId)).map((a) => a.name);
    const fromName = ordered.find((c) => c.uuid === fromCycleId)?.name || 'cycle';
    const transition = `${[...new Set(closeNames)].join('+') || 'none'} → ${openDefs.map((o) => o.name).join('+') || 'none'}`;
    const remark = `[concession-change] ${transition} from ${fromName} · "${reasonTxt}"`;

    // PREVIEW: run the exact reconciliation engine against the in-memory resulting assignments (no writes)
    const sim = await this.syncConcessions(schoolId, academicYearId, [studentId], userId, { dryRun: true, assignmentsOverride: resultingDefs, remark });
    const ordByName: Record<string, number> = {}; ordered.forEach((c) => { ordByName[String(c.name).trim().toLowerCase()] = c.ord; });
    const impact = await this.previewImpact(schoolId, academicYearId, studentId, sim.plan, ordByName);

    if (dryRun) return { dryRun: true, transition, fromCycle: fromName, remark, ...impact };

    // APPLY: write bound changes, then reconcile the ledger with the reason stamped onto each line.
    // Each leg is also logged to fee_concession_audit in the same transaction (change_reason = the
    // mandatory reason; a close+open pair reads as a mid-year switch).
    const curByUuid: Record<string, any> = {}; cur.forEach((a) => { curByUuid[a.uuid] = a; });
    const openById: Record<string, any> = {}; openDefs.forEach((o) => { openById[o.uuid] = o; });
    const actorName = await this.actorName(schoolId, userId);
    const q: string[] = []; const p: any[][] = []; const now = new Date();
    for (const u of updates) {
      const a = curByUuid[u.uuid] || {};
      if (u.del) {
        q.push(singleLineString`update fee_concession_student set status = 'deleted', change_reason = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5 and status = 'active'`); p.push([reasonTxt, userId, now, u.uuid, schoolId]);
        q.push(this.auditSql()); p.push(this.auditParams({ schoolId, academicYearId, entity: 'assignment', action: 'assignment_removed', schemeId: a.concessionId, studentId, assignmentId: u.uuid, before: { scheme: a.name }, after: { fromCycle: fromName }, changeReason: reasonTxt, actorUserid: userId, actorName, createdAt: now }));
      } else {
        q.push(singleLineString`update fee_concession_student set effective_to_cycle = $1, change_reason = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5 and school_id = $6 and status = 'active'`); p.push([u.toCycle, reasonTxt, userId, now, u.uuid, schoolId]);
        q.push(this.auditSql()); p.push(this.auditParams({ schoolId, academicYearId, entity: 'assignment', action: 'assignment_ended', schemeId: a.concessionId, studentId, assignmentId: u.uuid, before: { scheme: a.name }, after: { endedAtCycle: prev ? prev.name : null }, changeReason: reasonTxt, actorUserid: userId, actorName, createdAt: now }));
      }
    }
    for (const ins of inserts) {
      const assignmentId = generateShortUuid(12);
      q.push(singleLineString`insert into fee_concession_student (uuid, school_id, concession_id, student_id, effective_from_cycle, effective_to_cycle, change_reason, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,null,$6,'active',$7,$8)`); p.push([assignmentId, schoolId, ins.concessionId, studentId, fromCycleId, reasonTxt, userId, now]);
      q.push(this.auditSql()); p.push(this.auditParams({ schoolId, academicYearId, entity: 'assignment', action: 'assignment_added', schemeId: ins.concessionId, studentId, assignmentId, after: { scheme: openById[ins.concessionId]?.name, fromCycle: fromName }, changeReason: reasonTxt, actorUserid: userId, actorName, createdAt: now }));
    }
    if (q.length) await DB.queriesInTransaction(q, p);
    const applied = await this.syncConcessions(schoolId, academicYearId, [studentId], userId, { remark });
    return { dryRun: false, transition, fromCycle: fromName, applied, ...impact };
  }

  // Translate a dry-run concession plan into per-cycle impact (using charge debit + payments).
  // dueDelta > 0 = more owed (concession removed); dueDelta < 0 = discount, owes less (concession added);
  // advanceDelta > 0 = a paid cycle became overpaid. Rows are returned in cycle (sort_order) order.
  private async previewImpact(schoolId: string, academicYearId: string, studentId: string, plan: any[], ordByName: Record<string, number> = {}) {
    const n = (v: any) => (v == null ? 0 : Number(v));
    const nrm = (s: any) => String(s ?? '').trim().toLowerCase();
    const deltaByCharge: Record<string, number> = {};
    plan.forEach((pl) => { deltaByCharge[pl.chargeId] = (deltaByCharge[pl.chargeId] || 0) + (n(pl.to) - n(pl.from)); });
    const chargeIds = Object.keys(deltaByCharge);
    if (!chargeIds.length) return { affectedCycles: [], totalDue: 0, totalReduced: 0, totalAdvance: 0, affectedCount: 0, paidAffected: 0 };
    const charges: any[] = await DB.query(singleLineString`select uuid, cycle_label, debit from student_ledger_entry where school_id = $1 and academic_year_id = $2 and student_id = $3 and kind = 'charge' and status = 'active' and uuid = any($4)`, [schoolId, academicYearId, studentId, chargeIds]);
    const credits: any[] = await DB.query(singleLineString`select settles_entry_id, kind, sum(credit) as c from student_ledger_entry where school_id = $1 and academic_year_id = $2 and student_id = $3 and status = 'active' and kind in ('payment','concession','waiver') and settles_entry_id = any($4) group by settles_entry_id, kind`, [schoolId, academicYearId, studentId, chargeIds]);
    const conc: Record<string, number> = {}; const pay: Record<string, number> = {};
    credits.forEach((r) => { if (r.kind === 'payment') pay[r.settlesEntryId] = n(r.c); else conc[r.settlesEntryId] = (conc[r.settlesEntryId] || 0) + n(r.c); });
    let totalDue = 0, totalReduced = 0, totalAdvance = 0, paidAffected = 0; const rows: any[] = [];
    charges.forEach((ch) => {
      const debit = n(ch.debit), curConc = conc[ch.uuid] || 0, paid = pay[ch.uuid] || 0, dConc = deltaByCharge[ch.uuid] || 0;
      const oldOut = debit - curConc - paid, newOut = debit - (curConc + dConc) - paid;
      const dueDelta = Math.round((Math.max(0, newOut) - Math.max(0, oldOut)) * 100) / 100;
      const advDelta = Math.round((Math.max(0, -newOut) - Math.max(0, -oldOut)) * 100) / 100;
      if (paid > 0.005) paidAffected++;
      if (dueDelta > 0.005) totalDue += dueDelta;
      else if (dueDelta < -0.005) totalReduced += -dueDelta;
      if (advDelta > 0.005) totalAdvance += advDelta;
      rows.push({ cycle: ch.cycleLabel, ord: ordByName[nrm(ch.cycleLabel)] ?? 999, wasPaid: paid > 0.005, dueDelta: Math.round(dueDelta), advanceDelta: Math.round(advDelta) });
    });
    rows.sort((a, b) => a.ord - b.ord);
    return { affectedCycles: rows, totalDue: Math.round(totalDue), totalReduced: Math.round(totalReduced), totalAdvance: Math.round(totalAdvance), affectedCount: rows.length, paidAffected };
  }

  // Per-cycle concession timeline for the student app / admin timeline screen.
  public async concessionTimeline(schoolId: string, studentId: string, academicYearId: string) {
    const n = (v: any) => (v == null ? 0 : Number(v));
    const nrm = (s: any) => String(s ?? '').trim().toLowerCase();
    const cyc: any[] = await DB.query(singleLineString`select uuid, name, sort_order from fee_cycle where school_id = $1 and academic_year_id = $2 and status = 'active'`, [schoolId, academicYearId]);
    const ordered = cyc.map((c: any, i: number) => ({ uuid: c.uuid, name: c.name, ord: c.sortOrder == null ? i : Number(c.sortOrder) })).sort((a, b) => a.ord - b.ord);
    const ordByName: Record<string, number> = {}; ordered.forEach((c) => { ordByName[nrm(c.name)] = c.ord; });

    const charges: any[] = await DB.query(singleLineString`select uuid, fee_head_id, cycle_id, head_label, cycle_label, debit from student_ledger_entry where school_id = $1 and academic_year_id = $2 and student_id = $3 and kind = 'charge' and status = 'active'`, [schoolId, academicYearId, studentId]);
    const credits: any[] = await DB.query(singleLineString`select settles_entry_id, kind, head_label, sum(credit) as c from student_ledger_entry where school_id = $1 and academic_year_id = $2 and student_id = $3 and status = 'active' and kind in ('payment','concession','waiver') and settles_entry_id is not null group by settles_entry_id, kind, head_label`, [schoolId, academicYearId, studentId]);
    const byCharge: Record<string, { conc: number; pay: number; schemes: string[] }> = {};
    credits.forEach((r) => { const e = (byCharge[r.settlesEntryId] ||= { conc: 0, pay: 0, schemes: [] }); if (r.kind === 'payment') e.pay += n(r.c); else { e.conc += n(r.c); if (r.headLabel) e.schemes.push(r.headLabel); } });

    // group charges by cycle
    const cycleMap: Record<string, any> = {};
    charges.forEach((ch) => {
      const key = ch.cycleLabel || ch.cycleId || '—';
      const ord = ordByName[nrm(ch.cycleLabel)] ?? 9999;
      const g = (cycleMap[key] ||= { cycle: ch.cycleLabel || '—', ord, fee: 0, concession: 0, paid: 0, schemes: new Set<string>(), heads: [] as any[] });
      const cr = byCharge[ch.uuid] || { conc: 0, pay: 0, schemes: [] };
      g.fee += n(ch.debit); g.concession += cr.conc; g.paid += cr.pay;
      cr.schemes.forEach((s: string) => g.schemes.add(s));
      g.heads.push({ head: ch.headLabel, fee: n(ch.debit), concession: cr.conc, schemes: cr.schemes });
    });
    const rows = Object.values(cycleMap).map((g: any) => {
      const net = Math.round(g.fee - g.concession), out = Math.round(g.fee - g.concession - g.paid);
      const state = out < 0 ? 'advance' : out === 0 ? 'covered' : g.paid > 0 ? 'partial' : 'due';
      return { cycle: g.cycle, ord: g.ord, fee: Math.round(g.fee), concession: Math.round(g.concession), net, paid: Math.round(g.paid),
        outstanding: out, state, schemes: [...g.schemes], heads: g.heads };
    }).sort((a: any, b: any) => a.ord - b.ord);

    // change history (the markers)
    const changes: any[] = await DB.query(singleLineString`select cs.change_reason, cs.effective_from_cycle, cs.effective_to_cycle, cs.updated_at, c.name, cs.status from fee_concession_student cs join fee_concession c on c.uuid = cs.concession_id where cs.school_id = $1 and cs.student_id = $2 and c.academic_year_id = $3 and cs.change_reason is not null order by cs.updated_at`, [schoolId, studentId, academicYearId]);

    // current active schemes, grouped by name (a scheme may span heads) — for the Change dialog's "stop" picker
    const assigns: any[] = await DB.query(singleLineString`select cs.concession_id, cs.effective_from_cycle, cs.effective_to_cycle, c.name, c.value_type, c.value, c.fee_head_id, fh.name as head_name from fee_concession_student cs join fee_concession c on c.uuid = cs.concession_id and c.status = 'active' left join fee_head fh on fh.uuid = c.fee_head_id where cs.school_id = $1 and cs.student_id = $2 and c.academic_year_id = $3 and cs.status = 'active' order by c.name`, [schoolId, studentId, academicYearId]);
    const schemeMap: Record<string, any> = {};
    assigns.forEach((a) => {
      const g = (schemeMap[a.name] ||= { name: a.name, concessionIds: [], heads: [], valueType: a.valueType, value: n(a.value), fromCycle: a.effectiveFromCycle, toCycle: a.effectiveToCycle });
      g.concessionIds.push(a.concessionId); if (a.headName) g.heads.push(a.headName);
    });
    return { studentId, academicYearId, cycles: rows, changes, currentSchemes: Object.values(schemeMap) };
  }

  // School-wide concession change log (fee_concession_audit). Every scheme/assignment mutation with
  // its before/after, enriched with student name + class (for the event's AY) + current scheme name +
  // actor. Optional academicYearId / from / to (inclusive dates) / limit filters. Newest first.
  public async auditLog(schoolId: string, opts: { academicYearId?: string; from?: string; to?: string; limit?: number } = {}): Promise<any[]> {
    const params: any[] = [schoolId];
    let sql = singleLineString`
      select a.uuid, a.academic_year_id, a.entity, a.action, a.scheme_id, a.student_id, a.assignment_id,
        a.before, a.after, a.change_reason, a.actor_userid,
        coalesce(el.display_name, a.actor_name) as actor_name, a.created_at,
        s.name as student_name, s.admission_number, cl.name as class_name,
        coalesce(c.name, a.after->>'scheme', a.before->>'scheme') as scheme_name
      from fee_concession_audit a
      left join student s on s.uuid = a.student_id and s.school_id = a.school_id
      left join student_class sc on sc.student_id = a.student_id and sc.school_id = a.school_id and sc.academic_year_id = a.academic_year_id
      left join class cl on cl.uuid = sc.class_id
      left join fee_concession c on c.uuid = a.scheme_id
      left join employee_login el on el.uuid = a.actor_userid
      where a.school_id = $1`;
    if (opts.academicYearId) { params.push(opts.academicYearId); sql += ` and a.academic_year_id = $${params.length}`; }
    if (opts.from) { params.push(opts.from); sql += ` and a.created_at >= $${params.length}::date`; }
    if (opts.to) { params.push(opts.to); sql += ` and a.created_at < ($${params.length}::date + interval '1 day')`; }
    const lim = Math.min(Math.max(Number(opts.limit) || 500, 1), 2000);
    params.push(lim); sql += ` order by a.created_at desc limit $${params.length}`;
    return DB.query(sql, params);
  }
}

export const concessionService = new ConcessionService();
