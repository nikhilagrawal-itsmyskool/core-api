// Backend copy of the authorization policy. This is a byte-for-byte port of the
// admin-portal frontend model — keep the two in sync:
//   admin-portal/src/permissions/policy.js   -> ROLE_PERMISSIONS (below)
//   admin-portal/src/permissions/actions.js  -> ACTIONS (below)
//   admin-portal/src/permissions/can.js      -> can() (below)
// A parity test (shared/lib/__tests__/authz-policy.parity.test.ts) fails if they drift.
//
// Model: role -> allowed actions (allow-list; default DENY). Actions are coarse,
// namespaced `module.area.verb` strings.
//   '*'            grants everything (god)
//   'module.*'     grants every action in a module
//   'module.verb'  grants one action
// A user's roles come from the verified JWT `roles` claim; the union of those roles'
// actions is what they may do. Roles are additive (a user can hold several).

// Canonical action catalog (mirror of actions.js ACTIONS). Handlers/manifests should
// reference these constants rather than raw strings so a typo is a compile error.
export const ACTIONS = {
  MEDICAL_VIEW: 'medical.view',
  MEDICAL_MANAGE: 'medical.manage',
  LAB_VIEW: 'lab.view',
  LAB_MANAGE: 'lab.manage',
  FINE_VIEW: 'fine.view',
  FINE_MANAGE: 'fine.manage',
  FEE_VIEW: 'fee.view',
  FEE_MANAGE: 'fee.manage',
  FEE_COLLECT: 'fee.collect',
  // Outside the fee.* namespace on purpose -> fee incharges/clerks DON'T inherit it;
  // only the admin role (explicit grant) + god ('*'). Powers the Scan & Verify tile.
  RECEIPT_VERIFY: 'receipt.verify',
  UNIFORM_VIEW: 'uniform.view',
  UNIFORM_MANAGE: 'uniform.manage',
  SHOP_VIEW: 'shop.view',
  SHOP_MANAGE: 'shop.manage',
  SPORTS_VIEW: 'sports.view',
  SPORTS_MANAGE: 'sports.manage',
  ASSET_VIEW: 'asset.view',
  ASSET_MANAGE: 'asset.manage',
  LIBRARY_VIEW: 'library.view',
  LIBRARY_MANAGE: 'library.manage',
  SUPPLIES_VIEW: 'supplies.view',
  SUPPLIES_MANAGE: 'supplies.manage',
  TIMETABLE_VIEW: 'timetable.view',
  TIMETABLE_PRINT: 'timetable.print',
  TIMETABLE_MANAGE: 'timetable.manage',
  EMPLOYEE_VIEW: 'employee.view',
  EMPLOYEE_MANAGE: 'employee.manage',
  EMPLOYEE_RESTORE: 'employee.restore',
  PURCHASE_LOG_EDIT: 'purchaseLog.edit',
  PURCHASE_LOG_RESTORE: 'purchaseLog.restore',
  STUDENT_VIEW: 'student.view',
  STUDENT_MANAGE: 'student.manage',
  STUDENT_VIEW_CONTACTS: 'student.contacts.view',
  ATTENDANCE_FINALIZE: 'attendance.finalize',
  COMMUNICATION_SEND: 'communication.send',
  COMMUNICATION_TEMPLATE_MANAGE: 'communication.template.manage',
  COMMUNICATION_TEMPLATE_DELETE: 'communication.template.delete',
  HIRING_VIEW: 'hiring.view',
  HIRING_MANAGE: 'hiring.manage',
  TRANSPORT_VIEW: 'transport.view',
  TRANSPORT_MANAGE: 'transport.manage',
  TRANSPORT_ATTENDANCE_MARK: 'transport.attendance.mark',
  TRANSPORT_ATTENDANCE_FINALIZE: 'transport.attendance.finalize',
  TRANSFER_VIEW: 'transfer.view',
  TRANSFER_MANAGE: 'transfer.manage',
  SYLLABUS_VIEW: 'syllabus.view',
  SYLLABUS_MANAGE: 'syllabus.manage',
  SYLLABUS_PROGRESS_MARK: 'syllabus.progress.mark',
  ASSEMBLY_VIEW: 'assembly.view',
  ASSEMBLY_MANAGE: 'assembly.manage',
  HOMEWORK_POST: 'homework.post',
  HOMEWORK_MANAGE: 'homework.manage',
  ASSISTANT_USE: 'assistant.use',
} as const;

// Role -> allowed actions. Mirror of policy.js ROLE_PERMISSIONS (order preserved).
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  god: ['*'],
  admin: [
    'medical.*',
    'lab.*',
    'fine.*',
    'fee.*',
    'uniform.*',
    'shop.*',
    'sports.*',
    'asset.*',
    'library.*',
    'supplies.*',
    'employee.view',
    'employee.manage',
    'timetable.view',
    'timetable.print',
    'student.view',
    'student.manage',
    'student.contacts.view',
    'attendance.mark',
    'attendance.finalize',
    'communication.send',
    'communication.template.manage',
    'hiring.view',
    'hiring.manage',
    'transport.view',
    'transport.manage',
    'transport.attendance.mark',
    'transport.attendance.finalize',
    'transfer.view',
    'transfer.manage',
    'syllabus.view',
    'syllabus.manage',
    'syllabus.progress.mark',
    'assembly.view',
    'assembly.manage',
    'homework.post',
    'homework.manage',
    'receipt.verify', // Scan & Verify (admin + god only; NOT fee incharges)
  ],
  // Standard teaching staff: view-only across the modules they can reach.
  teacher: [
    'sports.view',
    'library.view',
    'supplies.view',
    'timetable.view',
    'student.view',
    'employee.view',
    'syllabus.view',
    'syllabus.progress.mark',
    'assembly.view',
  ],
  // Class teacher: additive to `teacher` — may MARK attendance and POST homework.
  'class-teacher': ['attendance.mark', 'homework.post'],
  // Each in-charge === admin, but scoped to its own module.
  'medical-incharge': ['medical.*'],
  'lab-incharge': ['lab.*'],
  'fees-incharge': ['fee.*'],
  'sports-incharge': ['sports.*'],
  'assets-incharge': ['asset.*'],
  'library-incharge': ['library.*'],
  'supplies-incharge': ['supplies.*'],
  'hiring-incharge': ['hiring.*'],
  'transport-incharge': ['transport.*'],
  'syllabus-incharge': ['syllabus.*'],
  'assembly-incharge': ['assembly.*'],
  // Route-scoped teacher: reach bus-attendance screens + mark, but only on routes
  // they staff (route filtering enforced in the transport handlers); finalize stays
  // admin/god/transport-incharge only.
  'transport-attendance': ['transport.attendance.mark'],
};

// True if any of `roles` grants `action`. Supports '*' and 'module.*' wildcards.
// Verbatim port of admin-portal/src/permissions/can.js — DO NOT refactor.
export function can(roles: string[] | undefined, action: string): boolean {
  const perms = (roles || []).flatMap((r) => ROLE_PERMISSIONS[r] || []);
  return perms.some(
    (p) => p === '*' || p === action || (p.endsWith('.*') && action.startsWith(p.slice(0, -1)))
  );
}
