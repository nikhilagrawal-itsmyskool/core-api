import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { FINE_ACTIONS } from './fine-actions';
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
const g = (ref: string, fn: any) => guard(FINE_ACTIONS[ref], fn);
export const getCategories = g('fine-lookup-handler.getCategories', handler.getCategories);
export const getStatuses = g('fine-lookup-handler.getStatuses', handler.getStatuses);
export const getDecisions = g('fine-lookup-handler.getDecisions', handler.getDecisions);
export const getPaymentMethods = g('fine-lookup-handler.getPaymentMethods', handler.getPaymentMethods);
