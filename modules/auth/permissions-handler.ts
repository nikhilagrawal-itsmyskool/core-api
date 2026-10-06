import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { DB } from '../../shared/lib/db';
import { ACTIONS, reloadPermissionOverrides } from '../../shared/lib/authz-policy';
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
