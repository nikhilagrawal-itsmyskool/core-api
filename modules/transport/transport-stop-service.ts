import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  BulkStopRequest, BulkStopResult, CreateStopRequest, TransportStop, UpdateStopRequest,
} from './transport-interfaces';
import { DEFAULTS } from './transport-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Select list returning km as a number (numeric comes back as a string from pg).
const STOP_COLS = singleLineString`
  uuid, school_id, name, km::float8 as km, landmark,
  latitude::float8 as latitude, longitude::float8 as longitude,
  status, createdby_userid, created_at, updatedby_userid, updated_at
`;

class TransportStopService {
  public async create(data: CreateStopRequest, schoolId: string, userId: string): Promise<TransportStop> {
    if (!data.name || !data.name.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'name is required');
    }
    await this.assertNameFree(schoolId, data.name, null);
    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into transport_stop
        (uuid, school_id, name, km, landmark, latitude, longitude, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        returning ${STOP_COLS}
      `,
      [uuid, schoolId, data.name.trim(), data.km ?? null, data.landmark || null,
        data.latitude ?? null, data.longitude ?? null, DEFAULTS.STATUS, userId, now],
    );
    return rows[0];
  }

  // Grid/bulk upsert: each row keyed by lower(name). Existing active stop -> update
  // km/landmark; new -> insert. Runs in a single transaction. Rows with a blank name
  // or that duplicate an earlier row in the same payload are skipped with a reason.
  public async bulkUpsert(data: BulkStopRequest, schoolId: string, userId: string): Promise<BulkStopResult> {
    const result: BulkStopResult = { created: 0, updated: 0, skipped: 0, errors: [] };
    if (!Array.isArray(data.stops) || data.stops.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'stops array is required');
    }

    // Existing active stops in this school, keyed by lower(name).
    const existingRows = await DB.query(
      singleLineString`select uuid, lower(name) as lname from transport_stop where school_id = $1 and status = 'active'`,
      [schoolId],
    );
    const existing = new Map<string, string>(); // lname -> uuid
    for (const r of existingRows) existing.set(r.lname, r.uuid);

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();
    const seen = new Set<string>(); // dedupe within the payload

    data.stops.forEach((row, idx) => {
      const name = (row.name || '').trim();
      if (!name) { result.skipped++; result.errors.push({ row: idx, reason: 'blank name' }); return; }
      const key = name.toLowerCase();
      if (seen.has(key)) { result.skipped++; result.errors.push({ row: idx, name, reason: 'duplicate row in payload' }); return; }
      seen.add(key);

      const km = row.km ?? null;
      const landmark = row.landmark || null;
      const existingId = existing.get(key);
      if (existingId) {
        queries.push(singleLineString`
          update transport_stop set km = $1, landmark = $2, updatedby_userid = $3, updated_at = $4 where uuid = $5
        `);
        params.push([km, landmark, userId, now, existingId]);
        result.updated++;
      } else {
        queries.push(singleLineString`
          insert into transport_stop (uuid, school_id, name, km, landmark, status, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `);
        params.push([generateShortUuid(12), schoolId, name, km, landmark, DEFAULTS.STATUS, userId, now]);
        result.created++;
      }
    });

    if (queries.length > 0) await DB.queriesInTransaction(queries, params);
    return result;
  }

  public async update(id: string, data: UpdateStopRequest, schoolId: string, userId: string): Promise<TransportStop | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    if (data.name !== undefined) {
      if (!data.name.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'name cannot be blank');
      await this.assertNameFree(schoolId, data.name, id);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };

    if (data.name !== undefined) set('name', data.name.trim());
    if (data.km !== undefined) set('km', data.km ?? null);
    if (data.landmark !== undefined) set('landmark', data.landmark || null);
    if (data.latitude !== undefined) set('latitude', data.latitude ?? null);
    if (data.longitude !== undefined) set('longitude', data.longitude ?? null);

    if (updates.length === 0) return existing;
    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);

    const rows = await DB.query(
      singleLineString`
        update transport_stop set ${updates.join(', ')}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning ${STOP_COLS}
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;
    // Block deletion of a stop still used by an active route or assignment.
    const inUse = await DB.query(
      singleLineString`
        select 1 from transport_route_stop where stop_id = $1 and school_id = $2 and status = 'active'
        union all
        select 1 from transport_student_assignment where stop_id = $1 and school_id = $2 and status = 'active'
        limit 1
      `,
      [id, schoolId],
    );
    if (inUse.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Stop is in use by a route or student assignment and cannot be deleted');
    }
    await DB.query(
      singleLineString`
        update transport_stop set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
    return true;
  }

  public async getById(id: string, schoolId: string): Promise<TransportStop | null> {
    const rows = await DB.query(
      singleLineString`select ${STOP_COLS} from transport_stop where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async list(schoolId: string, search?: string): Promise<TransportStop[]> {
    const params: any[] = [schoolId];
    let query = singleLineString`select ${STOP_COLS} from transport_stop where school_id = $1 and status = 'active'`;
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` and lower(name) like lower($2)`;
    }
    query += ` order by name`;
    return DB.query(query, params);
  }

  private async assertNameFree(schoolId: string, name: string, excludeId: string | null): Promise<void> {
    const params: any[] = [schoolId, name.trim()];
    let query = singleLineString`
      select uuid from transport_stop where school_id = $1 and lower(name) = lower($2) and status = 'active'
    `;
    if (excludeId) { params.push(excludeId); query += ` and uuid != $3`; }
    const rows = await DB.query(query, params);
    if (rows.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `A stop named "${name.trim()}" already exists`);
    }
  }
}

export const transportStopService = new TransportStopService();
