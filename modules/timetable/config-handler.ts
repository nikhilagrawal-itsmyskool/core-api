import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { configService } from './config-service';
import {
  CreateConfigRequest, UpdateConfigRequest,
  CreateDayStructureRequest, UpdateDayStructureRequest,
  CreateTimeSlotRequest, UpdateTimeSlotRequest,
} from './timetable-interfaces';
import { SLOT_TYPE_VALUES, CONFIG_STATUS_VALUES } from './timetable-constants';

class ConfigHandler {
  // ----- config -----
  public listConfigs = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const qp = event.queryStringParameters || {};
      const configs = await configService.listConfigs(ctx.schoolId, qp.academicYearId);
      ResponseBuilder.ok({ configs }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const config = await configService.getConfigById(id, ctx.schoolId);
      if (!config) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Config not found', callback); return; }
      ResponseBuilder.ok(config, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public createConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateConfigRequest>(event, callback);
      if (!body) return;
      if (!body.academicYearId || !body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'academicYearId and name are required', callback); return;
      }
      const config = await configService.createConfig(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(config, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<UpdateConfigRequest>(event, callback);
      if (!body) return;
      if (body.status !== undefined && !CONFIG_STATUS_VALUES.includes(body.status)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `status must be one of: ${CONFIG_STATUS_VALUES.join(', ')}`, callback); return;
      }
      const config = await configService.updateConfig(id, body, ctx.schoolId, ctx.userId);
      if (!config) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Config not found', callback); return; }
      ResponseBuilder.ok(config, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public removeConfig = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      if (!(await configService.configExists(id, ctx.schoolId))) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Config not found', callback); return;
      }
      await configService.archiveConfig(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Config archived successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ----- day structures -----
  public createDay = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const configId = requireParam(event, 'id', callback);
      if (!configId) return;
      if (!(await configService.configExists(configId, ctx.schoolId))) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Config not found', callback); return;
      }
      const body = parseBody<CreateDayStructureRequest>(event, callback);
      if (!body) return;
      if (!Number.isInteger(body.dayOfWeek) || body.dayOfWeek < 1 || body.dayOfWeek > 7) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'dayOfWeek must be an integer 1-7 (1=Mon)', callback); return;
      }
      const day = await configService.createDay(configId, body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(day, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateDay = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const dayId = requireParam(event, 'dayId', callback);
      if (!dayId) return;
      const body = parseBody<UpdateDayStructureRequest>(event, callback);
      if (!body) return;
      const day = await configService.updateDay(dayId, body, ctx.schoolId, ctx.userId);
      if (!day) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Day not found', callback); return; }
      ResponseBuilder.ok(day, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public removeDay = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const dayId = requireParam(event, 'dayId', callback);
      if (!dayId) return;
      const existing = await configService.getDayById(dayId, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Day not found', callback); return; }
      await configService.deleteDay(dayId, ctx.schoolId);
      ResponseBuilder.ok({ message: 'Day deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // ----- time slots -----
  public createSlot = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const dayId = requireParam(event, 'dayId', callback);
      if (!dayId) return;
      const day = await configService.getDayById(dayId, ctx.schoolId);
      if (!day) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Day not found', callback); return; }
      const body = parseBody<CreateTimeSlotRequest>(event, callback);
      if (!body) return;
      if (!Number.isInteger(body.sequence) || body.sequence < 1) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'sequence must be a positive integer', callback); return;
      }
      if (!body.slotType || !SLOT_TYPE_VALUES.includes(body.slotType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `slotType must be one of: ${SLOT_TYPE_VALUES.join(', ')}`, callback); return;
      }
      const slot = await configService.createSlot(dayId, body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(slot, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public updateSlot = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const slotId = requireParam(event, 'slotId', callback);
      if (!slotId) return;
      const body = parseBody<UpdateTimeSlotRequest>(event, callback);
      if (!body) return;
      if (body.slotType !== undefined && !SLOT_TYPE_VALUES.includes(body.slotType)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `slotType must be one of: ${SLOT_TYPE_VALUES.join(', ')}`, callback); return;
      }
      if (body.sequence !== undefined && (!Number.isInteger(body.sequence) || body.sequence < 1)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'sequence must be a positive integer', callback); return;
      }
      const slot = await configService.updateSlot(slotId, body, ctx.schoolId, ctx.userId);
      if (!slot) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Slot not found', callback); return; }
      ResponseBuilder.ok(slot, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public removeSlot = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const slotId = requireParam(event, 'slotId', callback);
      if (!slotId) return;
      const existing = await configService.getSlotById(slotId, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Slot not found', callback); return; }
      await configService.deleteSlot(slotId, ctx.schoolId);
      ResponseBuilder.ok({ message: 'Slot deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new ConfigHandler();
export const listConfigs = handler.listConfigs;
export const getConfig = handler.getConfig;
export const createConfig = handler.createConfig;
export const updateConfig = handler.updateConfig;
export const removeConfig = handler.removeConfig;
export const createDay = handler.createDay;
export const updateDay = handler.updateDay;
export const removeDay = handler.removeDay;
export const createSlot = handler.createSlot;
export const updateSlot = handler.updateSlot;
export const removeSlot = handler.removeSlot;
