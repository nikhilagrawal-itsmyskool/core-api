import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader, getCallerContext, revealEmployee } from '../auth/auth-utils';
import { guard, getCaller } from '../auth/authz';
import { can, ACTIONS } from '../../shared/lib/authz-policy';
import { EMPLOYEE_ACTIONS } from './employee-actions';
import { maskContactFields } from '../../shared/util/mask-phone';
import { employeeService } from './employee-service';
import { CreateEmployeeRequest, UpdateEmployeeRequest } from './employee-interfaces';

class EmployeeHandler {
  // Role assignment is a god-only sub-permission of employee management: an admin may add/edit
  // employees but cannot grant/revoke roles. Enforced server-side by stripping roleIds from the
  // request unless the caller holds employee.roles.manage (the UI also hides the role editor).
  private canManageRoles(event: ApiEvent): boolean {
    const caller = getCaller(event);
    return !!caller && can(caller.roles, ACTIONS.EMPLOYEE_ROLES_MANAGE);
  }

  // Per-school config: whether admins may edit/delete employees who hold a role.
  // GET is readable by employee viewers so the UI can gate its buttons.
  public getConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;
      const config = await employeeService.getConfig(schoolId);
      ResponseBuilder.ok({ config }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /config — god-only (employee.config.manage).
  public updateConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body = JSON.parse(event.body);
      const userId = this.getUserId(event);
      const config = await employeeService.updateConfig(schoolId, body, userId);
      ResponseBuilder.ok({ config }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Block a non-god admin from editing/deleting an employee who holds a role (when the school's
  // restrict_roled_edit config is on). Writes a 403 and returns true when blocked. God (anyone with
  // employee.roles.manage) bypasses.
  private async blockedByRoledRestriction(event: ApiEvent, id: string, schoolId: string, callback: ApiCallback): Promise<boolean> {
    if (this.canManageRoles(event)) return false;
    if (!(await employeeService.isEditRestricted(id, schoolId))) return false;
    ResponseBuilder.forbidden(
      ErrorCode.MissingPermission,
      'This employee has an assigned role; only a god user can edit or delete them.',
      callback
    );
    return true;
  }

  public search = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      const name = event.queryStringParameters?.name;
      const includeDeleted = event.queryStringParameters?.includeDeleted === 'true';
      const rolesParam = event.queryStringParameters?.roles;
      const roleCodes = rolesParam
        ? rolesParam
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      const results = await employeeService.search(schoolId, name, includeDeleted, roleCodes);
      const ctx = getCallerContext(event);
      for (const r of results || []) {
        // familyUniqueNumber is the login id — but it is the employee's mobile number.
        maskContactFields(r, ['mobile', 'whatsapp', 'familyUniqueNumber'], revealEmployee(ctx, r.uuid));
      }
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public listRoles = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      const results = await employeeService.listRoles(schoolId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body: CreateEmployeeRequest = JSON.parse(event.body);

      if (!body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Name is required', callback);
        return;
      }
      if (!body.familyUniqueNumber || !body.familyUniqueNumber.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Family unique number is required', callback);
        return;
      }

      // Only god (employee.roles.manage) may set roles; an admin's roleIds are ignored.
      if (!this.canManageRoles(event)) body.roleIds = undefined;

      const userId = this.getUserId(event);
      const result = await employeeService.create(body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback);
        return;
      }

      const result = await employeeService.getById(id, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Employee not found', callback);
        return;
      }
      const ctx = getCallerContext(event);
      maskContactFields(result, ['mobile', 'whatsapp', 'familyUniqueNumber'], revealEmployee(ctx, result.uuid));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback);
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      // A roled employee can only be edited by god when the school restricts it (config).
      if (await this.blockedByRoledRestriction(event, id, schoolId, callback)) return;

      const body: UpdateEmployeeRequest = JSON.parse(event.body);

      // Only god (employee.roles.manage) may change roles; an admin's roleIds are ignored so the
      // rest of the edit (name, employee number, device number, …) still goes through.
      if (!this.canManageRoles(event)) body.roleIds = undefined;

      const userId = this.getUserId(event);
      const result = await employeeService.update(id, body, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Employee not found', callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback);
        return;
      }

      // A roled employee can only be deleted by god when the school restricts it (config).
      if (await this.blockedByRoledRestriction(event, id, schoolId, callback)) return;

      const userId = this.getUserId(event);
      const deleted = await employeeService.delete(id, schoolId, userId);
      if (!deleted) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Employee not found', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Employee deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public restore = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback);
        return;
      }

      const userId = this.getUserId(event);
      const result = await employeeService.restore(id, schoolId, userId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Deleted employee not found', callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getCredentials = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback);
        return;
      }

      const result = await employeeService.getCredentials(id, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'No login found for this employee', callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public resetPassword = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback);
        return;
      }

      const userId = this.getUserId(event);
      const done = await employeeService.resetPassword(id, schoolId, userId);
      if (!done) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'No login found for this employee', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'Password has been reset. User must change password on next login.' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public forceReLogin = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await this.resolveSchoolId(event, callback);
      if (!schoolId) return;

      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Employee ID is required', callback);
        return;
      }

      const userId = this.getUserId(event);
      const done = await employeeService.forceReLogin(id, schoolId, userId);
      if (!done) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'No login found for this employee', callback);
        return;
      }
      ResponseBuilder.ok({ message: 'The employee will be signed out within a minute and must log in again.' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  private async resolveSchoolId(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
    const schoolCode = validateSchoolCodeHeader(event);
    const schoolId = await employeeService.getSchoolIdByCode(schoolCode);
    if (!schoolId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
      return null;
    }
    return schoolId;
  }

  private getUserId(event: ApiEvent): string {
    return event.requestContext?.authorizer?.principalId || 'system';
  }
}

const handler = new EmployeeHandler();
export const search = guard(EMPLOYEE_ACTIONS['employee-handler.search'], handler.search);
export const listRoles = guard(EMPLOYEE_ACTIONS['employee-handler.listRoles'], handler.listRoles);
export const create = guard(EMPLOYEE_ACTIONS['employee-handler.create'], handler.create);
export const getById = guard(EMPLOYEE_ACTIONS['employee-handler.getById'], handler.getById);
export const update = guard(EMPLOYEE_ACTIONS['employee-handler.update'], handler.update);
export const remove = guard(EMPLOYEE_ACTIONS['employee-handler.remove'], handler.remove);
export const restore = guard(EMPLOYEE_ACTIONS['employee-handler.restore'], handler.restore);
export const getCredentials = guard(EMPLOYEE_ACTIONS['employee-handler.getCredentials'], handler.getCredentials);
export const resetPassword = guard(EMPLOYEE_ACTIONS['employee-handler.resetPassword'], handler.resetPassword);
export const forceReLogin = guard(EMPLOYEE_ACTIONS['employee-handler.forceReLogin'], handler.forceReLogin);
export const getConfig = guard(EMPLOYEE_ACTIONS['employee-handler.getConfig'], handler.getConfig);
export const updateConfig = guard(EMPLOYEE_ACTIONS['employee-handler.updateConfig'], handler.updateConfig);
