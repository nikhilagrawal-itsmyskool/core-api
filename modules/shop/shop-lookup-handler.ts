import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ITEM_TYPES, SECTIONS, PAYMENT_STATUSES, CLASS_NOS } from './shop-constants';

export const getLookups = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
  _context.callbackWaitsForEmptyEventLoop = false;
  ResponseBuilder.ok({
    itemTypes: ITEM_TYPES,
    sections: SECTIONS,
    paymentStatuses: PAYMENT_STATUSES,
    classNos: CLASS_NOS,
  }, callback);
};
