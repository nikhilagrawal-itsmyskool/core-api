import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ITEM_TYPES, SECTIONS, PAYMENT_STATUSES, CLASS_NOS, GRADES, LOOSE_REASONS } from './shop-constants';
import { guard } from '../auth/authz';
import { SHOP_ACTIONS } from './shop-actions';

const getLookupsImpl = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
  _context.callbackWaitsForEmptyEventLoop = false;
  ResponseBuilder.ok({
    itemTypes: ITEM_TYPES,
    sections: SECTIONS,
    paymentStatuses: PAYMENT_STATUSES,
    classNos: CLASS_NOS,
    grades: GRADES,
    looseReasons: LOOSE_REASONS,
  }, callback);
};

export const getLookups = guard(SHOP_ACTIONS['shop-lookup-handler.getLookups'], getLookupsImpl);
