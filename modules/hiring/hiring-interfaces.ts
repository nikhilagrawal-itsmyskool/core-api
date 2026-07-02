import {
  CandidateStatus,
  FinalDecision,
  PositionType,
  StageOutcome,
  StageType,
} from './hiring-constants';

export interface BaseEntity {
  uuid: string;
  schoolId: string;
  createdbyUserid: string;
  createdAt: Date;
  updatedbyUserid?: string;
  updatedAt?: Date;
}

// ── Candidate ──────────────────────────────────────────────────────────────

export interface HiringCandidate extends BaseEntity {
  name: string;
  fatherHusbandName?: string;
  positionType: PositionType;
  subject?: string;
  mobile?: string;
  email?: string;
  photoFileId?: string;
  resumeFileId?: string;
  status: CandidateStatus;
  finalComments?: string;
  salaryRequested?: number;
  salaryOffered?: number;
  finalDecision?: FinalDecision;
}

export interface HiringCandidateDetail extends HiringCandidate {
  stages: HiringStage[];
}

export interface CreateCandidateRequest {
  name: string;
  fatherHusbandName?: string;
  positionType: PositionType;
  subject?: string;
  mobile?: string;
  email?: string;
}

export interface UpdateCandidateRequest {
  name?: string;
  fatherHusbandName?: string;
  positionType?: PositionType;
  subject?: string;
  mobile?: string;
  email?: string;
  status?: CandidateStatus; // manual override
  finalComments?: string;
  salaryRequested?: number | null;
  salaryOffered?: number | null;
  finalDecision?: FinalDecision | null;
}

export interface ListCandidatesParams {
  schoolId: string;
  status?: string[];
  positionType?: string;
  subject?: string;
  search?: string; // name / mobile / email
}

// ── Stage ──────────────────────────────────────────────────────────────────

export interface HiringStage extends BaseEntity {
  candidateId: string;
  stageType: StageType;
  scheduledDate?: Date;
  outcome: StageOutcome;
  comments?: string;
}

export interface CreateStageRequest {
  stageType: StageType;
  scheduledDate?: string; // ISO date string
  outcome?: StageOutcome; // defaults to 'pending'
  comments?: string;
}

export interface UpdateStageRequest {
  scheduledDate?: string | null;
  outcome?: StageOutcome;
  comments?: string;
}

// ── Files (photo / resume via shared file_storage) ───────────────────────────

export interface UploadFileRequest {
  kind: 'photo' | 'resume';
  fileName: string;
  mimeType: string;
  base64Data: string;
}

export interface HiringFileMeta {
  uuid: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface HiringFileWithData extends HiringFileMeta {
  data: string; // base64
}
