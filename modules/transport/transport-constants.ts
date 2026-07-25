// Transport module constants (dropdown catalogs + defaults).
// value/label(/description) arrays mirror the pattern in hiring/fine constants.

// camelCase response keys carrying a driver/conductor phone number. Masked for
// non admin/god callers (drivers/conductors are personal contacts, not public).
export const TRANSPORT_PHONE_FIELDS = ['driverPhone', 'conductorPhone'] as const;

export const VEHICLE_TYPES = [
  { value: 'bus', label: 'Bus' },
  { value: 'van', label: 'Van' },
  { value: 'other', label: 'Other' },
] as const;

export const OWNERSHIP_TYPES = [
  { value: 'owned', label: 'School Owned' },
  { value: 'contract', label: 'On Contract' },
] as const;

export const ROUTE_DIRECTIONS = [
  { value: 'morning', label: 'Morning (Pickup)' },
  { value: 'evening', label: 'Evening (Drop)' },
] as const;

// Roll-call status per assigned student on a route session.
export const ATTENDANCE_STATUSES = [
  { value: 'boarded', label: 'Boarded' },
  { value: 'absent', label: 'Absent' },
  { value: 'excused', label: 'Excused' },
] as const;

export const VEHICLE_TYPE_VALUES = VEHICLE_TYPES.map(v => v.value);
export const OWNERSHIP_VALUES = OWNERSHIP_TYPES.map(o => o.value);
export const DIRECTION_VALUES = ROUTE_DIRECTIONS.map(d => d.value);
export const ATTENDANCE_STATUS_VALUES = ATTENDANCE_STATUSES.map(s => s.value);
export const SESSION_STATUSES = ['open', 'finalized'] as const;
export const AUDIT_SOURCES = ['mark', 'edit', 'finalize'] as const;

export type VehicleType = typeof VEHICLE_TYPE_VALUES[number];
export type Ownership = typeof OWNERSHIP_VALUES[number];
export type Direction = typeof DIRECTION_VALUES[number];
export type AttendanceStatus = typeof ATTENDANCE_STATUS_VALUES[number];
export type SessionStatus = typeof SESSION_STATUSES[number];
export type AuditSource = typeof AUDIT_SOURCES[number];

export const DEFAULTS = {
  STATUS: 'active' as const,
  ATTENDANCE_PRESENT: 'boarded' as AttendanceStatus,
  SESSION_OPEN: 'open' as SessionStatus,
};

// Communication template key used to notify families of a transport absence on finalize.
export const ABSENT_TEMPLATE_KEY = 'transport_absent';
