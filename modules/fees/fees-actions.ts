import { ACTIONS } from '../../shared/lib/authz-policy';

// Required permission per fees endpoint, keyed by the `handler:` reference in
// fees-endpoints.yml (`file.export`). This is the single naming site for fees
// authorization; the coverage test (fees-authz.coverage.test.ts) asserts every
// handler in the yml appears here or in FEE_PUBLIC.
//
// Rule of thumb: reads = fee.view, config writes = fee.manage, taking money =
// fee.collect, Scan & Verify = receipt.verify (admin/god only, NOT fee incharges).
const { FEE_VIEW, FEE_MANAGE, FEE_COLLECT, RECEIPT_VERIFY } = ACTIONS;

// God-only: bulk historical import must never be reachable by an ordinary admin. No
// role grants this string, so only god ('*') passes.
const MIGRATION_IMPORT = 'migration.import';

export const FEE_ACTIONS: Record<string, string> = {
  // Lookups (dropdown data for fee pages)
  'fees-lookup-handler.lookups': FEE_VIEW,

  // Cycles
  'fees-cycle-handler.create': FEE_MANAGE,
  'fees-cycle-handler.update': FEE_MANAGE,
  'fees-cycle-handler.remove': FEE_MANAGE,
  'fees-cycle-handler.list': FEE_VIEW,

  // Heads
  'fees-head-handler.create': FEE_MANAGE,
  'fees-head-handler.update': FEE_MANAGE,
  'fees-head-handler.remove': FEE_MANAGE,
  'fees-head-handler.list': FEE_VIEW,

  // Structure
  'fees-structure-handler.create': FEE_MANAGE,
  'fees-structure-handler.update': FEE_MANAGE,
  'fees-structure-handler.remove': FEE_MANAGE,
  'fees-structure-handler.list': FEE_VIEW,
  'fees-structure-handler.bulkApply': FEE_MANAGE,
  'fees-structure-handler.copyFromClass': FEE_MANAGE,
  'fees-structure-handler.listStudent': FEE_VIEW,
  'fees-structure-handler.upsertStudent': FEE_MANAGE,
  'fees-structure-handler.removeStudent': FEE_MANAGE,

  // Transport slabs
  'fees-transport-slab-handler.create': FEE_MANAGE,
  'fees-transport-slab-handler.update': FEE_MANAGE,
  'fees-transport-slab-handler.remove': FEE_MANAGE,
  'fees-transport-slab-handler.list': FEE_VIEW,

  // Late-fee rules (applyPreview/applyRun mutate ledgers → manage)
  'fees-late-fee-rule-handler.create': FEE_MANAGE,
  'fees-late-fee-rule-handler.update': FEE_MANAGE,
  'fees-late-fee-rule-handler.remove': FEE_MANAGE,
  'fees-late-fee-rule-handler.list': FEE_VIEW,
  'fees-late-fee-rule-handler.applyPreview': FEE_MANAGE,
  'fees-late-fee-rule-handler.applyRun': FEE_MANAGE,

  // Concessions
  'fees-concession-handler.create': FEE_MANAGE,
  'fees-concession-handler.update': FEE_MANAGE,
  'fees-concession-handler.remove': FEE_MANAGE,
  'fees-concession-handler.list': FEE_VIEW,
  'fees-concession-handler.multi': FEE_VIEW,
  'fees-concession-handler.listStudents': FEE_VIEW,
  'fees-concession-handler.addStudents': FEE_MANAGE,
  'fees-concession-handler.removeStudent': FEE_MANAGE,

  // Waivers
  'fees-waiver-handler.create': FEE_MANAGE,
  'fees-waiver-handler.remove': FEE_MANAGE,
  'fees-waiver-handler.list': FEE_VIEW,

  // Ledger + charge run
  'fees-ledger-handler.studentLedger': FEE_VIEW,
  'fees-ledger-handler.studentSummary': FEE_VIEW,
  'fees-ledger-handler.chargeRun': FEE_MANAGE,

  // Receipts / collection
  'fees-receipt-handler.collect': FEE_COLLECT,
  'fees-receipt-handler.adhoc': FEE_COLLECT,
  'fees-receipt-handler.collectTransport': FEE_COLLECT,
  'fees-receipt-handler.cancel': FEE_COLLECT,
  'fees-receipt-handler.list': FEE_VIEW,
  'fees-receipt-handler.getById': FEE_VIEW,
  'fees-receipt-handler.print': FEE_VIEW,
  'fees-receipt-handler.verifyStaff': RECEIPT_VERIFY,

  // Refunds
  'fees-refund-handler.create': FEE_COLLECT,
  'fees-refund-handler.list': FEE_VIEW,

  // Reports (setFollowup is part of the collector's dues console; withdraw changes
  // a student's fee status → manage)
  'fees-report-handler.dailyCollection': FEE_VIEW,
  'fees-report-handler.overview': FEE_VIEW,
  'fees-report-handler.ungeneratedStudents': FEE_VIEW,
  'fees-report-handler.dues': FEE_VIEW,
  'fees-report-handler.setFollowup': FEE_COLLECT,
  'fees-report-handler.getFollowup': FEE_VIEW,
  'fees-report-handler.familyDues': FEE_VIEW,
  'fees-report-handler.withdraw': FEE_MANAGE,
  'fees-report-handler.duesByYear': FEE_VIEW,
  'fees-report-handler.studentConcessions': FEE_VIEW,
  'fees-report-handler.fineExemptions': FEE_VIEW,

  // Migration (god-only)
  'fees-migration-handler.importData': MIGRATION_IMPORT,
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
