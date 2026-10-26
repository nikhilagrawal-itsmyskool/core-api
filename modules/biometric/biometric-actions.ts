import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per admin endpoint, keyed by the `handler:` reference in
// biometric-endpoints.yml (`file.export`). Wired at the export site of each handler via
// guard(). god holds all ('*'); everything here is god-first (no role grant in policy.js)
// until a school opens cells via the Permissions grid.
const {
  BIOMETRIC_DEVICE_VIEW,
  BIOMETRIC_DEVICE_MANAGE,
  BIOMETRIC_ENROLLMENT_VIEW,
  BIOMETRIC_ENROLLMENT_SYNC,
  BIOMETRIC_PUNCH_VIEW,
} = ACTIONS;

export const BIOMETRIC_ACTIONS: Record<string, string> = {
  'biometric-admin-handler.listDevices': BIOMETRIC_DEVICE_VIEW,
  'biometric-admin-handler.getDevice': BIOMETRIC_DEVICE_VIEW,
  'biometric-admin-handler.registerDevice': BIOMETRIC_DEVICE_MANAGE,
  'biometric-admin-handler.updateDevice': BIOMETRIC_DEVICE_MANAGE,
  'biometric-admin-handler.syncEmployee': BIOMETRIC_ENROLLMENT_SYNC,
  'biometric-admin-handler.unsyncEmployee': BIOMETRIC_ENROLLMENT_SYNC,
  'biometric-admin-handler.listEnrollments': BIOMETRIC_ENROLLMENT_VIEW,
  'biometric-admin-handler.listPunches': BIOMETRIC_PUNCH_VIEW,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
//   - device-handler.iclock: the machine push endpoints (authorizer-exempt, SN-gated)
export const BIOMETRIC_PUBLIC: string[] = ['health-handler.health', 'device-handler.iclock'];
