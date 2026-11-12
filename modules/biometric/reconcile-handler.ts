import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { biometricService } from './biometric-service';

// EventBridge-scheduled device-membership reconcile (rate(15 minutes)). NOT an HTTP
// route — no authorizer, no X-School-Code scope. It brings every device's user list in
// line with employee status across all schools: removes the device user for anyone who
// went inactive/deleted (enrolment -> 'suspended'), and restores (re-pushes the user +
// replays stored fingerprint templates, enrolment -> 'synced') for anyone active again.
// Idempotent and cheap: the sweep query only returns enrolments that disagree with the
// employee's current status, so a tick with nothing to do does almost no work.
class ReconcileHandler {
  reconcileDevices = async (_event: ApiEvent, context: ApiContext, callback: ApiCallback) => {
    context.callbackWaitsForEmptyEventLoop = false;
    try {
      const result = await biometricService.reconcileAll();
      ResponseBuilder.ok(result, callback);
    } catch (err) {
      ResponseBuilder.handleError(err as Error, callback);
    }
  };
}

export const reconcileDevices = new ReconcileHandler().reconcileDevices;
