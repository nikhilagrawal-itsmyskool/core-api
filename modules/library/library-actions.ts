import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per library endpoint, keyed by the `handler:` reference in
// library-endpoints.yml (`file.export`). Single naming site for library authz — wired at the
// export site of each handler via guard(). Effective permission honours god's live grant/revoke
// overrides (see shared/lib/authz-policy.ts can()).
//
// admin + library-incharge hold the library.* wildcard (everything); teachers hold catalog.view
// (browse the catalog); god via '*'. Lookup reads ride catalog.view (needed while cataloguing);
// lookup writes are config (the per-school master).
const {
  LIBRARY_CATALOG_VIEW,
  LIBRARY_CATALOG_MANAGE,
  LIBRARY_CIRCULATION_VIEW,
  LIBRARY_CIRCULATION_MANAGE,
  LIBRARY_FINE_VIEW,
  LIBRARY_FINE_MANAGE,
  LIBRARY_CONFIG_VIEW,
  LIBRARY_CONFIG_MANAGE,
} = ACTIONS;

export const LIBRARY_ACTIONS: Record<string, string> = {
  // Catalog — works + titles + copies + labels (catalog resource)
  "library-work-handler.catalog": LIBRARY_CATALOG_VIEW,
  "library-work-handler.search": LIBRARY_CATALOG_VIEW,
  "library-work-handler.getWork": LIBRARY_CATALOG_VIEW,
  "library-work-handler.getTitle": LIBRARY_CATALOG_VIEW,
  "library-work-handler.createWork": LIBRARY_CATALOG_MANAGE,
  "library-work-handler.updateWork": LIBRARY_CATALOG_MANAGE,
  "library-work-handler.addTitle": LIBRARY_CATALOG_MANAGE,
  "library-work-handler.updateTitle": LIBRARY_CATALOG_MANAGE,
  "library-copy-handler.listByTitle": LIBRARY_CATALOG_VIEW,
  "library-copy-handler.searchCopies": LIBRARY_CATALOG_VIEW,
  "library-copy-handler.getCopy": LIBRARY_CATALOG_VIEW,
  "library-copy-handler.getByAccession": LIBRARY_CATALOG_VIEW,
  "library-copy-handler.addCopies": LIBRARY_CATALOG_MANAGE,
  "library-copy-handler.updateCopy": LIBRARY_CATALOG_MANAGE,
  "library-copy-handler.deleteCopy": LIBRARY_CATALOG_MANAGE,
  "library-label-handler.getLabel": LIBRARY_CATALOG_VIEW,
  "library-label-handler.resolve": LIBRARY_CATALOG_VIEW,

  // Lookups — reads are reference data (catalog.view); writes edit the per-school master (config)
  "library-lookup-handler.getStaticLookups": LIBRARY_CATALOG_VIEW,
  "library-lookup-handler.getDdc": LIBRARY_CATALOG_VIEW,
  "library-lookup-handler.getUsedDdc": LIBRARY_CATALOG_VIEW,
  "library-lookup-handler.getDdcByCode": LIBRARY_CATALOG_VIEW,
  "library-lookup-handler.normalizeAuthor": LIBRARY_CATALOG_VIEW,
  "library-lookup-handler.generateCallNo": LIBRARY_CATALOG_VIEW,
  "library-lookup-handler.isbnLookup": LIBRARY_CATALOG_VIEW,
  "library-lookup-handler.getKeywords": LIBRARY_CATALOG_VIEW,
  "library-lookup-handler.listLookups": LIBRARY_CATALOG_VIEW,
  "library-lookup-handler.createLookup": LIBRARY_CONFIG_MANAGE,
  "library-lookup-handler.updateLookup": LIBRARY_CONFIG_MANAGE,
  "library-lookup-handler.deleteLookup": LIBRARY_CONFIG_MANAGE,

  // Circulation — issue / return / renew (circulation resource)
  "library-circulation-handler.list": LIBRARY_CIRCULATION_VIEW,
  "library-circulation-handler.loans": LIBRARY_CIRCULATION_VIEW,
  "library-circulation-handler.issue": LIBRARY_CIRCULATION_MANAGE,
  "library-circulation-handler.returnBook": LIBRARY_CIRCULATION_MANAGE,
  "library-circulation-handler.renew": LIBRARY_CIRCULATION_MANAGE,

  // Fines — overdue / lost (fine resource)
  "library-fine-handler.list": LIBRARY_FINE_VIEW,
  "library-fine-handler.collect": LIBRARY_FINE_MANAGE,
  "library-fine-handler.waive": LIBRARY_FINE_MANAGE,

  // Circulation policy (config resource)
  "library-policy-handler.get": LIBRARY_CONFIG_VIEW,
  "library-policy-handler.update": LIBRARY_CONFIG_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const LIBRARY_PUBLIC: string[] = ["health-handler.health"];
