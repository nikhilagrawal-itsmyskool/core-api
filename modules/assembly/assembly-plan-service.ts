import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblyPlan,
  AssemblyPlanDetail,
  CreatePlanRequest,
  UpdatePlanRequest,
  PlanClassView,
} from './assembly-interfaces';
import { DEFAULTS, WEEKDAY_VALUES, Weekday } from './assembly-constants';
import { academicYearExists, findClass } from './assembly-common';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const PLAN_COLS = singleLineString`
  uuid, school_id, academic_year_id, name, scope_label, publish_status,
  published_at, publishedby_userid, status, createdby_userid, created_at,
  updatedby_userid, updated_at
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

    const days = this.normalizeDays(data.days ?? DEFAULTS.PLAN_WEEKDAYS);
    const uuid = generateShortUuid(12);
    const now = new Date();

    const queries: string[] = [];
    const params: any[][] = [];
    queries.push(singleLineString`
      insert into assembly_plan
      (uuid, school_id, academic_year_id, name, scope_label, publish_status, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `);
    params.push([uuid, schoolId, data.academicYearId, data.name.trim(), data.scopeLabel || null,
      DEFAULTS.PUBLISH_DRAFT, DEFAULTS.STATUS, userId, now]);
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

  // Replace the plan's class set. Validates each class exists and that no class
  // already belongs to a different active plan in the same academic year.
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

    // No class may belong to another active plan in the same academic year.
    if (unique.length > 0) {
      const placeholders = unique.map((_, idx) => `$${idx + 4}`).join(', ');
      const conflicts = await DB.query(
        singleLineString`
          select class_id, class_name, plan_id from assembly_plan_class
          where school_id = $1 and academic_year_id = $2 and plan_id != $3
            and status = 'active' and class_id in (${placeholders})
        `,
        [schoolId, plan.academicYearId, planId, ...unique],
      );
      if (conflicts.length > 0) {
        const list = conflicts.map((c: any) => c.className || c.classId).join(', ');
        throw new BusinessErrorResult(ErrorCode.BusinessError, `These classes already belong to another assembly plan this year: ${list}`);
      }
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
