import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { UNIFORM_CATEGORIES, UNIFORM_GENDERS, SALE_TYPES, PAYMENT_STATUSES, SEEDED_ITEMS } from './uniform-constants';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { uniformItemService } from './uniform-item-service';
import { guard } from '../auth/authz';
import { UNIFORM_ACTIONS } from './uniform-actions';

const getLookupsImpl = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
  _context.callbackWaitsForEmptyEventLoop = false;
  // Preset item-name suggestions are suppressed per-school when the Config toggle is off.
  let showSeededHints = true;
  try {
    const schoolId = await uniformItemService.getSchoolIdByCode(validateSchoolCodeHeader(event));
    if (schoolId) showSeededHints = (await uniformItemService.getConfig(schoolId)).showSeededHints;
  } catch { /* default to showing presets if school can't be resolved */ }

  ResponseBuilder.ok({
    categories: UNIFORM_CATEGORIES,
    genders: UNIFORM_GENDERS,
    saleTypes: SALE_TYPES,
    paymentStatuses: PAYMENT_STATUSES,
    itemNameHints: showSeededHints ? SEEDED_ITEMS.map(i => i.name) : [],
  }, callback);
};

export const getLookups = guard(UNIFORM_ACTIONS['uniform-lookup-handler.getLookups'], getLookupsImpl);
