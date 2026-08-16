import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { COMMUNICATION_ACTIONS } from './communication-actions';
import { CHANNELS } from './communication-constants';
import { AUTO_CONTEXT_KEYS } from './communication-util';

class CommunicationLookupHandler {
  public getChannels = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    ResponseBuilder.ok({ channels: CHANNELS }, callback);
  };

  // Variables the system auto-fills per recipient (by audience type) plus their
  // union. The Compose UI subtracts these from a selected template's `variables`
  // so it only prompts the sender for the shared/user-supplied ones.
  public getVariables = async (_event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    const autoVariablesAll = Array.from(new Set(Object.values(AUTO_CONTEXT_KEYS).flat()));
    ResponseBuilder.ok({ autoVariables: AUTO_CONTEXT_KEYS, autoVariablesAll }, callback);
  };
}

const handler = new CommunicationLookupHandler();
export const getChannels = guard(COMMUNICATION_ACTIONS['communication-lookup-handler.getChannels'], handler.getChannels);
export const getVariables = guard(COMMUNICATION_ACTIONS['communication-lookup-handler.getVariables'], handler.getVariables);
