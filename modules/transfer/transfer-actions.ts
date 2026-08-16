import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per transfer (TC) endpoint, keyed by the `handler:` reference in
// transfer-endpoints.yml. Reads = transfer.view; create/update (issuing a TC withdraws
// the student) = transfer.manage.
const { TRANSFER_VIEW, TRANSFER_MANAGE } = ACTIONS;

export const TRANSFER_ACTIONS: Record<string, string> = {
  'transfer-handler.listAll': TRANSFER_VIEW,
  'transfer-handler.list': TRANSFER_VIEW,
  'transfer-handler.create': TRANSFER_MANAGE,
  'transfer-handler.update': TRANSFER_MANAGE,
};

// health: authorizer-exempt readiness probe.
export const TRANSFER_PUBLIC: string[] = ['health-handler.health'];
