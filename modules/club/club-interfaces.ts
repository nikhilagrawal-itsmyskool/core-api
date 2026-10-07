import {
  ActivityAvailability,
  CapabilityBlock,
  ClubStatus,
  VersionStatus,
} from "./club-constants";

// ── Club ────────────────────────────────────────────────────────────────────
export interface CreateClubRequest {
  clubCode: string;
  name: string;
  displayName?: string;
  inChargeEmployeeId?: string | null;
  applicableGrades?: string[];
  status?: ClubStatus;
  sortOrder?: number;
}

export type UpdateClubRequest = Partial<CreateClubRequest>;

export interface ClubView {
  uuid: string;
  clubCode: string;
  name: string;
  displayName?: string;
  inChargeEmployeeId?: string | null;
  inChargeName?: string | null;
  applicableGrades?: string[];
  status: ClubStatus;
  sortOrder?: number;
  activityCount?: number;
  releasedCount?: number;
  config?: ClubConfigView;
}

export interface ClubConfigRequest {
  categories?: string[];
  enabledBlocks?: CapabilityBlock[];
  defaults?: Record<string, unknown>;
  exceptionRules?: Record<string, unknown>;
  trialMode?: boolean;
}
export interface ClubConfigView extends ClubConfigRequest {}

export interface SettingsRequest {
  displayName?: string;
  defaultSlots?: Array<{ start: string; end: string; label?: string }>;
  parallelClubLimit?: number | null;
}

// ── Activity (identity + versioned content) ───────────────────────────────────
// The lean-core content fields (blueprint §12). Mirrors the SRIJAN workbook columns.
export interface VersionContent {
  title: string;
  gradeLevel?: string;
  category?: string;
  difficulty?: string;
  prepBurden?: string;
  activityMode?: string;
  estDuration?: number;
  recommendedSequence?: number;
  learningOutcome?: string;
  teacherPreparation?: string;
  procedure?: string;
  riskSafety?: string;
  safetyLevel?: string;
  assessmentChecklist?: string;
  relatedVocabulary?: string;
  materialsSummary?: string;
  materialQuantityPlan?: string;
  evidenceNote?: string;
  supportEnrichment?: string;
  cleanupStorage?: string;
  minRepeatGapDays?: number;
  metadata?: Record<string, unknown>;
}

export interface MaterialLine {
  item: string;
  quantityNote?: string;
  providedBy?: string;
  consumable?: boolean;
  seq?: number;
}

export interface CreateActivityRequest {
  clubId: string;
  activityCode: string;
  content: VersionContent;
  materials?: MaterialLine[];
}

export type UpdateDraftRequest = Partial<VersionContent>;

export interface ActivityListItem {
  uuid: string;
  activityCode: string;
  clubId: string;
  availability: ActivityAvailability;
  title: string;
  gradeLevel?: string;
  category?: string;
  currentVersionId?: string;
  currentVersionNo?: number;
  currentVersionStatus?: VersionStatus;
  pendingDraftNo?: number;
}

export interface ActivityDetail {
  uuid: string;
  activityCode: string;
  clubId: string;
  availability: ActivityAvailability;
  currentVersion?: VersionView;
  draftVersion?: VersionView;
  versions: VersionSummary[];
}

export interface VersionView extends VersionContent {
  uuid: string;
  versionNo: number;
  status: VersionStatus;
  materials: MaterialLine[];
}

export interface VersionSummary {
  uuid: string;
  versionNo: number;
  status: VersionStatus;
  title: string;
  approvedAt?: string | null;
}

// ── Plan board ────────────────────────────────────────────────────────────────
export interface CreatePlanRequest {
  academicYearId?: string;
  planDate: string; // YYYY-MM-DD
  title?: string;
  participationScope?: "whole" | "grades" | "groups";
  coverage?: "complete" | "selective";
}
export interface UpdatePlanRequest {
  title?: string;
  participationScope?: "whole" | "grades" | "groups";
  coverage?: "complete" | "selective";
  rowVersion: number; // optimistic lock
}
export interface SlotRequest {
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  label?: string;
  seq?: number;
}
export interface GroupRequest {
  sourceType: "class" | "club" | "house" | "mixed" | "selected";
  sourceRef?: string;
  label: string;
  strength?: number;
  seq?: number;
  members?: Array<{ studentId: string; studentName?: string }>;
}
export interface AssignmentRequest {
  slotId: string;
  groupId: string;
  activityVersionId: string;
  teacherEmployeeId?: string;
  venueRef?: string;
  venueName?: string;
}
export interface CompletionRequest {
  outcome: "fully" | "partly" | "not";
  participationAsPlanned?: boolean;
  participationActual?: number;
  issueType?: "none" | "material" | "time" | "venue" | "safety" | "other";
  qualitySignal?: "as-planned" | "minor-change" | "needs-review";
  notConductedReason?: string;
  note?: string;
}
export interface Alert {
  severity: "blocker" | "warning" | "information";
  code: string;
  message: string;
  assignmentId?: string;
  groupId?: string;
}
export interface PlanValidation {
  blockers: Alert[];
  warnings: Alert[];
  info: Alert[];
  coverage: { inScope: number; assigned: number; unassigned: number };
  ready: boolean;
}
