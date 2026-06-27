import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ClassGroup, CreateClassGroupRequest, UpdateClassGroupRequest } from './timetable-interfaces';
import { DEFAULTS } from './timetable-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// A class_group is a cohort of co-scheduled classes (a composite class like XI-A).
// Membership lives on the core class table's class_group_id column (one cohort per
// class) — not a join table — so a class belongs to at most one group.
class ClassGroupService {
  // Attach each group's member classes (id + name) from class.class_group_id.
  private async attachClasses(groups: any[], schoolId: string): Promise<ClassGroup[]> {
    if (groups.length === 0) return groups;
    const ids = groups.map((g) => g.uuid);
    const rows = await DB.query(
      singleLineString`
        select uuid as class_id, name as class_name, class_group_id
        from class
        where school_id = $1 and class_group_id = any($2)
        order by seq asc nulls last, name
      `,
      [schoolId, ids],
    );
    const byGroup = new Map<string, { classId: string; className?: string }[]>();
    for (const r of rows) {
      if (!byGroup.has(r.classGroupId)) byGroup.set(r.classGroupId, []);
      byGroup.get(r.classGroupId)!.push({ classId: r.classId, className: r.className });
    }
    for (const g of groups) {
      const classes = byGroup.get(g.uuid) || [];
      g.classes = classes;
      g.classIds = classes.map((c) => c.classId);
    }
    return groups;
  }

  public async list(schoolId: string, academicYearId?: string): Promise<ClassGroup[]> {
    const params: any[] = [schoolId];
    let where = `school_id = $1 and status = 'active'`;
    if (academicYearId) { params.push(academicYearId); where += ` and academic_year_id = $${params.length}`; }
    const groups = await DB.query(
      singleLineString`select * from class_group where ${where} order by name`,
      params,
    );
    return this.attachClasses(groups, schoolId);
  }

  public async getById(id: string, schoolId: string): Promise<ClassGroup | null> {
    const rows = await DB.query(
      singleLineString`select * from class_group where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (rows.length === 0) return null;
    const [group] = await this.attachClasses(rows, schoolId);
    return group;
  }

  public async create(data: CreateClassGroupRequest, schoolId: string, userId: string): Promise<ClassGroup> {
    const dup = await DB.query(
      singleLineString`
        select 1 from class_group
        where school_id = $1 and academic_year_id = $2 and lower(name) = lower($3) and status = 'active' limit 1
      `,
      [schoolId, data.academicYearId, data.name],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'A class group with this name already exists for this year');
    }

    const groupId = generateShortUuid(12);
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    queries.push(singleLineString`
      insert into class_group (uuid, school_id, academic_year_id, name, code, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
    `);
    params.push([groupId, schoolId, data.academicYearId, data.name.trim(), data.code ?? null, DEFAULTS.STATUS, userId, now]);

    const memberIds = [...new Set(data.classIds || [])];
    if (memberIds.length > 0) {
      queries.push(singleLineString`
        update class set class_group_id = $1, updatedby_userid = $2, updated_at = $3
        where school_id = $4 and uuid = any($5)
      `);
      params.push([groupId, userId, now, schoolId, memberIds]);
    }
    await DB.queriesInTransaction(queries, params);
    return this.getById(groupId, schoolId) as Promise<ClassGroup>;
  }

  public async update(id: string, data: UpdateClassGroupRequest, schoolId: string, userId: string): Promise<ClassGroup | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    if ((data.name !== undefined && data.name !== existing.name) || data.code !== undefined) {
      if (data.name !== undefined && data.name !== existing.name) {
        const dup = await DB.query(
          singleLineString`
            select 1 from class_group
            where school_id = $1 and academic_year_id = $2 and lower(name) = lower($3) and status = 'active' and uuid <> $4 limit 1
          `,
          [schoolId, existing.academicYearId, data.name, id],
        );
        if (dup.length > 0) {
          throw new BusinessErrorResult(ErrorCode.BusinessError, 'A class group with this name already exists for this year');
        }
      }
      queries.push(singleLineString`
        update class_group set name = $1, code = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5 and school_id = $6
      `);
      params.push([
        data.name !== undefined ? data.name.trim() : existing.name,
        data.code !== undefined ? data.code : existing.code ?? null,
        userId, now, id, schoolId,
      ]);
    }

    // Replace membership wholesale when classIds is provided: clear current members,
    // then tag the new set. (Membership is the class.class_group_id column.)
    if (data.classIds !== undefined) {
      queries.push(singleLineString`
        update class set class_group_id = null, updatedby_userid = $1, updated_at = $2
        where school_id = $3 and class_group_id = $4
      `);
      params.push([userId, now, schoolId, id]);
      const memberIds = [...new Set(data.classIds)];
      if (memberIds.length > 0) {
        queries.push(singleLineString`
          update class set class_group_id = $1, updatedby_userid = $2, updated_at = $3
          where school_id = $4 and uuid = any($5)
        `);
        params.push([id, userId, now, schoolId, memberIds]);
      }
    }

    if (queries.length > 0) await DB.queriesInTransaction(queries, params);
    return this.getById(id, schoolId);
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    const now = new Date();
    await DB.queriesInTransaction(
      [
        singleLineString`update class_group set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
        singleLineString`update class set class_group_id = null, updatedby_userid = $1, updated_at = $2 where class_group_id = $3 and school_id = $4`,
      ],
      [
        [userId, now, id, schoolId],
        [userId, now, id, schoolId],
      ],
    );
  }
}

export const classGroupService = new ClassGroupService();
