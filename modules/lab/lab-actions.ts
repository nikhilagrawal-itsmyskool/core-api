import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per lab endpoint, keyed by the `handler:` reference in
// lab-endpoints.yml (`file.export`). Single naming site for lab authz — wired at the export
// site of each handler via guard(). Effective permission honours god's live grant/revoke
// overrides (see shared/lib/authz-policy.ts can()).
//
// admin + lab-incharge hold the lab.* wildcard (everything); teachers hold the two read leaves
// (inventory.view + issue.view); god via '*'. Lookups ride inventory.view so a teacher's
// Inventory / Issue screens render their unit/category/type/condition labels.
const {
  LAB_SETUP_VIEW,
  LAB_SETUP_MANAGE,
  LAB_INVENTORY_VIEW,
  LAB_INVENTORY_MANAGE,
  LAB_PURCHASE_VIEW,
  LAB_PURCHASE_MANAGE,
  LAB_ISSUE_VIEW,
  LAB_ISSUE_MANAGE,
  LAB_BREAKAGE_VIEW,
  LAB_BREAKAGE_MANAGE,
} = ACTIONS;

export const LAB_ACTIONS: Record<string, string> = {
  // Lookups (reference data) — readable by any inventory viewer
  "lab-lookup-handler.getUnits": LAB_INVENTORY_VIEW,
  "lab-lookup-handler.getCategories": LAB_INVENTORY_VIEW,
  "lab-lookup-handler.getLabTypes": LAB_INVENTORY_VIEW,
  "lab-lookup-handler.getConditions": LAB_INVENTORY_VIEW,

  // Labs registry (setup resource)
  "lab-handler.list": LAB_SETUP_VIEW,
  "lab-handler.getById": LAB_SETUP_VIEW,
  "lab-handler.create": LAB_SETUP_MANAGE,
  "lab-handler.update": LAB_SETUP_MANAGE,
  "lab-handler.remove": LAB_SETUP_MANAGE,

  // Inventory items
  "lab-item-handler.search": LAB_INVENTORY_VIEW,
  "lab-item-handler.getById": LAB_INVENTORY_VIEW,
  "lab-item-handler.create": LAB_INVENTORY_MANAGE,
  "lab-item-handler.createBulk": LAB_INVENTORY_MANAGE,
  "lab-item-handler.update": LAB_INVENTORY_MANAGE,
  "lab-item-handler.remove": LAB_INVENTORY_MANAGE,

  // Purchases (single)
  "lab-purchase-handler.list": LAB_PURCHASE_VIEW,
  "lab-purchase-handler.getById": LAB_PURCHASE_VIEW,
  "lab-purchase-handler.create": LAB_PURCHASE_MANAGE,
  "lab-purchase-handler.update": LAB_PURCHASE_MANAGE,
  "lab-purchase-handler.remove": LAB_PURCHASE_MANAGE,

  // Purchase batches + bills + alerts
  "lab-purchase-batch-handler.list": LAB_PURCHASE_VIEW,
  "lab-purchase-batch-handler.getById": LAB_PURCHASE_VIEW,
  "lab-purchase-batch-handler.listAlerts": LAB_PURCHASE_VIEW,
  "lab-purchase-batch-handler.getBill": LAB_PURCHASE_VIEW,
  "lab-purchase-batch-handler.createBulk": LAB_PURCHASE_MANAGE,
  "lab-purchase-batch-handler.update": LAB_PURCHASE_MANAGE,
  "lab-purchase-batch-handler.remove": LAB_PURCHASE_MANAGE,
  "lab-purchase-batch-handler.restore": LAB_PURCHASE_MANAGE,
  "lab-purchase-batch-handler.uploadBill": LAB_PURCHASE_MANAGE,
  "lab-purchase-batch-handler.deleteBill": LAB_PURCHASE_MANAGE,

  // Issue log
  "lab-issue-handler.list": LAB_ISSUE_VIEW,
  "lab-issue-handler.getById": LAB_ISSUE_VIEW,
  "lab-issue-handler.create": LAB_ISSUE_MANAGE,
  "lab-issue-handler.update": LAB_ISSUE_MANAGE,
  "lab-issue-handler.remove": LAB_ISSUE_MANAGE,
  "lab-issue-handler.returnItem": LAB_ISSUE_MANAGE,

  // Breakage log
  "lab-breakage-handler.list": LAB_BREAKAGE_VIEW,
  "lab-breakage-handler.getById": LAB_BREAKAGE_VIEW,
  "lab-breakage-handler.getImage": LAB_BREAKAGE_VIEW,
  "lab-breakage-handler.create": LAB_BREAKAGE_MANAGE,
  "lab-breakage-handler.update": LAB_BREAKAGE_MANAGE,
  "lab-breakage-handler.remove": LAB_BREAKAGE_MANAGE,
  "lab-breakage-handler.deleteImage": LAB_BREAKAGE_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const LAB_PUBLIC: string[] = ["health-handler.health"];
