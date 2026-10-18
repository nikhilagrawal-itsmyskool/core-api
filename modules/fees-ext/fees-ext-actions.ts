import { ACTIONS } from '../../shared/lib/authz-policy';

// Authorization map for the fees-ext service (overflow endpoints from the fees stack), keyed by
// the `handler:` reference in fees-ext-endpoints.yml. The coverage test asserts every handler here
// is gated or explicitly public. The actual guard lives on the re-exported fees handler.
export const FEE_EXT_ACTIONS: Record<string, string> = {
  'fees-ext-handler.writeOff': ACTIONS.FEE_WRITEOFF_MANAGE, // god-only (also enforced on the fees export)
};

export const FEE_EXT_PUBLIC: string[] = [
  'health-handler.health',
];
