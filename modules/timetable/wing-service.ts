import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { Wing, CreateWingRequest, UpdateWingRequest } from './timetable-interfaces';
import { DEFAULTS } from './timetable-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class WingService {
  // Attach each wing's class membership (ids + names) from timetable_wing_class.
  private async attachClasses(wings: any[], schoolId: string): Promise<Wing[]> {
    if (wings.length === 0) return wings;
    const ids = wings.map((w) => w.uuid);
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(', ');
    const rows = await DB.query(
      singleLineString`
        select wc.wing_id, wc.class_id, c.name as class_name
        from timetable_wing_class wc
        left join class c on c.uuid = wc.class_id
        where wc.school_id = $1 and wc.status = 'active' and wc.wing_id in (${placeholders})
        order by c.name
      `,
      [schoolId, ...ids],
    );
    const byWing = new Map<string, { classId: string; className?: string }[]>();
    for (const r of rows) {
      if (!byWing.has(r.wingId)) byWing.set(r.wingId, []);
      byWing.get(r.wingId)!.push({ classId: r.classId, className: r.className });
    }
    for (const w of wings) {
      const classes = byWing.get(w.uuid) || [];
      w.classes = classes;
      w.classIds = classes.map((c) => c.classId);
    }
    return wings;
  }

  public async list(schoolId: string, academicYearId?: string): Promise<Wing[]> {
    const params: any[] = [schoolId];
    let where = `school_id = $1 and status = 'active'`;
    if (academicYearId) { params.push(academicYearId); where += ` and academic_year_id = $${params.length}`; }
    const wings = await DB.query(
      singleLineString`select * from timetable_wing where ${where} order by name`,
      params,
    );
    return this.attachClasses(wings, schoolId);
  }

  public async getById(id: string, schoolId: string): Promise<Wing | null> {
    const rows = await DB.query(
      singleLineString`select * from timetable_wing where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (rows.length === 0) return null;
    const [wing] = await this.attachClasses(rows, schoolId);
    return wing;
  }

  // Active class ids of a wing — used to scope generation.
  public async getWingClassIds(schoolId: string, wingId: string): Promise<string[]> {
    const rows = await DB.query(
      singleLineString`select class_id from timetable_wing_class where wing_id = $1 and school_id = $2 and status = 'active'`,
      [wingId, schoolId],
    );
    return rows.map((r: any) => r.classId);
  }

  public async create(data: CreateWingRequest, schoolId: string, userId: string): Promise<Wing> {
    const dup = await DB.query(
      singleLineString`
        select 1 from timetable_wing
        where school_id = $1 and academic_year_id = $2 and lower(name) = lower($3) and status = 'active' limit 1
      `,
      [schoolId, data.academicYearId, data.name],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'A wing with this name already exists for this year');
    }

    const wingId = generateShortUuid(12);
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    queries.push(singleLineString`
      insert into timetable_wing (uuid, school_id, academic_year_id, name, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7)
    `);
    params.push([wingId, schoolId, data.academicYearId, data.name, DEFAULTS.STATUS, userId, now]);
    for (const classId of [...new Set(data.classIds || [])]) {
      queries.push(singleLineString`
        insert into timetable_wing_class (uuid, school_id, wing_id, class_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
      `);
      params.push([generateShortUuid(12), schoolId, wingId, classId, DEFAULTS.STATUS, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    return this.getById(wingId, schoolId) as Promise<Wing>;
  }

  public async update(id: string, data: UpdateWingRequest, schoolId: string, userId: string): Promise<Wing | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    if (data.name !== undefined && data.name !== existing.name) {
      const dup = await DB.query(
        singleLineString`
          select 1 from timetable_wing
          where school_id = $1 and academic_year_id = $2 and lower(name) = lower($3) and status = 'active' and uuid <> $4 limit 1
        `,
        [schoolId, existing.academicYearId, data.name, id],
      );
      if (dup.length > 0) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'A wing with this name already exists for this year');
      }
      queries.push(singleLineString`
        update timetable_wing set name = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5
      `);
      params.push([data.name, userId, now, id, schoolId]);
    }

    // Replace membership wholesale when classIds is provided.
    if (data.classIds !== undefined) {
      queries.push(singleLineString`
        update timetable_wing_class set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where wing_id = $3 and school_id = $4 and status = 'active'
      `);
      params.push([userId, now, id, schoolId]);
      for (const classId of [...new Set(data.classIds)]) {
        queries.push(singleLineString`
          insert into timetable_wing_class (uuid, school_id, wing_id, class_id, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7)
        `);
        params.push([generateShortUuid(12), schoolId, id, classId, DEFAULTS.STATUS, userId, now]);
      }
    }

    if (queries.length > 0) await DB.queriesInTransaction(queries, params);
    return this.getById(id, schoolId);
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    const now = new Date();
    await DB.queriesInTransaction(
      [
        singleLineString`update timetable_wing set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
        singleLineString`update timetable_wing_class set status = 'deleted', updatedby_userid = $1, updated_at = $2 where wing_id = $3 and school_id = $4 and status = 'active'`,
      ],
      [
        [userId, now, id, schoolId],
        [userId, now, id, schoolId],
      ],
    );
  }
}

export const wingService = new WingService();
