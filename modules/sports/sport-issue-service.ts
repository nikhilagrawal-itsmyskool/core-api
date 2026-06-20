import { DB, singleLineString } from '../../shared/lib/db';
import { SportIssueLog, CreateIssueLogRequest, UpdateIssueLogRequest, ReturnItemRequest } from './sport-interfaces';
import { DEFAULTS } from './sport-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SportIssueService {
  public async create(
    data: CreateIssueLogRequest,
    schoolId: string,
    userId: string
  ): Promise<SportIssueLog> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const quantity = data.quantity ?? DEFAULTS.QUANTITY;

    const insertQuery = singleLineString`
      insert into sport_issue_log
      (uuid, item_id, sport_type, issue_date, quantity, issue_type, issued_to, purpose, expected_return_date, returned, status, school_id, createdby_userid, created_at, issued_to_type, issued_to_id)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `;

    const updateStockQuery = singleLineString`
      update sport_item
      set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;

    const insertParams = [
      uuid,
      data.itemId,
      data.sportType,
      data.issueDate,
      quantity,
      data.issueType,
      data.issuedTo || null,
      data.purpose || null,
      data.expectedReturnDate || null,
      false,
      DEFAULTS.STATUS,
      schoolId,
      userId,
      now,
      data.issuedToType || null,
      data.issuedToId || null,
    ];

    const updateStockParams = [quantity, userId, now, data.itemId, schoolId];

    await DB.queriesInTransaction(
      [insertQuery, updateStockQuery],
      [insertParams, updateStockParams]
    );

    return this.getById(uuid, schoolId) as Promise<SportIssueLog>;
  }

  public async update(
    id: string,
    data: UpdateIssueLogRequest,
    schoolId: string,
    userId: string
  ): Promise<SportIssueLog | null> {
    const now = new Date();

    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return null;
    }

    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (data.issueDate !== undefined) {
      updates.push(`issue_date = $${paramIndex++}`);
      params.push(data.issueDate);
    }
    if (data.quantity !== undefined) {
      updates.push(`quantity = $${paramIndex++}`);
      params.push(data.quantity);
    }
    if (data.issueType !== undefined) {
      updates.push(`issue_type = $${paramIndex++}`);
      params.push(data.issueType);
    }
    if (data.issuedTo !== undefined) {
      updates.push(`issued_to = $${paramIndex++}`);
      params.push(data.issuedTo);
    }
    if (data.issuedToType !== undefined) {
      updates.push(`issued_to_type = $${paramIndex++}`);
      params.push(data.issuedToType);
    }
    if (data.issuedToId !== undefined) {
      updates.push(`issued_to_id = $${paramIndex++}`);
      params.push(data.issuedToId);
    }
    if (data.purpose !== undefined) {
      updates.push(`purpose = $${paramIndex++}`);
      params.push(data.purpose);
    }
    if (data.expectedReturnDate !== undefined) {
      updates.push(`expected_return_date = $${paramIndex++}`);
      params.push(data.expectedReturnDate);
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
      update sport_issue_log
      set ${updates.join(', ')}
      where uuid = $${paramIndex++} and school_id = $${paramIndex++} and status = 'active'
    `;

    if (data.quantity !== undefined && data.quantity !== existing.quantity) {
      const stockDiff = existing.quantity - data.quantity;
      const updateStockQuery = singleLineString`
        update sport_item
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
      update sport_issue_log
      set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `;

    // Restore stock only if not already returned
    if (!existing.returned) {
      const updateStockQuery = singleLineString`
        update sport_item
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
    } else {
      await DB.query(deleteQuery, [userId, now, id, schoolId]);
    }

    return true;
  }

  public async returnItem(
    id: string,
    data: ReturnItemRequest,
    schoolId: string,
    userId: string
  ): Promise<SportIssueLog | null> {
    const now = new Date();

    const existing = await this.getById(id, schoolId);
    if (!existing) {
      return null;
    }

    if (existing.returned) {
      return existing; // Already returned
    }

    const updateQuery = singleLineString`
      update sport_issue_log
      set returned = true, return_date = $1, return_condition = $2, return_remarks = $3,
          updatedby_userid = $4, updated_at = $5
      where uuid = $6 and school_id = $7 and status = 'active'
    `;

    const updateParams = [
      data.returnDate,
      data.returnCondition,
      data.returnRemarks || null,
      userId,
      now,
      id,
      schoolId,
    ];

    // Restore stock if returned in good or damaged condition (not lost)
    if (data.returnCondition !== 'lost') {
      const updateStockQuery = singleLineString`
        update sport_item
        set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `;

      await DB.queriesInTransaction(
        [updateQuery, updateStockQuery],
        [updateParams, [existing.quantity, userId, now, existing.itemId, schoolId]]
      );
    } else {
      await DB.query(updateQuery, updateParams);
    }

    return this.getById(id, schoolId);
  }

  public async getById(id: string, schoolId: string): Promise<SportIssueLog | null> {
    const query = `
      select il.*, i.name as item_name,
        case
          when il.issued_to_type = 'employee' then e.name
          when il.issued_to_type = 'student' then s.name
          when il.issued_to_type = 'class' then c.name
          else il.issued_to
        end as issued_to_name,
        latest_class.class_name as issued_to_class_name
      from sport_issue_log il
      left join sport_item i on il.item_id = i.uuid
      left join employee e on il.issued_to_type = 'employee' and il.issued_to_id = e.uuid
      left join student s on il.issued_to_type = 'student' and il.issued_to_id = s.uuid
      left join class c on il.issued_to_type = 'class' and il.issued_to_id = c.uuid
      left join lateral (
        select c2.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        join class c2 on sc.class_id = c2.uuid
        where sc.student_id = il.issued_to_id and il.issued_to_type = 'student'
        order by ay.start_date desc limit 1
      ) latest_class on true
      where il.uuid = $1 and il.school_id = $2 and il.status = 'active'
    `;

    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async search(params: {
    schoolId: string;
    sportType?: string;
    itemId?: string;
    issueType?: string;
    startDate: string;
    endDate: string;
    includeDeleted?: boolean;
  }): Promise<SportIssueLog[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";

    let query = `
      select il.*, i.name as item_name,
        case
          when il.issued_to_type = 'employee' then e.name
          when il.issued_to_type = 'student' then s.name
          when il.issued_to_type = 'class' then c.name
          else il.issued_to
        end as issued_to_name,
        latest_class.class_name as issued_to_class_name
      from sport_issue_log il
      left join sport_item i on il.item_id = i.uuid
      left join employee e on il.issued_to_type = 'employee' and il.issued_to_id = e.uuid
      left join student s on il.issued_to_type = 'student' and il.issued_to_id = s.uuid
      left join class c on il.issued_to_type = 'class' and il.issued_to_id = c.uuid
      left join lateral (
        select c2.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        join class c2 on sc.class_id = c2.uuid
        where sc.student_id = il.issued_to_id and il.issued_to_type = 'student'
        order by ay.start_date desc limit 1
      ) latest_class on true
      where il.school_id = $1
        and il.status in ${statusFilter}
        and il.issue_date >= $2
        and il.issue_date <= $3
    `;
    const queryParams: any[] = [params.schoolId, params.startDate, params.endDate];
    let paramIndex = 4;

    if (params.sportType) {
      query += ` and il.sport_type = $${paramIndex++}`;
      queryParams.push(params.sportType);
    }

    if (params.itemId) {
      query += ` and il.item_id = $${paramIndex++}`;
      queryParams.push(params.itemId);
    }

    if (params.issueType) {
      query += ` and il.issue_type = $${paramIndex++}`;
      queryParams.push(params.issueType);
    }

    query += ` order by il.issue_date desc`;

    return DB.query(query, queryParams);
  }
}

export const sportIssueService = new SportIssueService();
