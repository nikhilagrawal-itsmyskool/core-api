import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { AssemblyTheme, CreateThemeRequest, UpdateThemeRequest } from './assembly-interfaces';
import { DEFAULTS } from './assembly-constants';
import { academicYearExists, isValidDate } from './assembly-common';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const THEME_COLS = singleLineString`
  uuid, school_id, academic_year_id, plan_id, title, description,
  start_date::text as start_date, end_date::text as end_date, status,
  createdby_userid, created_at, updatedby_userid, updated_at
`;

class AssemblyThemeService {
  public async create(data: CreateThemeRequest, schoolId: string, userId: string): Promise<AssemblyTheme> {
    if (!data.title || !data.title.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'title is required');
    if (!data.academicYearId) throw new BusinessErrorResult(ErrorCode.BusinessError, 'academicYearId is required');
    if (!(await academicYearExists(schoolId, data.academicYearId))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid academicYearId');
    }
    this.assertDateRange(data.startDate, data.endDate);
    if (data.planId) await this.assertPlan(schoolId, data.planId);

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into assembly_theme
        (uuid, school_id, academic_year_id, plan_id, title, description, start_date, end_date, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        returning ${THEME_COLS}
      `,
      [uuid, schoolId, data.academicYearId, data.planId || null, data.title.trim(), data.description || null,
        data.startDate, data.endDate, DEFAULTS.STATUS, userId, now],
    );
    return rows[0];
  }

  // Themes for an academic year; when planId is given, restrict to that plan
  // plus school-wide themes (plan_id null).
  public async list(schoolId: string, academicYearId: string, planId?: string): Promise<AssemblyTheme[]> {
    const params: any[] = [schoolId, academicYearId];
    let query = singleLineString`
      select ${THEME_COLS} from assembly_theme
      where school_id = $1 and academic_year_id = $2 and status = 'active'
    `;
    if (planId) { params.push(planId); query += ` and (plan_id = $3 or plan_id is null)`; }
    query += ` order by start_date, title`;
    return DB.query(query, params);
  }

  public async getById(id: string, schoolId: string): Promise<AssemblyTheme | null> {
    const rows = await DB.query(
      singleLineString`select ${THEME_COLS} from assembly_theme where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async update(id: string, data: UpdateThemeRequest, schoolId: string, userId: string): Promise<AssemblyTheme | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    const start = data.startDate ?? existing.startDate;
    const end = data.endDate ?? existing.endDate;
    if (data.startDate !== undefined || data.endDate !== undefined) this.assertDateRange(start, end);
    if (data.title !== undefined && !data.title.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'title cannot be blank');

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };
    if (data.title !== undefined) set('title', data.title.trim());
    if (data.description !== undefined) set('description', data.description || null);
    if (data.startDate !== undefined) set('start_date', data.startDate);
    if (data.endDate !== undefined) set('end_date', data.endDate);
    if (updates.length === 0) return existing;
    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);
    const rows = await DB.query(
      singleLineString`update assembly_theme set ${updates.join(', ')} where uuid = $${i++} and school_id = $${i++} and status = 'active' returning ${THEME_COLS}`,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;
    await DB.query(
      singleLineString`update assembly_theme set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
      [userId, new Date(), id, schoolId],
    );
    return true;
  }

  // Active themes covering a date for a plan (plan-specific + school-wide).
  public async coveringDate(schoolId: string, academicYearId: string, planId: string, date: string): Promise<AssemblyTheme[]> {
    return DB.query(
      singleLineString`
        select ${THEME_COLS} from assembly_theme
        where school_id = $1 and academic_year_id = $2 and status = 'active'
          and (plan_id = $3 or plan_id is null)
          and start_date <= $4 and end_date >= $4
        order by start_date, title
      `,
      [schoolId, academicYearId, planId, date],
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private assertDateRange(startDate?: string, endDate?: string): void {
    if (!isValidDate(startDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid startDate (yyyy-mm-dd) is required');
    if (!isValidDate(endDate)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid endDate (yyyy-mm-dd) is required');
    if (endDate < startDate) throw new BusinessErrorResult(ErrorCode.BusinessError, 'endDate must be on or after startDate');
  }

  private async assertPlan(schoolId: string, planId: string): Promise<void> {
    const rows = await DB.query(
      singleLineString`select 1 from assembly_plan where uuid = $1 and school_id = $2 and status = 'active'`,
      [planId, schoolId],
    );
    if (rows.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid planId');
  }
}

export const assemblyThemeService = new AssemblyThemeService();
