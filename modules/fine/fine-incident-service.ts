import { DB, singleLineString } from '../../shared/lib/db';
import {
  FineIncident,
  FineIncidentDetail,
  CreateIncidentRequest,
  UpdateIncidentRequest,
} from './fine-interfaces';
import { DEFAULTS, VALID_STATUS_TRANSITIONS } from './fine-constants';
import { fineNoteService } from './fine-note-service';
import { BadRequestResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class FineIncidentService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async create(
    data: CreateIncidentRequest,
    schoolId: string,
    userId: string
  ): Promise<FineIncident> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const reportedById = data.reportedById || userId;

    const query = singleLineString`
      insert into fine_incident
      (uuid, school_id, incident_date, category, person_type, person_id,
       description, suggested_fine_amount, status, reported_by_id,
       createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      returning *
    `;

    const params = [
      uuid,
      schoolId,
      data.incidentDate,
      data.category,
      data.personType,
      data.personId,
      data.description || null,
      data.suggestedFineAmount || null,
      DEFAULTS.STATUS,
      reportedById,
      userId,
      now,
    ];

    const results = await DB.query(query, params);

    // Auto-insert system note with reporter's display name
    const reporterName = await this.getLoginDisplayName(reportedById);
    await fineNoteService.createSystemNote(
      uuid,
      schoolId,
      reportedById,
      `Incident reported by ${reporterName}`
    );

    return this.parseNumericFields(results[0]);
  }

  public async update(
    id: string,
    data: UpdateIncidentRequest,
    schoolId: string,
    userId: string
  ): Promise<FineIncident | null> {
    const existing = await this.getByIdSimple(id, schoolId);
    if (!existing) return null;

    // Lock decision fields once decision has been made
    if (['decision_made', 'closed'].includes(existing.status)) {
      if (data.decision !== undefined || data.decidedFineAmount !== undefined) {
        throw new BadRequestResult(ErrorCode.InvalidInput, 'Decision cannot be changed once made');
      }
    }

    const now = new Date();
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.incidentDate !== undefined) {
      updates.push(`incident_date = $${paramIndex++}`);
      params.push(data.incidentDate);
    }
    if (data.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      params.push(data.category);
    }
    if (data.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(data.description);
    }
    if (data.suggestedFineAmount !== undefined) {
      updates.push(`suggested_fine_amount = $${paramIndex++}`);
      params.push(data.suggestedFineAmount);
    }

    // Determine new status
    let newStatus = existing.status;
    const systemNotes: string[] = [];

    // Handle assignment
    if (data.assignedToId !== undefined) {
      updates.push(`assigned_to_id = $${paramIndex++}`);
      params.push(data.assignedToId);

      if (data.assignedToId && data.assignedToId !== existing.assignedToId) {
        systemNotes.push(`assigned_to:${data.assignedToId}`);
        // Auto-transition open → under_review when assigning
        if (existing.status === 'open') {
          newStatus = 'under_review';
        }
      } else if (!data.assignedToId && existing.assignedToId) {
        systemNotes.push('unassigned');
      }
    }

    // Handle decision
    if (data.decision !== undefined) {
      updates.push(`decision = $${paramIndex++}`);
      params.push(data.decision);

      if (data.decidedFineAmount !== undefined) {
        updates.push(`decided_fine_amount = $${paramIndex++}`);
        params.push(data.decidedFineAmount);
      }

      // Auto-transition to decision_made
      if (existing.status !== 'decision_made' && existing.status !== 'closed') {
        newStatus = 'decision_made';
      }

      if (data.decision === 'collect') {
        systemNotes.push(`decision:collect:${data.decidedFineAmount ?? existing.decidedFineAmount ?? 0}`);
      } else if (data.decision === 'waive') {
        systemNotes.push('decision:waive');
        // Auto-close on waive
        newStatus = 'closed';
      }
    } else if (data.decidedFineAmount !== undefined) {
      updates.push(`decided_fine_amount = $${paramIndex++}`);
      params.push(data.decidedFineAmount);
    }

    // Handle explicit status override
    if (data.status !== undefined && data.status !== newStatus) {
      const allowedTransitions = VALID_STATUS_TRANSITIONS[newStatus] || [];
      if (!allowedTransitions.includes(data.status)) {
        throw new Error(`Invalid status transition from '${newStatus}' to '${data.status}'`);
      }
      newStatus = data.status;
      systemNotes.push(`status:${newStatus}`);
    }

    // Apply status change
    if (newStatus !== existing.status) {
      updates.push(`status = $${paramIndex++}`);
      params.push(newStatus);
      if (!systemNotes.some(n => n.startsWith('status:'))) {
        systemNotes.push(`status:${newStatus}`);
      }
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
      update fine_incident
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++}
      returning *
    `;

    const results = await DB.query(query, params);
    if (results.length === 0) return null;

    const updated = this.parseNumericFields(results[0]);

    // Insert system notes
    for (const noteCode of systemNotes) {
      let noteText = '';
      if (noteCode.startsWith('assigned_to:')) {
        const assigneeId = noteCode.split(':')[1];
        const assignee = await this.getEmployeeName(assigneeId);
        noteText = `Incident assigned to ${assignee}`;
      } else if (noteCode === 'unassigned') {
        noteText = 'Incident unassigned';
      } else if (noteCode.startsWith('decision:collect:')) {
        const amount = noteCode.split(':')[2];
        noteText = `Decision: Collect ₹${amount}`;
      } else if (noteCode === 'decision:waive') {
        noteText = 'Decision: Fine waived';
      } else if (noteCode.startsWith('status:')) {
        const status = noteCode.split(':')[1];
        noteText = `Status changed to: ${status.replace(/_/g, ' ')}`;
      }

      if (noteText) {
        await fineNoteService.createSystemNote(id, schoolId, userId, noteText);
      }
    }

    return updated;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const now = new Date();
    const query = singleLineString`
      update fine_incident
      set status = 'closed', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4
    `;
    await DB.query(query, [userId, now, id, schoolId]);
    return true;
  }

  public async getById(id: string, schoolId: string): Promise<FineIncidentDetail | null> {
    // Fetch incident with name joins
    const incidentQuery = singleLineString`
      select fi.*,
        case when fi.person_type = 'employee' then e_person.name else s_person.name end as person_name,
        latest_class.class_name as person_class_name,
        e_assignee.name as assignee_name,
        el_reporter.display_name as reporter_name
      from fine_incident fi
      left join employee e_person on fi.person_type = 'employee' and fi.person_id = e_person.uuid
      left join student s_person on fi.person_type = 'student' and fi.person_id = s_person.uuid
      left join employee e_assignee on fi.assigned_to_id = e_assignee.uuid
      left join employee_login el_reporter on fi.reported_by_id = el_reporter.uuid
      left join lateral (
        select c.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        join class c on sc.class_id = c.uuid
        where sc.student_id = fi.person_id and fi.person_type = 'student'
        order by ay.start_date desc
        limit 1
      ) latest_class on true
      where fi.uuid = $1 and fi.school_id = $2
    `;

    const incidents = await DB.query(incidentQuery, [id, schoolId]);
    if (incidents.length === 0) return null;

    const incident = incidents[0];

    // Fetch notes
    const notes = await fineNoteService.list(id, schoolId);

    // Fetch evidence metadata
    const evidenceQuery = singleLineString`
      select e.*, fs.file_name, fs.mime_type, fs.size_bytes
      from fine_incident_evidence e
      join file_storage fs on e.file_id = fs.uuid
      where e.incident_id = $1 and e.school_id = $2 and e.status = 'active'
      order by e.created_at asc
    `;
    const evidence = await DB.query(evidenceQuery, [id, schoolId]);

    // Fetch all collections (for partial payment support)
    const collectionQuery = singleLineString`
      select * from fine_collection
      where incident_id = $1 and school_id = $2 and status = 'active'
      order by created_at asc
    `;
    const collectionRows = await DB.query(collectionQuery, [id, schoolId]);
    const parsedCollections = collectionRows.map((c: any) => this.parseCollectionNumericFields(c));
    const totalCollected = parsedCollections.reduce((sum: number, c: any) => sum + (c.amountCollected || 0), 0);

    return {
      ...this.parseNumericFields(incident),
      notes,
      evidence,
      collections: parsedCollections,
      totalCollected,
    };
  }

  public async getByIdSimple(id: string, schoolId: string): Promise<FineIncident | null> {
    const query = singleLineString`
      select * from fine_incident
      where uuid = $1 and school_id = $2
    `;
    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? this.parseNumericFields(results[0]) : null;
  }

  public async list(params: {
    schoolId: string;
    status?: string[];
    category?: string;
    personType?: string;
    personId?: string;
    assignedToId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<FineIncident[]> {
    let query = `
      select fi.*,
        case when fi.person_type = 'employee' then e_person.name else s_person.name end as person_name,
        e_assignee.name as assignee_name,
        el_reporter.display_name as reporter_name
      from fine_incident fi
      left join employee e_person on fi.person_type = 'employee' and fi.person_id = e_person.uuid
      left join student s_person on fi.person_type = 'student' and fi.person_id = s_person.uuid
      left join employee e_assignee on fi.assigned_to_id = e_assignee.uuid
      left join employee_login el_reporter on fi.reported_by_id = el_reporter.uuid
      where fi.school_id = $1
    `;
    const queryParams: any[] = [params.schoolId];
    let paramIndex = 2;

    if (params.status && params.status.length > 0) {
      query += ` and fi.status = ANY($${paramIndex++})`;
      queryParams.push(params.status);
    }
    if (params.category) {
      query += ` and fi.category = $${paramIndex++}`;
      queryParams.push(params.category);
    }
    if (params.personType) {
      query += ` and fi.person_type = $${paramIndex++}`;
      queryParams.push(params.personType);
    }
    if (params.personId) {
      query += ` and fi.person_id = $${paramIndex++}`;
      queryParams.push(params.personId);
    }
    if (params.assignedToId) {
      query += ` and fi.assigned_to_id = $${paramIndex++}`;
      queryParams.push(params.assignedToId);
    }
    if (params.startDate) {
      query += ` and fi.incident_date >= $${paramIndex++}`;
      queryParams.push(params.startDate);
    }
    if (params.endDate) {
      query += ` and fi.incident_date <= $${paramIndex++}`;
      queryParams.push(params.endDate);
    }
    if (params.search && params.search.trim()) {
      query += ` and lower(fi.description) like lower($${paramIndex++})`;
      queryParams.push(`%${params.search.trim()}%`);
    }

    query += ` order by fi.incident_date desc, fi.created_at desc`;

    const rows = await DB.query(query, queryParams);
    return rows.map((r: any) => this.parseNumericFields(r));
  }

  private parseNumericFields(incident: any): any {
    return {
      ...incident,
      suggestedFineAmount: incident.suggestedFineAmount != null ? parseFloat(incident.suggestedFineAmount) : null,
      decidedFineAmount: incident.decidedFineAmount != null ? parseFloat(incident.decidedFineAmount) : null,
    };
  }

  private parseCollectionNumericFields(collection: any): any {
    return {
      ...collection,
      amountCollected: collection.amountCollected != null ? parseFloat(collection.amountCollected) : null,
    };
  }

  private async getEmployeeName(employeeId: string): Promise<string> {
    const results = await DB.query(`select name from employee where uuid = $1`, [employeeId]);
    return results.length > 0 ? results[0].name : employeeId;
  }

  private async getLoginDisplayName(loginId: string): Promise<string> {
    const results = await DB.query(`select display_name from employee_login where uuid = $1`, [loginId]);
    return results.length > 0 ? results[0].displayName : loginId;
  }
}

export const fineIncidentService = new FineIncidentService();
