import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { AssetType, CreateAssetTypeRequest, UpdateAssetTypeRequest } from './asset-interfaces';
import { ASSET_TYPE_SEEDS, DEFAULTS } from './asset-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class AssetTypeService {
  // Resolve a school's internal uuid from its public code.
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  // Seed the default asset types for a school. Idempotent and self-healing:
  // - empty school -> full seed
  // - already-seeded school -> insert any newly-added default types and backfill
  //   null tag_abbr/include_in_tag (so schools seeded before tags existed catch up)
  public async seedForSchool(schoolId: string, userId: string): Promise<void> {
    const existing: any[] = await DB.query(
      singleLineString`select code, tag_abbr from asset_type where school_id = $1 and status = 'active'`,
      [schoolId]
    );
    const now = new Date();

    if (existing.length === 0) {
      const queries: string[] = [];
      const params: any[][] = [];
      for (const seed of ASSET_TYPE_SEEDS) {
        queries.push(singleLineString`
          insert into asset_type
          (uuid, school_id, code, label, kind, tag_abbr, include_in_tag, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `);
        params.push([generateShortUuid(12), schoolId, seed.code, seed.label, seed.kind, seed.tagAbbr, seed.includeInTag, DEFAULTS.STATUS, userId, now]);
      }
      await DB.queriesInTransaction(queries, params);
      return;
    }

    const existingCodes = new Set(existing.map((e) => String(e.code).toLowerCase()));
    const missing = ASSET_TYPE_SEEDS.filter((s) => !existingCodes.has(s.code.toLowerCase()));
    const needsBackfill = existing.some((e) => e.tagAbbr === null || e.tagAbbr === undefined);
    if (missing.length === 0 && !needsBackfill) {
      return;
    }

    const queries: string[] = [];
    const params: any[][] = [];
    for (const seed of missing) {
      queries.push(singleLineString`
        insert into asset_type
        (uuid, school_id, code, label, kind, tag_abbr, include_in_tag, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `);
      params.push([generateShortUuid(12), schoolId, seed.code, seed.label, seed.kind, seed.tagAbbr, seed.includeInTag, DEFAULTS.STATUS, userId, now]);
    }
    if (needsBackfill) {
      for (const seed of ASSET_TYPE_SEEDS) {
        queries.push(singleLineString`
          update asset_type
          set tag_abbr = coalesce(tag_abbr, $1), include_in_tag = coalesce(include_in_tag, $2)
          where school_id = $3 and lower(code) = lower($4) and status = 'active'
            and (tag_abbr is null or include_in_tag is null)
        `);
        params.push([seed.tagAbbr, seed.includeInTag, schoolId, seed.code]);
      }
    }
    await DB.queriesInTransaction(queries, params);
  }

  // List active asset types, seeding defaults on first use.
  public async list(schoolId: string, userId: string): Promise<AssetType[]> {
    await this.seedForSchool(schoolId, userId);
    const query = singleLineString`
      select * from asset_type
      where school_id = $1 and status = 'active'
      order by kind, label
    `;
    return DB.query(query, [schoolId]);
  }

  public async getById(id: string, schoolId: string): Promise<AssetType | null> {
    const query = singleLineString`
      select * from asset_type
      where uuid = $1 and school_id = $2 and status = 'active'
    `;
    const results = await DB.query(query, [id, schoolId]);
    return results.length > 0 ? results[0] : null;
  }

  public async create(data: CreateAssetTypeRequest, schoolId: string, userId: string): Promise<AssetType> {
    const code = data.code.trim().toLowerCase();

    const dup = await DB.query(
      singleLineString`
        select 1 from asset_type
        where school_id = $1 and lower(code) = lower($2) and status = 'active' limit 1
      `,
      [schoolId, code]
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Asset type "${code}" already exists`);
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const tagAbbr = data.tagAbbr && data.tagAbbr.trim() ? data.tagAbbr.trim().toLowerCase() : code.slice(0, 8);
    const includeInTag = data.includeInTag === undefined ? true : !!data.includeInTag;
    const query = singleLineString`
      insert into asset_type
      (uuid, school_id, code, label, kind, tag_abbr, include_in_tag, status, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      returning *
    `;
    const results = await DB.query(query, [uuid, schoolId, code, data.label.trim(), data.kind, tagAbbr, includeInTag, DEFAULTS.STATUS, userId, now]);
    return results[0];
  }

  public async update(id: string, data: UpdateAssetTypeRequest, schoolId: string, userId: string): Promise<AssetType | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;

    if (data.label !== undefined) {
      updates.push(`label = $${i++}`);
      params.push(data.label);
    }
    if (data.kind !== undefined) {
      updates.push(`kind = $${i++}`);
      params.push(data.kind);
    }
    if (data.tagAbbr !== undefined) {
      updates.push(`tag_abbr = $${i++}`);
      params.push(data.tagAbbr && data.tagAbbr.trim() ? data.tagAbbr.trim().toLowerCase() : null);
    }
    if (data.includeInTag !== undefined) {
      updates.push(`include_in_tag = $${i++}`);
      params.push(!!data.includeInTag);
    }

    if (updates.length === 0) {
      return this.getById(id, schoolId);
    }

    updates.push(`updatedby_userid = $${i++}`);
    params.push(userId);
    updates.push(`updated_at = $${i++}`);
    params.push(new Date());

    params.push(id);
    params.push(schoolId);

    const query = singleLineString`
      update asset_type
      set ${updates.join(', ')}
      where uuid = $${i++} and school_id = $${i++} and status = 'active'
      returning *
    `;
    const results = await DB.query(query, params);
    return results.length > 0 ? results[0] : null;
  }

  // Count of active assets referencing a type (used to block deletion).
  public async countAssetsUsingType(typeId: string, schoolId: string): Promise<number> {
    const results = await DB.query(
      singleLineString`
        select count(*)::int as count from asset
        where school_id = $1 and type_id = $2 and status = 'active'
      `,
      [schoolId, typeId]
    );
    return results.length > 0 ? results[0].count : 0;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    const inUse = await this.countAssetsUsingType(id, schoolId);
    if (inUse > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot delete: ${inUse} asset(s) still use this type`);
    }
    await DB.query(
      singleLineString`
        update asset_type
        set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId]
    );
  }
}

export const assetTypeService = new AssetTypeService();
