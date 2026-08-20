import { DB, singleLineString } from '../../shared/lib/db';

// Paired long-running devices (the "Hey Skool" desk assistant). A device generates a random
// device_id and passes it at login; the JWT carries a `device_id` claim; /employee/refresh only
// renews when the device is still ACTIVE here. Revoking a row (from the portal) stops renewal, so
// the device dies at its next refresh — no shared-secret rotation, no one else logged out.
// Everything here is best-effort: a DB blip must never wedge a legitimate login.

export interface DeviceRow {
  deviceId: string;
  schoolId: string;
  employeeId: string | null;
  loginName: string | null;
  label: string | null;
  status: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

const clean = (s: any, n: number): string => String(s || '').slice(0, n);

// Register (or re-activate) a device at login time.
export async function registerDevice(
  schoolId: string,
  employeeId: string | null,
  loginName: string | null,
  deviceId: string,
  label?: string,
): Promise<void> {
  const id = clean(deviceId, 64);
  if (!id) return;
  try {
    await DB.query(
      singleLineString`insert into device_session (device_id, school_id, employee_id, login_name, label, status, created_at, last_seen_at)
        values ($1, $2, $3, $4, $5, 'active', now(), now())
        on conflict (device_id) do update set school_id = excluded.school_id, employee_id = excluded.employee_id,
          login_name = excluded.login_name, label = coalesce(excluded.label, device_session.label),
          status = 'active', last_seen_at = now(), revoked_at = null, revokedby_userid = null`,
      [id, schoolId, employeeId, loginName, clean(label, 120) || null],
    );
  } catch (e) {
    console.error('device-session registerDevice failed:', e);
  }
}

// Is this device still allowed to refresh? Touches last_seen when active. FAILS CLOSED on a
// genuinely-revoked/missing row, but treats a DB error as active (availability) — the token is
// still short-lived, so a transient error can't grant indefinite access.
export async function isDeviceActive(schoolId: string, deviceId: string): Promise<boolean> {
  const id = clean(deviceId, 64);
  if (!id) return false;
  try {
    const rows = await DB.query(
      singleLineString`update device_session set last_seen_at = now() where device_id = $1 and school_id = $2 and status = 'active' returning device_id`,
      [id, schoolId],
    );
    return rows.length > 0;
  } catch (e) {
    console.error('device-session isDeviceActive failed (fail-open):', e);
    return true;
  }
}

export async function listDevices(schoolId: string): Promise<DeviceRow[]> {
  return DB.query(
    singleLineString`select device_id, school_id, employee_id, login_name, label, status, created_at, last_seen_at, revoked_at
      from device_session where school_id = $1 order by (status = 'active') desc, last_seen_at desc nulls last`,
    [schoolId],
  );
}

export async function revokeDevice(schoolId: string, deviceId: string, userId: string): Promise<boolean> {
  const rows = await DB.query(
    singleLineString`update device_session set status = 'revoked', revoked_at = now(), revokedby_userid = $3
      where device_id = $1 and school_id = $2 and status = 'active' returning device_id`,
    [clean(deviceId, 64), schoolId, userId],
  );
  return rows.length > 0;
}
