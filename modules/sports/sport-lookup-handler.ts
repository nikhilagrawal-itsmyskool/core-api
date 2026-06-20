import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import {
  SPORT_UNITS, SPORT_TYPES, ITEM_TYPES, ITEM_CONDITIONS,
  ISSUE_TYPES, CATEGORIES_BY_SPORT_TYPE,
} from './sport-constants';

class SportLookupHandler {
  public getUnits = (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ units: SPORT_UNITS }, callback);
  };

  public getCategories = (
    event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    const sportType = event.queryStringParameters?.sportType;
    if (sportType && CATEGORIES_BY_SPORT_TYPE[sportType]) {
      ResponseBuilder.ok({ categories: CATEGORIES_BY_SPORT_TYPE[sportType] }, callback);
    } else {
      ResponseBuilder.ok({ categories: CATEGORIES_BY_SPORT_TYPE }, callback);
    }
  };

  public getSportTypes = (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ sportTypes: SPORT_TYPES }, callback);
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

const handler = new SportLookupHandler();
export const getUnits = handler.getUnits;
export const getCategories = handler.getCategories;
export const getSportTypes = handler.getSportTypes;
export const getConditions = handler.getConditions;
