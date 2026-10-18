import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per fine endpoint, keyed by the `handler:` reference in
// fine-endpoints.yml (`file.export`). Wired at the export site of each handler via guard().
// admin holds the fine.* wildcard (everything); no teacher access; god via '*'.
const {
  FINE_INCIDENT_VIEW,
  FINE_INCIDENT_MANAGE,
  FINE_COLLECTION_VIEW,
  FINE_COLLECTION_MANAGE,
} = ACTIONS;

export const FINE_ACTIONS: Record<string, string> = {
  // Lookups + stats (reference / dashboard reads)
  "fine-stats-handler.getStats": FINE_INCIDENT_VIEW,
  "fine-lookup-handler.getCategories": FINE_INCIDENT_VIEW,
  "fine-lookup-handler.getStatuses": FINE_INCIDENT_VIEW,
  "fine-lookup-handler.getDecisions": FINE_INCIDENT_VIEW,
  "fine-lookup-handler.getPaymentMethods": FINE_INCIDENT_VIEW,

  // Incident lifecycle + evidence + notes (incident resource)
  "fine-incident-handler.list": FINE_INCIDENT_VIEW,
  "fine-incident-handler.getById": FINE_INCIDENT_VIEW,
  "fine-incident-handler.create": FINE_INCIDENT_MANAGE,
  "fine-incident-handler.update": FINE_INCIDENT_MANAGE,
  "fine-incident-handler.remove": FINE_INCIDENT_MANAGE,
  "fine-note-handler.list": FINE_INCIDENT_VIEW,
  "fine-note-handler.create": FINE_INCIDENT_MANAGE,
  "fine-evidence-handler.get": FINE_INCIDENT_VIEW,
  "fine-evidence-handler.upload": FINE_INCIDENT_MANAGE,
  "fine-evidence-handler.remove": FINE_INCIDENT_MANAGE,

  // Collection (collection resource)
  "fine-collection-handler.getReceipt": FINE_COLLECTION_VIEW,
  "fine-collection-handler.listCollections": FINE_COLLECTION_VIEW,
  "fine-collection-handler.collect": FINE_COLLECTION_MANAGE,
};

// Endpoints intentionally NOT gated: health (authorizer-exempt readiness probe).
export const FINE_PUBLIC: string[] = ["health-handler.health"];
