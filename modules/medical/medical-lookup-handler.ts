import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { MEDICAL_UNITS, ENTITY_TYPES } from './medical-constants';

class MedicalLookupHandler {
  public getUnits = (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ units: MEDICAL_UNITS, entityTypes: ENTITY_TYPES }, callback);
  };
}

const handler = new MedicalLookupHandler();
export const getUnits = handler.getUnits;
