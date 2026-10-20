import { MomentStatus, AudienceScope, ReactionEmoji } from "./outreach-constants";

// ---- Image on a photo ----
export interface MomentImageInput {
  fileName: string;
  mimeType: string;
  base64Data: string; // raw base64, no data: URI prefix
}

// ---- Audience ----
export interface AudienceSpec {
  scope: AudienceScope;      // 'school' | 'grade' | 'class'
  refId?: string | null;     // grade label or class uuid; null for 'school'
}

export interface AudienceView extends AudienceSpec {
  label: string;             // human label: "Whole school" / "Class I" / "I-A"
}

// ---- Write requests ----
export interface CreateMomentRequest {
  title?: string;
  body?: string;
  audience: AudienceSpec[];
}

export interface UpdateMomentRequest {
  title?: string;
  body?: string;
  audience?: AudienceSpec[];
}

export interface AddPhotoRequest {
  caption?: string;
  image: MomentImageInput;
}

// Teacher PWA create — audience is forced to the teacher's own class.
export interface TeacherCreateMomentRequest {
  classId: string;
  title?: string;
  body?: string;
}

export interface SetReactionRequest {
  emoji?: ReactionEmoji | null; // null/empty clears the caller's reaction
}

// ---- Read models ----
export interface MomentPhotoView {
  uuid: string;
  caption?: string | null;
  seq: number | null;
  imageUrl?: string | null; // presigned (S3/prod); null in local/Postgres mode
  fileId?: string | null;   // file_storage uuid — fetch base64 via .../photos/{id}/image
}

export interface ReactionSummary {
  counts: Record<string, number>; // emoji token -> count
  total: number;
  mine: string | null;            // the caller's current reaction token, or null
}

export interface MomentView {
  uuid: string;
  title?: string | null;
  body?: string | null;
  status: MomentStatus;
  publishedAt?: string | null;
  authorEmployeeId?: string | null;
  authorName?: string | null;
  audience: AudienceView[];
  photos: MomentPhotoView[];
  reactions: ReactionSummary;
  createdAt?: string | null;
}

// Admin list row (lightweight).
export interface MomentListRow {
  uuid: string;
  title?: string | null;
  status: MomentStatus;
  publishedAt?: string | null;
  authorName?: string | null;
  audience: AudienceView[];
  photoCount: number;
  reactionCount: number;
  createdAt?: string | null;
}

export interface AudienceOptions {
  grades: { grade: string }[];
  classes: { classId: string; name: string; grade: string }[];
}

export interface MyClass {
  classId: string;
  className: string;
}

export interface MomentAuditRow {
  uuid: string;
  action: string;
  detail?: string | null;
  changedbyUserid?: string | null;
  changedbyName?: string | null;
  changedAt?: string | null;
}
