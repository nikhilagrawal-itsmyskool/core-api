import { DB, singleLineString } from '../../shared/lib/db';
import { LabBreakageLog, CreateBreakageLogRequest, UpdateBreakageLogRequest } from './lab-interfaces';
import { DEFAULTS } from './lab-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class LabBreakageService {
  public async create(
    data: CreateBreakageLogRequest,
    schoolId: string,
    userId: string
  ): Promise<LabBreakageLog> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    const insertQuery = singleLineString`
      insert into lab_breakage_log
      (uuid, item_id, lab_id, breakage_date, quantity, responsible_type, responsible_name, responsible_class, cause, estimated_cost, action_taken, breakage_status, remarks, status, school_id, createdby_userid, created_at, responsible_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `;

    const updateStockQuery = singleLineString`
      update lab_item
      set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;

    const insertParams = [
      uuid,
      data.itemId,
      data.labId,
      data.breakageDate,
      data.quantity,
      data.responsibleType || null,
      data.responsibleName || null,
      data.responsibleClass || null,
      data.cause || null,
      data.estimatedCost || null,
      data.actionTaken || null,
      data.breakageStatus || DEFAULTS.BREAKAGE_STATUS,
      data.remarks || null,
      DEFAULTS.STATUS,
      schoolId,
      userId,
      now,
      data.responsibleId || null,
    ];

    const updateStockParams = [data.quantity, userId, now, data.itemId, schoolId];

    await DB.queriesInTransaction(
      [insertQuery, updateStockQuery],
      [insertParams, updateStockParams]
    );

    return this.getById(uuid, schoolId) as Promise<LabBreakageLog>;
  }

  public async update(
    id: string,
    data: UpdateBreakageLogRequest,
    schoolId: string,
    userId: string
  ): Promise<LabBreakageLog | null> {
    const now = new Date();

    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return null;
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.breakageDate !== undefined) {
      updates.push(`breakage_date = $${paramIndex++}`);
      params.push(data.breakageDate);
    }
    if (data.quantity !== undefined) {
      updates.push(`quantity = $${paramIndex++}`);
      params.push(data.quantity);
    }
    if (data.responsibleType !== undefined) {
      updates.push(`responsible_type = $${paramIndex++}`);
      params.push(data.responsibleType);
    }
    if (data.responsibleName !== undefined) {
      updates.push(`responsible_name = $${paramIndex++}`);
      params.push(data.responsibleName);
    }
    if (data.responsibleClass !== undefined) {
      updates.push(`responsible_class = $${paramIndex++}`);
      params.push(data.responsibleClass);
    }
    if (data.responsibleId !== undefined) {
      updates.push(`responsible_id = $${paramIndex++}`);
      params.push(data.responsibleId);
    }
    if (data.cause !== undefined) {
      updates.push(`cause = $${paramIndex++}`);
      params.push(data.cause);
    }
    if (data.estimatedCost !== undefined) {
      updates.push(`estimated_cost = $${paramIndex++}`);
      params.push(data.estimatedCost);
    }
    if (data.actionTaken !== undefined) {
      updates.push(`action_taken = $${paramIndex++}`);
      params.push(data.actionTaken);
    }
    if (data.breakageStatus !== undefined) {
      updates.push(`breakage_status = $${paramIndex++}`);
      params.push(data.breakageStatus);
    }
    if (data.remarks !== undefined) {
      updates.push(`remarks = $${paramIndex++}`);
      params.push(data.remarks);
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

    const updateQuery = singleLineString`
      update lab_breakage_log
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++} and status = 'active'
    `;

    // If quantity changed, adjust stock
    if (data.quantity !== undefined && data.quantity !== existing.quantity) {
      const stockDiff = existing.quantity - data.quantity;
      const updateStockQuery = singleLineString`
        update lab_item
        set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `;

      await DB.queriesInTransaction(
        [updateQuery, updateStockQuery],
        [params, [stockDiff, userId, now, existing.itemId, schoolId]]
      );
    } else {
      await DB.query(updateQuery, params);
    }

    return this.getById(id, schoolId);
  }

  public async delete(
    id: string,
    schoolId: string,
    userId: string
  ): Promise<boolean> {
    const now = new Date();

    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return false;
    }

    const deleteQuery = singleLineString`
      update lab_breakage_log
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `;

    const updateStockQuery = singleLineString`
      update lab_item
      set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;

    await DB.queriesInTransaction(
      [deleteQuery, updateStockQuery],
      [
        [userId, now, id, schoolId],
        [existing.quantity, userId, now, existing.itemId, schoolId],
      ]
    );

    return true;
  }

  public async getById(id: string, schoolId: string): Promise<LabBreakageLog | null> {
    const query = `
      select b.*, i.name as item_name,
        case
          when b.responsible_type = 'teacher' then e.name
          when b.responsible_type = 'student' then s.name
          else b.responsible_name
        end as resolved_responsible_name,
        latest_class.class_name as resolved_responsible_class
      from lab_breakage_log b
      left join lab_item i on b.item_id = i.uuid
      left join employee e on b.responsible_type = 'teacher' and b.responsible_id = e.uuid
      left join student s on b.responsible_type = 'student' and b.responsible_id = s.uuid
      left join lateral (
        select c.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        join class c on sc.class_id = c.uuid
        where sc.student_id = b.responsible_id and b.responsible_type = 'student'
        order by ay.start_date desc limit 1
      ) latest_class on true
      where b.uuid = $1 and b.school_id = $2 and b.status = 'active'
    `;

    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async search(params: {
    schoolId: string;
    labId?: string;
    itemId?: string;
    startDate: string;
    endDate: string;
    includeDeleted?: boolean;
  }): Promise<LabBreakageLog[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";

    let query = `
      select b.*, i.name as item_name,
        case
          when b.responsible_type = 'teacher' then e.name
          when b.responsible_type = 'student' then s.name
          else b.responsible_name
        end as resolved_responsible_name,
        latest_class.class_name as resolved_responsible_class
      from lab_breakage_log b
      left join lab_item i on b.item_id = i.uuid
      left join employee e on b.responsible_type = 'teacher' and b.responsible_id = e.uuid
      left join student s on b.responsible_type = 'student' and b.responsible_id = s.uuid
      left join lateral (
        select c.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        join class c on sc.class_id = c.uuid
        where sc.student_id = b.responsible_id and b.responsible_type = 'student'
        order by ay.start_date desc limit 1
      ) latest_class on true
      where b.school_id = $1
        and b.status in ${statusFilter}
        and b.breakage_date >= $2
        and b.breakage_date <= $3
    `;
    const queryParams: any[] = [params.schoolId, params.startDate, params.endDate];
    let paramIndex = 4;

    if (params.labId) {
      query += ` and b.lab_id = $${paramIndex++}`;
      queryParams.push(params.labId);
    }

    if (params.itemId) {
      query += ` and b.item_id = $${paramIndex++}`;
      queryParams.push(params.itemId);
    }

    query += ` order by b.breakage_date desc`;

    return DB.query(query, queryParams);
  }
}

export const labBreakageService = new LabBreakageService();
