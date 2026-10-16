import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per medical endpoint, keyed by the `handler:` reference in
// medical-endpoints.yml (`file.export`). Single naming site for medical authz — wired at the
// export site of each handler via guard(). Effective permission honours god's live
// grant/revoke overrides (see shared/lib/authz-policy.ts can()).
//
// admin + medical-incharge hold the medical.* wildcard (everything); teachers hold the two
// read leaves (inventory.view + issue.view); god via '*'.
const {
  MEDICAL_INVENTORY_VIEW,
  MEDICAL_INVENTORY_MANAGE,
  MEDICAL_PURCHASE_VIEW,
  MEDICAL_PURCHASE_MANAGE,
  MEDICAL_ISSUE_VIEW,
  MEDICAL_ISSUE_MANAGE,
} = ACTIONS;

export const MEDICAL_ACTIONS: Record<string, string> = {
  // Inventory items + units lookup
  "medical-lookup-handler.getUnits": MEDICAL_INVENTORY_VIEW,
  "medical-item-handler.search": MEDICAL_INVENTORY_VIEW,
  "medical-item-handler.getById": MEDICAL_INVENTORY_VIEW,
  "medical-item-handler.create": MEDICAL_INVENTORY_MANAGE,
  "medical-item-handler.update": MEDICAL_INVENTORY_MANAGE,
  "medical-item-handler.remove": MEDICAL_INVENTORY_MANAGE,

  // Purchases (single)
  "medical-purchase-handler.list": MEDICAL_PURCHASE_VIEW,
  "medical-purchase-handler.getById": MEDICAL_PURCHASE_VIEW,
  "medical-purchase-handler.create": MEDICAL_PURCHASE_MANAGE,
  "medical-purchase-handler.update": MEDICAL_PURCHASE_MANAGE,
  "medical-purchase-handler.remove": MEDICAL_PURCHASE_MANAGE,

  // Purchase batches + bills (bulk intake)
  "medical-purchase-batch-handler.list": MEDICAL_PURCHASE_VIEW,
  "medical-purchase-batch-handler.getById": MEDICAL_PURCHASE_VIEW,
  "medical-purchase-batch-handler.listExpiring": MEDICAL_PURCHASE_VIEW,
  "medical-purchase-batch-handler.getBill": MEDICAL_PURCHASE_VIEW,
  "medical-purchase-batch-handler.createBulk": MEDICAL_PURCHASE_MANAGE,
  "medical-purchase-batch-handler.update": MEDICAL_PURCHASE_MANAGE,
  "medical-purchase-batch-handler.remove": MEDICAL_PURCHASE_MANAGE,
  "medical-purchase-batch-handler.restore": MEDICAL_PURCHASE_MANAGE,
  "medical-purchase-batch-handler.uploadBill": MEDICAL_PURCHASE_MANAGE,
  "medical-purchase-batch-handler.deleteBill": MEDICAL_PURCHASE_MANAGE,

  // Issue log
  "medical-issue-handler.list": MEDICAL_ISSUE_VIEW,
  "medical-issue-handler.getById": MEDICAL_ISSUE_VIEW,
  "medical-issue-handler.create": MEDICAL_ISSUE_MANAGE,
  "medical-issue-handler.update": MEDICAL_ISSUE_MANAGE,
  "medical-issue-handler.remove": MEDICAL_ISSUE_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const MEDICAL_PUBLIC: string[] = ["health-handler.health"];
