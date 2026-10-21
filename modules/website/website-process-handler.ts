import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { websiteService } from "./website-service";

// EventBridge rate(1 minute): drain queued website pushes (upload tagged assets → create the
// Contentful entry). Loops until the queue is empty or ~4 minutes elapse (each push can be
// many multi-second asset uploads). serverless-offline does NOT fire schedule events, so this
// is a prod-only driver. Overlap-safe: a claimed publication flips to 'processing'.
class WebsiteProcessHandler {
  public drain = async (_event: ApiEvent, ctx: ApiContext, _callback: ApiCallback) => {
    if (ctx) ctx.callbackWaitsForEmptyEventLoop = false;
    const deadline = Date.now() + 4 * 60 * 1000;
    let processed = 0;
    try {
      while (Date.now() < deadline) {
        const n = await websiteService.processNextPush();
        if (n === 0) break;
        processed += n;
      }
      if (processed) console.log(`[website] processed ${processed} push(es)`);
    } catch (err: any) {
      console.error(`[website] drain error: ${err.message}`);
    }
  };
}

export const drain = new WebsiteProcessHandler().drain;
