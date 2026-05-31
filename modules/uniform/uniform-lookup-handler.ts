import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { UNIFORM_CATEGORIES, UNIFORM_GENDERS, SALE_TYPES, PAYMENT_STATUSES, SEEDED_ITEMS } from './uniform-constants';

export const getLookups = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
  _context.callbackWaitsForEmptyEventLoop = false;
  ResponseBuilder.ok({
    categories: UNIFORM_CATEGORIES,
    genders: UNIFORM_GENDERS,
    saleTypes: SALE_TYPES,
    paymentStatuses: PAYMENT_STATUSES,
    itemNameHints: SEEDED_ITEMS.map(i => i.name),
  }, callback);
};
