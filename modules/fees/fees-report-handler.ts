import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
import { resolveSchool } from './fees-util';
import { feesReportService } from './fees-report-service';

class FeesReportHandler {
  public dailyCollection = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.dailyCollection(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public overview = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.overview(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public ungeneratedStudents = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.ungeneratedStudents(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public dues = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.dues(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public setFollowup = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.setFollowup(rc.schoolId, JSON.parse(event.body || '{}'), rc.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public getFollowup = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.getFollowup(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public familyDues = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const id = event.pathParameters?.id as string;
      const result = await feesReportService.familyDues(rc.schoolId, id, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public withdraw = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const id = event.pathParameters?.id as string;
      const result = await feesReportService.withdrawStudent(rc.schoolId, id, JSON.parse(event.body || '{}'), rc.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public duesByYear = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const id = event.pathParameters?.id as string;
      const result = await feesReportService.duesByYear(rc.schoolId, id);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public studentConcessions = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const id = event.pathParameters?.id as string;
      const result = await feesReportService.studentConcessions(rc.schoolId, id, (event.queryStringParameters || {}).academicYearId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public fineExemptions = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReportService.fineExemptions(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new FeesReportHandler();
export const dailyCollection = guard(FEE_ACTIONS['fees-report-handler.dailyCollection'], handler.dailyCollection);
export const overview = guard(FEE_ACTIONS['fees-report-handler.overview'], handler.overview);
export const ungeneratedStudents = guard(FEE_ACTIONS['fees-report-handler.ungeneratedStudents'], handler.ungeneratedStudents);
export const dues = guard(FEE_ACTIONS['fees-report-handler.dues'], handler.dues);
export const setFollowup = guard(FEE_ACTIONS['fees-report-handler.setFollowup'], handler.setFollowup);
export const getFollowup = guard(FEE_ACTIONS['fees-report-handler.getFollowup'], handler.getFollowup);
export const familyDues = guard(FEE_ACTIONS['fees-report-handler.familyDues'], handler.familyDues);
export const withdraw = guard(FEE_ACTIONS['fees-report-handler.withdraw'], handler.withdraw);
export const duesByYear = guard(FEE_ACTIONS['fees-report-handler.duesByYear'], handler.duesByYear);
export const studentConcessions = guard(FEE_ACTIONS['fees-report-handler.studentConcessions'], handler.studentConcessions);
export const fineExemptions = guard(FEE_ACTIONS['fees-report-handler.fineExemptions'], handler.fineExemptions);
