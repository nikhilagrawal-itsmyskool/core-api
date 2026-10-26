import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per endpoint, keyed by the handler reference in the endpoints YAML.
// Wired at each handler's export site via guard(). god ('*') holds all.
const {
  STAFF_ATTENDANCE_VIEW,
  STAFF_ATTENDANCE_CONFIG_MANAGE,
  STAFF_ATTENDANCE_REGULARIZE,
  STAFF_ATTENDANCE_APPROVE,
} = ACTIONS;

export const STAFF_ATTENDANCE_ACTIONS: Record<string, string> = {
  // Config (god-only)
  'config-handler.getConfig': STAFF_ATTENDANCE_CONFIG_MANAGE,
  'config-handler.updateConfig': STAFF_ATTENDANCE_CONFIG_MANAGE,
  'config-handler.listSeasons': STAFF_ATTENDANCE_CONFIG_MANAGE,
  'config-handler.createSeason': STAFF_ATTENDANCE_CONFIG_MANAGE,
  'config-handler.updateSeason': STAFF_ATTENDANCE_CONFIG_MANAGE,
  'config-handler.deleteSeason': STAFF_ATTENDANCE_CONFIG_MANAGE,

  // Oversight (admin + education-director)
  'staff-attendance-handler.dayView': STAFF_ATTENDANCE_VIEW,
  'staff-attendance-handler.report': STAFF_ATTENDANCE_VIEW,
  'staff-attendance-handler.employeeAttendance': STAFF_ATTENDANCE_VIEW,
  'staff-attendance-handler.listRegularizations': STAFF_ATTENDANCE_VIEW,

  // Decide regularizations (education-director, god)
  'staff-attendance-handler.approveRegularization': STAFF_ATTENDANCE_APPROVE,
  'staff-attendance-handler.rejectRegularization': STAFF_ATTENDANCE_APPROVE,

  // Employee self-service (/me) — all staff
  'staff-attendance-me-handler.myAttendance': STAFF_ATTENDANCE_REGULARIZE,
  'staff-attendance-me-handler.myRegularizations': STAFF_ATTENDANCE_REGULARIZE,
  'staff-attendance-me-handler.applyRegularization': STAFF_ATTENDANCE_REGULARIZE,
  'staff-attendance-me-handler.cancelRegularization': STAFF_ATTENDANCE_REGULARIZE,
};

export const STAFF_ATTENDANCE_PUBLIC: string[] = ['health-handler.health'];
