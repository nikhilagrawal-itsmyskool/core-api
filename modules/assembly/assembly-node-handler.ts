import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { resolveSchool, parseBody, requireParam } from './handler-util';
import { assemblyNodeService } from './assembly-node-service';
import {
  CreateNodeRequest,
  UpdateNodeRequest,
  ReorderNodesRequest,
  SetNodeDaysRequest,
  SetNodeResponsibleRequest,
  SetNodeResourcesRequest,
} from './assembly-interfaces';

const NOT_FOUND = 'Node not found';

class AssemblyNodeHandler {
  // POST /plans/{id}/nodes — create a node under a plan (owner = plan).
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const planId = requireParam(event, 'id', callback);
      if (!planId) return;
      const body = parseBody<CreateNodeRequest>(event, callback);
      if (!body) return;
      const result = await assemblyNodeService.createNode('plan', planId, body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /specials/{id}/nodes — add a node to a special-assembly tree.
  public createForSpecial = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const specialId = requireParam(event, 'id', callback);
      if (!specialId) return;
      const body = parseBody<CreateNodeRequest>(event, callback);
      if (!body) return;
      const result = await assemblyNodeService.createNode('special', specialId, body, ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /specials/{id}/nodes/order — reorder a sibling group in a special tree.
  public reorderForSpecial = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const specialId = requireParam(event, 'id', callback);
      if (!specialId) return;
      const body = parseBody<ReorderNodesRequest>(event, callback);
      if (!body) return;
      const result = await assemblyNodeService.reorderNodes('special', specialId, body.parentId || null, body.order || [], ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // GET /plans/{id}/tree — full authored tree for a plan.
  public tree = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const planId = requireParam(event, 'id', callback);
      if (!planId) return;
      const result = await assemblyNodeService.getTree('plan', planId, ctx.schoolId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // PUT /plans/{id}/nodes/order — reorder a sibling group under a plan.
  public reorder = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const planId = requireParam(event, 'id', callback);
      if (!planId) return;
      const body = parseBody<ReorderNodesRequest>(event, callback);
      if (!body) return;
      const result = await assemblyNodeService.reorderNodes('plan', planId, body.parentId || null, body.order || [], ctx.schoolId, ctx.userId);
      ResponseBuilder.ok(result, callback);
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
      const result = await assemblyNodeService.getNodeDetail(id, ctx.schoolId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, NOT_FOUND, callback); return; }
      ResponseBuilder.ok(result, callback);
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
      const body = parseBody<UpdateNodeRequest>(event, callback);
      if (!body) return;
      const result = await assemblyNodeService.updateNode(id, body, ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, NOT_FOUND, callback); return; }
      ResponseBuilder.ok(result, callback);
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
      const deleted = await assemblyNodeService.deleteNode(id, ctx.schoolId, ctx.userId);
      if (!deleted) { ResponseBuilder.notFound(ErrorCode.InvalidId, NOT_FOUND, callback); return; }
      ResponseBuilder.ok({ message: 'Node (and its descendants) deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public setDays = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<SetNodeDaysRequest>(event, callback);
      if (!body) return;
      const result = await assemblyNodeService.setNodeDays(id, body.days || [], ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, NOT_FOUND, callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public setResponsible = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<SetNodeResponsibleRequest>(event, callback);
      if (!body) return;
      const result = await assemblyNodeService.setNodeResponsible(id, body.responsible || [], ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, NOT_FOUND, callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public setResources = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<SetNodeResourcesRequest>(event, callback);
      if (!body) return;
      const result = await assemblyNodeService.setNodeResources(id, body.resources || [], ctx.schoolId, ctx.userId);
      if (!result) { ResponseBuilder.notFound(ErrorCode.InvalidId, NOT_FOUND, callback); return; }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new AssemblyNodeHandler();
export const create = handler.create;
export const createForSpecial = handler.createForSpecial;
export const reorderForSpecial = handler.reorderForSpecial;
export const tree = handler.tree;
export const reorder = handler.reorder;
export const getById = handler.getById;
export const update = handler.update;
export const remove = handler.remove;
export const setDays = handler.setDays;
export const setResponsible = handler.setResponsible;
export const setResources = handler.setResources;
