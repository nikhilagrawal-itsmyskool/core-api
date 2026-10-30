import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { assetService } from './asset-service';
import { assetInventoryService, InventoryImage, CommitLine } from './asset-inventory-service';
import { guard } from '../auth/authz';
import { ASSET_ACTIONS } from './asset-actions';

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

// Accept either a bare base64 string or a data: URL and split off the prefix.
function normalizeImage(raw: any): InventoryImage | null {
  if (!raw) return null;
  let data = typeof raw === 'string' ? raw : raw.data;
  let mediaType = typeof raw === 'string' ? '' : raw.mediaType;
  if (typeof data !== 'string' || !data) return null;
  const m = data.match(/^data:(image\/[a-z+]+);base64,(.*)$/i);
  if (m) {
    mediaType = mediaType || m[1];
    data = m[2];
  }
  return { data, mediaType: mediaType || 'image/jpeg' };
}

class AssetInventoryHandler {
  // POST /inventory/analyze  { images: [{data, mediaType}] } -> draft counts
  public analyze = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body = JSON.parse(event.body);
      const rawImages = Array.isArray(body.images) ? body.images : [];
      const images = rawImages.map(normalizeImage).filter(Boolean) as InventoryImage[];
      if (images.length === 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'At least one image is required', callback);
        return;
      }
      const result = await assetInventoryService.analyze(images, schoolId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /inventory/commit  { roomId, lines: [{typeId, count, assetCondition?}] }
  public commit = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolId = await resolveSchool(event, callback);
      if (!schoolId) return;
      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }
      const body = JSON.parse(event.body);
      if (!body.roomId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'roomId is required', callback);
        return;
      }
      const lines: CommitLine[] = Array.isArray(body.lines) ? body.lines : [];
      if (lines.length === 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'At least one line is required', callback);
        return;
      }
      const result = await assetInventoryService.commit(body.roomId, lines, schoolId, userIdOf(event));
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new AssetInventoryHandler();
const g = (ref: string, fn: any) => guard(ASSET_ACTIONS[ref], fn);
export const analyze = g('asset-inventory-handler.analyze', handler.analyze);
export const commit = g('asset-inventory-handler.commit', handler.commit);
