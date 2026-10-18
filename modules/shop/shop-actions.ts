import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per shop endpoint, keyed by the `handler:` reference in
// shop-endpoints.yml (`file.export`). Wired at the export site of each handler via guard().
// admin holds the shop.* wildcard (everything); no teacher access; god via '*'.
const {
  SHOP_INVENTORY_VIEW,
  SHOP_INVENTORY_MANAGE,
  SHOP_PURCHASE_VIEW,
  SHOP_PURCHASE_MANAGE,
  SHOP_SET_VIEW,
  SHOP_SET_MANAGE,
  SHOP_SALE_VIEW,
  SHOP_SALE_MANAGE,
} = ACTIONS;

export const SHOP_ACTIONS: Record<string, string> = {
  "shop-stats-handler.getStats": SHOP_INVENTORY_VIEW,
  "shop-lookup-handler.getLookups": SHOP_INVENTORY_VIEW,

  "shop-item-handler.listItems": SHOP_INVENTORY_VIEW,
  "shop-item-handler.createItem": SHOP_INVENTORY_MANAGE,
  "shop-item-handler.updateItem": SHOP_INVENTORY_MANAGE,
  "shop-item-handler.deleteItem": SHOP_INVENTORY_MANAGE,

  "shop-purchase-handler.list": SHOP_PURCHASE_VIEW,
  "shop-purchase-handler.getById": SHOP_PURCHASE_VIEW,
  "shop-purchase-handler.getBill": SHOP_PURCHASE_VIEW,
  "shop-purchase-handler.create": SHOP_PURCHASE_MANAGE,
  "shop-purchase-handler.remove": SHOP_PURCHASE_MANAGE,
  "shop-purchase-handler.uploadBill": SHOP_PURCHASE_MANAGE,
  "shop-purchase-handler.deleteBill": SHOP_PURCHASE_MANAGE,

  // Set intake (receiving stock) rides the purchase resource.
  "shop-intake-handler.list": SHOP_PURCHASE_VIEW,
  "shop-intake-handler.create": SHOP_PURCHASE_MANAGE,
  "shop-intake-handler.remove": SHOP_PURCHASE_MANAGE,

  "shop-set-handler.list": SHOP_SET_VIEW,
  "shop-set-handler.getById": SHOP_SET_VIEW,
  "shop-set-handler.getStock": SHOP_SET_VIEW,
  "shop-set-handler.listLoose": SHOP_SET_VIEW,
  "shop-set-handler.create": SHOP_SET_MANAGE,
  "shop-set-handler.update": SHOP_SET_MANAGE,
  "shop-set-handler.remove": SHOP_SET_MANAGE,

  "shop-sale-handler.list": SHOP_SALE_VIEW,
  "shop-sale-handler.getById": SHOP_SALE_VIEW,
  "shop-sale-handler.create": SHOP_SALE_MANAGE,
  "shop-sale-handler.assign": SHOP_SALE_MANAGE,
  "shop-sale-handler.assignBulk": SHOP_SALE_MANAGE,
};

// Endpoints intentionally NOT gated: health (authorizer-exempt readiness probe).
export const SHOP_PUBLIC: string[] = ["health-handler.health"];
