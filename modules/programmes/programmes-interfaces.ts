import { Month, WorkflowStatus, AssessmentBand } from "./programmes-constants";

// ── Master rows ───────────────────────────────────────────────────────────────
export interface Programme {
  uuid: string;
  schoolId: string;
  code: string;
  name: string;
  motto: string | null;
  philosophy: string | null;
  status: string;
}

export interface FieldType {
  uuid: string;
  code: string; // F01..F15
  name: string;
  seq: number;
}

export interface MaterialType {
  uuid: string;
  code: string; // MT01..MT15
  name: string;
}

export interface Domain {
  uuid: string;
  code: string; // D01..D24
  name: string;
}

export interface Skill {
  uuid: string;
  category: string;
  name: string;
}

export interface Stage {
  uuid: string;
  grade: string;
  seq: number;
  developmentalBand: string | null;
  masterFocus: string | null;
  stageEmphasis: string | null;
  assessmentBand: AssessmentBand;
}

// ── Units ─────────────────────────────────────────────────────────────────────
// The 15 field contents keyed by field code, e.g. { "F01": "...", "F04": "..." }.
export type UnitFields = Record<string, string>;

export interface ProgrammeUnit {
  uuid: string;
  schoolId: string;
  programmeId: string;
  academicYearId: string;
  grade: string;
  month: Month;
  title: string;
  programmeFocus: string | null;
  primaryDomainId: string | null;
  fields: UnitFields | null;
  focusSkillIds: string[] | null;
  workflowStatus: WorkflowStatus;
  version: number;
  sourceFileId: string | null;
  status: string;
}

export interface CreateUnitRequest {
  programmeCode: string;
  academicYearId?: string;
  grade: string;
  month: Month;
  title: string;
  programmeFocus?: string;
  primaryDomainId?: string;
  fields?: UnitFields;
  focusSkillIds?: string[];
  workflowStatus?: WorkflowStatus;
}

export interface UpdateUnitRequest {
  title?: string;
  programmeFocus?: string;
  primaryDomainId?: string | null;
  fields?: UnitFields;
  focusSkillIds?: string[];
  workflowStatus?: WorkflowStatus;
}

// The resolved teacher page: field labels + ordering come from the field-type
// master, focus-skill names from the skill master, so the client renders directly.
export interface TeachField {
  code: string;
  name: string;
  content: string;
}

export interface TeachView {
  programme: { code: string; name: string; motto: string | null };
  academicYearId: string | null;
  grade: string;
  month: Month;
  monthLabel: string;
  unit: {
    uuid: string;
    title: string;
    programmeFocus: string | null;
    workflowStatus: WorkflowStatus;
    primaryDomain: { code: string; name: string } | null;
    focusSkills: { name: string; category: string }[];
    fields: TeachField[];
  } | null;
}

// ── Source documents ────────────────────────────────────────────────────────
export interface SourceDoc {
  uuid: string;
  grade: string;
  version: number;
  fileId: string | null;
  fileName?: string | null;
  updatedAt?: Date | null;
}
