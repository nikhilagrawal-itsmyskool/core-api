// Programmes module constants (generic enums + dropdown catalogs).
// The programme-specific vocabulary (field types, material types, domains, skills,
// stages) is DATA — seeded per programme into the master tables (see
// scripts/import-programmes.js and programmes-selc-seed.js), not hardcoded here.

// Academic months in teaching order (session starts in April).
export const MONTHS = [
  { value: "april", label: "April" },
  { value: "may", label: "May" },
  { value: "june", label: "June" },
  { value: "july", label: "July" },
  { value: "august", label: "August" },
  { value: "september", label: "September" },
  { value: "october", label: "October" },
  { value: "november", label: "November" },
  { value: "december", label: "December" },
  { value: "january", label: "January" },
  { value: "february", label: "February" },
  { value: "march", label: "March" },
] as const;

// Content governance lifecycle. Phase 1 operates only draft/published; the
// review/approve gates land in Phase 4 (the enum is stored from day 1).
export const WORKFLOW_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "reviewed", label: "Reviewed" },
  { value: "approved", label: "Approved" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
] as const;

// Assessment bands drive which observation levels are valid for a grade (Phase 3).
export const ASSESSMENT_BANDS = [
  { value: "early", label: "Early Years (Nursery–UKG)" },
  { value: "i_viii", label: "Classes I–VIII" },
  { value: "ix_xii", label: "Classes IX–XII" },
] as const;

export const MONTH_VALUES = MONTHS.map((m) => m.value);
export const WORKFLOW_STATUS_VALUES = WORKFLOW_STATUSES.map((s) => s.value);
export const ASSESSMENT_BAND_VALUES = ASSESSMENT_BANDS.map((b) => b.value);

export type Month = (typeof MONTH_VALUES)[number];
export type WorkflowStatus = (typeof WORKFLOW_STATUS_VALUES)[number];
export type AssessmentBand = (typeof ASSESSMENT_BAND_VALUES)[number];

export const DEFAULTS = {
  STATUS: "active" as const,
  WORKFLOW_DRAFT: "draft" as WorkflowStatus,
  WORKFLOW_PUBLISHED: "published" as WorkflowStatus,
};

// Calendar month number (1=Jan..12=Dec) -> academic month value, for anchoring
// "today" onto the teaching timeline.
export const CALENDAR_TO_MONTH: Record<number, Month> = {
  1: "january",
  2: "february",
  3: "march",
  4: "april",
  5: "may",
  6: "june",
  7: "july",
  8: "august",
  9: "september",
  10: "october",
  11: "november",
  12: "december",
};
