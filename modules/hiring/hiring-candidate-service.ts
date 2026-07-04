import { DB, singleLineString } from '../../shared/lib/db';
import {
  CreateCandidateRequest,
  HiringCandidate,
  HiringCandidateDetail,
  ListCandidatesParams,
  UpdateCandidateRequest,
} from './hiring-interfaces';
import { DEFAULTS, STATUS_FOR_FINAL_DECISION } from './hiring-constants';
import { hiringStageService } from './hiring-stage-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class HiringCandidateService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async create(
    data: CreateCandidateRequest,
    schoolId: string,
    userId: string
  ): Promise<HiringCandidate> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    const query = singleLineString`
      insert into hiring_candidate
      (uuid, school_id, name, father_husband_name, position_type, subjects,
       mobile, email, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.name,
      data.fatherHusbandName || null,
      data.positionType,
      data.subjects && data.subjects.length > 0 ? data.subjects : null,
      data.mobile || null,
      data.email || null,
      DEFAULTS.STATUS,
      userId,
      now,
    ];

    const results = await DB.query(query, params);
    return this.parseNumericFields(results[0]);
  }

  public async update(
    id: string,
    data: UpdateCandidateRequest,
    schoolId: string,
    userId: string
  ): Promise<HiringCandidate | null> {
    const existing = await this.getByIdSimple(id, schoolId);
    if (!existing) return null;

    const now = new Date();
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    const setField = (column: string, value: any) => {
      updates.push(`${column} = $${paramIndex++}`);
      params.push(value);
    };

    if (data.name !== undefined) setField('name', data.name);
    if (data.fatherHusbandName !== undefined) setField('father_husband_name', data.fatherHusbandName || null);
    if (data.positionType !== undefined) setField('position_type', data.positionType);
    if (data.subjects !== undefined) setField('subjects', data.subjects && data.subjects.length > 0 ? data.subjects : null);
    if (data.mobile !== undefined) setField('mobile', data.mobile || null);
    if (data.email !== undefined) setField('email', data.email || null);
    if (data.finalComments !== undefined) setField('final_comments', data.finalComments || null);
    if (data.salaryRequested !== undefined) setField('salary_requested', data.salaryRequested);
    if (data.salaryOffered !== undefined) setField('salary_offered', data.salaryOffered);

    // Final decision drives the terminal status unless an explicit status is given.
    let newStatus = data.status;
    if (data.finalDecision !== undefined) {
      setField('final_decision', data.finalDecision);
      if (data.finalDecision && newStatus === undefined) {
        newStatus = STATUS_FOR_FINAL_DECISION[data.finalDecision];
      }
    }
    if (newStatus !== undefined) setField('status', newStatus);

    if (updates.length === 0) {
      return existing;
    }

    setField('updatedby_userid', userId);
    setField('updated_at', now);

    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update hiring_candidate
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++}
      returning *
    `;

    const results = await DB.query(query, params);
    return results.length > 0 ? this.parseNumericFields(results[0]) : null;
  }

  // Applies a status change derived from a stage outcome. Skipped when the
  // candidate is already in a terminal state set manually, so a late stage edit
  // does not silently resurrect a rejected candidate — callers pass force=false.
  public async applyDerivedStatus(
    id: string,
    schoolId: string,
    status: string,
    userId: string
  ): Promise<void> {
    const now = new Date();
    await DB.query(
      singleLineString`
        update hiring_candidate
        set status = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `,
      [status, userId, now, id, schoolId]
    );
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getByIdSimple(id, schoolId);
    if (!existing) return false;

    const now = new Date();
    await DB.query(
      singleLineString`
        update hiring_candidate
        set status = 'withdrawn', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4
      `,
      [userId, now, id, schoolId]
    );
    return true;
  }

  public async getByIdSimple(id: string, schoolId: string): Promise<HiringCandidate | null> {
    const results = await DB.query(
      singleLineString`select * from hiring_candidate where uuid = $1 and school_id = $2`,
      [id, schoolId]
    );
    return results.length > 0 ? this.parseNumericFields(results[0]) : null;
  }

  public async getById(id: string, schoolId: string): Promise<HiringCandidateDetail | null> {
    const candidate = await this.getByIdSimple(id, schoolId);
    if (!candidate) return null;

    const stages = await hiringStageService.list(id, schoolId);
    return { ...candidate, stages };
  }

  public async list(params: ListCandidatesParams): Promise<HiringCandidate[]> {
    let query = `select * from hiring_candidate where school_id = $1`;
    const queryParams: any[] = [params.schoolId];
    let paramIndex = 2;

    if (params.status && params.status.length > 0) {
      query += ` and status = ANY($${paramIndex++})`;
      queryParams.push(params.status);
    }
    if (params.positionType) {
      query += ` and position_type = $${paramIndex++}`;
      queryParams.push(params.positionType);
    }
    if (params.subject) {
      // Matches candidates tagged with the given subject (array containment).
      query += ` and subjects @> ARRAY[$${paramIndex++}]::text[]`;
      queryParams.push(params.subject);
    }
    if (params.search && params.search.trim()) {
      const term = `%${params.search.trim()}%`;
      query += ` and (lower(name) like lower($${paramIndex}) or lower(mobile) like lower($${paramIndex}) or lower(email) like lower($${paramIndex}))`;
      queryParams.push(term);
      paramIndex++;
    }

    query += ` order by created_at desc`;

    const rows = await DB.query(query, queryParams);
    return rows.map((r: any) => this.parseNumericFields(r));
  }

  private parseNumericFields(candidate: any): any {
    return {
      ...candidate,
      salaryRequested: candidate.salaryRequested != null ? parseFloat(candidate.salaryRequested) : null,
      salaryOffered: candidate.salaryOffered != null ? parseFloat(candidate.salaryOffered) : null,
    };
  }
}

export const hiringCandidateService = new HiringCandidateService();
