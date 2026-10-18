import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per programmes endpoint, keyed by the `handler:` reference in
// programmes-endpoints.yml (`file.export`). Wired at the export site via guard().
//
// unit.view  = all reads: lookups, grades, programme catalog list/getByCode, unit list/getById.
// unit.manage = edit the programme definition + unit CRUD (create/update/remove).
// unit.teach = mark a unit taught (every teacher conducting the programme).
// source.view/manage = class-module reference docs (list/download vs upload).
// programme.config.manage has NO endpoint — it only gates the SelcSettings screen in the portal.
const {
  PROGRAMME_UNIT_VIEW, PROGRAMME_UNIT_MANAGE, PROGRAMME_UNIT_TEACH,
  PROGRAMME_SOURCE_VIEW, PROGRAMME_SOURCE_MANAGE,
} = ACTIONS;

export const PROGRAMME_ACTIONS: Record<string, string> = {
  // Lookups + catalog reads
  "programmes-lookup-handler.getLookups": PROGRAMME_UNIT_VIEW,
  "programmes-lookup-handler.getGrades": PROGRAMME_UNIT_VIEW,
  "programme-handler.list": PROGRAMME_UNIT_VIEW,
  "programme-handler.getByCode": PROGRAMME_UNIT_VIEW,
  "programme-handler.update": PROGRAMME_UNIT_MANAGE,

  // Units
  "programmes-unit-handler.list": PROGRAMME_UNIT_VIEW,
  "programmes-unit-handler.getById": PROGRAMME_UNIT_VIEW,
  "programmes-unit-handler.create": PROGRAMME_UNIT_MANAGE,
  "programmes-unit-handler.update": PROGRAMME_UNIT_MANAGE,
  "programmes-unit-handler.remove": PROGRAMME_UNIT_MANAGE,
  "programmes-unit-handler.teach": PROGRAMME_UNIT_TEACH,

  // Source docs
  "programmes-source-handler.list": PROGRAMME_SOURCE_VIEW,
  "programmes-source-handler.download": PROGRAMME_SOURCE_VIEW,
  "programmes-source-handler.upload": PROGRAMME_SOURCE_MANAGE,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe.
export const PROGRAMME_PUBLIC: string[] = ["health-handler.health"];
