import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import {
  SUPPLY_UNITS, ITEM_TYPES, ITEM_CONDITIONS, ISSUE_TYPES, WASTAGE_REASONS,
} from './supply-constants';

class SupplyLookupHandler {
  public getUnits = (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ units: SUPPLY_UNITS }, callback);
  };

  public getConditions = (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({
      conditions: ITEM_CONDITIONS,
      itemTypes: ITEM_TYPES,
      issueTypes: ISSUE_TYPES,
      wastageReasons: WASTAGE_REASONS,
    }, callback);
  };
}

const handler = new SupplyLookupHandler();
export const getUnits = handler.getUnits;
export const getConditions = handler.getConditions;
