import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import {
  LAB_UNITS, LAB_TYPES, ITEM_TYPES, ITEM_CONDITIONS,
  ISSUE_TYPES, CATEGORIES_BY_LAB_TYPE,
} from './lab-constants';

class LabLookupHandler {
  public getUnits = (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ units: LAB_UNITS }, callback);
  };

  public getCategories = (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    const labType = event.queryStringParameters?.labType;
    if (labType && CATEGORIES_BY_LAB_TYPE[labType]) {
      ResponseBuilder.ok({ categories: CATEGORIES_BY_LAB_TYPE[labType] }, callback);
    } else {
      ResponseBuilder.ok({ categories: CATEGORIES_BY_LAB_TYPE }, callback);
    }
  };

  public getLabTypes = (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ labTypes: LAB_TYPES }, callback);
  };

  public getConditions = (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({
      conditions: ITEM_CONDITIONS,
      itemTypes: ITEM_TYPES,
      issueTypes: ISSUE_TYPES,
    }, callback);
  };
}

const handler = new LabLookupHandler();
export const getUnits = handler.getUnits;
export const getCategories = handler.getCategories;
export const getLabTypes = handler.getLabTypes;
export const getConditions = handler.getConditions;
