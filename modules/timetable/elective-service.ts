import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  ElectiveBand, ElectiveOffering, CreateElectiveBandRequest,
  UpdateElectiveBandRequest, CreateElectiveOfferingRequest,
} from './timetable-interfaces';
import { DEFAULTS } from './timetable-constants';
import { validateBlockRules, toJsonb } from './timetable-util';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class ElectiveService {
  // ----- bands -----
  public async listBands(schoolId: string, classId?: string, academicYearId?: string): Promise<ElectiveBand[]> {
    const params: any[] = [schoolId];
    let where = `school_id = $1 and status = 'active'`;
    if (classId) { params.push(classId); where += ` and class_id = $${params.length}`; }
    if (academicYearId) { params.push(academicYearId); where += ` and academic_year_id = $${params.length}`; }
    const bands: ElectiveBand[] = await DB.query(
      singleLineString`select * from elective_band where ${where} order by name`,
      params,
    );
    for (const band of bands) {
      band.offerings = await this.listOfferings(band.uuid, schoolId);
    }
    return bands;
  }

  public async getBandById(id: string, schoolId: string): Promise<ElectiveBand | null> {
    const results = await DB.query(
      singleLineString`select * from elective_band where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    if (results.length === 0) return null;
    const band: ElectiveBand = results[0];
    band.offerings = await this.listOfferings(band.uuid, schoolId);
    return band;
  }

  public async createBand(data: CreateElectiveBandRequest, schoolId: string, userId: string): Promise<ElectiveBand> {
    const blockErr = validateBlockRules(data.blockRules, data.periodsPerWeek);
    if (blockErr) throw new BusinessErrorResult(ErrorCode.BusinessError, blockErr);

    const now = new Date();
    const bandId = generateShortUuid(12);
    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into elective_band
      (uuid, school_id, academic_year_id, class_id, name, periods_per_week, block_rules, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `);
    params.push([
      bandId, schoolId, data.academicYearId, data.classId, data.name.trim(),
      data.periodsPerWeek, toJsonb(data.blockRules), DEFAULTS.STATUS, userId, now,
    ]);

    const seenSubjects = new Set<string>();
    for (const off of data.offerings || []) {
      if (seenSubjects.has(off.subjectId)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Duplicate subject in band offerings');
      }
      seenSubjects.add(off.subjectId);
      queries.push(singleLineString`
        insert into elective_offering
        (uuid, school_id, band_id, subject_id, teacher_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `);
      params.push([generateShortUuid(12), schoolId, bandId, off.subjectId, off.teacherId, DEFAULTS.STATUS, userId, now]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getBandById(bandId, schoolId) as Promise<ElectiveBand>;
  }

  public async updateBand(id: string, data: UpdateElectiveBandRequest, schoolId: string, userId: string): Promise<ElectiveBand | null> {
    const existing = await this.getBandById(id, schoolId);
    if (!existing) return null;

    const name = data.name !== undefined ? data.name.trim() : existing.name;
    const periodsPerWeek = data.periodsPerWeek !== undefined ? data.periodsPerWeek : existing.periodsPerWeek;
    const blockRules = data.blockRules !== undefined ? data.blockRules : existing.blockRules;
    const blockErr = validateBlockRules(blockRules, periodsPerWeek);
    if (blockErr) throw new BusinessErrorResult(ErrorCode.BusinessError, blockErr);

    await DB.query(
      singleLineString`
        update elective_band
        set name = $1, periods_per_week = $2, block_rules = $3, updatedby_userid = $4, updated_at = $5
        where uuid = $6 and school_id = $7 and status = 'active'
      `,
      [name, periodsPerWeek, toJsonb(blockRules), userId, new Date(), id, schoolId],
    );
    return this.getBandById(id, schoolId);
  }

  public async deleteBand(id: string, schoolId: string, userId: string): Promise<void> {
    const now = new Date();
    await DB.queriesInTransaction(
      [
        singleLineString`update elective_band set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4 and status = 'active'`,
        singleLineString`update elective_offering set status = 'deleted', updatedby_userid = $1, updated_at = $2 where band_id = $3 and school_id = $4 and status = 'active'`,
      ],
      [
        [userId, now, id, schoolId],
        [userId, now, id, schoolId],
      ],
    );
  }

  // ----- offerings -----
  public async listOfferings(bandId: string, schoolId: string): Promise<ElectiveOffering[]> {
    return DB.query(
      singleLineString`
        select eo.*, s.name as subject_name, s.code as subject_code, s.status as subject_status
        from elective_offering eo
        left join subject s on s.uuid = eo.subject_id
        where eo.band_id = $1 and eo.school_id = $2 and eo.status = 'active'
        order by s.name
      `,
      [bandId, schoolId],
    );
  }

  public async getOfferingById(id: string, schoolId: string): Promise<ElectiveOffering | null> {
    const results = await DB.query(
      singleLineString`select * from elective_offering where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return results.length > 0 ? results[0] : null;
  }

  public async addOffering(bandId: string, data: CreateElectiveOfferingRequest, schoolId: string, userId: string): Promise<ElectiveOffering> {
    const dup = await DB.query(
      singleLineString`select 1 from elective_offering where band_id = $1 and subject_id = $2 and status = 'active' limit 1`,
      [bandId, data.subjectId],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'This subject is already offered in the band');
    }
    const results = await DB.query(
      singleLineString`
        insert into elective_offering
        (uuid, school_id, band_id, subject_id, teacher_id, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning *
      `,
      [generateShortUuid(12), schoolId, bandId, data.subjectId, data.teacherId, DEFAULTS.STATUS, userId, new Date()],
    );
    return results[0];
  }

  public async deleteOffering(id: string, schoolId: string, userId: string): Promise<void> {
    await DB.query(
      singleLineString`
        update elective_offering
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
  }
}

export const electiveService = new ElectiveService();
