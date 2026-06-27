import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { CHANNELS } from './communication-constants';

class CommunicationLookupHandler {
  public getChannels = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ channels: CHANNELS }, callback);
  };
}

const handler = new CommunicationLookupHandler();
export const getChannels = handler.getChannels;
