import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { DB } from '../../shared/lib/db';
import { ACTIONS, reloadPermissionOverrides, reloadUserGrants } from '../../shared/lib/authz-policy';
import { requireAction, getCaller } from './authz';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// God-only Permissions grid. The FILE (shared/lib/authz-policy.ts ROLE_PERMISSIONS) stays the
// factory default; this surface lets god layer GLOBAL grant/revoke overrides on top, stored in
// authz_permission_override. Effective permission = fileDefaults + grants − revokes (computed by
// can()). god ('*') is never a row and never overridable. Examination-first catalog for now.

// The grid's rows (roles) and columns (actions), per module. Deliberately curated per module so
// each grid is small and meaningful. Add a module's slice here and its tab appears in the grid;
// storage + union (can()) stay central, so nothing else changes. god is never a row (its '*' is
// not overridable). Dynamic/data-driven catalogs are Phase 2.
type Catalog = {
  module: string;
  roles: Array<{ role: string; label: string }>;
  actions: Array<{ action: string; label: string }>;
};

const CATALOGS: Record<string, Catalog> = {
  examination: {
    module: 'examination',
    roles: [
      { role: 'admin', label: 'Admin' },
      { role: 'exam-incharge', label: 'Exam Incharge' },
      { role: 'teacher', label: 'Teacher' },
      { role: 'class-teacher', label: 'Class Teacher' },
    ],
    actions: [
      { action: ACTIONS.EXAM_VIEW, label: 'View exams, schedule & rosters' },
      { action: ACTIONS.EXAM_MANAGE, label: 'Run exams: datesheet, rooms, invigilators, admit cards, attendance' },
      { action: ACTIONS.EXAM_PROGRESS_VIEW, label: 'View marks & co-scholastic progress' },
      { action: ACTIONS.EXAM_REPORTCARD_MANAGE, label: 'Generate & print report cards' },
      { action: ACTIONS.EXAM_FORMAT_MANAGE, label: 'Report format & scheme' },
      { action: ACTIONS.EXAM_REMARK_MANAGE, label: 'Remark-template library' },
      { action: ACTIONS.EXAM_MAPPING_MANAGE, label: 'Subject & class-teacher mapping' },
      { action: ACTIONS.EXAM_MARKS_OVERRIDE, label: 'Enter / submit marks on another teacher’s behalf' },
      { action: ACTIONS.EXAM_MARKS_LOCK, label: 'Lock / unlock marks & co-scholastic' },
      { action: ACTIONS.EXAM_CLASS_EXCLUDE, label: 'Exclude / include a class from exams' },
      { action: ACTIONS.EXAM_DUES_OVERRIDE, label: 'Admit-card dues override & threshold' },
    ],
  },
  attendance: {
    module: 'attendance',
    roles: [
      { role: 'admin', label: 'Admin' },
      { role: 'class-teacher', label: 'Class Teacher' },
      { role: 'teacher', label: 'Teacher' },
    ],
    actions: [
      { action: ACTIONS.ATTENDANCE_RECORD_VIEW, label: "View a student's attendance (360 view)" },
      { action: ACTIONS.ATTENDANCE_MARK, label: 'Take roll-call: roster, sessions & save marks' },
      { action: ACTIONS.ATTENDANCE_FINALIZE, label: 'Finalize sessions & edit records' },
      { action: ACTIONS.ATTENDANCE_CONFIG_MANAGE, label: 'Manage attendance config (half-day policy)' },
    ],
  },
  club: {
    module: 'club',
    roles: [
      { role: 'admin', label: 'Admin' },
      { role: 'club-incharge', label: 'Club In-charge' },
      { role: 'teacher', label: 'Teacher' },
    ],
    actions: [
      { action: ACTIONS.CLUB_SETUP_VIEW, label: 'View clubs & programme settings' },
      { action: ACTIONS.CLUB_SETUP_MANAGE, label: 'Manage clubs, config & programme settings' },
      { action: ACTIONS.CLUB_ACTIVITY_VIEW, label: 'View the activity bank' },
      { action: ACTIONS.CLUB_ACTIVITY_MANAGE, label: 'Edit activity content, materials & import' },
      { action: ACTIONS.CLUB_ACTIVITY_APPROVE, label: 'Release / suspend / archive activities' },
      { action: ACTIONS.CLUB_ACTIVITY_REVIEW, label: 'Work the activity review queue' },
      { action: ACTIONS.CLUB_PLAN_VIEW, label: 'View the weekly plan board' },
      { action: ACTIONS.CLUB_PLAN_MANAGE, label: 'Build & edit a draft weekly plan' },
      { action: ACTIONS.CLUB_PLAN_PUBLISH, label: 'Publish · after-publish change · close/reopen' },
      { action: ACTIONS.CLUB_PLAN_CONDUCT, label: 'Conduct guide + quick closure (teacher)' },
    ],
  },
  fees: {
    module: 'fees',
    roles: [
      { role: 'admin', label: 'Admin' },
      { role: 'fees-incharge', label: 'Fees In-charge' },
      { role: 'manager', label: 'Manager' },
    ],
    actions: [
      { action: ACTIONS.FEE_REPORT_VIEW, label: 'View dues, reports, receipts & student ledgers' },
      { action: ACTIONS.FEE_COLLECT, label: 'Collect fees, refunds & cancel receipts' },
      { action: ACTIONS.FEE_STRUCTURE_MANAGE, label: 'Fee structure, heads, cycles & charge-run' },
      { action: ACTIONS.FEE_CONCESSION_ASSIGN, label: 'Add / remove students to a concession' },
      { action: ACTIONS.FEE_CONCESSION_MANAGE, label: 'Create / edit / delete concession schemes' },
      { action: ACTIONS.FEE_WAIVER_MANAGE, label: 'Waivers & the Collect write-off' },
      { action: ACTIONS.FEE_LATEFEE_MANAGE, label: 'Late-fee rules & apply fines' },
      { action: ACTIONS.FEE_TRANSPORT_MANAGE, label: 'Transport fee slabs' },
      { action: ACTIONS.FEE_STUDENT_MANAGE, label: 'Withdraw a student & mark exam-only' },
      { action: ACTIONS.FEE_MANAGER_VIEW, label: 'Collection Desk (read-only)' },
      { action: ACTIONS.FEE_FINE_EXEMPT, label: 'Exempt a late fine' },
      { action: ACTIONS.FEE_RECEIPT_VERIFY, label: 'Scan & Verify receipts' },
      { action: ACTIONS.FEE_MIGRATION_IMPORT, label: 'Bulk historical import' },
    ],
  },
  leave: {
    module: 'leave',
    roles: [
      { role: 'admin', label: 'Admin' },
      { role: 'teacher', label: 'Teacher' },
    ],
    actions: [
      { action: ACTIONS.LEAVE_CALENDAR_VIEW, label: "Shared who's-on-leave calendar + coverage handover" },
      { action: ACTIONS.LEAVE_APPLICATION_APPLY, label: 'Apply for / cancel own leave (self-service)' },
      { action: ACTIONS.LEAVE_APPLICATION_VIEW, label: "View an application's detail, audit, attachment, balance" },
      { action: ACTIONS.LEAVE_APPLICATION_APPROVE, label: 'Approve / reject leave applications' },
      { action: ACTIONS.LEAVE_CONFIG_VIEW, label: 'View leave policy config & leave types' },
      { action: ACTIONS.LEAVE_CONFIG_MANAGE, label: 'Edit leave policy config & leave types' },
      { action: ACTIONS.LEAVE_ATTENDANCE_VIEW, label: 'View biometric attendance, day view & mapping' },
      { action: ACTIONS.LEAVE_ATTENDANCE_MANAGE, label: 'Mark & import biometric attendance, enroll mappings' },
      { action: ACTIONS.LEAVE_DEDUCTION_VIEW, label: 'View deduction (LOP) runs & an employee’s deductions' },
      { action: ACTIONS.LEAVE_DEDUCTION_MANAGE, label: 'Run / finalize deduction (LOP) batches' },
    ],
  },
  medical: {
    module: 'medical',
    roles: [
      { role: 'admin', label: 'Admin' },
      { role: 'medical-incharge', label: 'Medical In-charge' },
      { role: 'teacher', label: 'Teacher' },
    ],
    actions: [
      { action: ACTIONS.MEDICAL_INVENTORY_VIEW, label: 'View inventory items & stock' },
      { action: ACTIONS.MEDICAL_INVENTORY_MANAGE, label: 'Add / edit / delete inventory items' },
      { action: ACTIONS.MEDICAL_PURCHASE_VIEW, label: 'View purchases, batches, expiring stock & bills' },
      { action: ACTIONS.MEDICAL_PURCHASE_MANAGE, label: 'Record / edit / delete purchases, batches & bills' },
      { action: ACTIONS.MEDICAL_ISSUE_VIEW, label: 'View the issue log (what has been issued)' },
      { action: ACTIONS.MEDICAL_ISSUE_MANAGE, label: 'Record / edit / delete issues' },
    ],
  },
  lab: {
    module: 'lab',
    roles: [
      { role: 'admin', label: 'Admin' },
      { role: 'lab-incharge', label: 'Lab In-charge' },
      { role: 'teacher', label: 'Teacher' },
    ],
    actions: [
      { action: ACTIONS.LAB_SETUP_VIEW, label: 'View the Labs registry & lookups' },
      { action: ACTIONS.LAB_SETUP_MANAGE, label: 'Create / edit / delete labs' },
      { action: ACTIONS.LAB_INVENTORY_VIEW, label: 'View inventory items & stock' },
      { action: ACTIONS.LAB_INVENTORY_MANAGE, label: 'Add / edit / delete inventory items' },
      { action: ACTIONS.LAB_PURCHASE_VIEW, label: 'View purchases, batches, alerts & bills' },
      { action: ACTIONS.LAB_PURCHASE_MANAGE, label: 'Record / edit / delete purchases, batches & bills' },
      { action: ACTIONS.LAB_ISSUE_VIEW, label: 'View the issue log (what has been issued)' },
      { action: ACTIONS.LAB_ISSUE_MANAGE, label: 'Record / edit / delete / return issues' },
      { action: ACTIONS.LAB_BREAKAGE_VIEW, label: 'View the breakage log' },
      { action: ACTIONS.LAB_BREAKAGE_MANAGE, label: 'Record / edit / delete breakages' },
    ],
  },
  sports: {
    module: 'sports',
    roles: [
      { role: 'admin', label: 'Admin' },
      { role: 'sports-incharge', label: 'Sports In-charge' },
      { role: 'teacher', label: 'Teacher' },
    ],
    actions: [
      { action: ACTIONS.SPORTS_SETUP_VIEW, label: 'View sport in-charges & lookups' },
      { action: ACTIONS.SPORTS_SETUP_MANAGE, label: 'Set sport in-charges' },
      { action: ACTIONS.SPORTS_INVENTORY_VIEW, label: 'View inventory items & stock' },
      { action: ACTIONS.SPORTS_INVENTORY_MANAGE, label: 'Add / edit / delete inventory items' },
      { action: ACTIONS.SPORTS_PURCHASE_VIEW, label: 'View purchases, batches & bills' },
      { action: ACTIONS.SPORTS_PURCHASE_MANAGE, label: 'Record / edit / delete purchases, batches & bills' },
      { action: ACTIONS.SPORTS_ISSUE_VIEW, label: 'View the issue log (what has been issued)' },
      { action: ACTIONS.SPORTS_ISSUE_MANAGE, label: 'Record / edit / delete / return issues' },
      { action: ACTIONS.SPORTS_BREAKAGE_VIEW, label: 'View the breakage log' },
      { action: ACTIONS.SPORTS_BREAKAGE_MANAGE, label: 'Record / edit / delete breakages' },
    ],
  },
};

const DEFAULT_MODULE = 'examination';
// toggle() validates against the UNION of every registered catalog, so any module's cell is
// editable; the file policy / '*' still governs what the grant/revoke actually changes.
const ALL_ROLES = new Set<string>(
  Object.values(CATALOGS).flatMap((c) => c.roles.map((r) => r.role))
);
const ALL_ACTIONS = new Set<string>(
  Object.values(CATALOGS).flatMap((c) => c.actions.map((a) => a.action))
);

class PermissionsHandler {
  // GET /auth/permissions — the grid payload: catalog (rows+cols) + every global override row.
  public async list(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const caller = requireAction(event, ACTIONS.AUTHZ_MANAGE, callback);
      if (!caller) return;
      const moduleKey = (event.queryStringParameters && event.queryStringParameters.module) || DEFAULT_MODULE;
      const catalog = CATALOGS[moduleKey] || CATALOGS[DEFAULT_MODULE];
      const overrides = await DB.query(
        'select role, action, effect, setby_userid, set_at, reason from authz_permission_override order by role, action'
      );
      return ResponseBuilder.ok({ ...catalog, modules: Object.keys(CATALOGS), overrides }, callback);
    } catch (err) {
      return ResponseBuilder.handleError(err, callback);
    }
  }

  // GET /auth/permissions/effective — the slim override list for ANY authenticated user, so each
  // client can locally compute can() (e.g. show a menu item a grant just enabled). Not god-gated:
  // the policy itself isn't secret, and audit fields (who/why) are withheld here.
  public async effective(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const caller = getCaller(event);
      if (!caller) {
        return ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Authentication required', callback);
      }
      const overrides = await DB.query(
        'select role, action, effect from authz_permission_override order by role, action'
      );
      return ResponseBuilder.ok({ overrides }, callback);
    } catch (err) {
      return ResponseBuilder.handleError(err, callback);
    }
  }

  // POST /auth/permissions/toggle  { role, action, desired: 'grant' | 'revoke' | 'default' }
  // 'default' deletes the override (cell reverts to the file policy); grant/revoke upsert one row.
  public async toggle(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const caller = requireAction(event, ACTIONS.AUTHZ_MANAGE, callback);
      if (!caller) return;
      const body = this._body(event);
      if (!body) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);

      const role = String(body.role || '').trim();
      const action = String(body.action || '').trim();
      const desired = String(body.desired || '').trim();
      const reason = body.reason ? String(body.reason).slice(0, 255) : null;

      if (!ALL_ROLES.has(role)) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Unknown role: ${role}`, callback);
      }
      if (!ALL_ACTIONS.has(action)) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Unknown action: ${action}`, callback);
      }
      if (!['grant', 'revoke', 'default'].includes(desired)) {
        return ResponseBuilder.badRequest(
          ErrorCode.InvalidInput,
          "desired must be 'grant', 'revoke' or 'default'",
          callback
        );
      }

      if (desired === 'default') {
        await DB.query('delete from authz_permission_override where role=$1 and action=$2', [role, action]);
      } else {
        // upsert on the (role, action) unique cell
        const existing = await DB.query(
          'select uuid from authz_permission_override where role=$1 and action=$2',
          [role, action]
        );
        if (existing.length) {
          await DB.query(
            'update authz_permission_override set effect=$1, setby_userid=$2, set_at=now(), reason=$3 where role=$4 and action=$5',
            [desired, caller.loginId, reason, role, action]
          );
        } else {
          await DB.query(
            'insert into authz_permission_override (uuid, role, action, effect, setby_userid, set_at, reason) values ($1,$2,$3,$4,$5,now(),$6)',
            [generateShortUuid(12), role, action, desired, caller.loginId, reason]
          );
        }
      }

      // Refresh THIS container's cache immediately so god sees the effect without the TTL lag.
      await reloadPermissionOverrides();

      // Echo back the catalog for the module that owns the toggled action (so the client can
      // re-render the same tab), falling back to the default module.
      const catalog =
        Object.values(CATALOGS).find((c) => c.actions.some((a) => a.action === action)) ||
        CATALOGS[DEFAULT_MODULE];
      const overrides = await DB.query(
        'select role, action, effect, setby_userid, set_at, reason from authz_permission_override order by role, action'
      );
      return ResponseBuilder.ok({ ...catalog, modules: Object.keys(CATALOGS), overrides }, callback);
    } catch (err) {
      return ResponseBuilder.handleError(err, callback);
    }
  }

  // GET /auth/permissions/grants?module=<key>  — active (non-expired, non-revoked) temporary
  // per-employee grants, optionally narrowed to one module's actions, with the teacher's name.
  public async listGrants(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const caller = requireAction(event, ACTIONS.AUTHZ_MANAGE, callback);
      if (!caller) return;
      const moduleKey = event.queryStringParameters && event.queryStringParameters.module;
      const rows = await DB.query(
        'select g.uuid, g.employee_id, e.name as employee_name, g.action, g.reason, ' +
          'g.granted_by_userid, extract(epoch from g.granted_at) * 1000 as granted_ms, ' +
          'extract(epoch from g.expires_at) * 1000 as expires_ms ' +
          'from authz_user_grant g left join employee e on e.uuid = g.employee_id ' +
          'where g.revoked_at is null and g.expires_at > now() order by g.expires_at'
      );
      let grants = rows || [];
      if (moduleKey && CATALOGS[moduleKey]) {
        const inModule = new Set(CATALOGS[moduleKey].actions.map((a) => a.action));
        grants = grants.filter((r: any) => inModule.has(r.action));
      }
      return ResponseBuilder.ok({ grants }, callback);
    } catch (err) {
      return ResponseBuilder.handleError(err, callback);
    }
  }

  // POST /auth/permissions/grants  { employeeId, actions: string[], durationHours, reason }
  // Assign one teacher a set of actions for durationHours (god-only). One row per action.
  public async createGrants(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const caller = requireAction(event, ACTIONS.AUTHZ_MANAGE, callback);
      if (!caller) return;
      const body = this._body(event);
      if (!body) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);

      const employeeId = String(body.employeeId || '').trim();
      const actions: string[] = Array.isArray(body.actions) ? body.actions.map((a: any) => String(a).trim()) : [];
      const durationHours = Number(body.durationHours);
      const reason = body.reason ? String(body.reason).slice(0, 255) : null;

      if (!employeeId) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'employeeId is required', callback);
      if (!actions.length) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'At least one action is required', callback);
      const unknown = actions.filter((a) => !ALL_ACTIONS.has(a));
      if (unknown.length) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Unknown action(s): ${unknown.join(', ')}`, callback);
      if (!Number.isFinite(durationHours) || durationHours < 1 || durationHours > 720) {
        return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'durationHours must be an integer between 1 and 720', callback);
      }
      const hours = Math.floor(durationHours);

      // The grant is scoped to the teacher's own school (employee_id is globally unique).
      const emp = await DB.query('select uuid, school_id, name from employee where uuid = $1', [employeeId]);
      if (!emp.length) return ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Unknown employee', callback);
      const schoolId = emp[0].schoolId;

      for (const action of actions) {
        await DB.query(
          'insert into authz_user_grant (uuid, school_id, employee_id, action, granted_by_userid, granted_at, expires_at, reason) ' +
            'values ($1,$2,$3,$4,$5,now(), now() + make_interval(hours => $6), $7)',
          [generateShortUuid(12), schoolId, employeeId, action, caller.loginId, hours, reason]
        );
      }
      // Refresh THIS container immediately; other module containers catch up within the TTL.
      await reloadUserGrants();
      return ResponseBuilder.ok({ employeeId, employeeName: emp[0].name, actions, hours }, callback);
    } catch (err) {
      return ResponseBuilder.handleError(err, callback);
    }
  }

  // DELETE /auth/permissions/grants/{id} — revoke a temporary grant early.
  public async revokeGrant(event: ApiEvent, context: ApiContext, callback: ApiCallback) {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const caller = requireAction(event, ACTIONS.AUTHZ_MANAGE, callback);
      if (!caller) return;
      const id = event.pathParameters && event.pathParameters.id;
      if (!id) return ResponseBuilder.badRequest(ErrorCode.MissingId, 'grant id is required', callback);
      await DB.query(
        'update authz_user_grant set revoked_at = now(), revoked_by_userid = $1 where uuid = $2 and revoked_at is null',
        [caller.loginId, id]
      );
      await reloadUserGrants();
      return ResponseBuilder.ok({ revoked: id }, callback);
    } catch (err) {
      return ResponseBuilder.handleError(err, callback);
    }
  }

  private _body(event: ApiEvent): any {
    if (!event.body) return null;
    try {
      return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch {
      return null;
    }
  }
}

const h = new PermissionsHandler();
export const list = h.list.bind(h);
export const effective = h.effective.bind(h);
export const toggle = h.toggle.bind(h);
export const listGrants = h.listGrants.bind(h);
export const createGrants = h.createGrants.bind(h);
export const revokeGrant = h.revokeGrant.bind(h);
