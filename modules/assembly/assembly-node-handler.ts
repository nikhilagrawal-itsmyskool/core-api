import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { guard } from "../auth/authz";
import { ASSEMBLY_ACTIONS } from "./assembly-actions";
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
  SetNodeDayContentRequest,
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

  public setDayContent = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const id = requireParam(event, 'id', callback);
      if (!id) return;
      const body = parseBody<SetNodeDayContentRequest>(event, callback);
      if (!body) return;
      const result = await assemblyNodeService.setNodeDayContent(id, body.content || [], ctx.schoolId, ctx.userId);
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
const g = (ref: string, fn: any) => guard(ASSEMBLY_ACTIONS[ref], fn);
export const create = g("assembly-node-handler.create", handler.create);
export const createForSpecial = g("assembly-node-handler.createForSpecial", handler.createForSpecial);
export const reorderForSpecial = g("assembly-node-handler.reorderForSpecial", handler.reorderForSpecial);
export const tree = g("assembly-node-handler.tree", handler.tree);
export const reorder = g("assembly-node-handler.reorder", handler.reorder);
export const getById = g("assembly-node-handler.getById", handler.getById);
export const update = g("assembly-node-handler.update", handler.update);
export const remove = g("assembly-node-handler.remove", handler.remove);
export const setDays = g("assembly-node-handler.setDays", handler.setDays);
export const setResponsible = g("assembly-node-handler.setResponsible", handler.setResponsible);
export const setResources = g("assembly-node-handler.setResources", handler.setResources);
export const setDayContent = g("assembly-node-handler.setDayContent", handler.setDayContent);
