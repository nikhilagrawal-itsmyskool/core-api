import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { SUPPLY_ACTIONS } from './supply-actions';
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
const g = (ref: string, fn: any) => guard(SUPPLY_ACTIONS[ref], fn);
export const getUnits = g('supply-lookup-handler.getUnits', handler.getUnits);
export const getConditions = g('supply-lookup-handler.getConditions', handler.getConditions);
