import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { Subject, CreateSubjectRequest, UpdateSubjectRequest } from './timetable-interfaces';
import { DEFAULTS } from './timetable-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SubjectService {
  public async list(schoolId: string): Promise<Subject[]> {
    return DB.query(
      singleLineString`
        select * from subject
        where school_id = $1 and status = 'active'
        order by name
      `,
      [schoolId],
    );
  }

  public async getById(id: string, schoolId: string): Promise<Subject | null> {
    const results = await DB.query(
      singleLineString`select * from subject where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return results.length > 0 ? results[0] : null;
  }

  public async create(data: CreateSubjectRequest, schoolId: string, userId: string): Promise<Subject> {
    const code = data.code.trim();
    const dup = await DB.query(
      singleLineString`
        select 1 from subject
        where school_id = $1 and lower(code) = lower($2) and status = 'active' limit 1
      `,
      [schoolId, code],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Subject code "${code}" already exists`);
    }

    const results = await DB.query(
      singleLineString`
        insert into subject
        (uuid, school_id, name, code, kind, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning *
      `,
      [generateShortUuid(12), schoolId, data.name.trim(), code, data.kind, DEFAULTS.STATUS, userId, new Date()],
    );
    return results[0];
  }

  public async update(id: string, data: UpdateSubjectRequest, schoolId: string, userId: string): Promise<Subject | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    if (data.code !== undefined && data.code.trim().toLowerCase() !== existing.code.toLowerCase()) {
      const dup = await DB.query(
        singleLineString`
          select 1 from subject
          where school_id = $1 and lower(code) = lower($2) and status = 'active' and uuid <> $3 limit 1
        `,
        [schoolId, data.code.trim(), id],
      );
      if (dup.length > 0) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Subject code "${data.code.trim()}" already exists`);
      }
    }

    const name = data.name !== undefined ? data.name.trim() : existing.name;
    const code = data.code !== undefined ? data.code.trim() : existing.code;
    const kind = data.kind !== undefined ? data.kind : existing.kind;

    const results = await DB.query(
      singleLineString`
        update subject
        set name = $1, code = $2, kind = $3, updatedby_userid = $4, updated_at = $5
        where uuid = $6 and school_id = $7 and status = 'active'
        returning *
      `,
      [name, code, kind, userId, new Date(), id, schoolId],
    );
    return results.length > 0 ? results[0] : null;
  }

  // Active references that block deletion of a subject.
  private async countReferences(subjectId: string, schoolId: string): Promise<number> {
    const results = await DB.query(
      singleLineString`
        select
          (select count(*) from class_subject where school_id = $1 and subject_id = $2 and status = 'active')
          + (select count(*) from teaching_assignment where school_id = $1 and subject_id = $2 and status = 'active')
          + (select count(*) from elective_offering where school_id = $1 and subject_id = $2 and status = 'active')
          + (select count(*) from class_teacher where school_id = $1 and first_period_subject_id = $2 and status = 'active')
          as count
      `,
      [schoolId, subjectId],
    );
    return results.length > 0 ? Number(results[0].count) : 0;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    const inUse = await this.countReferences(id, schoolId);
    if (inUse > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot delete: subject is used in ${inUse} active record(s)`);
    }
    await DB.query(
      singleLineString`
        update subject
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
  }
}

export const subjectService = new SubjectService();
