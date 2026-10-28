import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per employee endpoint, keyed by the `handler:` reference in
// employee-endpoints.yml. Reads (search/list/detail/roles) = employee.view; writes
// (create/update/delete, credential view + reset) = employee.manage; restore = the
// god-only employee.restore. Contact unmasking on search/detail stays row-level
// (revealEmployee in auth-utils) on top of the employee.view gate.
const { EMPLOYEE_VIEW, EMPLOYEE_MANAGE, EMPLOYEE_RESTORE, EMPLOYEE_SESSION_RESET, EMPLOYEE_CONFIG_MANAGE, DOCUMENTS_HANDBOOK_MANAGE } = ACTIONS;

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
  // Force re-login is a stronger, god-only control (NOT part of employee.manage).
  'employee-handler.forceReLogin': EMPLOYEE_SESSION_RESET,
  // Employee config: reading is open to employee viewers (so the UI can gate buttons);
  // changing it is god-only (employee.config.manage).
  'employee-handler.getConfig': EMPLOYEE_VIEW,
  'employee-handler.updateConfig': EMPLOYEE_CONFIG_MANAGE,
  // Employee photo: view with the record; upload/remove with manage (same as other fields).
  'employee-photo-handler.get': EMPLOYEE_VIEW,
  'employee-photo-handler.upload': EMPLOYEE_MANAGE,
  'employee-photo-handler.remove': EMPLOYEE_MANAGE,
  // Staff document handbook — authoring surface (incl. the god-console reads list/get/docPdf,
  // which previously resolved school only). All god-first via documents.handbook.manage.
  'document-handler.list': DOCUMENTS_HANDBOOK_MANAGE,
  'document-handler.get': DOCUMENTS_HANDBOOK_MANAGE,
  'document-handler.create': DOCUMENTS_HANDBOOK_MANAGE,
  'document-handler.update': DOCUMENTS_HANDBOOK_MANAGE,
  'document-handler.remind': DOCUMENTS_HANDBOOK_MANAGE,
  'document-handler.archive': DOCUMENTS_HANDBOOK_MANAGE,
  'document-handler.acks': DOCUMENTS_HANDBOOK_MANAGE,
  'document-handler.ackArtifact': DOCUMENTS_HANDBOOK_MANAGE,
  'document-handler.docPdf': DOCUMENTS_HANDBOOK_MANAGE,
};

// NOT gated by requireAction:
//   - health: readiness probe
//   - document-handler.my*: the employee's own read-&-sign surface (resolveEmployee → own
//     identity from the token; every staff member signs their own docs). Self-service.
export const EMPLOYEE_PUBLIC: string[] = [
  'health-handler.health',
  'document-handler.myList',
  'document-handler.myGet',
  'document-handler.myAcknowledge',
  'document-handler.myUploadSigned',
  'document-handler.myDocPdf',
  'document-handler.myArtifact',
];
