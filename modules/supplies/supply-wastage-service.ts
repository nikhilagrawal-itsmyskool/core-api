import { DB, singleLineString } from '../../shared/lib/db';
import { fileStorageService, StoredFileWithData } from '../../shared/lib/file-storage';
import { SupplyWastageLog, CreateWastageLogRequest, UpdateWastageLogRequest } from './supply-interfaces';
import { DEFAULTS } from './supply-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SupplyWastageService {
  public async create(data: CreateWastageLogRequest, schoolId: string, userId: string): Promise<SupplyWastageLog> {
    const uuid = generateShortUuid(12);
    const now = new Date();

    const insertQuery = singleLineString`
      insert into supply_wastage_log
      (uuid, school_id, item_id, wastage_date, quantity, reason, responsible_type, responsible_name, responsible_class, responsible_id, estimated_cost, action_taken, wastage_status, remarks, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
    `;
    const updateStockQuery = singleLineString`
      update supply_item set current_stock = current_stock - $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;

    await DB.queriesInTransaction(
      [insertQuery, updateStockQuery],
      [
        [uuid, schoolId, data.itemId, data.wastageDate, data.quantity, data.reason, data.responsibleType || null, data.responsibleName || null, data.responsibleClass || null, data.responsibleId || null, data.estimatedCost || null, data.actionTaken || null, data.wastageStatus || DEFAULTS.WASTAGE_STATUS, data.remarks || null, DEFAULTS.STATUS, userId, now],
        [data.quantity, userId, now, data.itemId, schoolId],
      ]
    );

    if (data.fileData) {
      const stored = await fileStorageService.upload({
        fileName: data.fileData.fileName, mimeType: data.fileData.mimeType, base64Data: data.fileData.base64Data,
        entityType: 'supply_wastage_log', entityId: uuid, schoolId, userId,
      });
      await DB.query(`update supply_wastage_log set file_id = $1 where uuid = $2 and school_id = $3`, [stored.uuid, uuid, schoolId]);
    }
    return (await this.getById(uuid, schoolId))!;
  }

  public async update(id: string, data: UpdateWastageLogRequest, schoolId: string, userId: string): Promise<SupplyWastageLog | null> {
    const now = new Date();
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };
    if (data.wastageDate !== undefined) set('wastage_date', data.wastageDate);
    if (data.quantity !== undefined) set('quantity', data.quantity);
    if (data.reason !== undefined) set('reason', data.reason);
    if (data.responsibleType !== undefined) set('responsible_type', data.responsibleType);
    if (data.responsibleName !== undefined) set('responsible_name', data.responsibleName);
    if (data.responsibleClass !== undefined) set('responsible_class', data.responsibleClass);
    if (data.responsibleId !== undefined) set('responsible_id', data.responsibleId);
    if (data.estimatedCost !== undefined) set('estimated_cost', data.estimatedCost);
    if (data.actionTaken !== undefined) set('action_taken', data.actionTaken);
    if (data.wastageStatus !== undefined) set('wastage_status', data.wastageStatus);
    if (data.remarks !== undefined) set('remarks', data.remarks);

    // Image upload / deletion folded into the same SET so file_id updates atomically.
    if (data.deleteFile && existing.fileId) {
      await fileStorageService.delete(existing.fileId, schoolId);
      set('file_id', null);
    } else if (data.fileData) {
      if (existing.fileId) await fileStorageService.delete(existing.fileId, schoolId);
      const stored = await fileStorageService.upload({
        fileName: data.fileData.fileName, mimeType: data.fileData.mimeType, base64Data: data.fileData.base64Data,
        entityType: 'supply_wastage_log', entityId: id, schoolId, userId,
      });
      set('file_id', stored.uuid);
    }

    if (updates.length === 0) return existing;

    set('updatedby_userid', userId);
    set('updated_at', now);
    params.push(id);
    params.push(schoolId);

    const updateQuery = singleLineString`
      update supply_wastage_log set ${updates.join(', ')}
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
      update supply_wastage_log set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `;
    const updateStockQuery = singleLineString`
      update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `;
    await DB.queriesInTransaction([deleteQuery, updateStockQuery], [[userId, now, id, schoolId], [existing.quantity, userId, now, existing.itemId, schoolId]]);
    return true;
  }

  private readonly selectWithJoins = `
    select w.*, i.name as item_name,
      case
        when w.responsible_type = 'teacher' then e.name
        when w.responsible_type = 'student' then s.name
        else w.responsible_name
      end as resolved_responsible_name,
      latest_class.class_name as resolved_responsible_class
    from supply_wastage_log w
    left join supply_item i on w.item_id = i.uuid
    left join employee e on w.responsible_type = 'teacher' and w.responsible_id = e.uuid
    left join student s on w.responsible_type = 'student' and w.responsible_id = s.uuid
    left join lateral (
      select c.name as class_name
      from student_class sc
      join academic_year ay on sc.academic_year_id = ay.uuid
      join class c on sc.class_id = c.uuid
      where sc.student_id = w.responsible_id and w.responsible_type = 'student'
      order by ay.start_date desc limit 1
    ) latest_class on true
  `;

  public async getById(id: string, schoolId: string): Promise<SupplyWastageLog | null> {
    const results = await DB.query(
      `${this.selectWithJoins} where w.uuid = $1 and w.school_id = $2 and w.status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async search(params: {
    schoolId: string; itemId?: string; reason?: string; startDate: string; endDate: string; includeDeleted?: boolean;
  }): Promise<SupplyWastageLog[]> {
    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";
    let query = `${this.selectWithJoins}
      where w.school_id = $1 and w.status in ${statusFilter}
        and w.wastage_date >= $2 and w.wastage_date <= $3
    `;
    const queryParams: any[] = [params.schoolId, params.startDate, params.endDate];
    let idx = 4;
    if (params.itemId) { query += ` and w.item_id = $${idx++}`; queryParams.push(params.itemId); }
    if (params.reason) { query += ` and w.reason = $${idx++}`; queryParams.push(params.reason); }
    query += ` order by w.wastage_date desc`;
    return DB.query(query, queryParams);
  }

  public async getImage(id: string, schoolId: string): Promise<StoredFileWithData | null> {
    const wastage = await this.getById(id, schoolId);
    if (!wastage?.fileId) return null;
    return fileStorageService.getWithData(wastage.fileId, schoolId);
  }

  public async deleteImage(id: string, schoolId: string, userId: string): Promise<void> {
    const wastage = await this.getById(id, schoolId);
    if (!wastage?.fileId) return;
    await fileStorageService.delete(wastage.fileId, schoolId);
    await DB.query(`update supply_wastage_log set file_id = null where uuid = $1 and school_id = $2`, [id, schoolId]);
  }
}

export const supplyWastageService = new SupplyWastageService();
