import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { SupplyCategory, CreateCategoryRequest, UpdateCategoryRequest } from './supply-interfaces';
import { DEFAULTS } from './supply-constants';
import { supplyService } from './supply-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48);
}

class SupplyCategoryService {
  // List active categories, seeding the school's defaults + item master on first use.
  public async list(schoolId: string, userId: string): Promise<SupplyCategory[]> {
    await supplyService.seedForSchool(schoolId, userId);
    return DB.query(
      singleLineString`
        select * from supply_category
        where school_id = $1 and status = 'active'
        order by name
      `,
      [schoolId]
    );
  }

  public async getById(id: string, schoolId: string): Promise<SupplyCategory | null> {
    const results = await DB.query(
      singleLineString`select * from supply_category where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  public async create(data: CreateCategoryRequest, schoolId: string, userId: string): Promise<SupplyCategory> {
    const code = (data.code && data.code.trim() ? slugify(data.code) : slugify(data.name)) || 'category';

    const dup = await DB.query(
      singleLineString`
        select 1 from supply_category
        where school_id = $1 and lower(code) = lower($2) and status = 'active' limit 1
      `,
      [schoolId, code]
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Category "${code}" already exists`);
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const results = await DB.query(
      singleLineString`
        insert into supply_category
        (uuid, school_id, code, name, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning *
      `,
      [uuid, schoolId, code, data.name.trim(), DEFAULTS.STATUS, userId, now]
    );
    return results[0];
  }

  public async update(id: string, data: UpdateCategoryRequest, schoolId: string, userId: string): Promise<SupplyCategory | null> {
    if (data.name === undefined) {
      return this.getById(id, schoolId);
    }
    const results = await DB.query(
      singleLineString`
        update supply_category
        set name = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and status = 'active'
        returning *
      `,
      [data.name.trim(), userId, new Date(), id, schoolId]
    );
    return results.length > 0 ? results[0] : null;
  }

  // Count of active items referencing a category (blocks deletion of in-use categories).
  public async countItemsUsingCategory(categoryId: string, schoolId: string): Promise<number> {
    const results = await DB.query(
      singleLineString`
        select count(*)::int as count from supply_item
        where school_id = $1 and category_id = $2 and status = 'active'
      `,
      [schoolId, categoryId]
    );
    return results.length > 0 ? results[0].count : 0;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    const inUse = await this.countItemsUsingCategory(id, schoolId);
    if (inUse > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot delete: ${inUse} item(s) still use this category`);
    }
    await DB.query(
      singleLineString`
        update supply_category
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId]
    );
  }
}

export const supplyCategoryService = new SupplyCategoryService();
