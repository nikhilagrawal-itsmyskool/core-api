import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { guard } from "../auth/authz";
import { ASSEMBLY_ACTIONS } from "./assembly-actions";
import { ResponseBuilder } from '../../shared/lib/response-builder';
import {
  WEEKDAYS,
  RESPONSIBLE_ROLES,
  RESPONSIBLE_TARGET_TYPES,
  PUBLISH_STATUSES,
  CYCLE_UNITS,
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
        cycleUnits: [...CYCLE_UNITS],
      },
      callback,
    );
  };
}

const handler = new AssemblyLookupHandler();
const g = (ref: string, fn: any) => guard(ASSEMBLY_ACTIONS[ref], fn);
export const getLookups = g("assembly-lookup-handler.getLookups", handler.getLookups);
