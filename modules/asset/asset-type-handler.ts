import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { assetTypeService } from './asset-type-service';
import { CreateAssetTypeRequest, UpdateAssetTypeRequest } from './asset-interfaces';
import { ASSET_KINDS } from './asset-constants';

async function resolveSchool(event: ApiEvent, callback: ApiCallback): Promise<string | null> {
  const schoolCode = validateSchoolCodeHeader(event);
  const schoolId = await assetTypeService.getSchoolIdByCode(schoolCode);
  if (!schoolId) {
    ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
    return null;
  }
  return schoolId;
}

function userIdOf(event: ApiEvent): string {
  return event.requestContext?.authorizer?.principalId || 'system';
}

class AssetTypeHandler {
  public list = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      const results = await assetTypeService.list(schoolId, userIdOf(event));
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public create = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body: CreateAssetTypeRequest = JSON.parse(event.body);

      if (!body.code || !body.code.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Code is required', callback);
        return;
      }
      if (!body.label || !body.label.trim()) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Label is required', callback);
        return;
      }
      if (!body.kind || !ASSET_KINDS.includes(body.kind)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid kind. Must be one of: ${ASSET_KINDS.join(', ')}`, callback);
        return;
      }

      const result = await assetTypeService.create(body, schoolId, userIdOf(event));
      ResponseBuilder.ok(result, callback);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset type ID is required', callback);
        return;
      }
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body: UpdateAssetTypeRequest = JSON.parse(event.body);

      if (body.kind !== undefined && !ASSET_KINDS.includes(body.kind)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `Invalid kind. Must be one of: ${ASSET_KINDS.join(', ')}`, callback);
        return;
      }

      const result = await assetTypeService.update(id, body, schoolId, userIdOf(event));
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Asset type not found', callback);
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
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Asset type ID is required', callback);
        return;
      }

      const existing = await assetTypeService.getById(id, schoolId);
      if (!existing) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Asset type not found', callback);
        return;
      }

      await assetTypeService.delete(id, schoolId, userIdOf(event));
      ResponseBuilder.ok({ message: 'Asset type deleted successfully' }, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new AssetTypeHandler();
export const list = handler.list;
export const create = handler.create;
export const update = handler.update;
export const remove = handler.remove;
