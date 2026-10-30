import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per transfer (TC) endpoint, keyed by the `handler:` reference in
// transfer-endpoints.yml. Reads = transfer.view; create/update (issuing a TC withdraws
// the student) = transfer.manage.
const { TRANSFER_VIEW, TRANSFER_MANAGE, TRANSFER_CONFIG_MANAGE } = ACTIONS;

export const TRANSFER_ACTIONS: Record<string, string> = {
  'transfer-handler.listAll': TRANSFER_VIEW,
  'transfer-handler.list': TRANSFER_VIEW,
  'transfer-handler.print': TRANSFER_VIEW,
  'transfer-handler.prefill': TRANSFER_MANAGE,
  'transfer-handler.create': TRANSFER_MANAGE,
  'transfer-handler.update': TRANSFER_MANAGE,
  // Config: read open to TC viewers (form prefill needs defaults); write god-only.
  'transfer-handler.getConfig': TRANSFER_VIEW,
  'transfer-handler.updateConfig': TRANSFER_CONFIG_MANAGE,
};

// health + public TC verification (QR scan): authorizer-exempt.
export const TRANSFER_PUBLIC: string[] = ['health-handler.health', 'transfer-handler.verify'];
