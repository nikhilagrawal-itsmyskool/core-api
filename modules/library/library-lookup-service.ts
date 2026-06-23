import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  LOOKUP_SEEDS,
  LOOKUP_TYPES,
  DDC_CLASS_COLORS,
  DEFAULTS,
  LookupType,
} from "./library-constants";
import {
  LibraryLookup,
  CreateLookupRequest,
  UpdateLookupRequest,
} from "./library-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Per-school managed lookups (color, age_band, almirah, shelf, edition,
// publisher, source). Types with entries in LOOKUP_SEEDS are populated on first
// use; the rest start empty and are entirely school-defined.
class LookupService {
  public async seedForSchool(schoolId: string, userId: string): Promise<void> {
    const now = new Date();
    for (const [lookupType, seeds] of Object.entries(LOOKUP_SEEDS)) {
      const existing = await DB.query(
        singleLineString`select 1 from library_lookup where school_id = $1 and lookup_type = $2 and status = 'active' limit 1`,
        [schoolId, lookupType],
      );
      if (existing.length > 0) continue;

      const queries: string[] = [];
      const params: any[][] = [];
      for (const seed of seeds) {
        queries.push(singleLineString`
          insert into library_lookup
          (uuid, school_id, lookup_type, code, label, extra, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `);
        params.push([
          generateShortUuid(12),
          schoolId,
          lookupType,
          seed.code,
          seed.label,
          seed.extra ? JSON.stringify(seed.extra) : null,
          DEFAULTS.STATUS,
          userId,
          now,
        ]);
      }
      if (queries.length > 0) await DB.queriesInTransaction(queries, params);
    }
    await this.reconcileColors(schoolId, userId);
  }

  // Self-heal for schools seeded before colors were keyed to DDC classes:
  // backfill `ddcClass` onto existing color rows and insert any missing class
  // colors (e.g. indigo=100s, teal=400s). Non-destructive to custom labels.
  public async reconcileColors(schoolId: string, userId: string): Promise<void> {
    const rows = await DB.query(
      singleLineString`select uuid, code, extra from library_lookup where school_id = $1 and lookup_type = 'color' and status = 'active'`,
      [schoolId],
    );
    if (rows.length === 0) return; // fresh school: LOOKUP_SEEDS already seeded with ddcClass
    const byCode = new Map(rows.map((r: any) => [String(r.code).toLowerCase(), r]));
    const existingClasses = new Set(
      rows.map((r: any) => r.extra && r.extra.ddcClass).filter(Boolean),
    );
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];
    for (const c of DDC_CLASS_COLORS) {
      const ex: any = byCode.get(c.code.toLowerCase());
      if (ex) {
        if (!ex.extra || !ex.extra.ddcClass) {
          queries.push(
            singleLineString`update library_lookup set extra = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4`,
          );
          params.push([
            JSON.stringify({ hex: c.hex, ddcClass: c.ddcClass }),
            userId,
            now,
            ex.uuid,
          ]);
        }
      } else if (!existingClasses.has(c.ddcClass)) {
        queries.push(
          singleLineString`
            insert into library_lookup
            (uuid, school_id, lookup_type, code, label, extra, status, createdby_userid, created_at)
            values ($1, $2, 'color', $3, $4, $5, $6, $7, $8)
          `,
        );
        params.push([
          generateShortUuid(12),
          schoolId,
          c.code,
          c.label,
          JSON.stringify({ hex: c.hex, ddcClass: c.ddcClass }),
          DEFAULTS.STATUS,
          userId,
          now,
        ]);
      }
    }
    if (queries.length > 0) await DB.queriesInTransaction(queries, params);
  }

  public async list(
    lookupType: LookupType | undefined,
    schoolId: string,
    userId: string,
  ): Promise<LibraryLookup[]> {
    await this.seedForSchool(schoolId, userId);
    if (lookupType) {
      return DB.query(
        singleLineString`
          select * from library_lookup
          where school_id = $1 and lookup_type = $2 and status = 'active'
          order by label
        `,
        [schoolId, lookupType],
      );
    }
    return DB.query(
      singleLineString`
        select * from library_lookup
        where school_id = $1 and status = 'active'
        order by lookup_type, label
      `,
      [schoolId],
    );
  }

  public async getById(
    id: string,
    schoolId: string,
  ): Promise<LibraryLookup | null> {
    const rows = await DB.query(
      singleLineString`select * from library_lookup where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async create(
    data: CreateLookupRequest,
    schoolId: string,
    userId: string,
  ): Promise<LibraryLookup> {
    if (!LOOKUP_TYPES.includes(data.lookupType)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Invalid lookup type "${data.lookupType}"`,
      );
    }
    const code = data.code.trim().toLowerCase();
    const dup = await DB.query(
      singleLineString`
        select 1 from library_lookup
        where school_id = $1 and lookup_type = $2 and lower(code) = lower($3) and status = 'active' limit 1
      `,
      [schoolId, data.lookupType, code],
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `${data.lookupType} "${code}" already exists`,
      );
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into library_lookup
        (uuid, school_id, lookup_type, code, label, extra, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning *
      `,
      [
        uuid,
        schoolId,
        data.lookupType,
        code,
        data.label.trim(),
        data.extra ? JSON.stringify(data.extra) : null,
        DEFAULTS.STATUS,
        userId,
        now,
      ],
    );
    return rows[0];
  }

  public async update(
    id: string,
    data: UpdateLookupRequest,
    schoolId: string,
    userId: string,
  ): Promise<LibraryLookup | null> {
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    if (data.label !== undefined) {
      updates.push(`label = $${i++}`);
      params.push(data.label);
    }
    if (data.extra !== undefined) {
      updates.push(`extra = $${i++}`);
      params.push(data.extra ? JSON.stringify(data.extra) : null);
    }
    if (updates.length === 0) return this.getById(id, schoolId);

    updates.push(`updatedby_userid = $${i++}`);
    params.push(userId);
    updates.push(`updated_at = $${i++}`);
    params.push(new Date());
    params.push(id);
    params.push(schoolId);

    const rows = await DB.query(
      singleLineString`
        update library_lookup set ${updates.join(", ")}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning *
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(
    id: string,
    schoolId: string,
    userId: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`
        update library_lookup set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
  }
}

export const lookupService = new LookupService();
