import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per employee endpoint, keyed by the `handler:` reference in
// employee-endpoints.yml. Reads (search/list/detail/roles) = employee.view; writes
// (create/update/delete, credential view + reset) = employee.manage; restore = the
// god-only employee.restore. Contact unmasking on search/detail stays row-level
// (revealEmployee in auth-utils) on top of the employee.view gate.
const { EMPLOYEE_VIEW, EMPLOYEE_MANAGE, EMPLOYEE_RESTORE } = ACTIONS;

export const EMPLOYEE_ACTIONS: Record<string, string> = {
  'employee-handler.search': EMPLOYEE_VIEW,
  'employee-handler.listRoles': EMPLOYEE_VIEW,
  'employee-handler.getById': EMPLOYEE_VIEW,
  'employee-handler.create': EMPLOYEE_MANAGE,
  'employee-handler.update': EMPLOYEE_MANAGE,
  'employee-handler.remove': EMPLOYEE_MANAGE,
  'employee-handler.restore': EMPLOYEE_RESTORE,
  'employee-handler.getCredentials': EMPLOYEE_MANAGE,
  'employee-handler.resetPassword': EMPLOYEE_MANAGE,
};

export const EMPLOYEE_PUBLIC: string[] = ['health-handler.health'];
