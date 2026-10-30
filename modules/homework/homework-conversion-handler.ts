import {
  ApiCallback,
  ApiContext,
  ApiEvent,
} from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { homeworkService } from "./homework-service";
import { selfTest } from "../../shared/lib/docx-to-pdf";

// Word→PDF conversion worker (docx -> pdf), isolated in its own handler so the heavy
// LibreOffice import (and its layer) stays off the light CRUD handlers. Mirrors the
// syllabus model-paper worker. These exports are NOT action-gated: drain/selftest
// aren't HTTP, and process-next is only driven by the local poller offline.
class HomeworkConversionHandler {
  // POST /homework/conversions/process-next — convert one pending Word item (local poller).
  public processNext = async (_event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const r = await homeworkService.processNextConversion();
      ResponseBuilder.ok(r, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // Scheduled drain (EventBridge on AWS). Loops processNext until empty/timeout.
  // Not an HTTP handler — invoked by the schedule event; overlap-safe via `for update
  // skip locked`. Inert while the converter is disabled.
  public drain = async (_event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const summary = await homeworkService.drainConversions();
      if (typeof callback === "function") ResponseBuilder.ok(summary, callback);
    } catch (err: any) {
      console.error("homework drain-conversions error", err);
      if (typeof callback === "function") ResponseBuilder.handleError(err, callback);
    }
  };

  // Invoke-only: verify the LibreOffice layer runs on this runtime (AL2 binary on
  // AL2023). Bypasses the feature flag. Run via `serverless invoke -f convert-selftest`
  // before enabling HOMEWORK_CONVERT_ENABLED.
  public selftest = async (_event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    const result = await selfTest();
    if (typeof callback === "function") ResponseBuilder.ok(result, callback);
    return result;
  };
}

const h = new HomeworkConversionHandler();
export const processNext = h.processNext;
export const drain = h.drain;
export const selftest = h.selftest;
