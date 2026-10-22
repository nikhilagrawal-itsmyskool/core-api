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
  thumb?: MomentImageInput; // optional small variant (~320px) for list covers; saves data
}

// ---- Video (YouTube link) ----
export interface AddVideoRequest {
  url: string;       // any YouTube URL (watch / youtu.be / shorts / embed)
  caption?: string;
}

// ---- Schedule ----
export interface ScheduleRequest {
  publishAt: string; // ISO datetime (UTC); auto-publishes at that moment
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

export interface MomentVideoView {
  uuid: string;
  youtubeId: string;
  url?: string | null;
  caption?: string | null;
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
  publishAt?: string | null;   // scheduled publish time (set + still draft = "scheduled")
  scheduled?: boolean;         // convenience: draft with a future publishAt
  authorEmployeeId?: string | null;
  authorName?: string | null;
  audience: AudienceView[];
  photos: MomentPhotoView[];
  videos: MomentVideoView[];
  reactions: ReactionSummary;
  createdAt?: string | null;
}

// Admin list row (lightweight).
export interface MomentListRow {
  uuid: string;
  title?: string | null;
  coverUrl?: string | null;   // first photo's presigned URL (null in local/Postgres mode)
  status: MomentStatus;
  publishedAt?: string | null;
  publishAt?: string | null;
  scheduled?: boolean;
  authorName?: string | null;
  audience: AudienceView[];
  photoCount: number;
  videoCount: number;
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
