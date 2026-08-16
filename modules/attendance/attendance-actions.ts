import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per attendance endpoint, keyed by the `handler:` reference in
// attendance-endpoints.yml. Staff attendance screens (roster/register/sessions/marks +
// the 360 student view) = attendance.mark (admin + class-teacher, per the menu gating);
// finalizing a session and editing records after finalize = attendance.finalize (admin).
const MARK = 'attendance.mark'; // not in ACTIONS catalog (no UI branch), but a real policy grant
const { ATTENDANCE_FINALIZE } = ACTIONS;

export const ATTENDANCE_ACTIONS: Record<string, string> = {
  'attendance-handler.getRoster': MARK,
  'attendance-handler.getRegister': MARK,
  'attendance-handler.getStudentAttendance': MARK,
  'attendance-handler.openSession': MARK,
  'attendance-handler.listSessions': MARK,
  'attendance-handler.saveMarks': MARK,
  'attendance-handler.getSession': MARK,
  'attendance-handler.finalize': ATTENDANCE_FINALIZE,
  'attendance-handler.editRecord': ATTENDANCE_FINALIZE,
};

// health: readiness probe. attendance-me-handler.getMy: parent app (family token +
// X-Student-Id) — guarded by guardActiveStudent, not requireAction.
export const ATTENDANCE_PUBLIC: string[] = ['health-handler.health', 'attendance-me-handler.getMy'];
