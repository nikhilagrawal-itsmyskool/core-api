import { DB, singleLineString } from '../../shared/lib/db';
import { DEFAULT_SUPPLY_CATEGORIES, DEFAULTS } from './supply-constants';
import { SUPPLY_ITEM_SEEDS, SUPPLY_ITEM_MASTER_VERSION } from './supply-item-seeds';
import { normalizeName } from './supply-util';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class SupplyService {
  // Resolve a school's internal uuid from its public code.
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  // Seed default categories + the curated item master into a school, versioned
  // and idempotent. INSERT-ONLY DELTA: only categories/items the school has
  // never had (keyed on code / name+category across all statuses) are added.
  // Existing rows are never updated, deleted, or resurrected. A version bump on
  // the master pushes just the new items to already-seeded schools.
  public async seedForSchool(schoolId: string, userId: string): Promise<void> {
    const state = await DB.query(
      singleLineString`select seeded_version from supply_seed_state where school_id = $1`,
      [schoolId]
    );
    if (state.length > 0 && Number(state[0].seededVersion) >= SUPPLY_ITEM_MASTER_VERSION) {
      return; // already at/above current catalog version
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // --- Categories: map active code -> id; track every code ever seen ---
    const existingCats: any[] = await DB.query(
      singleLineString`select uuid, code, status from supply_category where school_id = $1`,
      [schoolId]
    );
    const activeCodeToId = new Map<string, string>();
    const seenCodes = new Set<string>();
    for (const c of existingCats) {
      seenCodes.add(String(c.code).toLowerCase());
      if (c.status === 'active') activeCodeToId.set(String(c.code).toLowerCase(), c.uuid);
    }

    for (const cat of DEFAULT_SUPPLY_CATEGORIES) {
      const codeKey = cat.code.toLowerCase();
      if (seenCodes.has(codeKey)) continue; // never re-add a code the school has seen
      const uuid = generateShortUuid(12);
      queries.push(singleLineString`
        insert into supply_category
        (uuid, school_id, code, name, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
      `);
      params.push([uuid, schoolId, cat.code, cat.name, DEFAULTS.STATUS, userId, now]);
      activeCodeToId.set(codeKey, uuid);
    }

    // --- Items: insert only those the school does not already have ---
    const existingItems: any[] = await DB.query(
      singleLineString`select uuid, name, category_id from supply_item where school_id = $1`,
      [schoolId]
    );
    const existingKeys = new Set<string>();
    for (const it of existingItems) {
      existingKeys.add(`${normalizeName(it.name)}|${it.categoryId}`);
    }

    // Every resolvable seed key — used both to skip re-inserting and to back-fill
    // is_seeded on pre-existing rows that match the master (see self-heal below).
    const seedKeySet = new Set<string>();
    for (const seed of SUPPLY_ITEM_SEEDS) {
      const categoryId = activeCodeToId.get(seed.categoryCode.toLowerCase());
      if (!categoryId) continue; // category was deleted by the school — skip
      const key = `${normalizeName(seed.name)}|${categoryId}`;
      seedKeySet.add(key);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      queries.push(singleLineString`
        insert into supply_item
        (uuid, school_id, category_id, name, item_type, unit, current_stock, reorder_level, status, is_seeded, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10, $11)
      `);
      params.push([
        generateShortUuid(12), schoolId, categoryId, seed.name, seed.itemType, seed.unit,
        DEFAULTS.CURRENT_STOCK, DEFAULTS.REORDER_LEVEL, DEFAULTS.STATUS, userId, now,
      ]);
    }

    // Self-heal: mark pre-existing rows that match the master as seeded. Needed for
    // schools seeded under v1, before the is_seeded column existed.
    const toMark = existingItems
      .filter((it) => seedKeySet.has(`${normalizeName(it.name)}|${it.categoryId}`))
      .map((it) => it.uuid);
    if (toMark.length > 0) {
      queries.push(singleLineString`
        update supply_item set is_seeded = true
        where school_id = $1 and uuid = any($2) and is_seeded is distinct from true
      `);
      params.push([schoolId, toMark]);
    }

    // --- Marker: upsert to the current catalog version ---
    queries.push(singleLineString`
      insert into supply_seed_state (school_id, seeded_version, seeded_at)
      values ($1, $2, $3)
      on conflict (school_id) do update set seeded_version = excluded.seeded_version, seeded_at = excluded.seeded_at
    `);
    params.push([schoolId, SUPPLY_ITEM_MASTER_VERSION, now]);

    await DB.queriesInTransaction(queries, params);
  }

  // --- Per-school module settings (one row per school; default-in-code) ---
  public async getConfig(schoolId: string): Promise<{ schoolId: string; hideSeededItems: boolean }> {
    const rows = await DB.query(
      singleLineString`select hide_seeded_items from supply_config where school_id = $1`,
      [schoolId]
    );
    return { schoolId, hideSeededItems: rows.length > 0 ? !!rows[0].hideSeededItems : false };
  }

  public async updateConfig(
    schoolId: string,
    data: { hideSeededItems?: boolean },
    userId: string
  ): Promise<{ schoolId: string; hideSeededItems: boolean }> {
    const now = new Date();
    const hide = !!data.hideSeededItems;
    const existing = await DB.query(
      singleLineString`select school_id from supply_config where school_id = $1`,
      [schoolId]
    );
    if (existing.length > 0) {
      await DB.query(
        singleLineString`update supply_config set hide_seeded_items = $1, updatedby_userid = $2, updated_at = $3 where school_id = $4`,
        [hide, userId, now, schoolId]
      );
    } else {
      await DB.query(
        singleLineString`insert into supply_config (school_id, hide_seeded_items, updatedby_userid, updated_at) values ($1, $2, $3, $4)`,
        [schoolId, hide, userId, now]
      );
    }
    return this.getConfig(schoolId);
  }
}

export const supplyService = new SupplyService();
