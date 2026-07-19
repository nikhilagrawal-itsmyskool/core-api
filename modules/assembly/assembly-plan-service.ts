import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblyPlan,
  AssemblyPlanDetail,
  CreatePlanRequest,
  UpdatePlanRequest,
  ClonePlanRequest,
  PlanClassView,
} from './assembly-interfaces';
import { DEFAULTS, WEEKDAY_VALUES, Weekday } from './assembly-constants';
import { academicYearExists, findClass, isValidDate } from './assembly-common';
import { assemblyNodeService } from './assembly-node-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const PLAN_COLS = singleLineString`
  uuid, school_id, academic_year_id, name, scope_label,
  start_date::text as start_date, end_date::text as end_date, priority,
  rotation_anchor::text as rotation_anchor,
  publish_status, published_at, publishedby_userid, status,
  createdby_userid, created_at, updatedby_userid, updated_at
`;

class AssemblyPlanService {
  // ── Plan CRUD ──────────────────────────────────────────────────────────────

  public async create(data: CreatePlanRequest, schoolId: string, userId: string): Promise<AssemblyPlanDetail> {
    if (!data.name || !data.name.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'name is required');
    }
    if (!data.academicYearId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'academicYearId is required');
    }
    if (!(await academicYearExists(schoolId, data.academicYearId))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid academicYearId');
    }
    await this.assertNameFree(schoolId, data.academicYearId, data.name, null);
    const { startDate, endDate } = this.validateDates(data.startDate, data.endDate);

    const days = this.normalizeDays(data.days ?? DEFAULTS.PLAN_WEEKDAYS);
    const uuid = generateShortUuid(12);
    const now = new Date();

    const queries: string[] = [];
    const params: any[][] = [];
    queries.push(singleLineString`
      insert into assembly_plan
      (uuid, school_id, academic_year_id, name, scope_label, start_date, end_date, priority, publish_status, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `);
    params.push([uuid, schoolId, data.academicYearId, data.name.trim(), data.scopeLabel || null,
      startDate, endDate, data.priority ?? null, DEFAULTS.PUBLISH_DRAFT, DEFAULTS.STATUS, userId, now]);
    for (const weekday of days) {
      queries.push(singleLineString`
        insert into assembly_plan_day (uuid, school_id, plan_id, weekday, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6)
      `);
      params.push([generateShortUuid(12), schoolId, uuid, weekday, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);

    return (await this.getDetail(uuid, schoolId))!;
  }

  public async list(schoolId: string, academicYearId?: string): Promise<AssemblyPlan[]> {
    const params: any[] = [schoolId];
    let query = singleLineString`select ${PLAN_COLS} from assembly_plan where school_id = $1 and status = 'active'`;
    if (academicYearId) {
      params.push(academicYearId);
      query += ` and academic_year_id = $2`;
    }
    query += ` order by name`;
    return DB.query(query, params);
  }

  public async getById(id: string, schoolId: string): Promise<AssemblyPlan | null> {
    const rows = await DB.query(
      singleLineString`select ${PLAN_COLS} from assembly_plan where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // Plan + its audience (classes) + weekday ceiling.
  public async getDetail(id: string, schoolId: string): Promise<AssemblyPlanDetail | null> {
    const plan = await this.getById(id, schoolId);
    if (!plan) return null;
    const classes = await this.getClasses(id, schoolId);
    const days = await this.getDays(id, schoolId);
    return { ...plan, classes, days };
  }

  public async update(id: string, data: UpdatePlanRequest, schoolId: string, userId: string): Promise<AssemblyPlanDetail | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    if (data.name !== undefined) {
      if (!data.name.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'name cannot be blank');
      await this.assertNameFree(schoolId, existing.academicYearId, data.name, id);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };

    if (data.name !== undefined) set('name', data.name.trim());
    if (data.scopeLabel !== undefined) set('scope_label', data.scopeLabel || null);
    if (data.startDate !== undefined || data.endDate !== undefined) {
      const start = data.startDate !== undefined ? data.startDate : existing.startDate;
      const end = data.endDate !== undefined ? data.endDate : existing.endDate;
      const v = this.validateDates(start || undefined, end || undefined);
      set('start_date', v.startDate);
      set('end_date', v.endDate);
    }
    if (data.priority !== undefined) set('priority', data.priority ?? null);
    if (data.rotationAnchor !== undefined) {
      if (data.rotationAnchor && !isValidDate(data.rotationAnchor)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid rotationAnchor (yyyy-mm-dd)');
      set('rotation_anchor', data.rotationAnchor || null);
    }

    if (updates.length === 0) return this.getDetail(id, schoolId);
    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);

    await DB.query(
      singleLineString`
        update assembly_plan set ${updates.join(', ')}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
      `,
      params,
    );
    return this.getDetail(id, schoolId);
  }

  // Soft-delete the plan and its audience rows; hard-delete its weekday rows.
  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;
    const now = new Date();
    await DB.queriesInTransaction(
      [
        singleLineString`update assembly_plan set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
        singleLineString`update assembly_plan_class set status = 'deleted', updatedby_userid = $1, updated_at = $2 where plan_id = $3 and status = 'active'`,
        singleLineString`delete from assembly_plan_day where plan_id = $1`,
      ],
      [
        [userId, now, id, schoolId],
        [userId, now, id],
        [id],
      ],
    );
    return true;
  }

  public async publish(id: string, schoolId: string, userId: string): Promise<AssemblyPlanDetail | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    await DB.query(
      singleLineString`
        update assembly_plan
        set publish_status = 'published', published_at = $1, publishedby_userid = $2, updatedby_userid = $2, updated_at = $1
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [new Date(), userId, id, schoolId],
    );
    return this.getDetail(id, schoolId);
  }

  // Clone a whole plan (weekdays + audience + node tree) into a new dated plan (draft).
  public async clone(sourceId: string, data: ClonePlanRequest, schoolId: string, userId: string): Promise<AssemblyPlanDetail | null> {
    const src = await this.getById(sourceId, schoolId);
    if (!src) return null;
    if (!data.name || !data.name.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'name is required');
    await this.assertNameFree(schoolId, src.academicYearId, data.name, null);
    const { startDate, endDate } = this.validateDates(data.startDate, data.endDate);

    const newId = generateShortUuid(12);
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into assembly_plan
      (uuid, school_id, academic_year_id, name, scope_label, start_date, end_date, priority, publish_status, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `);
    params.push([newId, schoolId, src.academicYearId, data.name.trim(), data.scopeLabel ?? src.scopeLabel ?? null,
      startDate, endDate, src.priority ?? null, DEFAULTS.PUBLISH_DRAFT, DEFAULTS.STATUS, userId, now]);

    for (const weekday of await this.getDays(sourceId, schoolId)) {
      queries.push(singleLineString`insert into assembly_plan_day (uuid, school_id, plan_id, weekday, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6)`);
      params.push([generateShortUuid(12), schoolId, newId, weekday, userId, now]);
    }

    if (data.copyClasses !== false) {
      for (const c of await this.getClasses(sourceId, schoolId)) {
        queries.push(singleLineString`insert into assembly_plan_class (uuid, school_id, academic_year_id, plan_id, class_id, class_name, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`);
        params.push([generateShortUuid(12), schoolId, src.academicYearId, newId, c.classId, c.className ?? null, DEFAULTS.STATUS, userId, now]);
      }
    }

    // Deep-copy the entire node tree (nodes + day rows + responsible + resources).
    for (const q of await assemblyNodeService.buildFullPlanCloneQueries(newId, sourceId, schoolId, userId, now)) {
      queries.push(q.q);
      params.push(q.p);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getDetail(newId, schoolId);
  }

  // ── Audience (classes) ───────────────────────────────────────────────────────

  public async getClasses(planId: string, schoolId: string): Promise<PlanClassView[]> {
    const rows = await DB.query(
      singleLineString`
        select class_id, class_name from assembly_plan_class
        where plan_id = $1 and school_id = $2 and status = 'active' order by class_name
      `,
      [planId, schoolId],
    );
    return rows.map((r: any) => ({ classId: r.classId, className: r.className }));
  }

  // Replace the plan's class set. Validates each class exists. Classes MAY overlap
  // with other dated plans (Term 1 + exam block, ...) — resolution is narrowest-wins.
  public async setClasses(planId: string, classIds: string[], schoolId: string, userId: string): Promise<AssemblyPlanDetail | null> {
    const plan = await this.getById(planId, schoolId);
    if (!plan) return null;
    if (!Array.isArray(classIds)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'classIds array is required');
    }
    const unique = [...new Set(classIds.filter(Boolean))];

    // Validate each class exists in this school and collect denormalized names.
    const names = new Map<string, string>();
    for (const classId of unique) {
      const cls = await findClass(schoolId, classId);
      if (!cls) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid classId: ${classId}`);
      names.set(classId, cls.name);
    }

    const now = new Date();
    const queries: string[] = [
      singleLineString`update assembly_plan_class set status = 'deleted', updatedby_userid = $1, updated_at = $2 where plan_id = $3 and status = 'active'`,
    ];
    const params: any[][] = [[userId, now, planId]];
    for (const classId of unique) {
      queries.push(singleLineString`
        insert into assembly_plan_class
        (uuid, school_id, academic_year_id, plan_id, class_id, class_name, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `);
      params.push([generateShortUuid(12), schoolId, plan.academicYearId, planId, classId, names.get(classId) || null, DEFAULTS.STATUS, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    return this.getDetail(planId, schoolId);
  }

  // ── Weekday ceiling ──────────────────────────────────────────────────────────

  public async getDays(planId: string, schoolId: string): Promise<Weekday[]> {
    const rows = await DB.query(
      singleLineString`select weekday from assembly_plan_day where plan_id = $1 and school_id = $2`,
      [planId, schoolId],
    );
    return this.orderDays(rows.map((r: any) => r.weekday));
  }

  public async setDays(planId: string, days: Weekday[], schoolId: string, userId: string): Promise<AssemblyPlanDetail | null> {
    const plan = await this.getById(planId, schoolId);
    if (!plan) return null;
    const normalized = this.normalizeDays(days);
    if (normalized.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'A plan must have at least one assembly weekday');
    }
    const now = new Date();
    const queries: string[] = [singleLineString`delete from assembly_plan_day where plan_id = $1`];
    const params: any[][] = [[planId]];
    for (const weekday of normalized) {
      queries.push(singleLineString`
        insert into assembly_plan_day (uuid, school_id, plan_id, weekday, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6)
      `);
      params.push([generateShortUuid(12), schoolId, planId, weekday, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    return this.getDetail(planId, schoolId);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private validateDates(startDate?: string | null, endDate?: string | null): { startDate: string | null; endDate: string | null } {
    const s = startDate || null;
    const e = endDate || null;
    if (s && !isValidDate(s)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid startDate (yyyy-mm-dd)');
    if (e && !isValidDate(e)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid endDate (yyyy-mm-dd)');
    if (s && e && e < s) throw new BusinessErrorResult(ErrorCode.BusinessError, 'endDate must be on or after startDate');
    return { startDate: s, endDate: e };
  }

  private async assertNameFree(schoolId: string, academicYearId: string, name: string, excludeId: string | null): Promise<void> {
    const params: any[] = [schoolId, academicYearId, name.trim()];
    let query = singleLineString`
      select uuid from assembly_plan
      where school_id = $1 and academic_year_id = $2 and lower(name) = lower($3) and status = 'active'
    `;
    if (excludeId) { params.push(excludeId); query += ` and uuid != $4`; }
    const rows = await DB.query(query, params);
    if (rows.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `An assembly plan named "${name.trim()}" already exists for this academic year`);
    }
  }

  private normalizeDays(days: Weekday[]): Weekday[] {
    if (!Array.isArray(days)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'days must be an array of weekdays');
    }
    const unique = [...new Set(days)];
    for (const d of unique) {
      if (!WEEKDAY_VALUES.includes(d)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid weekday: ${d}`);
      }
    }
    return this.orderDays(unique);
  }

  private orderDays(days: string[]): Weekday[] {
    return WEEKDAY_VALUES.filter(w => days.includes(w)) as Weekday[];
  }
}

export const assemblyPlanService = new AssemblyPlanService();
