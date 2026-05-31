import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { fineIncidentService } from './fine-incident-service';
import { fineCollectionService } from './fine-collection-service';
import { CollectFineRequest } from './fine-interfaces';
import { PAYMENT_METHOD_VALUES } from './fine-constants';
import { isValidDate } from '../../shared/util/datetime';

class FineCollectionHandler {
  public collect = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await fineIncidentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const incidentId = event.pathParameters?.id;
      if (!incidentId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Incident ID is required', callback);
        return;
      }

      const incident = await fineIncidentService.getByIdSimple(incidentId, schoolId);
      if (!incident) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Incident not found', callback);
        return;
      }
      if (incident.status !== 'decision_made') {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Fine can only be collected when incident status is decision_made', callback);
        return;
      }
      if (incident.decision !== 'collect') {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Incident decision must be collect to record a payment', callback);
        return;
      }

      if (!event.body) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Request body is required', callback);
        return;
      }

      const body: CollectFineRequest = JSON.parse(event.body);

      if (body.amountCollected === undefined || body.amountCollected <= 0) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'amountCollected must be greater than 0', callback);
        return;
      }
      if (!body.collectionDate) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'collectionDate is required', callback);
        return;
      }
      if (!isValidDate(body.collectionDate)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid collectionDate format. Use YYYY-MM-DD', callback);
        return;
      }
      if (body.paymentMethod && !PAYMENT_METHOD_VALUES.includes(body.paymentMethod as any)) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, `paymentMethod must be one of: ${PAYMENT_METHOD_VALUES.join(', ')}`, callback);
        return;
      }

      const userId = event.requestContext?.authorizer?.principalId || 'system';
      const result = await fineCollectionService.collect(incidentId, body, schoolId, userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public getReceipt = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await fineIncidentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const incidentId = event.pathParameters?.id;
      if (!incidentId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Incident ID is required', callback);
        return;
      }

      const result = await fineCollectionService.getReceipt(incidentId, schoolId);
      if (!result) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'No collection record found for this incident', callback);
        return;
      }
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  public listCollections = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const schoolId = await fineIncidentService.getSchoolIdByCode(schoolCode);
      if (!schoolId) {
        ResponseBuilder.badRequest(ErrorCode.InvalidInput, 'Invalid school code', callback);
        return;
      }

      const incidentId = event.pathParameters?.id;
      if (!incidentId) {
        ResponseBuilder.badRequest(ErrorCode.MissingId, 'Incident ID is required', callback);
        return;
      }

      const results = await fineCollectionService.listCollections(incidentId, schoolId);
      ResponseBuilder.ok(results, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new FineCollectionHandler();
export const collect = handler.collect;
export const getReceipt = handler.getReceipt;
export const listCollections = handler.listCollections;
