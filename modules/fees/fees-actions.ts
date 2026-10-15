import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per fees endpoint, keyed by the `handler:` reference in
// fees-endpoints.yml (`file.export`). Single naming site for fees authorization;
// the coverage test asserts every handler in the yml appears here or in FEE_PUBLIC.
//
// module.resource.action, NO fee.* wildcard. Reads = fee.report.view; money = fee.collect.collect;
// each config area is its own manage action (structure/concession/waiver/latefee/transport/student);
// concession.manage (create schemes), waiver/latefee/transport .manage, fine.exempt, migration.import
// are god-only by default — admin/incharge are NOT granted them.
const {
  FEE_REPORT_VIEW, FEE_COLLECT, FEE_STRUCTURE_MANAGE, FEE_CONCESSION_MANAGE, FEE_CONCESSION_ASSIGN,
  FEE_WAIVER_MANAGE, FEE_LATEFEE_MANAGE, FEE_TRANSPORT_MANAGE, FEE_STUDENT_MANAGE, FEE_MANAGER_VIEW,
  FEE_FINE_EXEMPT, FEE_RECEIPT_VERIFY, FEE_MIGRATION_IMPORT,
} = ACTIONS;

export const FEE_ACTIONS: Record<string, string> = {
  // Lookups (dropdown data for fee pages)
  'fees-lookup-handler.lookups': FEE_REPORT_VIEW,

  // Cycles / heads / structure / charge-run → structure.manage
  'fees-cycle-handler.create': FEE_STRUCTURE_MANAGE,
  'fees-cycle-handler.update': FEE_STRUCTURE_MANAGE,
  'fees-cycle-handler.remove': FEE_STRUCTURE_MANAGE,
  'fees-cycle-handler.list': FEE_REPORT_VIEW,

  'fees-head-handler.create': FEE_STRUCTURE_MANAGE,
  'fees-head-handler.update': FEE_STRUCTURE_MANAGE,
  'fees-head-handler.remove': FEE_STRUCTURE_MANAGE,
  'fees-head-handler.list': FEE_REPORT_VIEW,

  'fees-structure-handler.create': FEE_STRUCTURE_MANAGE,
  'fees-structure-handler.update': FEE_STRUCTURE_MANAGE,
  'fees-structure-handler.remove': FEE_STRUCTURE_MANAGE,
  'fees-structure-handler.list': FEE_REPORT_VIEW,
  'fees-structure-handler.bulkApply': FEE_STRUCTURE_MANAGE,
  'fees-structure-handler.copyFromClass': FEE_STRUCTURE_MANAGE,
  'fees-structure-handler.listStudent': FEE_REPORT_VIEW,
  'fees-structure-handler.upsertStudent': FEE_STRUCTURE_MANAGE,
  'fees-structure-handler.removeStudent': FEE_STRUCTURE_MANAGE,

  // Transport slabs → transport.manage (god-only)
  'fees-transport-slab-handler.create': FEE_TRANSPORT_MANAGE,
  'fees-transport-slab-handler.update': FEE_TRANSPORT_MANAGE,
  'fees-transport-slab-handler.remove': FEE_TRANSPORT_MANAGE,
  'fees-transport-slab-handler.list': FEE_REPORT_VIEW,

  // Collection Desk (manager) + per-cycle fine exempt
  'fees-manager-handler.summary': FEE_MANAGER_VIEW,
  'fees-manager-handler.dueStudents': FEE_MANAGER_VIEW,
  'fees-manager-handler.dayCollection': FEE_MANAGER_VIEW,
  'fees-manager-handler.search': FEE_MANAGER_VIEW,
  'fees-manager-handler.studentDues': FEE_MANAGER_VIEW,
  'fees-manager-handler.topDues': FEE_MANAGER_VIEW,
  'fees-manager-handler.exemptFine': FEE_FINE_EXEMPT,

  // Late-fee rules → latefee.manage (god-only); applyPreview/applyRun mutate ledgers
  'fees-late-fee-rule-handler.create': FEE_LATEFEE_MANAGE,
  'fees-late-fee-rule-handler.update': FEE_LATEFEE_MANAGE,
  'fees-late-fee-rule-handler.remove': FEE_LATEFEE_MANAGE,
  'fees-late-fee-rule-handler.list': FEE_REPORT_VIEW,
  'fees-late-fee-rule-handler.applyPreview': FEE_LATEFEE_MANAGE,
  'fees-late-fee-rule-handler.applyRun': FEE_LATEFEE_MANAGE,

  // Concessions: create/edit/delete SCHEMES = concession.manage (god-only);
  // add/remove students + mid-year change = concession.assign (admin/incharge OK)
  'fees-concession-handler.create': FEE_CONCESSION_MANAGE,
  'fees-concession-handler.update': FEE_CONCESSION_MANAGE,
  'fees-concession-handler.remove': FEE_CONCESSION_MANAGE,
  'fees-concession-handler.list': FEE_REPORT_VIEW,
  'fees-concession-handler.multi': FEE_REPORT_VIEW,
  'fees-concession-handler.listStudents': FEE_REPORT_VIEW,
  'fees-concession-handler.addStudents': FEE_CONCESSION_ASSIGN,
  'fees-concession-handler.removeStudent': FEE_CONCESSION_ASSIGN,
  'fees-concession-handler.changeConcession': FEE_CONCESSION_ASSIGN,
  'fees-concession-handler.timeline': FEE_REPORT_VIEW,
  'fees-concession-handler.auditLog': FEE_REPORT_VIEW,

  // Waivers → waiver.manage (god-only)
  'fees-waiver-handler.create': FEE_WAIVER_MANAGE,
  'fees-waiver-handler.remove': FEE_WAIVER_MANAGE,
  'fees-waiver-handler.list': FEE_REPORT_VIEW,

  // Ledger + charge run (charge-run = structure.manage)
  'fees-ledger-handler.studentLedger': FEE_REPORT_VIEW,
  'fees-ledger-handler.studentSummary': FEE_REPORT_VIEW,
  'fees-ledger-handler.chargeRun': FEE_STRUCTURE_MANAGE,

  // Receipts / collection
  'fees-receipt-handler.collect': FEE_COLLECT,
  'fees-receipt-handler.adhoc': FEE_COLLECT,
  'fees-receipt-handler.collectTransport': FEE_COLLECT,
  'fees-receipt-handler.cancel': FEE_COLLECT,
  'fees-receipt-handler.list': FEE_REPORT_VIEW,
  'fees-receipt-handler.getById': FEE_REPORT_VIEW,
  'fees-receipt-handler.print': FEE_REPORT_VIEW,
  'fees-receipt-handler.verifyStaff': FEE_RECEIPT_VERIFY,

  // Refunds
  'fees-refund-handler.create': FEE_COLLECT,
  'fees-refund-handler.list': FEE_REPORT_VIEW,

  // Reports (setFollowup = collector's dues console; withdraw/exam-only cancel = student.manage)
  'fees-report-handler.dailyCollection': FEE_REPORT_VIEW,
  'fees-report-handler.overview': FEE_REPORT_VIEW,
  'fees-report-handler.ungeneratedStudents': FEE_REPORT_VIEW,
  'fees-report-handler.dues': FEE_REPORT_VIEW,
  'fees-report-handler.topDues': FEE_REPORT_VIEW,
  'fees-report-handler.setFollowup': FEE_COLLECT,
  'fees-report-handler.getFollowup': FEE_REPORT_VIEW,
  'fees-report-handler.familyDues': FEE_REPORT_VIEW,
  'fees-report-handler.withdraw': FEE_STUDENT_MANAGE,
  'fees-report-handler.duesByYear': FEE_REPORT_VIEW,
  'fees-report-handler.studentConcessions': FEE_REPORT_VIEW,
  'fees-report-handler.fineExemptions': FEE_REPORT_VIEW,
  'fees-report-handler.examOnlyStudents': FEE_REPORT_VIEW,
  'fees-report-handler.cancelExamOnlyDemands': FEE_STUDENT_MANAGE,

  // Migration (god-only)
  'fees-migration-handler.importData': FEE_MIGRATION_IMPORT,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
//   - fees-receipt-handler.verify: PUBLIC receipt QR verify (authorizer-exempt)
//   - fees-late-fee-rule-handler.nightly: schedule (cron) event, no HTTP / no caller
export const FEE_PUBLIC: string[] = [
  'health-handler.health',
  'fees-receipt-handler.verify',
  'fees-late-fee-rule-handler.nightly',
];
