import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { outreachService } from "./outreach-service";
import { getSchoolCodeById } from "./outreach-common";
import { notifyMomentPublished } from "./outreach-notify";

// EventBridge rate(1 minute): publish any draft whose scheduled publish_at has arrived, then
// fan the in-app notification to its audience — exactly like a manual publish. serverless-offline
// does NOT fire schedule events, so this is a prod-only driver (scheduling is a prod feature).
class OutreachScheduledHandler {
  public drain = async (_event: ApiEvent, ctx: ApiContext, _callback: ApiCallback) => {
    if (ctx) ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const published = await outreachService.processScheduled(50);
      for (const p of published) {
        try {
          const schoolCode = await getSchoolCodeById(p.schoolId);
          if (!schoolCode) continue;
          const view = await outreachService.getMoment(p.schoolId, p.momentId, { reactorId: null });
          const studentIds = await outreachService.resolveAudienceStudentIds(p.schoolId, p.momentId);
          await notifyMomentPublished(schoolCode, studentIds, p.momentId, view);
        } catch (err: any) {
          console.error(`[outreach] scheduled notify failed for ${p.momentId}: ${err.message}`);
        }
      }
      if (published.length) console.log(`[outreach] scheduled-publish: ${published.length} moment(s)`);
    } catch (err: any) {
      console.error(`[outreach] scheduled drain error: ${err.message}`);
    }
  };
}

export const drain = new OutreachScheduledHandler().drain;
