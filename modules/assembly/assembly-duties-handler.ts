import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveEmployee, parseBody, requireParam } from './handler-util';
import { guardActiveStudent } from '../auth/auth-utils';
import { assemblyDutiesService } from './assembly-duties-service';
import { assemblyWeekService } from './assembly-week-service';
import { assemblyChecklistService } from './assembly-checklist-service';
import { assemblyGradingService } from './assembly-grading-service';
import { SaveRosterRequest, SaveChecklistRequest, SignoffRequest, SaveGradeRequest } from './assembly-interfaces';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const istToday = () => iso(new Date(Date.now() + 5.5 * 3600 * 1000));

class AssemblyDutiesHandler {
  // GET /me/assembly/duties?from=&to=  (employee token) — my roster duties + evaluator status.
  public duties = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const me = resolveEmployee(event, callback); if (!me) return;
      const q = event.queryStringParameters || {};
      const from = q.from || istToday();
      const to = q.to || iso(new Date(Date.now() + 56 * 86400000));
      ResponseBuilder.ok(await assemblyDutiesService.myDuties(me.schoolId, me.employeeId, from, to), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // Run `fn(weekId)` only when the employee is in-charge of the week's house.
  private guardedWeek = async (
    event: ApiEvent, callback: ApiCallback, fn: (weekId: string, schoolId: string, employeeId: string) => Promise<any>,
  ) => {
    const me = resolveEmployee(event, callback); if (!me) return;
    const weekId = requireParam(event, 'id', callback); if (!weekId) return;
    if (!(await assemblyDutiesService.canEditWeek(me.schoolId, me.employeeId, weekId))) {
      ResponseBuilder.forbidden(ErrorCode.GeneralError, 'You are not the in-charge of this week', callback); return;
    }
    const result = await fn(weekId, me.schoolId, me.employeeId);
    if (result === null) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
    ResponseBuilder.ok(result, callback);
  };

  public getWeek = (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    return this.guardedWeek(event, callback, (id, s) => assemblyWeekService.getWeek(id, s)).catch((e) => ResponseBuilder.handleError(e, callback));
  };

  public saveRoster = (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    const body = parseBody<SaveRosterRequest>(event, callback); if (!body) return;
    return this.guardedWeek(event, callback, (id, s, e) => assemblyWeekService.saveRoster(id, body, s, e)).catch((err) => ResponseBuilder.handleError(err, callback));
  };

  public submit = (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    return this.guardedWeek(event, callback, (id, s, e) => assemblyWeekService.submit(id, s, e)).catch((err) => ResponseBuilder.handleError(err, callback));
  };

  public getChecklist = (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    return this.guardedWeek(event, callback, (id, s) => assemblyChecklistService.getWeekChecklist(id, s)).catch((e) => ResponseBuilder.handleError(e, callback));
  };

  public saveChecklist = (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    const body = parseBody<SaveChecklistRequest>(event, callback); if (!body) return;
    return this.guardedWeek(event, callback, (id, s, e) => assemblyChecklistService.saveTicks(id, body, s, e)).catch((err) => ResponseBuilder.handleError(err, callback));
  };

  public signoff = (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    const body = (event.body ? parseBody<SignoffRequest>(event, callback) : {}) as SignoffRequest | null;
    if (body === null) return;
    return this.guardedWeek(event, callback, (id, s, e) => assemblyChecklistService.signoff(id, body.note, s, e)).catch((err) => ResponseBuilder.handleError(err, callback));
  };

  // POST /me/assembly/plans/{id}/weeks — start (ensure) MY house's week for a date.
  public ensureWeek = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const me = resolveEmployee(event, callback); if (!me) return;
      const planId = requireParam(event, 'id', callback); if (!planId) return;
      const body = parseBody<{ weekStart: string }>(event, callback); if (!body) return;
      if (!body.weekStart) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'weekStart is required', callback); return; }
      if (!(await assemblyDutiesService.canEnsure(me.schoolId, me.employeeId, planId, body.weekStart))) {
        ResponseBuilder.forbidden(ErrorCode.GeneralError, 'Your house is not on duty that week', callback); return;
      }
      ResponseBuilder.ok(await assemblyWeekService.ensureWeek(planId, body.weekStart, me.schoolId, me.employeeId), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // POST /me/assembly/weeks/{id}/grades — grade as MYSELF (evaluator=the caller).
  // Future-dated grades are rejected (today or earlier only); admins use the desktop.
  public saveGrade = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const me = resolveEmployee(event, callback); if (!me) return;
      const weekId = requireParam(event, 'id', callback); if (!weekId) return;
      const body = parseBody<Omit<SaveGradeRequest, 'evaluatorId'>>(event, callback); if (!body) return;
      if (body.gradeDate && body.gradeDate > istToday()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'You cannot grade a future date', callback); return;
      }
      const result = await assemblyGradingService.saveGrade(weekId, { ...body, evaluatorId: me.employeeId } as SaveGradeRequest, me.schoolId, me.employeeId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Week not found', callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // GET /me/assembly/leaderboard?from=&to=  (student token) — read-only house-of-the-month.
  public leaderboard = async (event: ApiEvent, _c: ApiContext, callback: ApiCallback) => {
    _c.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback); if (!auth) return;
      const q = event.queryStringParameters || {};
      const now = new Date();
      const from = q.from || iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
      const to = q.to || iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)));
      ResponseBuilder.ok(await assemblyGradingService.leaderboard(auth.token.school_id, from, to), callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new AssemblyDutiesHandler();
export const duties = handler.duties;
export const ensureWeek = handler.ensureWeek;
export const getWeek = handler.getWeek;
export const saveRoster = handler.saveRoster;
export const submit = handler.submit;
export const getChecklist = handler.getChecklist;
export const saveChecklist = handler.saveChecklist;
export const signoff = handler.signoff;
export const saveGrade = handler.saveGrade;
export const leaderboard = handler.leaderboard;
