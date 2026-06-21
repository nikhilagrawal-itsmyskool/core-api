import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ErrorCode } from '../../shared/lib/error-codes';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { studentAuthService } from './student-auth-service';
import { extractAndVerifyToken } from './token-utils';

class StudentPasswordHandler {

  public async changePassword(event: ApiEvent, _context: ApiContext, callback: ApiCallback) {
    _context.callbackWaitsForEmptyEventLoop = false;

    // Extract and verify JWT
    const authorization = event.headers?.Authorization || event.headers?.authorization;
    const decoded = extractAndVerifyToken(authorization);
    if (!decoded) {
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Invalid or missing authorization token', callback);
      return;
    }

    if (decoded.type !== 'student') {
      ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Only student tokens are accepted', callback);
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
      const result = await studentAuthService.changePassword(decoded.id, currentPassword, newPassword, decoded.school_id);
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
}

const handler = new StudentPasswordHandler();
export const changePassword = handler.changePassword.bind(handler);
