import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per uniform endpoint, keyed by the `handler:` reference in
// uniform-endpoints.yml (`file.export`). Wired at the export site of each handler via guard().
// admin holds the uniform.* wildcard (everything); no teacher access; god via '*'.
const {
  UNIFORM_INVENTORY_VIEW,
  UNIFORM_INVENTORY_MANAGE,
  UNIFORM_PURCHASE_VIEW,
  UNIFORM_PURCHASE_MANAGE,
  UNIFORM_SET_VIEW,
  UNIFORM_SET_MANAGE,
  UNIFORM_SALE_VIEW,
  UNIFORM_SALE_MANAGE,
} = ACTIONS;

export const UNIFORM_ACTIONS: Record<string, string> = {
  "uniform-stats-handler.getStats": UNIFORM_INVENTORY_VIEW,
  "uniform-lookup-handler.getLookups": UNIFORM_INVENTORY_VIEW,

  "uniform-item-handler.listItems": UNIFORM_INVENTORY_VIEW,
  "uniform-item-handler.createItem": UNIFORM_INVENTORY_MANAGE,
  "uniform-item-handler.updateItem": UNIFORM_INVENTORY_MANAGE,
  "uniform-item-handler.deleteItem": UNIFORM_INVENTORY_MANAGE,
  "uniform-item-handler.createSize": UNIFORM_INVENTORY_MANAGE,
  "uniform-item-handler.updateSize": UNIFORM_INVENTORY_MANAGE,
  "uniform-item-handler.deleteSize": UNIFORM_INVENTORY_MANAGE,

  "uniform-purchase-handler.list": UNIFORM_PURCHASE_VIEW,
  "uniform-purchase-handler.getById": UNIFORM_PURCHASE_VIEW,
  "uniform-purchase-handler.getBill": UNIFORM_PURCHASE_VIEW,
  "uniform-purchase-handler.create": UNIFORM_PURCHASE_MANAGE,
  "uniform-purchase-handler.remove": UNIFORM_PURCHASE_MANAGE,
  "uniform-purchase-handler.uploadBill": UNIFORM_PURCHASE_MANAGE,
  "uniform-purchase-handler.deleteBill": UNIFORM_PURCHASE_MANAGE,

  "uniform-set-handler.list": UNIFORM_SET_VIEW,
  "uniform-set-handler.getById": UNIFORM_SET_VIEW,
  "uniform-set-handler.expandSet": UNIFORM_SET_VIEW,
  "uniform-set-handler.create": UNIFORM_SET_MANAGE,
  "uniform-set-handler.update": UNIFORM_SET_MANAGE,
  "uniform-set-handler.remove": UNIFORM_SET_MANAGE,

  "uniform-sale-handler.list": UNIFORM_SALE_VIEW,
  "uniform-sale-handler.getById": UNIFORM_SALE_VIEW,
  "uniform-sale-handler.getReturnEvidence": UNIFORM_SALE_VIEW,
  "uniform-sale-handler.create": UNIFORM_SALE_MANAGE,
  "uniform-sale-handler.addPayment": UNIFORM_SALE_MANAGE,
  "uniform-sale-handler.createReturn": UNIFORM_SALE_MANAGE,
};

// Endpoints intentionally NOT gated: health (authorizer-exempt readiness probe).
export const UNIFORM_PUBLIC: string[] = ["health-handler.health"];
