import { ApiCallback, ApiContext, ApiEvent, ApiResponse } from '../../shared/lib/api.interfaces';
import { deviceService } from './device-service';

// Reply in ZKTeco's plain-text format (NOT JSON). CORS header kept for parity with the
// rest of the API; the device itself ignores it.
function replyText(body: string, callback: ApiCallback, statusCode = 200): void {
  const response: ApiResponse = {
    body,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'text/plain',
    },
    statusCode,
  };
  callback(undefined, response);
}

// Single dispatcher for every /iclock/* device request (greedy {proxy+} route, any method).
class DeviceHandler {
  iclock = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const anyEvent = event as any;
      // Path after /iclock/ — e.g. 'cdata', 'cdata.aspx', 'getrequest', 'devicecmd'.
      let proxy = (event.pathParameters && (event.pathParameters as any).proxy) || '';
      if (!proxy && event.path) {
        const m = event.path.match(/\/iclock\/(.+)$/i);
        proxy = m ? m[1] : '';
      }
      const bodyRaw = event.body || '';
      const body = anyEvent.isBase64Encoded ? Buffer.from(bodyRaw, 'base64').toString('utf8') : bodyRaw;

      const replyBody = await deviceService.handle({
        method: (anyEvent.httpMethod || 'GET').toUpperCase(),
        proxy,
        query: event.queryStringParameters || {},
        body,
        sourceIp: anyEvent.requestContext?.identity?.sourceIp,
      });
      replyText(replyBody, callback);
    } catch (err) {
      // Never 500 a device — it would error-loop. Log and ack so it moves on; the
      // missed batch re-arrives on the next poll (Realtime) or handshake catch-up.
      console.error('[biometric] device request failed:', err);
      replyText('OK', callback);
    }
  };
}

const handler = new DeviceHandler();
export const iclock = handler.iclock;
