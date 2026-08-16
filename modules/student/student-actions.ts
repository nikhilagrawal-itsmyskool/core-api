import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per student endpoint, keyed by the `handler:` reference in
// student-endpoints.yml. Reads (search/list/detail + houses/lookups/guardians/addresses/
// siblings/photos reads) = student.view; writes (admit/edit/delete, promote/graduate,
// houses, lookups, guardians/addresses/siblings, photos, credentials view + reset) =
// student.manage. Contact UNMASKING on search/detail stays row-level (revealStudent /
// student.contacts.view) on top of the student.view gate.
const { STUDENT_VIEW, STUDENT_MANAGE } = ACTIONS;

export const STUDENT_ACTIONS: Record<string, string> = {
  // reads
  'student-handler.search': STUDENT_VIEW,
  'student-handler.omni': STUDENT_VIEW,
  'student-handler.classStrength': STUDENT_VIEW,
  'student-admin-handler.list': STUDENT_VIEW,
  'student-admin-handler.commsSummary': STUDENT_VIEW,
  'student-admin-handler.getById': STUDENT_VIEW,
  'house-handler.list': STUDENT_VIEW,
  'house-handler.getById': STUDENT_VIEW,
  'house-handler.listTeachers': STUDENT_VIEW,
  'student-lookup-handler.list': STUDENT_VIEW,
  'student-lookup-handler.suggestByPincode': STUDENT_VIEW,
  'student-photo-handler.get': STUDENT_VIEW,
  'student-guardian-handler.list': STUDENT_VIEW,
  'student-address-handler.list': STUDENT_VIEW,
  'student-sibling-handler.list': STUDENT_VIEW,

  // writes
  'student-admin-handler.create': STUDENT_MANAGE,
  'student-admin-handler.update': STUDENT_MANAGE,
  'student-admin-handler.remove': STUDENT_MANAGE,
  'student-admin-handler.getCredentials': STUDENT_MANAGE,
  'student-admin-handler.resetPassword': STUDENT_MANAGE,
  'house-handler.create': STUDENT_MANAGE,
  'house-handler.update': STUDENT_MANAGE,
  'house-handler.remove': STUDENT_MANAGE,
  'house-handler.setTeachers': STUDENT_MANAGE,
  'house-handler.assign': STUDENT_MANAGE,
  'student-lookup-handler.create': STUDENT_MANAGE,
  'student-lookup-handler.update': STUDENT_MANAGE,
  'student-lookup-handler.remove': STUDENT_MANAGE,
  'student-photo-handler.upload': STUDENT_MANAGE,
  'student-photo-handler.remove': STUDENT_MANAGE,
  'promotion-handler.promote': STUDENT_MANAGE,
  'promotion-handler.promoteClass': STUDENT_MANAGE,
  'promotion-handler.graduate': STUDENT_MANAGE,
  'student-guardian-handler.create': STUDENT_MANAGE,
  'student-guardian-handler.update': STUDENT_MANAGE,
  'student-guardian-handler.remove': STUDENT_MANAGE,
  'student-address-handler.create': STUDENT_MANAGE,
  'student-address-handler.update': STUDENT_MANAGE,
  'student-address-handler.remove': STUDENT_MANAGE,
  'student-sibling-handler.create': STUDENT_MANAGE,
  'student-sibling-handler.remove': STUDENT_MANAGE,
};

// health: readiness probe. student-me-handler.getMe: parent app (family token +
// X-Student-Id) — guarded by guardActiveStudent, not requireAction.
export const STUDENT_PUBLIC: string[] = ['health-handler.health', 'student-me-handler.getMe'];
