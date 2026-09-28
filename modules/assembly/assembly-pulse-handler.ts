import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { resolveSchool } from './handler-util';
import { assemblyPulseService } from './assembly-pulse-service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class AssemblyPulseHandler {
  // GET /assembly/pulse?from=YYYY-MM-DD&to=YYYY-MM-DD  (director cockpit)
  // Defaults to the last 14 days ending today so the desktop fortnight view has data.
  public pulse = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = await resolveSchool(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const today = new Date().toISOString().slice(0, 10);
      const to = q.to && DATE_RE.test(q.to) ? q.to : today;
      let from = q.from && DATE_RE.test(q.from) ? q.from : '';
      if (!from) {
        const d = new Date(to + 'T00:00:00Z');
        d.setUTCDate(d.getUTCDate() - 13);
        from = d.toISOString().slice(0, 10);
      }
      ResponseBuilder.ok(await assemblyPulseService.pulse(auth.schoolId, from, to), callback);
    } catch (e: any) {
      ResponseBuilder.handleError(e, callback);
    }
  };
}

const h = new AssemblyPulseHandler();
export const pulse = h.pulse;
