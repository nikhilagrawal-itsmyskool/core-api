import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { getAuthorizationHeader } from '../auth/auth-utils';
import { extractAndVerifyToken } from '../auth/token-utils';
import { supplyIssueService } from './supply-issue-service';
import { guard } from '../auth/authz';
import { SUPPLY_ACTIONS } from './supply-actions';

// Resolve the logged-in employee (teacher) from the bearer token — for the teacher-PWA
// "My Issued Items" surface. The school comes from the token (authoritative), not the
// X-School-Code header. On failure writes 401 and returns null.
function resolveEmployee(
  event: ApiEvent,
  callback: ApiCallback,
): { employeeId: string; schoolId: string } | null {
  const token = extractAndVerifyToken(getAuthorizationHeader(event));
  const employeeId = token?.employee_id || token?.id;
  if (!token || token.type !== 'employee' || !employeeId) {
    ResponseBuilder.unauthorizedRequest(ErrorCode.GeneralError, 'Employee login required', callback);
    return null;
  }
  return { employeeId, schoolId: token.school_id };
}

// Teacher PWA read surface for the supplies module. Self-scoped: a teacher sees ONLY the
// supplies issued to themselves (issued_to_type='employee' and issued_to_id = their id),
// with return status. Writes (procurement + issuing) stay on the admin surface, held by
// admin / supplies-incharge via the supplies.* wildcard.
class SupplyMeHandler {
  // GET /supplies/me/issues
  public myIssues = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const emp = resolveEmployee(event, callback);
      if (!emp) return;
      const results = await supplyIssueService.myIssues(emp.schoolId, emp.employeeId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new SupplyMeHandler();
const g = (ref: string, fn: any) => guard(SUPPLY_ACTIONS[ref], fn);
export const myIssues = g('supply-me-handler.myIssues', handler.myIssues);
