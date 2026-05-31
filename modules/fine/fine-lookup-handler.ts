import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import {
  FINE_CATEGORIES,
  FINE_STATUSES,
  FINE_DECISIONS,
  FINE_PAYMENT_METHODS,
} from './fine-constants';

class FineLookupHandler {
  public getCategories = async (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok([...FINE_CATEGORIES], callback);
  };

  public getStatuses = async (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok([...FINE_STATUSES], callback);
  };

  public getDecisions = async (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok([...FINE_DECISIONS], callback);
  };

  public getPaymentMethods = async (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok([...FINE_PAYMENT_METHODS], callback);
  };
}

const handler = new FineLookupHandler();
export const getCategories = handler.getCategories;
export const getStatuses = handler.getStatuses;
export const getDecisions = handler.getDecisions;
export const getPaymentMethods = handler.getPaymentMethods;
