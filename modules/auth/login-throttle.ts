import { DB, singleLineString } from '../../shared/lib/db';
import { ApiEvent } from '../../shared/lib/api.interfaces';

// Brute-force lockout for the login endpoints. Lambda is stateless, so the
// counters live in a tiny `login_lockout` table (see auth-setup.sql). Two
// independent scopes: per-account (school + username) stops targeted password
// guessing; per-IP stops one host spraying many usernames. Everything here is
// FAIL-OPEN — a school must never be locked out of its own portal by a DB blip,
// so any throttle error is logged and treated as "not locked".
const WINDOW_MIN = 15; // rolling window over which failures are counted
const USER_MAX = 8; // failed attempts per account in the window before it locks
const IP_MAX = 40; // failed attempts per source IP in the window before it locks
const LOCK_MIN = 15; // how long a lock lasts once tripped

export interface LockStatus {
  locked: boolean;
  retryAfterSec: number;
}

const userKey = (schoolId: string, username: string): string =>
  `${schoolId}:${String(username || '').trim().toLowerCase()}`.slice(0, 200);

// Client IP as API Gateway saw it; fall back to the first X-Forwarded-For hop.
export function getClientIp(event: ApiEvent): string {
  const ip = (event as any)?.requestContext?.identity?.sourceIp;
  if (ip) return String(ip).slice(0, 200);
  const h = event?.headers || {};
  const xff = (h as any)['X-Forwarded-For'] || (h as any)['x-forwarded-for'];
  return xff ? String(xff).split(',')[0].trim().slice(0, 200) : 'unknown';
}

// Is this account OR this IP currently locked? Returns the longer remaining wait.
export async function checkLock(schoolId: string, username: string, ip: string): Promise<LockStatus> {
  try {
    const rows = await DB.query(
      singleLineString`select max(locked_until) as locked_until from login_lockout where locked_until is not null and locked_until > now() and ((scope = 'user' and scope_key = $1) or (scope = 'ip' and scope_key = $2))`,
      [userKey(schoolId, username), ip]
    );
    const until = rows[0]?.lockedUntil;
    if (!until) return { locked: false, retryAfterSec: 0 };
    const secs = Math.max(1, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));
    return { locked: true, retryAfterSec: secs };
  } catch (e) {
    console.error('login-throttle checkLock failed (fail-open):', e);
    return { locked: false, retryAfterSec: 0 };
  }
}

// One upsert that: starts a fresh window if the old one has rolled over, else
// increments; and stamps locked_until once the count reaches `max`.
async function bump(scope: 'user' | 'ip', key: string, max: number): Promise<void> {
  await DB.query(
    singleLineString`insert into login_lockout (scope, scope_key, fail_count, window_started_at, locked_until, updated_at) values ($1, $2, 1, now(), null, now()) on conflict (scope, scope_key) do update set fail_count = case when login_lockout.window_started_at < now() - make_interval(mins => $3) then 1 else login_lockout.fail_count + 1 end, window_started_at = case when login_lockout.window_started_at < now() - make_interval(mins => $3) then now() else login_lockout.window_started_at end, locked_until = case when (case when login_lockout.window_started_at < now() - make_interval(mins => $3) then 1 else login_lockout.fail_count + 1 end) >= $4 then now() + make_interval(mins => $5) else login_lockout.locked_until end, updated_at = now()`,
    [scope, key, WINDOW_MIN, max, LOCK_MIN]
  );
}

export async function recordFailure(schoolId: string, username: string, ip: string): Promise<void> {
  try {
    await bump('user', userKey(schoolId, username), USER_MAX);
    if (ip && ip !== 'unknown') await bump('ip', ip, IP_MAX);
  } catch (e) {
    console.error('login-throttle recordFailure failed:', e);
  }
}

// A good login clears that account's counter (leave the IP counter — a shared
// NAT could still be mid-spray from other accounts).
export async function recordSuccess(schoolId: string, username: string): Promise<void> {
  try {
    await DB.query(singleLineString`delete from login_lockout where scope = 'user' and scope_key = $1`, [userKey(schoolId, username)]);
  } catch (e) {
    console.error('login-throttle recordSuccess failed:', e);
  }
}
