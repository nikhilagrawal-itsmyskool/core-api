import { ApiCallback, ApiContext, ApiEvent } from "../../shared/lib/api.interfaces";
import { ResponseBuilder } from "../../shared/lib/response-builder";
import { ErrorCode } from "../../shared/lib/error-codes";
import { validateSchoolCodeHeader, guardActiveStudent } from "../auth/auth-utils";
import { paymentsService } from "./payments-service";
import { CreateOrderRequest, VerifyRequest } from "./payments-interfaces";

function body<T>(event: ApiEvent, callback: ApiCallback): T | null {
  if (!event.body) { ResponseBuilder.badRequest(ErrorCode.InvalidInput, "Request body is required", callback); return null; }
  return JSON.parse(event.body) as T;
}

const header = (event: ApiEvent, name: string): string | undefined => {
  const h = event.headers || {};
  const k = Object.keys(h).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? (h as any)[k] : undefined;
};

class PaymentsHandler {
  // GET /payments/me/payable?academicYearId=
  public payable = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const q = event.queryStringParameters || {};
      const result = await paymentsService.payable(auth.token.school_id, schoolCode, auth.activeStudentId, q.academicYearId || null);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /payments/me/order { cycleKeys: string[] }
  public createOrder = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const b = body<CreateOrderRequest>(event, callback);
      if (!b) return;
      const q = event.queryStringParameters || {};
      const result = await paymentsService.createOrder({
        schoolId: auth.token.school_id, schoolCode, studentId: auth.activeStudentId,
        academicYearId: q.academicYearId || null, userId: auth.activeStudentId, cycleKeys: b.cycleKeys || [],
      });
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /payments/me/verify { intentId, orderId, paymentId, signature }
  public verify = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      validateSchoolCodeHeader(event);
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;
      const b = body<VerifyRequest>(event, callback);
      if (!b) return;
      const result = await paymentsService.verify(auth.token.school_id, auth.activeStudentId, b);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };

  // POST /payments/webhooks/razorpay — authorizer-exempt; verifies its own HMAC off the raw body.
  public webhook = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const raw = event.body || "";
      const sig = header(event, "x-razorpay-signature") || "";
      let payload: any = {};
      try { payload = JSON.parse(raw); } catch { /* bad body → signature check will fail anyway */ }
      const result = await paymentsService.handleWebhookEvent(payload, sig, raw);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const h = new PaymentsHandler();
export const payable = h.payable;
export const createOrder = h.createOrder;
export const verify = h.verify;
export const webhook = h.webhook;
