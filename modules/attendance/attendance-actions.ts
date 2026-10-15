import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per attendance endpoint, keyed by the `handler:` reference in
// attendance-endpoints.yml. The roll-call screens (roster/register/sessions/marks) =
// attendance.session.mark (admin + class-teacher, per the menu gating); finalizing a session
// and editing records after finalize = attendance.session.finalize (admin). Reading a single
// student's attendance history (the 360 card) = attendance.record.view (teacher + admin).
const { ATTENDANCE_MARK, ATTENDANCE_FINALIZE, ATTENDANCE_RECORD_VIEW, ATTENDANCE_CONFIG_MANAGE } = ACTIONS;

export const ATTENDANCE_ACTIONS: Record<string, string> = {
  'attendance-handler.getDayInfo': ATTENDANCE_MARK,
  // Reading config is open to markers (so the marking screen can offer Half-day); only
  // admin + god (attendance.config.manage) may change it.
  'attendance-handler.getConfig': ATTENDANCE_MARK,
  'attendance-handler.updateConfig': ATTENDANCE_CONFIG_MANAGE,
  'attendance-handler.getRoster': ATTENDANCE_MARK,
  'attendance-handler.getRegister': ATTENDANCE_MARK,
  // The student 360 attendance card — a read any teacher may see, not a roll-call screen.
  'attendance-handler.getStudentAttendance': ATTENDANCE_RECORD_VIEW,
  'attendance-handler.openSession': ATTENDANCE_MARK,
  'attendance-handler.listSessions': ATTENDANCE_MARK,
  'attendance-handler.saveMarks': ATTENDANCE_MARK,
  'attendance-handler.getSession': ATTENDANCE_MARK,
  'attendance-handler.finalize': ATTENDANCE_FINALIZE,
  'attendance-handler.editRecord': ATTENDANCE_FINALIZE,
};

// health: readiness probe. attendance-me-handler.getMy: parent app (family token +
// X-Student-Id) — guarded by guardActiveStudent, not requireAction.
export const ATTENDANCE_PUBLIC: string[] = ['health-handler.health', 'attendance-me-handler.getMy'];
