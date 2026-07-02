import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import {
  ATTENDANCE_STATUSES,
  OWNERSHIP_TYPES,
  ROUTE_DIRECTIONS,
  VEHICLE_TYPES,
} from './transport-constants';

class TransportLookupHandler {
  // Single endpoint serving every dropdown the transport forms need.
  public getLookups = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok(
      {
        vehicleTypes: [...VEHICLE_TYPES],
        ownershipTypes: [...OWNERSHIP_TYPES],
        directions: [...ROUTE_DIRECTIONS],
        attendanceStatuses: [...ATTENDANCE_STATUSES],
      },
      callback,
    );
  };
}

const handler = new TransportLookupHandler();
export const getLookups = handler.getLookups;
