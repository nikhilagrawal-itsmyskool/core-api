import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per hiring endpoint, keyed by the `handler:` reference in
// hiring-endpoints.yml (`file.export`). Wired at the export site of each handler via guard().
// admin + hiring-incharge; no teacher access; god via '*'. One `candidate` resource covers the
// whole pipeline (candidate + stages + files + lookups).
const { HIRING_CANDIDATE_VIEW, HIRING_CANDIDATE_MANAGE } = ACTIONS;

export const HIRING_ACTIONS: Record<string, string> = {
  "hiring-lookup-handler.getLookups": HIRING_CANDIDATE_VIEW,

  "hiring-candidate-handler.list": HIRING_CANDIDATE_VIEW,
  "hiring-candidate-handler.getById": HIRING_CANDIDATE_VIEW,
  "hiring-candidate-handler.create": HIRING_CANDIDATE_MANAGE,
  "hiring-candidate-handler.update": HIRING_CANDIDATE_MANAGE,
  "hiring-candidate-handler.remove": HIRING_CANDIDATE_MANAGE,

  "hiring-stage-handler.create": HIRING_CANDIDATE_MANAGE,
  "hiring-stage-handler.update": HIRING_CANDIDATE_MANAGE,
  "hiring-stage-handler.remove": HIRING_CANDIDATE_MANAGE,

  "hiring-file-handler.get": HIRING_CANDIDATE_VIEW,
  "hiring-file-handler.upload": HIRING_CANDIDATE_MANAGE,
  "hiring-file-handler.remove": HIRING_CANDIDATE_MANAGE,
};

// Endpoints intentionally NOT gated: health (authorizer-exempt readiness probe).
export const HIRING_PUBLIC: string[] = ["health-handler.health"];
