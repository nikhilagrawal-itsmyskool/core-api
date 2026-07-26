// Syllabus module constants (dropdown catalogs + defaults).
// value/label arrays mirror the pattern in transport/fine constants.

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

// Row kinds in a syllabus. `topic` is a taught chapter; the rest are the
// non-topic rows seen on the sheets (senior "Topic:" umbrella = section).
export const ENTRY_TYPES = [
  { value: "topic", label: "Topic" },
  { value: "section", label: "Section Header" },
  { value: "activity", label: "Activity" },
  { value: "revision", label: "Revision" },
  { value: "exam", label: "Examination" },
  { value: "refresher", label: "Refresher" },
  { value: "note", label: "Note" },
] as const;

// Examination terms the sheets split on.
export const TERMS = [
  { value: "half_yearly", label: "Half Yearly" },
  { value: "annual", label: "Annual" },
] as const;

// Print/render layout of a plan (junior single table vs senior grouped).
export const LAYOUTS = [
  { value: "junior", label: "Junior (single table)" },
  { value: "senior", label: "Senior (grouped by topic)" },
] as const;

// Per-section coverage state of an entry.
export const PROGRESS_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "covered", label: "Covered" },
] as const;

// Exams a model-paper set can belong to.
export const EXAMS = [
  { value: "half_yearly", label: "Half Yearly" },
  { value: "annual", label: "Annual" },
] as const;

// The three documents in a model-paper set.
export const DOC_TYPES = [
  { value: "model_paper", label: "Model Paper" },
  { value: "answer_key", label: "Answer Key" },
  { value: "blueprint", label: "Blueprint" },
] as const;

export const MONTH_VALUES = MONTHS.map((m) => m.value);
export const ENTRY_TYPE_VALUES = ENTRY_TYPES.map((e) => e.value);
export const TERM_VALUES = TERMS.map((t) => t.value);
export const LAYOUT_VALUES = LAYOUTS.map((l) => l.value);
export const PROGRESS_STATUS_VALUES = PROGRESS_STATUSES.map((s) => s.value);
export const EXAM_VALUES = EXAMS.map((e) => e.value);
export const DOC_TYPE_VALUES = DOC_TYPES.map((d) => d.value);

export type Month = (typeof MONTH_VALUES)[number];
export type EntryType = (typeof ENTRY_TYPE_VALUES)[number];
export type Term = (typeof TERM_VALUES)[number];
export type Layout = (typeof LAYOUT_VALUES)[number];
export type ProgressStatus = (typeof PROGRESS_STATUS_VALUES)[number];
export type Exam = (typeof EXAM_VALUES)[number];
export type DocType = (typeof DOC_TYPE_VALUES)[number];

export const DEFAULTS = {
  STATUS: "active" as const,
  ENTRY_TYPE: "topic" as EntryType,
  PROGRESS_PENDING: "pending" as ProgressStatus,
  PROGRESS_COVERED: "covered" as ProgressStatus,
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
