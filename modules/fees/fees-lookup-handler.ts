import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { guard } from '../auth/authz';
import { FEE_ACTIONS } from './fees-actions';
import { resolveSchool } from './fees-util';
import {
  FEE_HEAD_KINDS,
  CONCESSION_TYPES,
  CONCESSION_VALUE_TYPES,
  PAYMENT_MODES,
  RECEIVED_FROM,
  RECEIPT_TYPES,
  LEDGER_CATEGORIES,
  LATE_FEE_MODES,
  REFUND_STATUSES,
} from './fees-constants';

class FeeLookupHandler {
  public lookups = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const ctx = await resolveSchool(event, callback);
      if (!ctx) return;
      ResponseBuilder.ok(
        {
          feeHeadKinds: FEE_HEAD_KINDS,
          concessionTypes: CONCESSION_TYPES,
          concessionValueTypes: CONCESSION_VALUE_TYPES,
          paymentModes: PAYMENT_MODES,
          receivedFrom: RECEIVED_FROM,
          receiptTypes: RECEIPT_TYPES,
          ledgerCategories: LEDGER_CATEGORIES,
          lateFeeModes: LATE_FEE_MODES,
          refundStatuses: REFUND_STATUSES,
        },
        callback
      );
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new FeeLookupHandler();
export const lookups = guard(FEE_ACTIONS['fees-lookup-handler.lookups'], handler.lookups);
