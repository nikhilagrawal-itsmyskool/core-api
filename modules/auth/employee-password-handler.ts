import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { employeeAuthService } from './employee-auth-service';
import { extractAndVerifyToken } from './token-utils';

class EmployeePasswordHandler {

  public async changePassword(event: ApiEvent, _context: ApiContext, callback: ApiCallback) {
    _context.callbackWaitsForEmptyEventLoop = false;

    // Extract and verify JWT
    const authorization = event.headers?.Authorization || event.headers?.authorization;
    const decoded = extractAndVerifyToken(authorization);
    if (!decoded) {
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Invalid or missing authorization token', callback);
      return;
    }

    if (decoded.type !== 'employee') {
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Only employee tokens are accepted', callback);
      return;
    }

    // Parse request body
    let bodyObj: any;
    try {
      bodyObj = JSON.parse(event.body || '{}');
    } catch (err) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid JSON in request body', callback);
      return;
    }

    const { currentPassword, newPassword } = bodyObj;
    if (!currentPassword || !newPassword) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'currentPassword and newPassword are required', callback);
      return;
    }

    try {
      const result = await employeeAuthService.changePassword(decoded.id, currentPassword, newPassword, decoded.school_id);
      if (!result.success) {
        ResponseBuilder.badRequest(ErrorCode.GeneralError, result.message, callback);
        return;
      }

      ResponseBuilder.ok({ message: result.message }, callback);
    } catch (err: any) {
      console.error('Error changing password:', err);
      ResponseBuilder.badRequest(ErrorCode.GeneralError, err.message || 'Failed to change password', callback);
    }
  }

  public async resetPassword(event: ApiEvent, _context: ApiContext, callback: ApiCallback) {
    _context.callbackWaitsForEmptyEventLoop = false;

    // Extract and verify JWT
    const authorization = event.headers?.Authorization || event.headers?.authorization;
    const decoded = extractAndVerifyToken(authorization);
    if (!decoded) {
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Invalid or missing authorization token', callback);
      return;
    }

    if (decoded.type !== 'employee') {
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Only employee tokens are accepted', callback);
      return;
    }

    // Check admin/god role
    if (!decoded.roles.includes('admin') && !decoded.roles.includes('god')) {
      ResponseBuilder.forbidden(ErrorCode.MissingPermission, 'Only admin or god roles can reset passwords', callback);
      return;
    }

    // Parse request body
    let bodyObj: any;
    try {
      bodyObj = JSON.parse(event.body || '{}');
    } catch (err) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid JSON in request body', callback);
      return;
    }

    const { employeeLoginId } = bodyObj;
    if (!employeeLoginId) {
      ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'employeeLoginId is required', callback);
      return;
    }

    try {
      const result = await employeeAuthService.resetPassword(employeeLoginId, decoded.school_id);
      if (!result.success) {
        ResponseBuilder.badRequest(ErrorCode.GeneralError, result.message, callback);
        return;
      }

      ResponseBuilder.ok({ message: result.message }, callback);
    } catch (err: any) {
      console.error('Error resetting password:', err);
      ResponseBuilder.badRequest(ErrorCode.GeneralError, err.message || 'Failed to reset password', callback);
    }
  }
}

const handler = new EmployeePasswordHandler();
export const changePassword = handler.changePassword.bind(handler);
export const resetPassword = handler.resetPassword.bind(handler);
