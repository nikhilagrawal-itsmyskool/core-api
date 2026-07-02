import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import {
  CANDIDATE_STATUSES,
  FINAL_DECISIONS,
  HIRING_SUBJECTS,
  POSITION_TYPES,
  STAGE_OUTCOMES,
  STAGE_TYPES,
} from './hiring-constants';

class HiringLookupHandler {
  // Single endpoint serving every dropdown the form needs.
  public getLookups = async (
    _event: ApiEvent,
    _context: ApiContext,
    callback: ApiCallback
  ) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok(
      {
        positionTypes: [...POSITION_TYPES],
        subjects: [...HIRING_SUBJECTS],
        stageTypes: [...STAGE_TYPES],
        stageOutcomes: [...STAGE_OUTCOMES],
        statuses: [...CANDIDATE_STATUSES],
        finalDecisions: [...FINAL_DECISIONS],
      },
      callback
    );
  };
}

const handler = new HiringLookupHandler();
export const getLookups = handler.getLookups;
