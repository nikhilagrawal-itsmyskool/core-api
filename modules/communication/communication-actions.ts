import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per communication endpoint, keyed by the `handler:` reference in
// communication-endpoints.yml. Composing/sending (incl. lookups + reading templates &
// messages the compose flow needs) = communication.message.send; creating/editing templates =
// communication.template.manage; deleting/restoring a template = the god-only
// communication.template.delete. Contact-reveal masking on message rows stays row-level.
const { COMMUNICATION_SEND, COMMUNICATION_TEMPLATE_MANAGE, COMMUNICATION_TEMPLATE_DELETE } = ACTIONS;

export const COMMUNICATION_ACTIONS: Record<string, string> = {
  'communication-lookup-handler.getChannels': COMMUNICATION_SEND,
  'communication-lookup-handler.getVariables': COMMUNICATION_SEND,
  'template-handler.list': COMMUNICATION_SEND,
  'template-handler.getById': COMMUNICATION_SEND,
  'template-handler.create': COMMUNICATION_TEMPLATE_MANAGE,
  'template-handler.update': COMMUNICATION_TEMPLATE_MANAGE,
  'template-handler.remove': COMMUNICATION_TEMPLATE_DELETE,
  'template-handler.restore': COMMUNICATION_TEMPLATE_DELETE,
  'message-handler.send': COMMUNICATION_SEND,
  'message-handler.preview': COMMUNICATION_SEND,
  'message-handler.list': COMMUNICATION_SEND,
  'message-handler.getById': COMMUNICATION_SEND,
  'message-handler.cancel': COMMUNICATION_SEND,
  // In-app notification inbox: POST /notifications is the cross-module fan-out — service
  // tokens bypass requireAction; a human caller needs communication.message.send.
  'notification-handler.create': COMMUNICATION_SEND,
};

// NOT gated by requireAction:
//   - health: readiness probe
//   - message-handler.webhook: provider delivery callback (authorizer-exempt, provider-secret auth)
//   - message-handler.drain: EventBridge schedule (no HTTP caller)
//   - message-handler.cockpitDigest: EventBridge schedule (no HTTP caller; mints its own service token)
//   - message-handler.processNext: internal worker call (service token, no user roles)
//   - otp-handler.send: machine-to-machine from the auth recovery flow (service token)
export const COMMUNICATION_PUBLIC: string[] = [
  'health-handler.health',
  'message-handler.webhook',
  'message-handler.drain',
  'message-handler.cockpitDigest',
  'message-handler.processNext',
  'otp-handler.send',
  // In-app notification self-service (/me/notifications, /me/devices): the handler resolves
  // the caller's OWN identity from the token (employee_id or activeStudentId). Students carry
  // no roles, so these self-authorize and cannot be action-gated.
  'notification-handler.list',
  'notification-handler.markRead',
  'notification-handler.markAllRead',
  'notification-handler.registerDevice',
  'notification-handler.unregisterDevice',
];
