import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { assetService } from './asset-service';
import {
  CreateAssetRequest, UpdateAssetRequest, MoveRequest,
  IndividualizeRequest, SetResponsibilityRequest,
} from './asset-interfaces';
import { ASSET_CONDITIONS, ASSET_STATUSES } from './asset-constants';

const VALID_CONDITIONS = ASSET_CONDITIONS.map((c) => c.value) as readonly string[];
const VALID_STATUSES = ASSET_STATUSES.map((s) => s.value) as readonly string[];

async function resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
  const schoolCode = validateSchoolCodeHeader(event);
  const schoolId = await assetService.getSchoolIdByCode(schoolCode);
  if (!schoolId) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
    return null;
  }
  return schoolId;
}

function userIdOf(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class AssetHandler {
  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body: CreateAssetRequest = JSON.parse(event.body);

      if (!body.typeId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'typeId is required', callback);
        return;
      }
      if (!body.name || !body.name.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'name is required', callback);
        return;
      }
      if (body.assetCondition && !VALID_CONDITIONS.includes(body.assetCondition)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid condition. Must be one of: ${VALID_CONDITIONS.join(', ')}`, callback);
        return;
      }
      if (body.assetStatus && !VALID_STATUSES.includes(body.assetStatus)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, callback);
        return;
      }

      const result = await assetService.create(body, schoolId, userIdOf(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public search = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const q = event.queryStringParameters || {};
      const hasCode = q.hasCode === undefined ? undefined : q.hasCode === 'true';
      const results = await assetService.search(schoolId, {
        typeId: q.typeId,
        parentId: q.parentId,
        responsibleId: q.responsibleId,
        assetStatus: q.assetStatus,
        hasCode,
        search: q.search,
      });
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getTree = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const rootId = event.queryStringParameters?.rootId;
      const tree = await assetService.getTree(schoolId, rootId);
      ResponseBuilder.ok(tree, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public suggestCode = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const q = event.queryStringParameters || {};
      const code = await assetService.suggestCode(schoolId, {
        prefix: q.prefix,
        parentId: q.parentId,
        typeId: q.typeId,
      });
      ResponseBuilder.ok({ code }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getById = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset ID is required', callback);
        return;
      }
      const asset = await assetService.getById(id, schoolId);
      if (!asset) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Asset not found', callback);
        return;
      }
      const responsibility = await assetService.getEffectiveResponsibility(id, schoolId);
      ResponseBuilder.ok({ ...asset, responsibility }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public update = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset ID is required', callback);
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body: UpdateAssetRequest = JSON.parse(event.body);

      if (body.assetCondition && !VALID_CONDITIONS.includes(body.assetCondition)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid condition. Must be one of: ${VALID_CONDITIONS.join(', ')}`, callback);
        return;
      }
      if (body.assetStatus && !VALID_STATUSES.includes(body.assetStatus)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`, callback);
        return;
      }

      const result = await assetService.update(id, body, schoolId, userIdOf(event));
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Asset not found', callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public remove = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset ID is required', callback);
        return;
      }
      const existing = await assetService.getById(id, schoolId);
      if (!existing) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Asset not found', callback);
        return;
      }
      await assetService.delete(id, schoolId, userIdOf(event));
      ResponseBuilder.ok({ message: 'Asset deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public move = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset ID is required', callback);
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body: MoveRequest = JSON.parse(event.body);
      if (body.toParentId === undefined) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'toParentId is required (use null for root)', callback);
        return;
      }

      const result = await assetService.move(id, body, schoolId, userIdOf(event));
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Asset not found', callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public individualize = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset ID is required', callback);
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body: IndividualizeRequest = JSON.parse(event.body);
      if (body.count === undefined || body.count === null) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'count is required', callback);
        return;
      }

      const created = await assetService.individualize(id, body, schoolId, userIdOf(event));
      ResponseBuilder.ok({ items: created, count: created.length }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public setResponsibility = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset ID is required', callback);
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body: SetResponsibilityRequest = JSON.parse(event.body);

      const result = await assetService.setResponsibility(id, body, schoolId, userIdOf(event));
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Asset not found', callback);
        return;
      }
      const responsibility = await assetService.getEffectiveResponsibility(id, schoolId);
      ResponseBuilder.ok({ ...result, responsibility }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getResponsibility = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset ID is required', callback);
        return;
      }
      const responsibility = await assetService.getEffectiveResponsibility(id, schoolId);
      if (!responsibility) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Asset not found', callback);
        return;
      }
      ResponseBuilder.ok(responsibility, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getMovements = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const id = event.pathParameters?.id;
      if (!id) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset ID is required', callback);
        return;
      }
      const movements = await assetService.getMovements(id, schoolId);
      ResponseBuilder.ok(movements, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public summary = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const results = await assetService.summary(schoolId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public counts = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const typeId = event.queryStringParameters?.typeId;
      if (!typeId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'typeId is required', callback);
        return;
      }
      const result = await assetService.counts(schoolId, typeId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getByResponsible = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const employeeId = event.pathParameters?.employeeId;
      if (!employeeId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'employeeId is required', callback);
        return;
      }
      const results = await assetService.getByResponsible(employeeId, schoolId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new AssetHandler();
export const create = handler.create;
export const search = handler.search;
export const getTree = handler.getTree;
export const suggestCode = handler.suggestCode;
export const getById = handler.getById;
export const update = handler.update;
export const remove = handler.remove;
export const move = handler.move;
export const individualize = handler.individualize;
export const setResponsibility = handler.setResponsibility;
export const getResponsibility = handler.getResponsibility;
export const getMovements = handler.getMovements;
export const summary = handler.summary;
export const counts = handler.counts;
export const getByResponsible = handler.getByResponsible;
