import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { electiveService } from './elective-service';
import { timetableService } from './timetable-service';
import { CreateElectiveBandRequest, UpdateElectiveBandRequest, CreateElectiveOfferingRequest } from './timetable-interfaces';

class ElectiveHandler {
  public listBands = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      const bands = await electiveService.listBands(ctx.schoolId, qp.classId, qp.academicYearId);
      ResponseBuilder.ok({ bands }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getBand = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const band = await electiveService.getBandById(id, ctx.schoolId);
      if (!band) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Elective band not found', callback); return; }
      ResponseBuilder.ok(band, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public createBand = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateElectiveBandRequest>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.classId || !body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId, classId and name are required', callback); return;
      }
      if (!Number.isInteger(body.periodsPerWeek) || body.periodsPerWeek < 1) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'periodsPerWeek must be a positive integer', callback); return;
      }
      if (!(await timetableService.classExists(body.classId, ctx.schoolId))) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid classId', callback); return;
      }
      const band = await electiveService.createBand(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(band, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateBand = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<UpdateElectiveBandRequest>(event, callback);
      if (!body) return;
      if (body.periodsPerWeek !== undefined && (!Number.isInteger(body.periodsPerWeek) || body.periodsPerWeek < 1)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'periodsPerWeek must be a positive integer', callback); return;
      }
      const band = await electiveService.updateBand(id, body, ctx.schoolId, ctx.userId);
      if (!band) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Elective band not found', callback); return; }
      ResponseBuilder.ok(band, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public removeBand = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const existing = await electiveService.getBandById(id, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Elective band not found', callback); return; }
      await electiveService.deleteBand(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Elective band deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public addOffering = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const bandId = requireParam(event, 'id', callback);
      if (!bandId) return;
      const band = await electiveService.getBandById(bandId, ctx.schoolId);
      if (!band) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Elective band not found', callback); return; }
      const body = parseBody<CreateElectiveOfferingRequest>(event, callback);
      if (!body) return;
      if (!body.subjectId || !body.teacherId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'subjectId and teacherId are required', callback); return;
      }
      if (!(await timetableService.subjectExists(body.subjectId, ctx.schoolId))) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid subjectId', callback); return;
      }
      const offering = await electiveService.addOffering(bandId, body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(offering, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public removeOffering = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const offeringId = requireParam(event, 'offeringId', callback);
      if (!offeringId) return;
      const existing = await electiveService.getOfferingById(offeringId, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Offering not found', callback); return; }
      await electiveService.deleteOffering(offeringId, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Offering deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ElectiveHandler();
export const listBands = handler.listBands;
export const getBand = handler.getBand;
export const createBand = handler.createBand;
export const updateBand = handler.updateBand;
export const removeBand = handler.removeBand;
export const addOffering = handler.addOffering;
export const removeOffering = handler.removeOffering;
