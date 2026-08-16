import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { validateSchoolCodeHeader } from '../auth/auth-utils';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
import { resolveSchool, parseBody, requireParam } from './fees-util';
import { feesReceiptService } from './fees-receipt-service';

class FeesReceiptHandler {
  public collect = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const body = parseBody<any>(event, callback); if (!body) return;
      const result = await feesReceiptService.collect(rc.schoolId, body, rc.userId, schoolCode);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public adhoc = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const body = parseBody<any>(event, callback); if (!body) return;
      const result = await feesReceiptService.adhoc(rc.schoolId, body, rc.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public collectTransport = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const schoolCode = validateSchoolCodeHeader(event);
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const body = parseBody<any>(event, callback); if (!body) return;
      const result = await feesReceiptService.collectTransport(rc.schoolId, body, rc.userId, schoolCode);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public cancel = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const body = parseBody<any>(event, callback); if (!body) return;
      const result = await feesReceiptService.cancel(rc.schoolId, id, body.reason, rc.userId);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public getById = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const result = await feesReceiptService.getById(rc.schoolId, id);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public list = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const result = await feesReceiptService.list(rc.schoolId, event.queryStringParameters || {});
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  public print = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const id = requireParam(event, 'id', callback); if (!id) return;
      const format = (event.queryStringParameters || {}).format; // 'waterfall' → SchoolPad statement view
      const html = await feesReceiptService.printHtml(rc.schoolId, id, format);
      ResponseBuilder.returnHtml(html, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // PUBLIC — no auth (authorizer-exempt). Scanning a fee-receipt QR resolves here.
  public verify = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const uuid = event.pathParameters?.uuid as string;
      const result = await feesReceiptService.verifyReceipt(uuid);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };

  // STAFF — authed. The Scan & Verify PWA tile (admin/god) resolves any receipt type here.
  public verifyStaff = async (event: ApiEvent, ctx: ApiContext, callback: ApiCallback) => {
    ctx.callbackWaitsForEmptyEventLoop = false;
    try {
      const rc = await resolveSchool(event, callback); if (!rc) return;
      const uuid = event.pathParameters?.uuid as string;
      const result = await feesReceiptService.verifyReceiptStaff(rc.schoolId, uuid);
      ResponseBuilder.ok(result, callback);
    } catch (err: any) { ResponseBuilder.handleError(err, callback); }
  };
}

const handler = new FeesReceiptHandler();
export const collect = guard(FEE_ACTIONS['fees-receipt-handler.collect'], handler.collect);
export const adhoc = guard(FEE_ACTIONS['fees-receipt-handler.adhoc'], handler.adhoc);
export const collectTransport = guard(FEE_ACTIONS['fees-receipt-handler.collectTransport'], handler.collectTransport);
export const cancel = guard(FEE_ACTIONS['fees-receipt-handler.cancel'], handler.cancel);
export const getById = guard(FEE_ACTIONS['fees-receipt-handler.getById'], handler.getById);
export const list = guard(FEE_ACTIONS['fees-receipt-handler.list'], handler.list);
export const print = guard(FEE_ACTIONS['fees-receipt-handler.print'], handler.print);
export const verify = handler.verify; // PUBLIC — authorizer-exempt QR verify, ungated
export const verifyStaff = guard(FEE_ACTIONS['fees-receipt-handler.verifyStaff'], handler.verifyStaff);
