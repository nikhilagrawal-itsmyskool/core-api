import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AssemblySpecial,
  AssemblyNodeDetail,
  CreateSpecialRequest,
  UpdateSpecialRequest,
} from './assembly-interfaces';
import { DEFAULTS, WEEKDAY_VALUES, Weekday } from './assembly-constants';
import { assemblyNodeService, NodeWriteQuery } from './assembly-node-service';
import { isValidDate } from './assembly-common';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const SPECIAL_COLS = singleLineString`
  uuid, school_id, academic_year_id, plan_id, special_date::text as special_date, title,
  description, source, publish_status, status, createdby_userid, created_at, updatedby_userid, updated_at
`;

export type AssemblySpecialDetail = AssemblySpecial & { nodes: AssemblyNodeDetail[] };

// yyyy-mm-dd -> weekday token, parsed as UTC to avoid timezone drift.
function weekdayOf(dateStr: string): Weekday {
  const map: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return map[new Date(`${dateStr}T00:00:00Z`).getUTCDay()];
}

class AssemblySpecialService {
  public async create(planId: string, data: CreateSpecialRequest, schoolId: string, userId: string): Promise<AssemblySpecialDetail> {
    const plan = await this.getPlan(planId, schoolId);
    if (!plan) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid plan id');
    if (!data.title || !data.title.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'title is required');
    if (!isValidDate(data.specialDate)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'A valid specialDate (yyyy-mm-dd) is required');
    }
    const weekday = weekdayOf(data.specialDate);
    if (!WEEKDAY_VALUES.includes(weekday)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid specialDate');
    }
    await this.assertDateFree(schoolId, planId, data.specialDate);

    const source = data.source === 'blank' ? 'blank' : 'cloned';
    const uuid = generateShortUuid(12);
    const now = new Date();

    const queries: NodeWriteQuery[] = [{
      q: singleLineString`
        insert into assembly_special
        (uuid, school_id, academic_year_id, plan_id, special_date, title, description, source, publish_status, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      p: [uuid, schoolId, plan.academicYearId, planId, data.specialDate, data.title.trim(),
        data.description || null, source, DEFAULTS.PUBLISH_DRAFT, DEFAULTS.STATUS, userId, now],
    }];

    if (source === 'cloned') {
      const { queries: cloneQ } = await assemblyNodeService.buildCloneQueries(uuid, planId, schoolId, weekday, userId, now);
      queries.push(...cloneQ);
    }
    await DB.queriesInTransaction(queries.map(q => q.q), queries.map(q => q.p));

    return (await this.getDetail(uuid, schoolId))!;
  }

  public async list(planId: string, schoolId: string, from?: string, to?: string): Promise<AssemblySpecial[]> {
    const params: any[] = [planId, schoolId];
    let query = singleLineString`select ${SPECIAL_COLS} from assembly_special where plan_id = $1 and school_id = $2 and status = 'active'`;
    if (isValidDate(from)) { params.push(from); query += ` and special_date >= $${params.length}`; }
    if (isValidDate(to)) { params.push(to); query += ` and special_date <= $${params.length}`; }
    query += ` order by special_date`;
    return DB.query(query, params);
  }

  public async getById(id: string, schoolId: string): Promise<AssemblySpecial | null> {
    const rows = await DB.query(
      singleLineString`select ${SPECIAL_COLS} from assembly_special where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async getDetail(id: string, schoolId: string): Promise<AssemblySpecialDetail | null> {
    const special = await this.getById(id, schoolId);
    if (!special) return null;
    const nodes = await assemblyNodeService.getTree('special', id, schoolId);
    return { ...special, nodes };
  }

  public async update(id: string, data: UpdateSpecialRequest, schoolId: string, userId: string): Promise<AssemblySpecialDetail | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    if (data.title !== undefined && !data.title.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'title cannot be blank');

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };
    if (data.title !== undefined) set('title', data.title.trim());
    if (data.description !== undefined) set('description', data.description || null);
    if (updates.length === 0) return this.getDetail(id, schoolId);
    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);
    await DB.query(
      singleLineString`update assembly_special set ${updates.join(', ')} where uuid = $${i++} and school_id = $${i++} and status = 'active'`,
      params,
    );
    return this.getDetail(id, schoolId);
  }

  // Soft-delete the special and its whole cloned tree (nodes + child sets).
  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;
    const now = new Date();
    await DB.queriesInTransaction(
      [
        singleLineString`update assembly_special set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
        singleLineString`update assembly_node_responsible set status = 'deleted', updatedby_userid = $1, updated_at = $2 where status = 'active' and node_id in (select uuid from assembly_node where owner_type = 'special' and owner_id = $3)`,
        singleLineString`update assembly_node_resource set status = 'deleted', updatedby_userid = $1, updated_at = $2 where status = 'active' and node_id in (select uuid from assembly_node where owner_type = 'special' and owner_id = $3)`,
        singleLineString`delete from assembly_node_day where node_id in (select uuid from assembly_node where owner_type = 'special' and owner_id = $1)`,
        singleLineString`update assembly_node set status = 'deleted', updatedby_userid = $1, updated_at = $2 where owner_type = 'special' and owner_id = $3 and status = 'active'`,
      ],
      [
        [userId, now, id, schoolId],
        [userId, now, id],
        [userId, now, id],
        [id],
        [userId, now, id],
      ],
    );
    return true;
  }

  public async publish(id: string, schoolId: string, userId: string): Promise<AssemblySpecialDetail | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    await DB.query(
      singleLineString`
        update assembly_special
        set publish_status = 'published', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
    return this.getDetail(id, schoolId);
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async getPlan(planId: string, schoolId: string): Promise<{ academicYearId: string } | null> {
    const rows = await DB.query(
      singleLineString`select academic_year_id from assembly_plan where uuid = $1 and school_id = $2 and status = 'active'`,
      [planId, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  private async assertDateFree(schoolId: string, planId: string, date: string): Promise<void> {
    const rows = await DB.query(
      singleLineString`select uuid from assembly_special where school_id = $1 and plan_id = $2 and special_date = $3 and status = 'active'`,
      [schoolId, planId, date],
    );
    if (rows.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `A special assembly already exists for this plan on ${date}`);
    }
  }
}

export const assemblySpecialService = new AssemblySpecialService();
