import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { biometricService } from './biometric-service';
import { BIOMETRIC_ACTIONS } from './biometric-actions';
import { resolveSchool, parseBody, requireParam } from './handler-util';

// Admin surface (X-School-Code + JWT). Each export is gated by guard() at the bottom.
// NOTE: handlers AWAIT the full service call before calling the ResponseBuilder callback.
// A non-awaited `.then()` chain lets the async handler's promise resolve to undefined
// first, which serverless-offline/Lambda turns into a 502.
class BiometricAdminHandler {
  listDevices = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      ResponseBuilder.ok(await biometricService.listDevices(ctx.schoolId), callback);
    } catch (err) {
      ResponseBuilder.handleError(err as Error, callback);
    }
  };

  registerDevice = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await biometricService.registerDevice(ctx.schoolId, ctx.userId, body), callback);
    } catch (err) {
      ResponseBuilder.handleError(err as Error, callback);
    }
  };

  getDevice = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const sn = requireParam(event, 'sn', callback);
      if (!sn) return;
      ResponseBuilder.ok(await biometricService.getDevice(ctx.schoolId, sn), callback);
    } catch (err) {
      ResponseBuilder.handleError(err as Error, callback);
    }
  };

  updateDevice = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const sn = requireParam(event, 'sn', callback);
      if (!sn) return;
      const body = parseBody<any>(event, callback);
      if (!body) return;
      ResponseBuilder.ok(await biometricService.updateDevice(ctx.schoolId, sn, ctx.userId, body), callback);
    } catch (err) {
      ResponseBuilder.handleError(err as Error, callback);
    }
  };

  syncEmployee = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const employeeId = requireParam(event, 'employeeId', callback);
      if (!employeeId) return;
      const body = parseBody<any>(event, callback) || {};
      ResponseBuilder.ok(await biometricService.syncEmployee(ctx.schoolId, ctx.userId, employeeId, body), callback);
    } catch (err) {
      ResponseBuilder.handleError(err as Error, callback);
    }
  };

  unsyncEmployee = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const employeeId = requireParam(event, 'employeeId', callback);
      if (!employeeId) return;
      const body = parseBody<any>(event, callback) || {};
      ResponseBuilder.ok(await biometricService.unsyncEmployee(ctx.schoolId, ctx.userId, employeeId, body), callback);
    } catch (err) {
      ResponseBuilder.handleError(err as Error, callback);
    }
  };

  listEnrollments = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      ResponseBuilder.ok(await biometricService.listEnrollments(ctx.schoolId, { deviceSn: q.deviceSn }), callback);
    } catch (err) {
      ResponseBuilder.handleError(err as Error, callback);
    }
  };

  listPunches = async (event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      const q = event.queryStringParameters || {};
      ResponseBuilder.ok(
        await biometricService.listPunches(ctx.schoolId, { from: q.from, to: q.to, employeeId: q.employeeId, deviceSn: q.deviceSn }),
        callback,
      );
    } catch (err) {
      ResponseBuilder.handleError(err as Error, callback);
    }
  };
}

const h = new BiometricAdminHandler();
const g = (ref: string, fn: any) => guard(BIOMETRIC_ACTIONS[ref], fn);

export const listDevices = g('biometric-admin-handler.listDevices', h.listDevices);
export const registerDevice = g('biometric-admin-handler.registerDevice', h.registerDevice);
export const getDevice = g('biometric-admin-handler.getDevice', h.getDevice);
export const updateDevice = g('biometric-admin-handler.updateDevice', h.updateDevice);
export const syncEmployee = g('biometric-admin-handler.syncEmployee', h.syncEmployee);
export const unsyncEmployee = g('biometric-admin-handler.unsyncEmployee', h.unsyncEmployee);
export const listEnrollments = g('biometric-admin-handler.listEnrollments', h.listEnrollments);
export const listPunches = g('biometric-admin-handler.listPunches', h.listPunches);
