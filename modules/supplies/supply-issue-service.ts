import { DB, singleLineString } from '../../shared/lib/db';
import { SupplyIssueLog, CreateIssueLogRequest, UpdateIssueLogRequest, ReturnItemRequest } from './supply-interfaces';
import { DEFAULTS } from './supply-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SupplyIssueService {
  public async create(data: CreateIssueLogRequest, schoolId: string, userId: string): Promise<SupplyIssueLog> {
    const uuid = generateShortUuid(12);
    const now = new Date();
    const quantity = data.quantity ?? DEFAULTS.QUANTITY;

    const insertQuery = singleLineString`
      insert into supply_issue_log
      (uuid, school_id, item_id, issue_date, quantity, issue_type, issued_to, issued_to_type, issued_to_id, purpose, expected_return_date, returned, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `;
    const updateStockQuery = singleLineString`
      update supply_item set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;

    await DB.queriesInTransaction(
      [insertQuery, updateStockQuery],
      [
        [uuid, schoolId, data.itemId, data.issueDate, quantity, data.issueType, data.issuedTo || null, data.issuedToType || null, data.issuedToId || null, data.purpose || null, data.expectedReturnDate || null, false, DEFAULTS.STATUS, userId, now],
        [quantity, userId, now, data.itemId, schoolId],
      ]
    );
    return (await this.getById(uuid, schoolId))!;
  }

  public async update(id: string, data: UpdateIssueLogRequest, schoolId: string, userId: string): Promise<SupplyIssueLog | null> {
    const now = new Date();
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };
    if (data.issueDate !== undefined) set('issue_date', data.issueDate);
    if (data.quantity !== undefined) set('quantity', data.quantity);
    if (data.issueType !== undefined) set('issue_type', data.issueType);
    if (data.issuedTo !== undefined) set('issued_to', data.issuedTo);
    if (data.issuedToType !== undefined) set('issued_to_type', data.issuedToType);
    if (data.issuedToId !== undefined) set('issued_to_id', data.issuedToId);
    if (data.purpose !== undefined) set('purpose', data.purpose);
    if (data.expectedReturnDate !== undefined) set('expected_return_date', data.expectedReturnDate);

    if (updates.length === 0) return existing;

    set('updatedby_userid', userId);
    set('updated_at', now);
    params.push(id);
    params.push(schoolId);

    const updateQuery = singleLineString`
      update supply_issue_log set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
    `;

    if (data.quantity !== undefined && data.quantity !== existing.quantity) {
      const stockDiff = existing.quantity - data.quantity; // give back the difference
      const updateStockQuery = singleLineString`
        update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `;
      await DB.queriesInTransaction([updateQuery, updateStockQuery], [params, [stockDiff, userId, now, existing.itemId, schoolId]]);
    } else {
      await DB.query(updateQuery, params);
    }
    return this.getById(id, schoolId);
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const now = new Date();
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;

    const deleteQuery = singleLineString`
      update supply_issue_log set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `;
    if (!existing.returned) {
      const updateStockQuery = singleLineString`
        update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `;
      await DB.queriesInTransaction([deleteQuery, updateStockQuery], [[userId, now, id, schoolId], [existing.quantity, userId, now, existing.itemId, schoolId]]);
    } else {
      await DB.query(deleteQuery, [userId, now, id, schoolId]);
    }
    return true;
  }

  public async returnItem(id: string, data: ReturnItemRequest, schoolId: string, userId: string): Promise<SupplyIssueLog | null> {
    const now = new Date();
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    if (existing.returned) return existing;

    const updateQuery = singleLineString`
      update supply_issue_log set returned = true, return_date = $1, return_condition = $2, return_remarks = $3, updatedby_userid = $4, updated_at = $5
      where uuid = $6 and school_id = $7 and status = 'active'
    `;
    const updateParams = [data.returnDate, data.returnCondition, data.returnRemarks || null, userId, now, id, schoolId];

    if (data.returnCondition !== 'lost') {
      const updateStockQuery = singleLineString`
        update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5
      `;
      await DB.queriesInTransaction([updateQuery, updateStockQuery], [updateParams, [existing.quantity, userId, now, existing.itemId, schoolId]]);
    } else {
      await DB.query(updateQuery, updateParams);
    }
    return this.getById(id, schoolId);
  }

  private readonly selectWithJoins = `
    select il.*, i.name as item_name,
      case
        when il.issued_to_type = 'employee' then e.name
        when il.issued_to_type = 'student' then s.name
        when il.issued_to_type = 'class' then c.name
        else il.issued_to
      end as issued_to_name,
      latest_class.class_name as issued_to_class_name
    from supply_issue_log il
    left join supply_item i on il.item_id = i.uuid
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
  `;

  public async getById(id: string, schoolId: string): Promise<SupplyIssueLog | null> {
    const results = await DB.query(
      `${this.selectWithJoins} where il.uuid = $1 and il.school_id = $2 and il.status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async search(params: {
    schoolId: string; itemId?: string; issueType?: string; startDate: string; endDate: string; includeDeleted?: boolean;
  }): Promise<SupplyIssueLog[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";
    let query = `${this.selectWithJoins}
      where il.school_id = $1 and il.status in ${statusFilter}
        and il.issue_date >= $2 and il.issue_date <= $3
    `;
    const queryParams: any[] = [params.schoolId, params.startDate, params.endDate];
    let idx = 4;
    if (params.itemId) { query += ` and il.item_id = $${idx++}`; queryParams.push(params.itemId); }
    if (params.issueType) { query += ` and il.issue_type = $${idx++}`; queryParams.push(params.issueType); }
    query += ` order by il.issue_date desc`;
    return DB.query(query, queryParams);
  }
}

export const supplyIssueService = new SupplyIssueService();
