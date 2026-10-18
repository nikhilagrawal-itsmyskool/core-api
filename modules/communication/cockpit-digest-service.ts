// Director's "School Pulse" daily WhatsApp digest.
//
// A once-a-day briefing (fired by the `cockpit-digest` EventBridge schedule at
// 08:30 IST) that mirrors the four most glanceable cards of the admin-portal
// Director's Cockpit and sends them to the director over WhatsApp via the
// approved `school_pulse_daily` template.
//
// There is no single cockpit backend endpoint — the portal page fans out to a
// handful of per-module "pulse" endpoints and composes client-side. We replicate
// the cheap ones here over HTTP (service token + X-School-Code), exactly the way
// the frontend does, then compose six short template variables and enqueue the
// send through this module's own queue.
//
// WHO gets it is pure data, not config: any active employee holding the
// `education_director` role (see DIGEST_ROLE_CODE) in a school that has one. The
// WhatsApp number comes straight off that employee's record. This makes the whole
// feature self-gating — no role assigned, or no approved WhatsApp template active
// for the school, and nothing sends. So it's safe to deploy before launch.
//
// Why it lives in `communication`: this module already owns the send queue and an
// EventBridge schedule (drain-messages), and the digest's only job is to send. It
// reaches the other modules purely over HTTP (no code import), the same shape
// academic-calendar-notify.ts uses in reverse.

import { DB, singleLineString } from '../../shared/lib/db';
const { serviceAuthHeader } = require('../../shared/util/service-token.js');

const TEMPLATE_KEY = 'school_pulse_daily';
// Role whose holders receive the digest. Assign it (employee_role) to the director(s);
// the send resolves their whatsapp number from the employee row.
const DIGEST_ROLE_CODE = 'education-director';

// Base URL other modules use to reach the API (gateway locally, the API domain in
// prod). Same convention as academic-calendar-notify.ts / attendance-util.ts.
const BASE = process.env.COMM_BASE_URL || 'http://localhost:3000';

function headers(schoolCode: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-School-Code': schoolCode,
    Authorization: serviceAuthHeader({ name: 'cockpit-digest' }),
  };
}

async function getJson(path: string, schoolCode: string): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}${path}`, { headers: headers(schoolCode) });
    if (!res.ok) {
      console.error(`[cockpit-digest] GET ${path} -> HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.error(`[cockpit-digest] GET ${path} error: ${err.message}`);
    return null;
  }
}

// ── date / time helpers (IST) ────────────────────────────────────────────────
const iso = (d: Date) => d.toISOString().slice(0, 10);
const istNow = () => new Date(Date.now() + 330 * 60000);
const addDaysIso = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
// Minutes-past-midnight IST for a stored (UTC) timestamp. Mirrors Cockpit.jsx.
const istMinutes = (signedAt: string) => {
  const d = new Date(signedAt);
  return (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (s: string) => `${DOW[new Date(`${s}T00:00:00Z`).getUTCDay()]} ${Number(s.slice(8, 10))}`;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const prettyDate = (s: string) => `${Number(s.slice(8, 10))} ${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
const firstName = (n: string | null) => (n || '').trim().split(/\s+/)[0] || '';

// Every composer returns a NON-EMPTY string: resolveVariables() treats an empty
// value as a missing variable and would skip the recipient, so a failed/absent
// source degrades to '—' rather than suppressing the whole message.

function composeAssembly(pulse: any, today: string): string {
  if (!pulse || !Array.isArray(pulse.checklist) || pulse.checklist.length === 0) return '—';
  const dueMin = pulse.dueTime
    ? (() => { const [h, m] = pulse.dueTime.split(':').map(Number); return h * 60 + m; })()
    : null;
  // Most recent assembly day up to today (today only counts once it's signed, since
  // this runs in the morning before grading). checklist is ascending by date.
  let pick: any = null;
  for (const e of pulse.checklist) {
    if (e.date < today || (e.date === today && e.signedAt)) pick = e;
  }
  if (!pick) pick = pulse.checklist[pulse.checklist.length - 1];
  if (!pick) return 'no recent assembly';

  const label = `Last assembly (${dayLabel(pick.date)})`;
  const g = (pulse.grading || []).find((x: any) => x.date === pick.date);
  const gradeTxt = g && g.expected > 0 ? `, ${g.submitted}/${g.expected} graded` : '';
  if (!pick.signedAt) return `${label}: not signed${gradeTxt}`;
  const m = istMinutes(pick.signedAt);
  const timing = dueMin == null ? '' : m > dueMin ? `, ${m - dueMin}m late` : ', on time';
  return `${label}: signed ${hhmm(m)}${timing}${gradeTxt}`;
}

function composeLeave(leave: any, today: string): { out: string; pending: string } {
  if (!leave) return { out: '—', pending: '—' };
  const d = (leave.days || []).find((x: any) => x.date === today);
  let out = 'none';
  if (d && d.count > 0) {
    const names = (d.names || []).map((n: any) => firstName(n.name)).filter(Boolean);
    const shown = names.slice(0, 3).join(', ');
    const extra = names.length > 3 ? ` +${names.length - 3}` : '';
    out = shown ? `${d.count} (${shown}${extra})` : `${d.count}`;
  }
  return { out, pending: String(leave.pending ?? 0) };
}

function composeFeedback(flow: any): string {
  if (!flow) return '—';
  const open = Number(flow.open || 0);
  if (open === 0) return 'all clear';
  const oldest = Number(flow.oldestOpenDays || 0);
  return oldest > 0 ? `${open} open, oldest ${oldest}d` : `${open} open`;
}

// Mirrors the "behind" derivation in Cockpit.jsx: a plan is behind when the leaves
// scheduled through the current month exceed the best section's covered count.
function composeSyllabus(ov: any): string {
  if (!ov || !Array.isArray(ov.rows)) return '—';
  const idx = ov.currentMonthIndex ?? 0;
  const behind: string[] = [];
  for (const r of ov.rows) {
    const expectedByNow = (r.monthlyScheduled || []).slice(0, idx + 1).reduce((a: number, b: number) => a + b, 0);
    const bestCovered = Math.max(0, ...(r.sections || []).map((s: any) => s.coveredCount || 0));
    if (expectedByNow > 0 && bestCovered < expectedByNow) behind.push(`${r.grade}–${r.subjectName}`);
  }
  if (behind.length === 0) return 'all on track';
  const shown = behind.slice(0, 3).join(', ');
  return `${behind.length} behind — ${shown}${behind.length > 3 ? ` +${behind.length - 3}` : ''}`;
}

// Build the six ordered template variables from the raw source payloads. Pure —
// exported for unit testing. Keys match the school_pulse_daily template's
// `variables` order: date, assembly, leaveOut, leavePending, feedback, syllabus.
export function buildDigestContext(
  sources: { pulse: any; leave: any; flow: any; overview: any },
  today: string,
): Record<string, string> {
  const lv = composeLeave(sources.leave, today);
  return {
    date: prettyDate(today),
    assembly: composeAssembly(sources.pulse, today),
    leaveOut: lv.out,
    leavePending: lv.pending,
    feedback: composeFeedback(sources.flow),
    syllabus: composeSyllabus(sources.overview),
  };
}

async function runForSchool(schoolCode: string, schoolId: string, roleId: string): Promise<void> {
  const today = iso(istNow());
  const from = addDaysIso(today, -9);

  // Current academic year (needed by syllabus; optional for feedback). Resolved straight
  // from the DB using the same "today in range, else latest-starting" rule as
  // academic-year-service — not over HTTP, so it can't be broken by a cross-module auth
  // hop (the /academic-year/search endpoint 403s the machine service token unless that
  // module is on current authz).
  const ayRows = await DB.query(
    singleLineString`
      select uuid from academic_year where school_id = $1
      order by (case when current_date between start_date and end_date then 0 else 1 end), start_date desc nulls last
      limit 1
    `,
    [schoolId],
  );
  const ayId = ayRows[0]?.uuid || '';

  const [pulse, leave, flow, overview] = await Promise.all([
    getJson(`/assembly/pulse?from=${from}&to=${today}`, schoolCode),
    getJson(`/leave/summary?from=${from}&to=${today}`, schoolCode),
    getJson(`/feedback/flow?weeks=4${ayId ? `&academicYearId=${ayId}` : ''}`, schoolCode),
    ayId ? getJson(`/syllabus/overview?academicYearId=${ayId}`, schoolCode) : Promise.resolve(null),
  ]);

  const context = buildDigestContext({ pulse, leave, flow, overview }, today);

  try {
    const res = await fetch(`${BASE}/communication/messages`, {
      method: 'POST',
      headers: headers(schoolCode),
      body: JSON.stringify({
        templateKey: TEMPLATE_KEY,
        language: 'en',
        forceChannel: 'whatsapp',
        source: 'cockpit-digest',
        audience: { employees: { roleIds: [roleId] } },
        context,
      }),
    });
    if (!res.ok) {
      console.error(`[cockpit-digest] ${schoolCode}: enqueue failed HTTP ${res.status}`);
      return;
    }
    const data: any = await res.json();
    console.log(`[cockpit-digest] ${schoolCode}: queued job ${data.jobId}`);
  } catch (err: any) {
    console.error(`[cockpit-digest] ${schoolCode}: enqueue error ${err.message}`);
  }
}

// Entry point invoked by the EventBridge schedule. Resolves every school that has
// an `education_director` role and enqueues a digest for its holders. Never throws —
// a bad school logs and the rest still run. No rows (role not created anywhere) = no-op.
export async function runCockpitDigest(): Promise<{ schools: number }> {
  const targets = await DB.query(
    singleLineString`
      select r.uuid as role_id, r.school_id as school_id, sc.code as school_code
      from role r
      join school sc on sc.uuid = r.school_id
      where lower(r.code) = lower($1)
    `,
    [DIGEST_ROLE_CODE],
  );
  if (targets.length === 0) {
    console.log(`[cockpit-digest] no '${DIGEST_ROLE_CODE}' role in any school — skipping`);
    return { schools: 0 };
  }
  for (const t of targets) {
    try {
      await runForSchool(t.schoolCode, t.schoolId, t.roleId);
    } catch (err: any) {
      console.error(`[cockpit-digest] ${t?.schoolCode} error: ${err.message}`);
    }
  }
  return { schools: targets.length };
}
