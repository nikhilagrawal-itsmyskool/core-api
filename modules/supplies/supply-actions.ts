import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per supplies endpoint, keyed by the `handler:` reference in
// supply-endpoints.yml (`file.export`). Single naming site for supplies authz — wired at the
// export site of each handler via guard(). Effective permission honours god's live grant/revoke
// overrides (see shared/lib/authz-policy.ts can()).
//
// admin + supplies-incharge hold the supplies.* wildcard (everything); teachers hold
// inventory.view + issue.view; god via '*'. Lookups ride inventory.view.
const {
  SUPPLIES_CATEGORY_VIEW,
  SUPPLIES_CATEGORY_MANAGE,
  SUPPLIES_INVENTORY_VIEW,
  SUPPLIES_INVENTORY_MANAGE,
  SUPPLIES_PURCHASE_VIEW,
  SUPPLIES_PURCHASE_MANAGE,
  SUPPLIES_ISSUE_VIEW,
  SUPPLIES_ISSUE_MANAGE,
  SUPPLIES_WASTAGE_VIEW,
  SUPPLIES_WASTAGE_MANAGE,
} = ACTIONS;

export const SUPPLY_ACTIONS: Record<string, string> = {
  // Lookups (reference data)
  "supply-lookup-handler.getUnits": SUPPLIES_INVENTORY_VIEW,
  "supply-lookup-handler.getConditions": SUPPLIES_INVENTORY_VIEW,

  // Categories (setup)
  "supply-category-handler.list": SUPPLIES_CATEGORY_VIEW,
  "supply-category-handler.getById": SUPPLIES_CATEGORY_VIEW,
  "supply-category-handler.create": SUPPLIES_CATEGORY_MANAGE,
  "supply-category-handler.update": SUPPLIES_CATEGORY_MANAGE,
  "supply-category-handler.remove": SUPPLIES_CATEGORY_MANAGE,

  // Inventory items
  "supply-item-handler.search": SUPPLIES_INVENTORY_VIEW,
  "supply-item-handler.getById": SUPPLIES_INVENTORY_VIEW,
  "supply-item-handler.create": SUPPLIES_INVENTORY_MANAGE,
  "supply-item-handler.update": SUPPLIES_INVENTORY_MANAGE,
  "supply-item-handler.remove": SUPPLIES_INVENTORY_MANAGE,
  "supply-item-handler.merge": SUPPLIES_INVENTORY_MANAGE,

  // Purchase batches + bills
  "supply-purchase-batch-handler.list": SUPPLIES_PURCHASE_VIEW,
  "supply-purchase-batch-handler.getById": SUPPLIES_PURCHASE_VIEW,
  "supply-purchase-batch-handler.getBill": SUPPLIES_PURCHASE_VIEW,
  "supply-purchase-batch-handler.createBulk": SUPPLIES_PURCHASE_MANAGE,
  "supply-purchase-batch-handler.update": SUPPLIES_PURCHASE_MANAGE,
  "supply-purchase-batch-handler.remove": SUPPLIES_PURCHASE_MANAGE,
  "supply-purchase-batch-handler.restore": SUPPLIES_PURCHASE_MANAGE,
  "supply-purchase-batch-handler.uploadBill": SUPPLIES_PURCHASE_MANAGE,
  "supply-purchase-batch-handler.deleteBill": SUPPLIES_PURCHASE_MANAGE,

  // Issue log
  "supply-issue-handler.list": SUPPLIES_ISSUE_VIEW,
  "supply-issue-handler.getById": SUPPLIES_ISSUE_VIEW,
  "supply-issue-handler.create": SUPPLIES_ISSUE_MANAGE,
  "supply-issue-handler.update": SUPPLIES_ISSUE_MANAGE,
  "supply-issue-handler.remove": SUPPLIES_ISSUE_MANAGE,
  "supply-issue-handler.returnItem": SUPPLIES_ISSUE_MANAGE,

  // Wastage log
  "supply-wastage-handler.list": SUPPLIES_WASTAGE_VIEW,
  "supply-wastage-handler.getById": SUPPLIES_WASTAGE_VIEW,
  "supply-wastage-handler.getImage": SUPPLIES_WASTAGE_VIEW,
  "supply-wastage-handler.create": SUPPLIES_WASTAGE_MANAGE,
  "supply-wastage-handler.update": SUPPLIES_WASTAGE_MANAGE,
  "supply-wastage-handler.remove": SUPPLIES_WASTAGE_MANAGE,
  "supply-wastage-handler.deleteImage": SUPPLIES_WASTAGE_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const SUPPLY_PUBLIC: string[] = ["health-handler.health"];
