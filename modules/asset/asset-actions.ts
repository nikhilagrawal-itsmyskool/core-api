import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per asset endpoint, keyed by the `handler:` reference in
// asset-endpoints.yml (`file.export`). Single naming site for asset authz — wired at the export
// site of each handler via guard(). Effective permission honours god's live grant/revoke
// overrides (see shared/lib/authz-policy.ts can()).
//
// admin + assets-incharge hold the asset.* wildcard (everything); no teacher access; god via '*'.
const {
  ASSET_REGISTER_VIEW,
  ASSET_REGISTER_MANAGE,
  ASSET_TYPE_VIEW,
  ASSET_TYPE_MANAGE,
} = ACTIONS;

export const ASSET_ACTIONS: Record<string, string> = {
  // Lookups (reference data)
  "asset-lookup-handler.getTypes": ASSET_REGISTER_VIEW,
  "asset-lookup-handler.getConditions": ASSET_REGISTER_VIEW,
  "asset-lookup-handler.getStatuses": ASSET_REGISTER_VIEW,
  "asset-lookup-handler.getKinds": ASSET_REGISTER_VIEW,

  // Asset-type master (type resource)
  "asset-type-handler.list": ASSET_TYPE_VIEW,
  "asset-type-handler.create": ASSET_TYPE_MANAGE,
  "asset-type-handler.update": ASSET_TYPE_MANAGE,
  "asset-type-handler.remove": ASSET_TYPE_MANAGE,

  // Register: the containment tree, items, counts, responsibility, movements (register resource)
  "asset-handler.getTree": ASSET_REGISTER_VIEW,
  "asset-handler.summary": ASSET_REGISTER_VIEW,
  "asset-handler.counts": ASSET_REGISTER_VIEW,
  "asset-handler.suggestCode": ASSET_REGISTER_VIEW,
  "asset-handler.getByResponsible": ASSET_REGISTER_VIEW,
  "asset-handler.search": ASSET_REGISTER_VIEW,
  "asset-handler.getById": ASSET_REGISTER_VIEW,
  "asset-handler.getResponsibility": ASSET_REGISTER_VIEW,
  "asset-handler.getMovements": ASSET_REGISTER_VIEW,
  "asset-handler.create": ASSET_REGISTER_MANAGE,
  "asset-handler.update": ASSET_REGISTER_MANAGE,
  "asset-handler.remove": ASSET_REGISTER_MANAGE,
  "asset-handler.move": ASSET_REGISTER_MANAGE,
  "asset-handler.individualize": ASSET_REGISTER_MANAGE,
  "asset-handler.setResponsibility": ASSET_REGISTER_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const ASSET_PUBLIC: string[] = ["health-handler.health"];
