import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';

export const health = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
  _context.callbackWaitsForEmptyEventLoop = false;
  ResponseBuilder.ok({ status: 'ok', module: 'student' }, callback);
};
