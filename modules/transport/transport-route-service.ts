import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  AddRouteStopsRequest, CreateRouteRequest, ReorderRouteStopsRequest,
  RouteStopView, TransportRoute, TransportRouteDetail, UpdateRouteRequest,
} from './transport-interfaces';
import { DEFAULTS, DIRECTION_VALUES } from './transport-constants';
import { findEmployee, resolveEmployeeNames } from './transport-common';
import { transportVehicleService } from './transport-vehicle-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class TransportRouteService {
  public async create(data: CreateRouteRequest, schoolId: string, userId: string): Promise<TransportRoute> {
    if (!data.name || !data.name.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'name is required');
    }
    if (!DIRECTION_VALUES.includes(data.direction as any)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `direction must be one of: ${DIRECTION_VALUES.join(', ')}`);
    }
    await this.assertNameFree(schoolId, data.name, data.direction, null);
    await this.validateStaff(schoolId, data);

    // Prefill driver/conductor from the assigned vehicle unless explicitly provided.
    let { driverName, driverPhone, conductorName, conductorPhone } = data;
    if (data.vehicleId) {
      const vehicle = await transportVehicleService.getById(data.vehicleId, schoolId);
      if (!vehicle) throw new BusinessErrorResult(ErrorCode.BusinessError, 'vehicleId does not reference a valid vehicle');
      driverName = driverName ?? vehicle.driverName;
      driverPhone = driverPhone ?? vehicle.driverPhone;
      conductorName = conductorName ?? vehicle.conductorName;
      conductorPhone = conductorPhone ?? vehicle.conductorPhone;
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into transport_route
        (uuid, school_id, name, direction, vehicle_id, accompanying_teacher_id, helper_id, route_incharge_id,
         driver_name, driver_phone, conductor_name, conductor_phone, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        returning *
      `,
      [uuid, schoolId, data.name.trim(), data.direction, data.vehicleId || null,
        data.accompanyingTeacherId || null, data.helperId || null, data.routeInchargeId || null,
        driverName || null, driverPhone || null, conductorName || null, conductorPhone || null,
        DEFAULTS.STATUS, userId, now],
    );
    return rows[0];
  }

  public async update(id: string, data: UpdateRouteRequest, schoolId: string, userId: string): Promise<TransportRoute | null> {
    const existing = await this.getRouteRow(id, schoolId);
    if (!existing) return null;

    if (data.name !== undefined) {
      if (!data.name.trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, 'name cannot be blank');
      await this.assertNameFree(schoolId, data.name, existing.direction, id);
    }
    await this.validateStaff(schoolId, data);

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => { updates.push(`${col} = $${i++}`); params.push(val); };

    if (data.name !== undefined) set('name', data.name.trim());
    if (data.accompanyingTeacherId !== undefined) set('accompanying_teacher_id', data.accompanyingTeacherId || null);
    if (data.helperId !== undefined) set('helper_id', data.helperId || null);
    if (data.routeInchargeId !== undefined) set('route_incharge_id', data.routeInchargeId || null);

    // Vehicle change may re-copy contacts when requested.
    if (data.vehicleId !== undefined) {
      set('vehicle_id', data.vehicleId || null);
      if (data.vehicleId && data.syncContactsFromVehicle) {
        const vehicle = await transportVehicleService.getById(data.vehicleId, schoolId);
        if (!vehicle) throw new BusinessErrorResult(ErrorCode.BusinessError, 'vehicleId does not reference a valid vehicle');
        set('driver_name', vehicle.driverName || null);
        set('driver_phone', vehicle.driverPhone || null);
        set('conductor_name', vehicle.conductorName || null);
        set('conductor_phone', vehicle.conductorPhone || null);
      }
    }

    // Explicit contact overrides (win over any vehicle sync above only if provided last;
    // callers should not send both a sync flag and explicit contacts).
    if (data.driverName !== undefined) set('driver_name', data.driverName || null);
    if (data.driverPhone !== undefined) set('driver_phone', data.driverPhone || null);
    if (data.conductorName !== undefined) set('conductor_name', data.conductorName || null);
    if (data.conductorPhone !== undefined) set('conductor_phone', data.conductorPhone || null);

    if (updates.length === 0) return this.getRouteRow(id, schoolId);
    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);

    const rows = await DB.query(
      singleLineString`
        update transport_route set ${updates.join(', ')}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning *
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getRouteRow(id, schoolId);
    if (!existing) return false;
    const assigned = await DB.query(
      singleLineString`select 1 from transport_student_assignment where route_id = $1 and school_id = $2 and status = 'active' limit 1`,
      [id, schoolId],
    );
    if (assigned.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Route has active student assignments and cannot be deleted');
    }
    const now = new Date();
    // Soft-delete the route and its stop links together.
    await DB.queriesInTransaction(
      [
        singleLineString`update transport_route set status = 'deleted', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
        singleLineString`update transport_route_stop set status = 'deleted', updatedby_userid = $1, updated_at = $2 where route_id = $3 and school_id = $4 and status = 'active'`,
      ],
      [
        [userId, now, id, schoolId],
        [userId, now, id, schoolId],
      ],
    );
    return true;
  }

  public async getRouteRow(id: string, schoolId: string): Promise<TransportRoute | null> {
    const rows = await DB.query(
      singleLineString`select * from transport_route where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async getById(id: string, schoolId: string): Promise<TransportRouteDetail | null> {
    const route = await this.getRouteRow(id, schoolId);
    if (!route) return null;

    const vehicle = route.vehicleId ? await transportVehicleService.getById(route.vehicleId, schoolId) : null;
    const names = await resolveEmployeeNames(schoolId, [route.accompanyingTeacherId, route.helperId, route.routeInchargeId]);
    const stops = await this.listStops(id, schoolId);

    return {
      ...route,
      vehicle: vehicle || null,
      accompanyingTeacherName: route.accompanyingTeacherId ? names[route.accompanyingTeacherId] || null : null,
      helperName: route.helperId ? names[route.helperId] || null : null,
      routeInchargeName: route.routeInchargeId ? names[route.routeInchargeId] || null : null,
      stops,
    };
  }

  public async list(schoolId: string, direction?: string): Promise<any[]> {
    const params: any[] = [schoolId];
    let query = singleLineString`
      select r.*, v.registration_number as vehicle_registration_number,
        (select count(*) from transport_route_stop rs where rs.route_id = r.uuid and rs.status = 'active')::int as stop_count
      from transport_route r
      left join transport_vehicle v on v.uuid = r.vehicle_id
      where r.school_id = $1 and r.status = 'active'
    `;
    if (direction) { params.push(direction); query += ` and r.direction = $${params.length}`; }
    query += ` order by r.direction, r.name`;
    return DB.query(query, params);
  }

  // ── Stops on a route ───────────────────────────────────────────────────────

  public async listStops(routeId: string, schoolId: string): Promise<RouteStopView[]> {
    return DB.query(
      singleLineString`
        select rs.uuid, rs.stop_id, s.name, s.km::float8 as km, s.landmark,
               rs.sequence, rs.scheduled_time
        from transport_route_stop rs
        join transport_stop s on s.uuid = rs.stop_id
        where rs.route_id = $1 and rs.school_id = $2 and rs.status = 'active'
        order by rs.sequence
      `,
      [routeId, schoolId],
    );
  }

  // Append one or more stops to the end of the route. Rejects a stop already on
  // the route (the unique index also guards this) and validates the stop exists.
  public async addStops(routeId: string, data: AddRouteStopsRequest, schoolId: string, userId: string): Promise<RouteStopView[] | null> {
    const route = await this.getRouteRow(routeId, schoolId);
    if (!route) return null;
    if (!Array.isArray(data.stops) || data.stops.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'stops array is required');
    }

    const currentRows = await DB.query(
      singleLineString`select stop_id, max(sequence) over () as max_seq from transport_route_stop where route_id = $1 and school_id = $2 and status = 'active'`,
      [routeId, schoolId],
    );
    const onRoute = new Set<string>(currentRows.map((r: any) => r.stopId));
    let nextSeq = (currentRows.length > 0 ? currentRows[0].maxSeq : 0) + 1;

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();
    const seen = new Set<string>();

    for (const s of data.stops) {
      if (!s.stopId) throw new BusinessErrorResult(ErrorCode.BusinessError, 'stopId is required for each stop');
      if (onRoute.has(s.stopId) || seen.has(s.stopId)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Stop ${s.stopId} is already on this route`);
      }
      const stop = await DB.query(
        singleLineString`select uuid from transport_stop where uuid = $1 and school_id = $2 and status = 'active'`,
        [s.stopId, schoolId],
      );
      if (stop.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, `Stop ${s.stopId} does not exist`);
      seen.add(s.stopId);

      queries.push(singleLineString`
        insert into transport_route_stop (uuid, school_id, route_id, stop_id, sequence, scheduled_time, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `);
      params.push([generateShortUuid(12), schoolId, routeId, s.stopId, nextSeq++, s.scheduledTime || null, DEFAULTS.STATUS, userId, now]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.listStops(routeId, schoolId);
  }

  public async removeStop(routeId: string, routeStopId: string, schoolId: string, userId: string): Promise<RouteStopView[] | null> {
    const route = await this.getRouteRow(routeId, schoolId);
    if (!route) return null;
    const rows = await DB.query(
      singleLineString`
        update transport_route_stop set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and route_id = $4 and school_id = $5 and status = 'active'
        returning uuid
      `,
      [userId, new Date(), routeStopId, routeId, schoolId],
    );
    if (rows.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Stop is not on this route');
    // Re-densify the remaining sequence so it stays 1..n.
    await this.resequence(routeId, schoolId, userId);
    return this.listStops(routeId, schoolId);
  }

  // Reorder stops. `order` is the full list of route_stop uuids in the new order.
  public async reorderStops(routeId: string, data: ReorderRouteStopsRequest, schoolId: string, userId: string): Promise<RouteStopView[] | null> {
    const route = await this.getRouteRow(routeId, schoolId);
    if (!route) return null;
    if (!Array.isArray(data.order) || data.order.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'order array is required');
    }

    const current = await DB.query(
      singleLineString`select uuid from transport_route_stop where route_id = $1 and school_id = $2 and status = 'active'`,
      [routeId, schoolId],
    );
    const currentIds = new Set<string>(current.map((r: any) => r.uuid));
    if (data.order.length !== currentIds.size || !data.order.every((id) => currentIds.has(id))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'order must contain exactly the current route stop ids');
    }

    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();
    data.order.forEach((routeStopId, idx) => {
      queries.push(singleLineString`
        update transport_route_stop set sequence = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and route_id = $5 and school_id = $6
      `);
      params.push([idx + 1, userId, now, routeStopId, routeId, schoolId]);
    });
    await DB.queriesInTransaction(queries, params);
    return this.listStops(routeId, schoolId);
  }

  private async resequence(routeId: string, schoolId: string, userId: string): Promise<void> {
    const current = await DB.query(
      singleLineString`select uuid from transport_route_stop where route_id = $1 and school_id = $2 and status = 'active' order by sequence`,
      [routeId, schoolId],
    );
    if (current.length === 0) return;
    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();
    current.forEach((r: any, idx: number) => {
      queries.push(singleLineString`update transport_route_stop set sequence = $1, updated_at = $2, updatedby_userid = $3 where uuid = $4`);
      params.push([idx + 1, now, userId, r.uuid]);
    });
    await DB.queriesInTransaction(queries, params);
  }

  // ── Validation helpers ─────────────────────────────────────────────────────

  private async validateStaff(schoolId: string, data: { accompanyingTeacherId?: string | null; helperId?: string | null; routeInchargeId?: string | null }): Promise<void> {
    for (const [label, id] of [
      ['accompanyingTeacherId', data.accompanyingTeacherId],
      ['helperId', data.helperId],
      ['routeInchargeId', data.routeInchargeId],
    ] as const) {
      if (id) {
        const emp = await findEmployee(schoolId, id);
        if (!emp) throw new BusinessErrorResult(ErrorCode.BusinessError, `${label} does not reference a valid employee`);
      }
    }
  }

  private async assertNameFree(schoolId: string, name: string, direction: string, excludeId: string | null): Promise<void> {
    const params: any[] = [schoolId, name.trim(), direction];
    let query = singleLineString`
      select uuid from transport_route
      where school_id = $1 and lower(name) = lower($2) and direction = $3 and status = 'active'
    `;
    if (excludeId) { params.push(excludeId); query += ` and uuid != $4`; }
    const rows = await DB.query(query, params);
    if (rows.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `A ${direction} route named "${name.trim()}" already exists`);
    }
  }
}

export const transportRouteService = new TransportRouteService();
