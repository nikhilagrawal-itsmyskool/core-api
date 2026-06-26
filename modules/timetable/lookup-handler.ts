import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import {
  SUBJECT_KINDS, SLOT_TYPES, CONSTRAINT_TYPES, HARDNESS_VALUES, DAYS_OF_WEEK,
} from './timetable-constants';

// Static lookups for dropdowns in the admin portal. (Classes, teachers and
// academic years come from their own modules.)
class LookupHandler {
  public getAll = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok(
      {
        subjectKinds: SUBJECT_KINDS,
        slotTypes: SLOT_TYPES,
        constraintTypes: CONSTRAINT_TYPES,
        hardness: HARDNESS_VALUES,
        daysOfWeek: DAYS_OF_WEEK,
      },
      callback,
    );
  };
}

const handler = new LookupHandler();
export const getAll = handler.getAll;
