import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  LOOKUP_TYPES,
  LOOKUP_SEEDS,
  AUTO_CREATE_TYPES,
  DEFAULTS,
  LookupType,
} from './student-constants';
import {
  StudentLookup,
  CreateLookupRequest,
  UpdateLookupRequest,
} from './student-interfaces';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Per-school coded reference data (category, blood_group, nationality, country,
// mother_tongue, relationship, state, city, locality). Types in LOOKUP_SEEDS are
// populated on first use; `city`/`locality` start empty and grow via resolveCode
// (reuse exact code, else create) during address entry.
class StudentLookupService {
  private normalizeCode(value: string): string {
    // Cap at 64 to match student_lookup.code / student_address.*_code widths.
    return value.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 64);
  }

  public async seedForSchool(schoolId: string, userId: string): Promise<void> {
    const now = new Date();
    for (const [lookupType, seeds] of Object.entries(LOOKUP_SEEDS)) {
      const existing = await DB.query(
        singleLineString`select 1 from student_lookup where school_id = $1 and lookup_type = $2 and status = 'active' limit 1`,
        [schoolId, lookupType]
      );
      if (existing.length > 0) continue;

      const queries: string[] = [];
      const params: any[][] = [];
      for (const seed of seeds) {
        queries.push(singleLineString`
          insert into student_lookup
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
  }

  public async list(
    lookupType: LookupType | undefined,
    schoolId: string,
    userId: string
  ): Promise<StudentLookup[]> {
    await this.seedForSchool(schoolId, userId);
    if (lookupType) {
      return DB.query(
        singleLineString`
          select * from student_lookup
          where school_id = $1 and lookup_type = $2 and status = 'active'
          order by label
        `,
        [schoolId, lookupType]
      );
    }
    return DB.query(
      singleLineString`
        select * from student_lookup
        where school_id = $1 and status = 'active'
        order by lookup_type, label
      `,
      [schoolId]
    );
  }

  public async getById(id: string, schoolId: string): Promise<StudentLookup | null> {
    const rows = await DB.query(
      singleLineString`select * from student_lookup where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async create(
    data: CreateLookupRequest,
    schoolId: string,
    userId: string
  ): Promise<StudentLookup> {
    if (!(LOOKUP_TYPES as readonly string[]).includes(data.lookupType)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid lookup type "${data.lookupType}"`);
    }
    if (!data.code || !data.code.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'code is required');
    }
    const code = this.normalizeCode(data.code);
    const dup = await DB.query(
      singleLineString`
        select 1 from student_lookup
        where school_id = $1 and lookup_type = $2 and lower(code) = lower($3) and status = 'active' limit 1
      `,
      [schoolId, data.lookupType, code]
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `${data.lookupType} "${code}" already exists`);
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into student_lookup
        (uuid, school_id, lookup_type, code, label, extra, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning *
      `,
      [
        uuid,
        schoolId,
        data.lookupType,
        code,
        (data.label || data.code).trim(),
        data.extra ? JSON.stringify(data.extra) : null,
        DEFAULTS.STATUS,
        userId,
        now,
      ]
    );
    return rows[0];
  }

  public async update(
    id: string,
    data: UpdateLookupRequest,
    schoolId: string,
    userId: string
  ): Promise<StudentLookup | null> {
    const fields: string[] = [];
    const params: any[] = [];
    const set = (col: string, val: any) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };
    if (data.label !== undefined) set('label', data.label);
    if (data.extra !== undefined) set('extra', data.extra ? JSON.stringify(data.extra) : null);
    if (fields.length === 0) return this.getById(id, schoolId);

    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);
    const rows = await DB.query(
      `update student_lookup set ${fields.join(', ')}
       where uuid = $${params.length - 1} and school_id = $${params.length} and status = 'active'
       returning *`,
      params
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<void> {
    await DB.query(
      singleLineString`
        update student_lookup set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId]
    );
  }

  // Resolve a code-or-label to a stored lookup code. For auto-create types
  // (city, locality) the value is inserted on first use. For seeded types the
  // provided code is normalized and returned even if not found (frontend picks
  // from the seeded list, so codes are already valid).
  public async resolveCode(
    lookupType: string,
    value: string | undefined | null,
    schoolId: string,
    userId: string
  ): Promise<string | null> {
    if (value === undefined || value === null || `${value}`.trim() === '') return null;
    const code = this.normalizeCode(`${value}`);
    const existing = await DB.query(
      singleLineString`
        select code from student_lookup
        where school_id = $1 and lookup_type = $2 and lower(code) = lower($3) and status = 'active' limit 1
      `,
      [schoolId, lookupType, code]
    );
    if (existing.length > 0) return existing[0].code;

    if ((AUTO_CREATE_TYPES as readonly string[]).includes(lookupType)) {
      await DB.query(
        singleLineString`
          insert into student_lookup
          (uuid, school_id, lookup_type, code, label, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [generateShortUuid(12), schoolId, lookupType, code, `${value}`.trim(), DEFAULTS.STATUS, userId, new Date()]
      );
    }
    return code;
  }

  // Pincode autofill fallback (pincode_ref is deferred): suggest the most common
  // state/city/locality codes already entered for this pincode in this school.
  public async suggestByPincode(
    pincode: string,
    schoolId: string
  ): Promise<{ stateCode?: string; cityCode?: string; localityCode?: string } | null> {
    if (!pincode || !pincode.trim()) return null;
    const rows = await DB.query(
      singleLineString`
        select state_code, city_code, locality_code, count(*) as n
        from student_address
        where school_id = $1 and pincode = $2 and status = 'active'
        group by state_code, city_code, locality_code
        order by n desc limit 1
      `,
      [schoolId, pincode.trim()]
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return { stateCode: r.stateCode, cityCode: r.cityCode, localityCode: r.localityCode };
  }
}

export const studentLookupService = new StudentLookupService();
