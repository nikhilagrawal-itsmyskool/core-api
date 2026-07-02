import {
  VehicleType,
  Ownership,
  Direction,
  AttendanceStatus,
  SessionStatus,
  AuditSource,
} from './transport-constants';

export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// ── Stop ─────────────────────────────────────────────────────────────────────

export interface TransportStop extends BaseEntity {
  name: string;
  km?: number;
  landmark?: string;
  latitude?: number;
  longitude?: number;
  status: string;
}

export interface CreateStopRequest {
  name: string;
  km?: number;
  landmark?: string;
  latitude?: number;
  longitude?: number;
}

export interface UpdateStopRequest {
  name?: string;
  km?: number | null;
  landmark?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

// Rows for the grid/bulk upsert. Each row is upserted by lower(name).
export interface BulkStopRow {
  name: string;
  km?: number;
  landmark?: string;
}

export interface BulkStopRequest {
  stops: BulkStopRow[];
}

export interface BulkStopResult {
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; name?: string; reason: string }[];
}

// ── Vehicle ──────────────────────────────────────────────────────────────────

export interface TransportVehicle extends BaseEntity {
  vehicleType: VehicleType;
  makeModel?: string;
  registrationNumber: string;
  ownership: Ownership;
  capacity?: number;
  driverName?: string;
  driverPhone?: string;
  conductorName?: string;
  conductorPhone?: string;
  status: string;
}

export interface CreateVehicleRequest {
  vehicleType: VehicleType;
  makeModel?: string;
  registrationNumber: string;
  ownership: Ownership;
  capacity?: number;
  driverName?: string;
  driverPhone?: string;
  conductorName?: string;
  conductorPhone?: string;
}

export interface UpdateVehicleRequest {
  vehicleType?: VehicleType;
  makeModel?: string | null;
  registrationNumber?: string;
  ownership?: Ownership;
  capacity?: number | null;
  driverName?: string | null;
  driverPhone?: string | null;
  conductorName?: string | null;
  conductorPhone?: string | null;
}

// ── Route ────────────────────────────────────────────────────────────────────

export interface TransportRoute extends BaseEntity {
  name: string;
  direction: Direction;
  vehicleId?: string;
  accompanyingTeacherId?: string;
  helperId?: string;
  routeInchargeId?: string;
  driverName?: string;
  driverPhone?: string;
  conductorName?: string;
  conductorPhone?: string;
  status: string;
}

// Route detail: route + resolved vehicle/staff names + ordered stops.
export interface TransportRouteDetail extends TransportRoute {
  vehicle?: TransportVehicle | null;
  accompanyingTeacherName?: string | null;
  helperName?: string | null;
  routeInchargeName?: string | null;
  stops: RouteStopView[];
}

export interface RouteStopView {
  uuid: string; // route_stop uuid
  stopId: string;
  name: string;
  km?: number;
  landmark?: string;
  sequence: number;
  scheduledTime?: string;
}

export interface CreateRouteRequest {
  name: string;
  direction: Direction;
  vehicleId?: string;
  accompanyingTeacherId?: string;
  helperId?: string;
  routeInchargeId?: string;
  // Optional explicit contact overrides; when omitted they are prefilled from the vehicle.
  driverName?: string;
  driverPhone?: string;
  conductorName?: string;
  conductorPhone?: string;
}

export interface UpdateRouteRequest {
  name?: string;
  vehicleId?: string | null;
  accompanyingTeacherId?: string | null;
  helperId?: string | null;
  routeInchargeId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  conductorName?: string | null;
  conductorPhone?: string | null;
  // When true (with a vehicleId change), re-copy driver/conductor from the vehicle.
  syncContactsFromVehicle?: boolean;
}

export interface AddRouteStopsRequest {
  // One or more stops to append to the route (sequence auto-assigned to the end).
  stops: { stopId: string; scheduledTime?: string }[];
}

export interface ReorderRouteStopsRequest {
  // Ordered list of route_stop uuids (or stop ids) defining the new sequence.
  order: string[];
}

// ── Student assignment ───────────────────────────────────────────────────────

export interface TransportAssignment extends BaseEntity {
  academicYearId: string;
  studentId: string;
  routeId: string;
  stopId: string;
  direction: Direction;
  studentName?: string;
  status: string;
}

export interface CreateAssignmentRequest {
  academicYearId: string;
  studentId: string;
  routeId: string;
  stopId: string;
}

export interface UpdateAssignmentRequest {
  routeId?: string;
  stopId?: string;
}

// ── Attendance ───────────────────────────────────────────────────────────────

export interface TransportAttendanceSession extends BaseEntity {
  academicYearId: string;
  routeId: string;
  attendanceDate: string;
  status: SessionStatus;
  finalizedAt?: Date;
}

export interface OpenSessionRequest {
  routeId: string;
  academicYearId: string;
  date: string; // yyyy-mm-dd; may be back-dated
}

export interface TransportAttendanceRecord extends BaseEntity {
  sessionId: string;
  studentId: string;
  status: AttendanceStatus;
  remark?: string;
  studentName?: string;
}

export interface MarkEntry {
  studentId: string;
  status: AttendanceStatus;
  remark?: string;
}

export interface SaveMarksRequest {
  marks: MarkEntry[];
}

export interface EditRecordRequest {
  status?: AttendanceStatus;
  remark?: string;
}

export interface TransportAttendanceAudit {
  uuid: string;
  schoolId: string;
  sessionId: string;
  recordId?: string;
  studentId: string;
  oldStatus?: string;
  newStatus?: string;
  source: AuditSource;
  changedbyUserid?: string;
  changedAt: Date;
}

// Roster row for the marking screen: assigned student + any existing mark.
export interface RosterEntry {
  studentId: string;
  name: string;
  stopId?: string;
  stopName?: string;
  status?: AttendanceStatus;
  remark?: string;
}
