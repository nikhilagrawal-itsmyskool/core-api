import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { SampleServices } from './sample-service';

export class SampleHandler {
  get = (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    let queryParams = event.queryStringParameters;
    queryParams = queryParams || {};
    SampleServices.get(queryParams)
      .then((res) => {
        ResponseBuilder.ok(res, callback);
      })
      .catch((err) => {
        ResponseBuilder.handleError(err, callback);
      });
  };
}

const shandler = new SampleHandler();
export const get = shandler.get;
