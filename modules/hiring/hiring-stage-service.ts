import { DB, singleLineString } from '../../shared/lib/db';
import { CreateStageRequest, HiringStage, UpdateStageRequest } from './hiring-interfaces';
import { StageOutcome, StageType, deriveStatusFromStage } from './hiring-constants';
import { hiringCandidateService } from './hiring-candidate-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class HiringStageService {
  public async list(candidateId: string, schoolId: string): Promise<HiringStage[]> {
    const rows = await DB.query(
      singleLineString`
        select * from hiring_stage
        where candidate_id = $1 and school_id = $2
        order by created_at asc
      `,
      [candidateId, schoolId]
    );
    return rows;
  }

  public async getById(id: string, schoolId: string): Promise<HiringStage | null> {
    const rows = await DB.query(
      singleLineString`select * from hiring_stage where uuid = $1 and school_id = $2`,
      [id, schoolId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async create(
    candidateId: string,
    data: CreateStageRequest,
    schoolId: string,
    userId: string
  ): Promise<HiringStage> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const outcome: StageOutcome = data.outcome || 'pending';

    const query = singleLineString`
      insert into hiring_stage
      (uuid, candidate_id, school_id, stage_type, scheduled_date, outcome,
       comments, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      returning *
    `;

    const params = [
      uuid,
      candidateId,
      schoolId,
      data.stageType,
      data.scheduledDate || null,
      outcome,
      data.comments || null,
      userId,
      now,
    ];

    const results = await DB.query(query, params);

    await this.syncCandidateStatus(candidateId, schoolId, data.stageType, outcome, userId);

    return results[0];
  }

  public async update(
    id: string,
    data: UpdateStageRequest,
    schoolId: string,
    userId: string
  ): Promise<HiringStage | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    const now = new Date();
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.scheduledDate !== undefined) {
      updates.push(`scheduled_date = $${paramIndex++}`);
      params.push(data.scheduledDate || null);
    }
    if (data.outcome !== undefined) {
      updates.push(`outcome = $${paramIndex++}`);
      params.push(data.outcome);
    }
    if (data.comments !== undefined) {
      updates.push(`comments = $${paramIndex++}`);
      params.push(data.comments || null);
    }

    if (updates.length === 0) {
      return existing;
    }

    updates.push(`updatedby_userid = $${paramIndex++}`);
    params.push(userId);
    updates.push(`updated_at = $${paramIndex++}`);
    params.push(now);

    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update hiring_stage
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++}
      returning *
    `;

    const results = await DB.query(query, params);
    if (results.length === 0) return null;

    const updated = results[0];
    if (data.outcome !== undefined) {
      await this.syncCandidateStatus(
        updated.candidateId,
        schoolId,
        updated.stageType,
        updated.outcome,
        userId
      );
    }

    return updated;
  }

  public async delete(id: string, schoolId: string): Promise<boolean> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;

    await DB.query(
      singleLineString`delete from hiring_stage where uuid = $1 and school_id = $2`,
      [id, schoolId]
    );
    return true;
  }

  // Push the candidate's overall status to match the latest stage outcome.
  private async syncCandidateStatus(
    candidateId: string,
    schoolId: string,
    stageType: StageType,
    outcome: StageOutcome,
    userId: string
  ): Promise<void> {
    const derived = deriveStatusFromStage(stageType, outcome);
    if (derived) {
      await hiringCandidateService.applyDerivedStatus(candidateId, schoolId, derived, userId);
    }
  }
}

export const hiringStageService = new HiringStageService();
