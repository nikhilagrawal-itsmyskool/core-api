// Force-relogin kill-switch, read side. Every employee JWT carries the login's session_version
// (employee_login.session_version) at mint time. God bumps that number from the portal's
// "Force re-login" to invalidate a person's live tokens — without tracking JWTs or rotating the
// shared secret. This module is the per-request check: compare the token's version against the
// current DB value.
//
// Same fail-safe, SYNC design as authz-policy.ts's override cache: requireAction() is sync, so we
// keep an in-memory map (loginId -> version), read it synchronously, and refresh it in the
// background (fire-and-forget, short TTL) off the hot path. A cold/empty/unavailable cache FAILS
// OPEN (treats the session as valid) — availability over enforcement, because a legitimate request
// must never be wedged by a DB blip, and the window is only until the next background load (~60s).
// The runs in EVERY module's Lambda, each with its own cache refreshing independently, so a bump
// propagates everywhere within ~one TTL.

type Entry = { version: number; loadedAt: number };
const CACHE = new Map<string, Entry>();
const loading = new Set<string>();
const TTL_MS = 60_000;

async function loadNow(loginId: string): Promise<void> {
  try {
    // lazy require — importing this file must NOT create a DB pool (authorizer/test safety)
    const { DB } = require('./db');
    const rows = await DB.query('select session_version from employee_login where uuid = $1', [loginId]);
    const v = rows && rows.length ? Number(rows[0].sessionVersion) : NaN;
    // A login row with no version yet (pre-backfill) or a missing row -> treat as 1 (the backfill
    // default), so we never spuriously log someone out before the column is populated.
    CACHE.set(loginId, { version: Number.isFinite(v) && v > 0 ? v : 1, loadedAt: Date.now() });
  } catch {
    // keep whatever we had; a transient failure must not flip a valid session to stale
  }
}

function maybeRefresh(loginId: string): void {
  // Skip the background DB refresh under the jest unit harness (no DB server), matching authz-policy.
  if (process.env.NODE_ENV === 'test') return;
  const entry = CACHE.get(loginId);
  if (entry && Date.now() - entry.loadedAt < TTL_MS) return;
  if (loading.has(loginId)) return;
  loading.add(loginId);
  loadNow(loginId).finally(() => loading.delete(loginId));
}

// Is this employee token stale (its version is older than the DB's)? Triggers a background refresh
// and answers from the cache. FAILS OPEN (returns false) when the cache has no data yet, so at most
// one request per cold cache slips through before the bump is enforced.
export function isSessionStale(loginId: string | undefined, tokenVersion: number | undefined): boolean {
  if (!loginId) return false;
  maybeRefresh(loginId);
  const entry = CACHE.get(loginId);
  if (!entry) return false; // cache miss -> allow; next request (after background load) enforces
  return (tokenVersion ?? 0) < entry.version;
}
