import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import {
  WEEKDAYS,
  RESPONSIBLE_ROLES,
  RESPONSIBLE_TARGET_TYPES,
  PUBLISH_STATUSES,
} from './assembly-constants';

class AssemblyLookupHandler {
  // Single endpoint serving every dropdown the assembly forms need.
  public getLookups = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok(
      {
        weekdays: [...WEEKDAYS],
        responsibleRoles: [...RESPONSIBLE_ROLES],
        responsibleTargetTypes: [...RESPONSIBLE_TARGET_TYPES],
        publishStatuses: [...PUBLISH_STATUSES],
      },
      callback,
    );
  };
}

const handler = new AssemblyLookupHandler();
export const getLookups = handler.getLookups;
