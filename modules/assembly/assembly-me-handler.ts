import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guardActiveStudent } from '../auth/auth-utils';
import { assemblyResolveService } from './assembly-resolve-service';

// School-local (IST, UTC+5:30) today as yyyy-mm-dd, so "today" matches the
// school day even for requests made near UTC midnight.
function todayIST(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

class AssemblyMeHandler {
  // GET /me/assembly/today — the active child's assembly for today.
  public today = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const result = await assemblyResolveService.resolveForStudent(
        auth.token.school_id, auth.activeStudentId, todayIST(), q.academicYearId,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /me/assembly/on?date=yyyy-mm-dd — the active child's assembly for a date.
  public on = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const result = await assemblyResolveService.resolveForStudent(
        auth.token.school_id, auth.activeStudentId, q.date, q.academicYearId,
      );
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new AssemblyMeHandler();
export const today = handler.today;
export const on = handler.on;
