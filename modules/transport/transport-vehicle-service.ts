import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { CreateVehicleRequest, TransportVehicle, UpdateVehicleRequest } from './transport-interfaces';
import { DEFAULTS } from './transport-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class TransportVehicleService {
  public async create(data: CreateVehicleRequest, schoolId: string, userId: string): Promise<TransportVehicle> {
    await this.assertRegistrationFree(schoolId, data.registrationNumber, null);

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into transport_vehicle
        (uuid, school_id, vehicle_type, make_model, registration_number, ownership, capacity,
         driver_name, driver_phone, conductor_name, conductor_phone, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        returning *
      `,
      [
        uuid, schoolId, data.vehicleType, data.makeModel || null, data.registrationNumber.trim(),
        data.ownership, data.capacity ?? null, data.driverName || null, data.driverPhone || null,
        data.conductorName || null, data.conductorPhone || null, DEFAULTS.STATUS, userId, now,
      ],
    );
    return rows[0];
  }

  public async update(id: string, data: UpdateVehicleRequest, schoolId: string, userId: string): Promise<TransportVehicle | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    if (data.registrationNumber !== undefined) {
      await this.assertRegistrationFree(schoolId, data.registrationNumber, id);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };

    if (data.vehicleType !== undefined) set('vehicle_type', data.vehicleType);
    if (data.makeModel !== undefined) set('make_model', data.makeModel || null);
    if (data.registrationNumber !== undefined) set('registration_number', data.registrationNumber.trim());
    if (data.ownership !== undefined) set('ownership', data.ownership);
    if (data.capacity !== undefined) set('capacity', data.capacity ?? null);
    if (data.driverName !== undefined) set('driver_name', data.driverName || null);
    if (data.driverPhone !== undefined) set('driver_phone', data.driverPhone || null);
    if (data.conductorName !== undefined) set('conductor_name', data.conductorName || null);
    if (data.conductorPhone !== undefined) set('conductor_phone', data.conductorPhone || null);

    if (updates.length === 0) return existing;

    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);

    const rows = await DB.query(
      singleLineString`
        update transport_vehicle set ${updates.join(', ')}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning *
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;
    await DB.query(
      singleLineString`
        update transport_vehicle set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
    return true;
  }

  public async getById(id: string, schoolId: string): Promise<TransportVehicle | null> {
    const rows = await DB.query(
      singleLineString`select * from transport_vehicle where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async list(schoolId: string, search?: string): Promise<TransportVehicle[]> {
    const params: any[] = [schoolId];
    let query = singleLineString`select * from transport_vehicle where school_id = $1 and status = 'active'`;
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` and (lower(registration_number) like lower($2) or lower(make_model) like lower($2))`;
    }
    query += ` order by registration_number`;
    return DB.query(query, params);
  }

  private async assertRegistrationFree(schoolId: string, registrationNumber: string, excludeId: string | null): Promise<void> {
    if (!registrationNumber || !registrationNumber.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'registrationNumber is required');
    }
    const params: any[] = [schoolId, registrationNumber.trim()];
    let query = singleLineString`
      select uuid from transport_vehicle
      where school_id = $1 and lower(registration_number) = lower($2) and status = 'active'
    `;
    if (excludeId) { params.push(excludeId); query += ` and uuid != $3`; }
    const rows = await DB.query(query, params);
    if (rows.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `A vehicle with registration "${registrationNumber.trim()}" already exists`);
    }
  }
}

export const transportVehicleService = new TransportVehicleService();
