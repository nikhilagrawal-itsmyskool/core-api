// Backend copy of the authorization policy. This is a byte-for-byte port of the
// admin-portal frontend model — keep the two in sync:
//   admin-portal/src/permissions/policy.js   -> ROLE_PERMISSIONS (below)
//   admin-portal/src/permissions/actions.js  -> ACTIONS (below)
//   admin-portal/src/permissions/can.js      -> can() (below)
// A parity test (shared/lib/__tests__/authz-policy.parity.test.ts) fails if they drift.
//
// Model: role -> allowed actions (allow-list; default DENY). Actions are coarse,
// namespaced `module.area.verb` strings.
//   '*'            grants everything (god)
//   'module.*'     grants every action in a module
//   'module.verb'  grants one action
// A user's roles come from the verified JWT `roles` claim; the union of those roles'
// actions is what they may do. Roles are additive (a user can hold several).

// Canonical action catalog (mirror of actions.js ACTIONS). Handlers/manifests should
// reference these constants rather than raw strings so a typo is a compile error.
export const ACTIONS = {
  MEDICAL_VIEW: 'medical.view',
  MEDICAL_MANAGE: 'medical.manage',
  LAB_VIEW: 'lab.view',
  LAB_MANAGE: 'lab.manage',
  FINE_VIEW: 'fine.view',
  FINE_MANAGE: 'fine.manage',
  FEE_VIEW: 'fee.view',
  FEE_MANAGE: 'fee.manage',
  FEE_COLLECT: 'fee.collect',
  // Read-only "Collection Desk" (simplified manager view). Under fee.* so admin/god/fees-incharge
  // inherit it; the locked `manager` role gets ONLY this.
  FEE_MANAGER_VIEW: 'fee.manager.view',
  // Outside the fee.* namespace on purpose -> fee incharges/clerks DON'T inherit it;
  // only the admin role (explicit grant) + god ('*'). Powers the Scan & Verify tile.
  RECEIPT_VERIFY: 'receipt.verify',
  UNIFORM_VIEW: 'uniform.view',
  UNIFORM_MANAGE: 'uniform.manage',
  SHOP_VIEW: 'shop.view',
  SHOP_MANAGE: 'shop.manage',
  SPORTS_VIEW: 'sports.view',
  SPORTS_MANAGE: 'sports.manage',
  ASSET_VIEW: 'asset.view',
  ASSET_MANAGE: 'asset.manage',
  LIBRARY_VIEW: 'library.view',
  LIBRARY_MANAGE: 'library.manage',
  SUPPLIES_VIEW: 'supplies.view',
  SUPPLIES_MANAGE: 'supplies.manage',
  TIMETABLE_VIEW: 'timetable.view',
  TIMETABLE_PRINT: 'timetable.print',
  TIMETABLE_MANAGE: 'timetable.manage',
  EMPLOYEE_VIEW: 'employee.view',
  EMPLOYEE_MANAGE: 'employee.manage',
  EMPLOYEE_RESTORE: 'employee.restore',
  PURCHASE_LOG_EDIT: 'purchaseLog.edit',
  PURCHASE_LOG_RESTORE: 'purchaseLog.restore',
  STUDENT_VIEW: 'student.view',
  STUDENT_MANAGE: 'student.manage',
  STUDENT_VIEW_CONTACTS: 'student.contacts.view',
  // Attendance. mark = take roll-call (roster/sessions/save + read config); finalize = finalize
  // sessions & edit records after finalize; config.manage = the per-school Attendance Config screen
  // (half-day policy) — god + admin only. mark/finalize are granted below; config.manage to admin.
  ATTENDANCE_MARK: 'attendance.mark',
  ATTENDANCE_FINALIZE: 'attendance.finalize',
  ATTENDANCE_CONFIG_MANAGE: 'attendance.config.manage',
  COMMUNICATION_SEND: 'communication.send',
  COMMUNICATION_TEMPLATE_MANAGE: 'communication.template.manage',
  COMMUNICATION_TEMPLATE_DELETE: 'communication.template.delete',
  HIRING_VIEW: 'hiring.view',
  HIRING_MANAGE: 'hiring.manage',
  TRANSPORT_VIEW: 'transport.view',
  TRANSPORT_MANAGE: 'transport.manage',
  TRANSPORT_ATTENDANCE_MARK: 'transport.attendance.mark',
  TRANSPORT_ATTENDANCE_FINALIZE: 'transport.attendance.finalize',
  TRANSFER_VIEW: 'transfer.view',
  TRANSFER_MANAGE: 'transfer.manage',
  SYLLABUS_VIEW: 'syllabus.view',
  SYLLABUS_MANAGE: 'syllabus.manage',
  SYLLABUS_PROGRESS_MARK: 'syllabus.progress.mark',
  ASSEMBLY_VIEW: 'assembly.view',
  ASSEMBLY_MANAGE: 'assembly.manage',
  HOMEWORK_POST: 'homework.post',
  HOMEWORK_MANAGE: 'homework.manage',
  ACADEMIC_CALENDAR_VIEW: 'academic-calendar.view',
  ACADEMIC_CALENDAR_MANAGE: 'academic-calendar.manage',
  // Examination — strict `module.resource.action` convention. NOTE: no role carries an `exam.*`
  // wildcard anymore (admin/exam-incharge get explicit lists below), so every leaf is independently
  // grantable and the god-only ones are NOT swallowed by a wildcard. (EXAM_VIEW/EXAM_MANAGE keep
  // their constant NAMES so the ~90 existing guard() call-sites don't change — only the values move.)
  EXAM_VIEW: 'exam.schedule.view',
  EXAM_MANAGE: 'exam.schedule.manage',
  EXAM_PROGRESS_VIEW: 'exam.progress.view',
  EXAM_REPORTCARD_MANAGE: 'exam.reportcard.manage',
  EXAM_FORMAT_MANAGE: 'exam.format.manage',
  EXAM_REMARK_MANAGE: 'exam.remark.manage',
  EXAM_MAPPING_MANAGE: 'exam.mapping.manage',
  EXAM_MARKS_OVERRIDE: 'exam.marks.override',
  EXAM_MARKS_LOCK: 'exam.marks.lock',
  EXAM_CLASS_EXCLUDE: 'exam.class.exclude',
  EXAM_DUES_OVERRIDE: 'exam.dues.override',
  // God-only: edit the role→permission overrides from the Permissions grid. No role but god
  // (via '*') holds it, so requireAction('authz.manage') is effectively god-only.
  AUTHZ_MANAGE: 'authz.manage',
  // Developmental programmes (Spoken English & Life Communication, …). view = the
  // teacher Class->Month->Theme reader + catalog (teacher/admin); manage = author
  // units + re-upload source docs (admin/god/programme-incharge).
  PROGRAMME_VIEW: 'programme.view',
  PROGRAMME_MANAGE: 'programme.manage',
  ASSISTANT_USE: 'assistant.use',
  // Staff leave. apply = self-service (teacher/admin); manage = oversight (god-only for now).
  LEAVE_APPLY: 'leave.apply',
  LEAVE_MANAGE: 'leave.manage',
  // Home-visit feedback / complaints. view = read category lookup (teachers, to record);
  // record = log + assign to a teacher (teachers); respond = the assigned teacher's reply
  // (teachers, own items only); review = director dashboard + complete/reopen. `review` is
  // deliberately OUTSIDE any namespace admin inherits, so it is god-only until a real
  // `education-director` role is introduced (grant it feedback.review then).
  FEEDBACK_VIEW: 'feedback.view',
  FEEDBACK_RECORD: 'feedback.record',
  FEEDBACK_RESPOND: 'feedback.respond',
  FEEDBACK_REVIEW: 'feedback.review',
  // Director's Cockpit / School Pulse landing (director + god). Read-only heartbeat.
  COCKPIT_VIEW: 'cockpit.view',
  // Clubs & Activities (per-school display name e.g. "Saturday Activities"). A day-neutral
  // engine: a club's versioned activity bank, the weekly plan board, and quick closure. Strict
  // `module.resource.action` across THREE resources (setup | activity | plan); NO `club.*`
  // wildcard anywhere, so every leaf is independently grantable and god-only leaves aren't
  // swallowed. Locked default: everything is god-first; god opens the rest up via the grid.
  //   setup.*     = clubs, config, enabled blocks & programme settings
  //   activity.*  = the versioned bank (view / author content / release / review queue)
  //   plan.*      = the weekly board (view / build draft / publish+change+close / teacher conduct)
  CLUB_SETUP_VIEW: 'club.setup.view',
  CLUB_SETUP_MANAGE: 'club.setup.manage',
  CLUB_ACTIVITY_VIEW: 'club.activity.view',
  CLUB_ACTIVITY_MANAGE: 'club.activity.manage',
  CLUB_ACTIVITY_APPROVE: 'club.activity.approve',
  CLUB_ACTIVITY_REVIEW: 'club.activity.review',
  CLUB_PLAN_VIEW: 'club.plan.view',
  CLUB_PLAN_MANAGE: 'club.plan.manage',
  CLUB_PLAN_PUBLISH: 'club.plan.publish',
  CLUB_PLAN_CONDUCT: 'club.plan.conduct',
} as const;

// Role -> allowed actions. Mirror of policy.js ROLE_PERMISSIONS (order preserved).
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  god: ['*'],
  admin: [
    'medical.*',
    'lab.*',
    'fine.*',
    'fee.*',
    'uniform.*',
    'shop.*',
    'sports.*',
    'asset.*',
    'library.*',
    'supplies.*',
    'employee.view',
    'employee.manage',
    'timetable.view',
    'timetable.print',
    'student.view',
    'student.manage',
    'student.contacts.view',
    'attendance.mark',
    'attendance.finalize',
    'attendance.config.manage', // Attendance Config screen (half-day policy) — admin + god
    'communication.send',
    'communication.template.manage',
    'hiring.view',
    'hiring.manage',
    'transport.view',
    'transport.manage',
    'transport.attendance.mark',
    'transport.attendance.finalize',
    'transfer.view',
    'transfer.manage',
    'syllabus.view',
    'syllabus.manage',
    'syllabus.progress.mark',
    'programme.view',
    'assembly.view',
    'assembly.manage',
    'homework.post',
    'homework.manage',
    'academic-calendar.view',
    'academic-calendar.manage',
    // Examination (explicit, no wildcard): admin runs exams + report cards, views progress.
    // NOT config/scheme/remark/mapping, NOT marks-override/lock/class-exclude, NOT dues-override (god-only).
    'exam.schedule.view',
    'exam.schedule.manage',
    'exam.progress.view',
    'exam.reportcard.manage',
    'receipt.verify', // Scan & Verify (admin + god only; NOT fee incharges)
    'leave.apply', // Self-service leave only; oversight (leave.manage) is god-only for now
    'documents.sign', // Read & sign own documents; authoring (documents.manage) is god-only
    // Clubs & Activities: NONE by default (locked to god). god grants admin what it needs via
    // the Permissions grid. No club.* here on purpose.
  ],
  // Standard teaching staff: view-only across the modules they can reach.
  teacher: [
    'sports.view',
    'library.view',
    'supplies.view',
    'timetable.view',
    'student.view',
    'student.contacts.view',
    'employee.view',
    'syllabus.view',
    'syllabus.progress.mark',
    'programme.view',
    'assembly.view',
    'academic-calendar.view',
    'leave.apply',
    'documents.sign',
    // Feedback/complaints: any teacher may record + assign, and respond to items
    // assigned to them. Reviewing/completing (feedback.review) is god-only.
    'feedback.view',
    'feedback.record',
    'feedback.respond',
    'club.plan.conduct', // Run own club assignment (guide) + quick closure on the PWA
  ],
  // Class teacher: additive to `teacher` — may MARK attendance and POST homework.
  'class-teacher': ['attendance.mark', 'homework.post'],
  // Club in-charge: READ-ONLY by default across the three club resources (see clubs, the
  // activity bank, and the plan board). Authoring/approve/review/planning are god-first;
  // god grants this role more via the Permissions grid as each school decides.
  'club-incharge': ['club.setup.view', 'club.activity.view', 'club.plan.view'],
  // Each in-charge === admin, but scoped to its own module.
  'medical-incharge': ['medical.*'],
  'lab-incharge': ['lab.*'],
  'fees-incharge': ['fee.*'],
  'sports-incharge': ['sports.*'],
  'assets-incharge': ['asset.*'],
  'library-incharge': ['library.*'],
  'supplies-incharge': ['supplies.*'],
  'hiring-incharge': ['hiring.*'],
  'transport-incharge': ['transport.*'],
  'syllabus-incharge': ['syllabus.*'],
  'programme-incharge': ['programme.*'],
  'assembly-incharge': ['assembly.*'],
  // Exam incharge === admin, but scoped to the examination module.
  // Exam office: run exams + view progress, but NOT report cards, config, mapping, or the god-only
  // overrides (enter-on-behalf, lock, class-exclude, dues-override).
  'exam-incharge': ['exam.schedule.view', 'exam.schedule.manage', 'exam.progress.view'],
  // Route-scoped teacher: reach bus-attendance screens + mark, but only on routes
  // they staff (route filtering enforced in the transport handlers); finalize stays
  // admin/god/transport-incharge only.
  'transport-attendance': ['transport.attendance.mark'],
  // Collection-desk manager: a locked, read-only fee-collection view and nothing else.
  manager: ['fee.manager.view'],
  // Education director: lands on the Cockpit / School Pulse and reviews the school's
  // heartbeat. Read-oriented oversight across the pulse domains. Additive — a person can
  // also hold `god`. Mirrors admin-portal/src/permissions/policy.js.
  director: [
    'cockpit.view',
    'feedback.view',
    'feedback.review',
    'assembly.view',
    'assembly.manage',
    'syllabus.view',
    'student.view',
    'student.contacts.view',
    'academic-calendar.view',
    'timetable.view',
    'transport.view',
    'leave.apply',
    'leave.manage',
  ],
};

// ── God's live overrides (DB) layered on the file defaults above ──────────────────────
// Loaded into a per-Lambda cache, refreshed in the background (fire-and-forget, short TTL). can()
// stays SYNC and FAIL-SAFE: an empty/stale/unavailable cache falls back to the file defaults, and
// with no overrides this is byte-for-byte the old behaviour. GLOBAL (deployment-wide, not per-school).
type Override = { role: string; action: string; effect: 'grant' | 'revoke' };
let OVERRIDES: Override[] = [];
let overridesLoadedAt = 0;
let overridesLoading = false;
const OVERRIDE_TTL_MS = 60_000;

async function loadOverridesNow(): Promise<void> {
  try {
    // lazy require — merely importing this policy file must NOT create a DB pool (authorizer safety)
    const { DB } = require('./db');
    const rows = await DB.query('select role, action, effect from authz_permission_override');
    OVERRIDES = (rows || []).map((r: any) => ({ role: r.role, action: r.action, effect: r.effect }));
  } catch { /* keep current cache → file defaults on any failure */ }
  overridesLoadedAt = Date.now();
}

function maybeRefreshOverrides(): void {
  // Skip the background DB refresh under the jest unit harness (no DB server) to avoid noise and
  // open handles; real Lambdas (NODE_ENV unset/'production') refresh normally.
  if (process.env.NODE_ENV === 'test') return;
  if (overridesLoading || Date.now() - overridesLoadedAt < OVERRIDE_TTL_MS) return;
  overridesLoading = true;
  loadOverridesNow().finally(() => { overridesLoading = false; });
}

// Force a reload now — called right after god writes a toggle so the same warm container is fresh.
export async function reloadPermissionOverrides(): Promise<void> { await loadOverridesNow(); }
export function getPermissionOverrides(): Override[] { return OVERRIDES; }

// Does the FILE default (ignoring overrides) grant this action to this single role?
export function baseGrants(role: string, action: string): boolean {
  return (ROLE_PERMISSIONS[role] || []).some(
    (p) => p === '*' || p === action || (p.endsWith('.*') && action.startsWith(p.slice(0, -1)))
  );
}
const hasOverride = (role: string, action: string, effect: 'grant' | 'revoke') =>
  OVERRIDES.some((o) => o.role === role && o.action === action && o.effect === effect);

// True if any of `roles` grants `action`. File defaults + god's grant/revoke overrides.
export function can(roles: string[] | undefined, action: string): boolean {
  maybeRefreshOverrides();
  const rs = roles || [];
  if (rs.some((r) => (ROLE_PERMISSIONS[r] || []).includes('*'))) return true;         // god — never overridable
  if (rs.some((r) => hasOverride(r, action, 'grant'))) return true;                    // explicit grant wins
  return rs.some((r) => !hasOverride(r, action, 'revoke') && baseGrants(r, action));   // default, unless revoked
}
