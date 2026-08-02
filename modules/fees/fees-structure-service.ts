import { DB, singleLineString } from '../../shared/lib/db';
import { ErrorCode } from '../../shared/lib/error-codes';
import { BadRequestResult } from '../../shared/lib/errors';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

export interface CreateFeeStructureRequest {
  academicYearId: string;
  classId: string;
  feeHeadId: string;
  cycleId: string;
  amount: number;
}

export interface UpdateFeeStructureRequest {
  amount?: number;
}

export interface BulkApplyRequest {
  academicYearId: string;
  feeHeadId: string;
  cycleIds: string[];
  classIds: string[];
  amount: number;
}

export interface CopyFromClassRequest {
  academicYearId: string;
  fromClassId: string;
  toClassIds: string[];
}

export interface UpsertStudentStructureRequest {
  academicYearId: string;
  studentId: string;
  feeHeadId: string;
  cycleId: string;
  amount: number;
}

class FeeStructureService {
  public async create(data: CreateFeeStructureRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required'); }
    if (!data.classId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'classId is required'); }
    if (!data.feeHeadId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'feeHeadId is required'); }
    if (!data.cycleId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'cycleId is required'); }
    if (data.amount === undefined || data.amount === null) { throw new BadRequestResult(ErrorCode.InvalidInput, 'amount is required'); }

    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into fee_structure
      (uuid, school_id, academic_year_id, class_id, fee_head_id, cycle_id, amount, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.academicYearId,
      data.classId,
      data.feeHeadId,
      data.cycleId,
      data.amount,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return results[0];
  }

  public async update(id: string, data: UpdateFeeStructureRequest, schoolId: string, userId: string): Promise<any | null> {
    if (data.amount === undefined || data.amount === null) {
      return this.getById(id, schoolId);
    }

    const query = singleLineString`
      update fee_structure set amount = $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [data.amount, userId, new Date(), id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async remove(id: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_structure set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async getById(id: string, schoolId: string): Promise<any | null> {
    const results = await DB.query(
      singleLineString`select * from fee_structure where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async list(
    schoolId: string,
    academicYearId?: string,
    classId?: string,
    feeHeadId?: string,
    includeDeleted?: boolean
  ): Promise<any[]> {
    const params: any[] = [schoolId];
    let sql = `select * from fee_structure where school_id = $1`;
    if (!includeDeleted) { sql += ` and status = 'active'`; }
    if (academicYearId) { params.push(academicYearId); sql += ` and academic_year_id = $${params.length}`; }
    if (classId) { params.push(classId); sql += ` and class_id = $${params.length}`; }
    if (feeHeadId) { params.push(feeHeadId); sql += ` and fee_head_id = $${params.length}`; }
    sql += ` order by class_id, fee_head_id, cycle_id`;
    return DB.query(sql, params);
  }

  // Upsert a structure row for every (class x cycle) combo at the given amount.
  public async bulkApply(data: BulkApplyRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required'); }
    if (!data.feeHeadId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'feeHeadId is required'); }
    if (!Array.isArray(data.classIds) || data.classIds.length === 0) { throw new BadRequestResult(ErrorCode.InvalidInput, 'classIds is required'); }
    if (!Array.isArray(data.cycleIds) || data.cycleIds.length === 0) { throw new BadRequestResult(ErrorCode.InvalidInput, 'cycleIds is required'); }
    if (data.amount === undefined || data.amount === null) { throw new BadRequestResult(ErrorCode.InvalidInput, 'amount is required'); }

    const existing = await DB.query(
      singleLineString`
        select uuid, class_id, cycle_id from fee_structure
        where school_id = $1 and academic_year_id = $2 and fee_head_id = $3
          and class_id = any($4) and cycle_id = any($5) and status = 'active'
      `,
      [schoolId, data.academicYearId, data.feeHeadId, data.classIds, data.cycleIds]
    );
    const existingMap = new Map<string, string>();
    for (const r of existing) { existingMap.set(`${r.classId}|${r.cycleId}`, r.uuid); }

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();

    for (const classId of data.classIds) {
      for (const cycleId of data.cycleIds) {
        const existingUuid = existingMap.get(`${classId}|${cycleId}`);
        if (existingUuid) {
          queries.push(singleLineString`
            update fee_structure set amount = $1, updatedby_userid = $2, updated_at = $3
            where uuid = $4 and school_id = $5
          `);
          params.push([data.amount, userId, now, existingUuid, schoolId]);
        } else {
          queries.push(singleLineString`
            insert into fee_structure
            (uuid, school_id, academic_year_id, class_id, fee_head_id, cycle_id, amount, status, createdby_userid, created_at)
            values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
          `);
          params.push([generateShortUuid(12), schoolId, data.academicYearId, classId, data.feeHeadId, cycleId, data.amount, userId, now]);
        }
      }
    }

    if (queries.length > 0) {
      await DB.queriesInTransaction(queries, params);
    }
    return { applied: queries.length };
  }

  // Copy all active structure rows of fromClass to each toClass (skip combos already present).
  public async copyFromClass(data: CopyFromClassRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required'); }
    if (!data.fromClassId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'fromClassId is required'); }
    if (!Array.isArray(data.toClassIds) || data.toClassIds.length === 0) { throw new BadRequestResult(ErrorCode.InvalidInput, 'toClassIds is required'); }

    const source = await DB.query(
      singleLineString`
        select fee_head_id, cycle_id, amount from fee_structure
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and status = 'active'
      `,
      [schoolId, data.academicYearId, data.fromClassId]
    );

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();

    for (const toClassId of data.toClassIds) {
      if (toClassId === data.fromClassId) { continue; }
      const existing = await DB.query(
        singleLineString`
          select fee_head_id, cycle_id from fee_structure
          where school_id = $1 and academic_year_id = $2 and class_id = $3 and status = 'active'
        `,
        [schoolId, data.academicYearId, toClassId]
      );
      const existingSet = new Set<string>(existing.map((r: any) => `${r.feeHeadId}|${r.cycleId}`));

      for (const s of source) {
        if (existingSet.has(`${s.feeHeadId}|${s.cycleId}`)) { continue; }
        queries.push(singleLineString`
          insert into fee_structure
          (uuid, school_id, academic_year_id, class_id, fee_head_id, cycle_id, amount, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
        `);
        params.push([generateShortUuid(12), schoolId, data.academicYearId, toClassId, s.feeHeadId, s.cycleId, s.amount, userId, now]);
      }
    }

    if (queries.length > 0) {
      await DB.queriesInTransaction(queries, params);
    }
    return { copied: queries.length };
  }

  // ---- Per-student overrides (fee_structure_student) ----

  public async listStudent(schoolId: string, academicYearId?: string, studentId?: string, includeDeleted?: boolean): Promise<any[]> {
    const params: any[] = [schoolId];
    let sql = `select * from fee_structure_student where school_id = $1`;
    if (!includeDeleted) { sql += ` and status = 'active'`; }
    if (academicYearId) { params.push(academicYearId); sql += ` and academic_year_id = $${params.length}`; }
    if (studentId) { params.push(studentId); sql += ` and student_id = $${params.length}`; }
    sql += ` order by fee_head_id, cycle_id`;
    return DB.query(sql, params);
  }

  public async upsertStudent(data: UpsertStudentStructureRequest, schoolId: string, userId: string): Promise<any> {
    if (!data.academicYearId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'academicYearId is required'); }
    if (!data.studentId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'studentId is required'); }
    if (!data.feeHeadId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'feeHeadId is required'); }
    if (!data.cycleId) { throw new BadRequestResult(ErrorCode.InvalidInput, 'cycleId is required'); }
    if (data.amount === undefined || data.amount === null) { throw new BadRequestResult(ErrorCode.InvalidInput, 'amount is required'); }

    const now = new Date();
    const existing = await DB.query(
      singleLineString`
        select uuid from fee_structure_student
        where school_id = $1 and academic_year_id = $2 and student_id = $3 and fee_head_id = $4 and cycle_id = $5 and status = 'active'
      `,
      [schoolId, data.academicYearId, data.studentId, data.feeHeadId, data.cycleId]
    );

    if (existing.length > 0) {
      const results = await DB.query(
        singleLineString`
          update fee_structure_student set amount = $1, updatedby_userid = $2, updated_at = $3
          where uuid = $4 and school_id = $5
          returning *
        `,
        [data.amount, userId, now, existing[0].uuid, schoolId]
      );
      return results[0];
    }

    const results = await DB.query(
      singleLineString`
        insert into fee_structure_student
        (uuid, school_id, academic_year_id, student_id, fee_head_id, cycle_id, amount, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
        returning *
      `,
      [generateShortUuid(12), schoolId, data.academicYearId, data.studentId, data.feeHeadId, data.cycleId, data.amount, userId, now]
    );
    return results[0];
  }

  public async removeStudent(id: string, schoolId: string, userId: string): Promise<any | null> {
    const query = singleLineString`
      update fee_structure_student set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
      returning *
    `;
    const results = await DB.query(query, [userId, new Date(), id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }
}

export const feeStructureService = new FeeStructureService();
