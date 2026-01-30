import { DB, singleLineString } from '../../shared/lib/db';
import { MedicalIssueLog, CreateIssueLogRequest, UpdateIssueLogRequest } from './medical-interfaces';
import { DEFAULTS } from './medical-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class MedicalIssueService {
  public async create(
    data: CreateIssueLogRequest,
    schoolId: string,
    userId: string
  ): Promise<MedicalIssueLog> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const quantity = data.quantity ?? DEFAULTS.QUANTITY;

    // Use transaction to insert issue and update stock
    const insertQuery = singleLineString`
      insert into medical_issue_log
      (uuid, item_id, issue_date, entity_type, entity_id, quantity, remarks, parent_consent, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `;

    const updateStockQuery = singleLineString`
      update medical_item
      set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;

    const insertParams = [
      uuid,
      data.itemId,
      data.issueDate,
      data.entityType,
      data.entityId,
      quantity,
      data.remarks || null,
      data.parentConsent ?? DEFAULTS.PARENT_CONSENT,
      DEFAULTS.STATUS,
      schoolId,
      userId,
      now,
    ];

    const updateStockParams = [quantity, userId, now, data.itemId, schoolId];

    await DB.queriesInTransaction(
      [insertQuery, updateStockQuery],
      [insertParams, updateStockParams]
    );

    return this.getById(uuid, schoolId) as Promise<MedicalIssueLog>;
  }

  public async update(
    id: string,
    data: UpdateIssueLogRequest,
    schoolId: string,
    userId: string
  ): Promise<MedicalIssueLog | null> {
    const now = new Date();

    // Get existing issue to calculate stock difference
    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return null;
    }

    // Build dynamic update query
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.issueDate !== undefined) {
      updates.push(`issue_date = $${paramIndex++}`);
      params.push(data.issueDate);
    }
    if (data.entityType !== undefined) {
      updates.push(`entity_type = $${paramIndex++}`);
      params.push(data.entityType);
    }
    if (data.entityId !== undefined) {
      updates.push(`entity_id = $${paramIndex++}`);
      params.push(data.entityId);
    }
    if (data.quantity !== undefined) {
      updates.push(`quantity = $${paramIndex++}`);
      params.push(data.quantity);
    }
    if (data.remarks !== undefined) {
      updates.push(`remarks = $${paramIndex++}`);
      params.push(data.remarks);
    }
    if (data.parentConsent !== undefined) {
      updates.push(`parent_consent = $${paramIndex++}`);
      params.push(data.parentConsent);
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
      update medical_issue_log
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++} and status = 'active'
    `;

    // If quantity changed, update stock
    if (data.quantity !== undefined && data.quantity !== existing.quantity) {
      // Stock adjustment: add back old quantity, subtract new quantity
      const stockDiff = existing.quantity - data.quantity;
      const updateStockQuery = singleLineString`
        update medical_item
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

    // Get existing issue to reverse stock
    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return false;
    }

    const deleteQuery = singleLineString`
      update medical_issue_log
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `;

    // Restore stock (add back the issued quantity)
    const updateStockQuery = singleLineString`
      update medical_item
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

  public async getById(id: string, schoolId: string): Promise<MedicalIssueLog | null> {
    const query = singleLineString`
      select il.*, i.name as item_name,
        case when il.entity_type = 'employee' then e.name else s.name end as entity_name,
        latest_class.class_name as entity_class_name
      from medical_issue_log il
      left join medical_item i on il.item_id = i.uuid
      left join employee e on il.entity_type = 'employee' and il.entity_id = e.uuid
      left join student s on il.entity_type = 'student' and il.entity_id = s.uuid
      left join lateral (
        select c.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        join class c on sc.class_id = c.uuid
        where sc.student_id = il.entity_id and il.entity_type = 'student'
        order by ay.start_date desc
        limit 1
      ) latest_class on true
      where il.uuid = $1 and il.school_id = $2 and il.status = 'active'
    `;

    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async listByItem(itemId: string, schoolId: string): Promise<MedicalIssueLog[]> {
    const query = singleLineString`
      select il.*, i.name as item_name,
        case when il.entity_type = 'employee' then e.name else s.name end as entity_name,
        latest_class.class_name as entity_class_name
      from medical_issue_log il
      left join medical_item i on il.item_id = i.uuid
      left join employee e on il.entity_type = 'employee' and il.entity_id = e.uuid
      left join student s on il.entity_type = 'student' and il.entity_id = s.uuid
      left join lateral (
        select c.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        join class c on sc.class_id = c.uuid
        where sc.student_id = il.entity_id and il.entity_type = 'student'
        order by ay.start_date desc
        limit 1
      ) latest_class on true
      where il.item_id = $1 and il.school_id = $2 and il.status = 'active'
      order by il.issue_date desc
    `;
    return DB.query(query, [itemId, schoolId]);
  }

  public async listByEntity(
    entityType: string,
    entityId: string,
    schoolId: string
  ): Promise<MedicalIssueLog[]> {
    const query = singleLineString`
      select il.*, i.name as item_name,
        case when il.entity_type = 'employee' then e.name else s.name end as entity_name,
        latest_class.class_name as entity_class_name
      from medical_issue_log il
      left join medical_item i on il.item_id = i.uuid
      left join employee e on il.entity_type = 'employee' and il.entity_id = e.uuid
      left join student s on il.entity_type = 'student' and il.entity_id = s.uuid
      left join lateral (
        select c.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        join class c on sc.class_id = c.uuid
        where sc.student_id = il.entity_id and il.entity_type = 'student'
        order by ay.start_date desc
        limit 1
      ) latest_class on true
      where il.entity_type = $1 and il.entity_id = $2 and il.school_id = $3 and il.status = 'active'
      order by il.issue_date desc
    `;
    return DB.query(query, [entityType, entityId, schoolId]);
  }

  public async search(params: {
    schoolId: string;
    itemId?: string;
    entityType?: string;
    entityId?: string;
    startDate: string;
    endDate: string;
    includeDeleted?: boolean;
  }): Promise<MedicalIssueLog[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";

    let query = `
      select il.*, i.name as item_name,
        case when il.entity_type = 'employee' then e.name else s.name end as entity_name,
        latest_class.class_name as entity_class_name
      from medical_issue_log il
      left join medical_item i on il.item_id = i.uuid
      left join employee e on il.entity_type = 'employee' and il.entity_id = e.uuid
      left join student s on il.entity_type = 'student' and il.entity_id = s.uuid
      left join lateral (
        select c.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        join class c on sc.class_id = c.uuid
        where sc.student_id = il.entity_id and il.entity_type = 'student'
        order by ay.start_date desc
        limit 1
      ) latest_class on true
      where il.school_id = $1
        and il.status in ${statusFilter}
        and il.issue_date >= $2
        and il.issue_date <= $3
    `;
    const queryParams: any[] = [params.schoolId, params.startDate, params.endDate];
    let paramIndex = 4;

    if (params.itemId) {
      query += ` and il.item_id = $${paramIndex++}`;
      queryParams.push(params.itemId);
    }

    if (params.entityType) {
      query += ` and il.entity_type = $${paramIndex++}`;
      queryParams.push(params.entityType);
    }

    if (params.entityId) {
      query += ` and il.entity_id = $${paramIndex++}`;
      queryParams.push(params.entityId);
    }

    query += ` order by il.issue_date desc`;

    return DB.query(query, queryParams);
  }
}

export const medicalIssueService = new MedicalIssueService();
