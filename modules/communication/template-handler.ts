import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { guard } from '../auth/authz';
import { COMMUNICATION_ACTIONS } from './communication-actions';
import { templateService } from './template-service';
import { CreateTemplateRequest, UpdateTemplateRequest } from './communication-interfaces';

class TemplateHandler {
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const templates = await templateService.list(ctx.schoolId);
      ResponseBuilder.ok({ templates }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const template = await templateService.getById(id, ctx.schoolId);
      if (!template) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Template not found', callback); return; }
      ResponseBuilder.ok(template, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<CreateTemplateRequest>(event, callback);
      if (!body) return;
      const template = await templateService.create(body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(template, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<UpdateTemplateRequest>(event, callback);
      if (!body) return;
      const template = await templateService.update(id, body, ctx.schoolId, ctx.userId);
      if (!template) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Template not found', callback); return; }
      ResponseBuilder.ok(template, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const existing = await templateService.getById(id, ctx.schoolId);
      if (!existing) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Template not found', callback); return; }
      await templateService.delete(id, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok({ message: 'Template deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public restore = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const template = await templateService.restore(id, ctx.schoolId, ctx.userId);
      if (!template) { ResponseBuilder.notFound(ErrorCode.InvalidId, 'Deleted template not found', callback); return; }
      ResponseBuilder.ok(template, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new TemplateHandler();
export const list = guard(COMMUNICATION_ACTIONS['template-handler.list'], handler.list);
export const getById = guard(COMMUNICATION_ACTIONS['template-handler.getById'], handler.getById);
export const create = guard(COMMUNICATION_ACTIONS['template-handler.create'], handler.create);
export const update = guard(COMMUNICATION_ACTIONS['template-handler.update'], handler.update);
export const remove = guard(COMMUNICATION_ACTIONS['template-handler.remove'], handler.remove);
export const restore = guard(COMMUNICATION_ACTIONS['template-handler.restore'], handler.restore);
