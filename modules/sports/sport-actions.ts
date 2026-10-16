import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per sports endpoint, keyed by the `handler:` reference in
// sport-endpoints.yml (`file.export`). Single naming site for sports authz — wired at the
// export site of each handler via guard(). Effective permission honours god's live
// grant/revoke overrides (see shared/lib/authz-policy.ts can()).
//
// admin + sports-incharge hold the sports.* wildcard (everything); teachers hold the two read
// leaves (inventory.view + issue.view); god via '*'. Lookups ride inventory.view so a teacher's
// Inventory / Issue screens render their labels.
const {
  SPORTS_SETUP_VIEW,
  SPORTS_SETUP_MANAGE,
  SPORTS_INVENTORY_VIEW,
  SPORTS_INVENTORY_MANAGE,
  SPORTS_PURCHASE_VIEW,
  SPORTS_PURCHASE_MANAGE,
  SPORTS_ISSUE_VIEW,
  SPORTS_ISSUE_MANAGE,
  SPORTS_BREAKAGE_VIEW,
  SPORTS_BREAKAGE_MANAGE,
} = ACTIONS;

export const SPORT_ACTIONS: Record<string, string> = {
  // Lookups (reference data) — readable by any inventory viewer
  "sport-lookup-handler.getUnits": SPORTS_INVENTORY_VIEW,
  "sport-lookup-handler.getCategories": SPORTS_INVENTORY_VIEW,
  "sport-lookup-handler.getSportTypes": SPORTS_INVENTORY_VIEW,
  "sport-lookup-handler.getConditions": SPORTS_INVENTORY_VIEW,

  // Sport in-charges (setup resource)
  "sport-incharge-handler.list": SPORTS_SETUP_VIEW,
  "sport-incharge-handler.getBySport": SPORTS_SETUP_VIEW,
  "sport-incharge-handler.setForSport": SPORTS_SETUP_MANAGE,

  // Inventory items
  "sport-item-handler.search": SPORTS_INVENTORY_VIEW,
  "sport-item-handler.getById": SPORTS_INVENTORY_VIEW,
  "sport-item-handler.create": SPORTS_INVENTORY_MANAGE,
  "sport-item-handler.update": SPORTS_INVENTORY_MANAGE,
  "sport-item-handler.remove": SPORTS_INVENTORY_MANAGE,

  // Purchases (single)
  "sport-purchase-handler.list": SPORTS_PURCHASE_VIEW,
  "sport-purchase-handler.getById": SPORTS_PURCHASE_VIEW,
  "sport-purchase-handler.create": SPORTS_PURCHASE_MANAGE,
  "sport-purchase-handler.update": SPORTS_PURCHASE_MANAGE,
  "sport-purchase-handler.remove": SPORTS_PURCHASE_MANAGE,

  // Purchase batches + bills
  "sport-purchase-batch-handler.list": SPORTS_PURCHASE_VIEW,
  "sport-purchase-batch-handler.getById": SPORTS_PURCHASE_VIEW,
  "sport-purchase-batch-handler.getBill": SPORTS_PURCHASE_VIEW,
  "sport-purchase-batch-handler.createBulk": SPORTS_PURCHASE_MANAGE,
  "sport-purchase-batch-handler.update": SPORTS_PURCHASE_MANAGE,
  "sport-purchase-batch-handler.remove": SPORTS_PURCHASE_MANAGE,
  "sport-purchase-batch-handler.restore": SPORTS_PURCHASE_MANAGE,
  "sport-purchase-batch-handler.uploadBill": SPORTS_PURCHASE_MANAGE,
  "sport-purchase-batch-handler.deleteBill": SPORTS_PURCHASE_MANAGE,

  // Issue log
  "sport-issue-handler.list": SPORTS_ISSUE_VIEW,
  "sport-issue-handler.getById": SPORTS_ISSUE_VIEW,
  "sport-issue-handler.create": SPORTS_ISSUE_MANAGE,
  "sport-issue-handler.update": SPORTS_ISSUE_MANAGE,
  "sport-issue-handler.remove": SPORTS_ISSUE_MANAGE,
  "sport-issue-handler.returnItem": SPORTS_ISSUE_MANAGE,

  // Breakage log
  "sport-breakage-handler.list": SPORTS_BREAKAGE_VIEW,
  "sport-breakage-handler.getById": SPORTS_BREAKAGE_VIEW,
  "sport-breakage-handler.getImage": SPORTS_BREAKAGE_VIEW,
  "sport-breakage-handler.create": SPORTS_BREAKAGE_MANAGE,
  "sport-breakage-handler.update": SPORTS_BREAKAGE_MANAGE,
  "sport-breakage-handler.remove": SPORTS_BREAKAGE_MANAGE,
  "sport-breakage-handler.deleteImage": SPORTS_BREAKAGE_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const SPORT_PUBLIC: string[] = ["health-handler.health"];
