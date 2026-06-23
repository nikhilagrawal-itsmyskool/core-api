import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  SupplyItem, CreateItemRequest, UpdateItemRequest,
  ItemCandidate, NeedsConfirmationResult,
} from './supply-interfaces';
import { DEFAULTS } from './supply-constants';
import { normalizeName, isNearMatch } from './supply-util';
import { supplyService } from './supply-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SupplyItemService {
  // Active items in a category, used by the hygiene guard (small set).
  private async activeItemsInCategory(categoryId: string, schoolId: string): Promise<any[]> {
    return DB.query(
      singleLineString`
        select uuid, name, unit, current_stock from supply_item
        where school_id = $1 and category_id = $2 and status = 'active'
      `,
      [schoolId, categoryId]
    );
  }

  // Find the exact (normalized) reuse target + near-match candidates in one pass.
  public guardName(
    name: string,
    items: any[]
  ): { exact?: any; candidates: ItemCandidate[] } {
    const norm = normalizeName(name);
    let exact: any | undefined;
    const candidates: ItemCandidate[] = [];
    for (const it of items) {
      const itNorm = normalizeName(it.name);
      if (itNorm === norm) {
        exact = it;
      } else if (isNearMatch(norm, itNorm)) {
        candidates.push({ itemId: it.uuid, name: it.name, unit: it.unit, currentStock: it.currentStock });
      }
    }
    return { exact, candidates };
  }

  public async categoryExists(categoryId: string, schoolId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from supply_category where uuid = $1 and school_id = $2 and status = 'active' limit 1`,
      [categoryId, schoolId]
    );
    return rows.length > 0;
  }

  public async create(
    data: CreateItemRequest,
    schoolId: string,
    userId: string
  ): Promise<SupplyItem | NeedsConfirmationResult> {
    if (!(await this.categoryExists(data.categoryId, schoolId))) {
      throw new BusinessErrorResult(ErrorCode.InvalidId, 'Category not found');
    }

    const items = await this.activeItemsInCategory(data.categoryId, schoolId);
    const { exact, candidates } = this.guardName(data.name, items);

    // Exact normalized match -> reuse the existing item instead of duplicating.
    if (exact) {
      return (await this.getById(exact.uuid, schoolId))!;
    }

    // Near-match typo guard: require explicit confirmation to create anyway.
    if (candidates.length > 0 && !data.confirmNewItem) {
      return { needsConfirmation: true, conflicts: [{ lineIndex: 0, proposedName: data.name, candidates }] };
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const results = await DB.query(
      singleLineString`
        insert into supply_item
        (uuid, school_id, category_id, name, item_type, unit, current_stock, reorder_level, location, item_condition, cost_per_unit, comments, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        returning *
      `,
      [
        uuid, schoolId, data.categoryId, data.name.trim(),
        data.itemType || DEFAULTS.ITEM_TYPE, data.unit,
        DEFAULTS.CURRENT_STOCK, data.reorderLevel ?? DEFAULTS.REORDER_LEVEL,
        data.location || null,
        data.itemCondition || (data.itemType === 'equipment' ? DEFAULTS.ITEM_CONDITION : null),
        data.costPerUnit || null, data.comments || null,
        DEFAULTS.STATUS, userId, now,
      ]
    );
    return results[0];
  }

  public async update(id: string, data: UpdateItemRequest, schoolId: string, userId: string): Promise<SupplyItem | null> {
    if (data.categoryId !== undefined && !(await this.categoryExists(data.categoryId, schoolId))) {
      throw new BusinessErrorResult(ErrorCode.InvalidId, 'Category not found');
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };
    if (data.categoryId !== undefined) set('category_id', data.categoryId);
    if (data.name !== undefined) set('name', data.name.trim());
    if (data.unit !== undefined) set('unit', data.unit);
    if (data.itemType !== undefined) set('item_type', data.itemType);
    if (data.reorderLevel !== undefined) set('reorder_level', data.reorderLevel);
    if (data.location !== undefined) set('location', data.location);
    if (data.itemCondition !== undefined) set('item_condition', data.itemCondition);
    if (data.costPerUnit !== undefined) set('cost_per_unit', data.costPerUnit);
    if (data.comments !== undefined) set('comments', data.comments);

    if (updates.length === 0) {
      return this.getById(id, schoolId);
    }

    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id);
    params.push(schoolId);

    const results = await DB.query(
      singleLineString`
        update supply_item set ${updates.join(', ')}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning *
      `,
      params
    );
    return results.length > 0 ? results[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    await DB.query(
      singleLineString`
        update supply_item set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId]
    );
    return true;
  }

  public async getById(id: string, schoolId: string): Promise<SupplyItem | null> {
    const results = await DB.query(
      singleLineString`
        select i.*, c.name as category_name
        from supply_item i
        left join supply_category c on i.category_id = c.uuid
        where i.uuid = $1 and i.school_id = $2 and i.status = 'active'
      `,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async search(params: {
    schoolId: string;
    userId: string;
    categoryId?: string;
    itemType?: string;
    searchTerm?: string;
    lowStock?: boolean;
    includeDeleted?: boolean;
  }): Promise<SupplyItem[]> {
    // Seed defaults + master on first use so the typeahead is populated.
    await supplyService.seedForSchool(params.schoolId, params.userId);

    const statusFilter = params.includeDeleted ? "('active', 'deleted')" : "('active')";
    let query = `
      select i.*, c.name as category_name
      from supply_item i
      left join supply_category c on i.category_id = c.uuid
      where i.school_id = $1 and i.status in ${statusFilter}
    `;
    const queryParams: any[] = [params.schoolId];
    let idx = 2;

    if (params.categoryId) {
      query += ` and i.category_id = $${idx++}`;
      queryParams.push(params.categoryId);
    }
    if (params.itemType) {
      query += ` and i.item_type = $${idx++}`;
      queryParams.push(params.itemType);
    }
    if (params.searchTerm && params.searchTerm.trim()) {
      query += ` and (lower(i.name) like lower($${idx}) or lower(i.comments) like lower($${idx}))`;
      queryParams.push(`%${params.searchTerm.trim()}%`);
      idx++;
    }
    if (params.lowStock) {
      query += ` and i.reorder_level > 0 and i.current_stock <= i.reorder_level`;
    }

    query += ` order by i.name`;
    return DB.query(query, queryParams);
  }

  // Merge a duplicate (source) into target: repoint all logs, move stock, soft-delete source.
  public async merge(sourceId: string, targetItemId: string, schoolId: string, userId: string): Promise<SupplyItem | null> {
    if (sourceId === targetItemId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Cannot merge an item into itself');
    }
    const source = await this.getById(sourceId, schoolId);
    const target = await this.getById(targetItemId, schoolId);
    if (!source) throw new BusinessErrorResult(ErrorCode.InvalidId, 'Source item not found');
    if (!target) throw new BusinessErrorResult(ErrorCode.InvalidId, 'Target item not found');

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    for (const table of ['supply_purchase_log', 'supply_issue_log', 'supply_wastage_log']) {
      queries.push(singleLineString`
        update ${table} set item_id = $1, updatedby_userid = $2, updated_at = $3
        where item_id = $4 and school_id = $5
      `);
      params.push([targetItemId, userId, now, sourceId, schoolId]);
    }

    queries.push(singleLineString`
      update supply_item set current_stock = current_stock + $1, updatedby_userid = $2, updated_at = $3
      where uuid = $4 and school_id = $5
    `);
    params.push([source.currentStock || 0, userId, now, targetItemId, schoolId]);

    queries.push(singleLineString`
      update supply_item set status = 'deleted', updatedby_userid = $1, updated_at = $2
      where uuid = $3 and school_id = $4 and status = 'active'
    `);
    params.push([userId, now, sourceId, schoolId]);

    await DB.queriesInTransaction(queries, params);
    return this.getById(targetItemId, schoolId);
  }
}

export const supplyItemService = new SupplyItemService();
