// Hiring module constants (dropdown catalogs + pipeline logic).
// value/label(/description) arrays mirror the pattern in fine-constants.ts.

export const POSITION_TYPES = [
  { value: 'tgt', label: 'TGT', description: 'Trained Graduate Teacher' },
  { value: 'pgt', label: 'PGT', description: 'Post Graduate Teacher' },
  { value: 'prt', label: 'PRT', description: 'Primary Teacher' },
  { value: 'ntt', label: 'NTT / Non-teaching', description: 'Nursery Teacher Trainer / non-teaching staff' },
] as const;

// Suggested subjects for the dropdown. Not enforced by the DB/handler so an
// "Other" free-text value is also accepted.
export const HIRING_SUBJECTS = [
  { value: 'english', label: 'English' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'sanskrit', label: 'Sanskrit' },
  { value: 'mathematics', label: 'Mathematics' },
  { value: 'science', label: 'Science' },
  { value: 'physics', label: 'Physics' },
  { value: 'chemistry', label: 'Chemistry' },
  { value: 'biology', label: 'Biology' },
  { value: 'social_studies', label: 'Social Studies' },
  { value: 'history', label: 'History' },
  { value: 'geography', label: 'Geography' },
  { value: 'economics', label: 'Economics' },
  { value: 'political_science', label: 'Political Science' },
  { value: 'commerce', label: 'Commerce' },
  { value: 'accountancy', label: 'Accountancy' },
  { value: 'business_studies', label: 'Business Studies' },
  { value: 'computer_science', label: 'Computer Science' },
  { value: 'physical_education', label: 'Physical Education' },
  { value: 'art', label: 'Art' },
  { value: 'music', label: 'Music' },
  { value: 'dance', label: 'Dance' },
  { value: 'evs', label: 'Environmental Studies (EVS)' },
  { value: 'general', label: 'General / Multiple' },
  { value: 'other', label: 'Other' },
] as const;

// Pipeline stage types, in order. Candidate flows through them.
export const STAGE_TYPES = [
  { value: 'resume_screening', label: 'Resume Screening' },
  { value: 'interview_1', label: '1st Interview' },
  { value: 'class_demo', label: 'Class Demo' },
  { value: 'final_round', label: 'Final Round' },
] as const;

// Outcome recorded on each stage.
export const STAGE_OUTCOMES = [
  { value: 'pending', label: 'Pending', description: 'Stage scheduled / awaiting result' },
  { value: 'rejected', label: 'Rejected', description: 'Candidate rejected at this stage' },
  { value: 'moved_to_next', label: 'Moved to Next Round', description: 'Advance to the next stage' },
  { value: 'on_hold', label: 'On Hold', description: 'Decision deferred' },
  { value: 'selected', label: 'Selected', description: 'Candidate selected' },
] as const;

// Overall candidate status. Auto-advanced from stage outcomes; a manual
// override is also allowed via the update endpoint.
export const CANDIDATE_STATUSES = [
  { value: 'applied', label: 'Applied', description: 'Candidate entered, not yet screened' },
  { value: 'screening', label: 'Resume Screening', description: 'Resume under screening' },
  { value: 'interview', label: 'Interview', description: 'In 1st interview stage' },
  { value: 'demo', label: 'Class Demo', description: 'In class demo stage' },
  { value: 'final_round', label: 'Final Round', description: 'In final round' },
  { value: 'selected', label: 'Selected', description: 'Hired / selected' },
  { value: 'rejected', label: 'Rejected', description: 'Not selected' },
  { value: 'on_hold', label: 'On Hold', description: 'Decision deferred' },
  { value: 'withdrawn', label: 'Withdrawn', description: 'Candidate withdrew' },
] as const;

// Final decision recorded in the final-review section.
export const FINAL_DECISIONS = [
  { value: 'selected', label: 'Selected' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'on_hold', label: 'On Hold' },
] as const;

export const POSITION_TYPE_VALUES = POSITION_TYPES.map(p => p.value);
export const STAGE_TYPE_VALUES = STAGE_TYPES.map(s => s.value);
export const STAGE_OUTCOME_VALUES = STAGE_OUTCOMES.map(o => o.value);
export const CANDIDATE_STATUS_VALUES = CANDIDATE_STATUSES.map(s => s.value);
export const FINAL_DECISION_VALUES = FINAL_DECISIONS.map(d => d.value);

export type PositionType = typeof POSITION_TYPE_VALUES[number];
export type StageType = typeof STAGE_TYPE_VALUES[number];
export type StageOutcome = typeof STAGE_OUTCOME_VALUES[number];
export type CandidateStatus = typeof CANDIDATE_STATUS_VALUES[number];
export type FinalDecision = typeof FINAL_DECISION_VALUES[number];

// Ordered pipeline sequence used to drive auto-advance.
export const STAGE_SEQUENCE: StageType[] = [
  'resume_screening',
  'interview_1',
  'class_demo',
  'final_round',
];

// The candidate status that "being in" a given stage represents.
export const STATUS_FOR_STAGE: Record<StageType, CandidateStatus> = {
  resume_screening: 'screening',
  interview_1: 'interview',
  class_demo: 'demo',
  final_round: 'final_round',
};

// Derive the candidate status implied by a stage's outcome.
// Returns null when the outcome should not change candidate status.
export function deriveStatusFromStage(
  stageType: StageType,
  outcome: StageOutcome
): CandidateStatus | null {
  switch (outcome) {
    case 'rejected':
      return 'rejected';
    case 'on_hold':
      return 'on_hold';
    case 'selected':
      return 'selected';
    case 'moved_to_next': {
      const idx = STAGE_SEQUENCE.indexOf(stageType);
      const next = STAGE_SEQUENCE[idx + 1];
      // Advancing past the final stage means the candidate is selected.
      return next ? STATUS_FOR_STAGE[next] : 'selected';
    }
    case 'pending':
      // Reaching a stage moves the candidate into that stage's phase.
      return STATUS_FOR_STAGE[stageType];
    default:
      return null;
  }
}

// Map a final decision to the terminal candidate status.
export const STATUS_FOR_FINAL_DECISION: Record<FinalDecision, CandidateStatus> = {
  selected: 'selected',
  rejected: 'rejected',
  on_hold: 'on_hold',
};

export const DEFAULTS = {
  STATUS: 'applied' as CandidateStatus,
};

// Allowed upload types for photo (image) and resume (image/pdf/doc).
export const PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
export const RESUME_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
];
export const FILE_KINDS = ['photo', 'resume'] as const;
export type FileKind = typeof FILE_KINDS[number];
