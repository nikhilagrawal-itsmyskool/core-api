import { FeedbackStatus, FeedbackEventType } from "./feedback-constants";

// ---- Category ----
export interface FeedbackCategoryView {
  uuid: string;
  name: string;
  sortOrder: number | null;
  status: string;
}

// ---- Attachments ----
export interface AttachmentInput {
  fileName: string;
  mimeType: string;
  base64Data: string; // raw base64, no data: URI prefix
}

export interface AttachmentMeta {
  fileId: string; // file_storage uuid
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
}

// ---- Write requests ----
export interface RecordFeedbackRequest {
  studentId: string;
  classId?: string;
  academicYearId?: string;
  categoryId: string;
  feedbackText: string;
  visitDate?: string; // YYYY-MM-DD, defaults to today (IST)
  assignedTo: string; // employee uuid the ticket is first assigned to
  attachments?: AttachmentInput[]; // evidence from the visit
}

export interface CommentRequest {
  body: string;
  mentions?: string[]; // employee uuids @mentioned
  attachments?: AttachmentInput[];
}

export interface AssignRequest {
  toEmployeeId: string;
  comment?: string; // mandatory for non-god actors (enforced in the service)
  mentions?: string[];
  attachments?: AttachmentInput[];
}

export interface ReviewRequest {
  note?: string;
  toEmployeeId?: string; // optional reassign target on reopen
}

// ---- Read models ----
export interface FeedbackView {
  uuid: string;
  academicYearId: string | null;
  studentId: string;
  studentName: string | null;
  admissionNumber: string | null;
  classId: string | null;
  className: string | null;
  categoryId: string | null;
  categoryName: string | null;
  feedbackText: string;
  visitDate: string | null;
  assignedTo: string;
  assignedToName: string | null;
  awaitingDirector: boolean; // open AND current owner holds a reviewer role
  recordedBy: string | null;
  recordedByName: string | null;
  status: FeedbackStatus;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: string | null;
  lastActivityAt: string | null;
  createdAt: string | null;
  // Present on the /me and dashboard list rows (per-caller):
  unread?: boolean;
}

export interface MentionRef {
  id: string;
  name: string | null;
}

export interface TimelineEventView {
  uuid: string;
  eventType: FeedbackEventType;
  actorId: string | null;
  actorName: string | null;
  body: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  fromAssignee: string | null;
  fromAssigneeName: string | null;
  toAssignee: string | null;
  toAssigneeName: string | null;
  mentions: MentionRef[];
  attachments: AttachmentMeta[];
  createdAt: string | null;
}

export interface WatcherView {
  employeeId: string;
  employeeName: string | null;
  muted: boolean;
  lastSeenAt: string | null;
}

// The full ticket-thread payload.
export interface FeedbackThread extends FeedbackView {
  events: TimelineEventView[];
  watchers: WatcherView[];
}

// Director dashboard rollup.
export interface TeacherBreakupRow {
  employeeId: string;
  employeeName: string | null;
  open: number;       // open tickets currently owned by this teacher
  completed: number;
  total: number;
  oldestOpenAt: string | null; // last_activity/created of the oldest open ticket (for aging)
}

export interface FeedbackSummary {
  byStatus: { open: number; completed: number; cancelled: number };
  open: number;
  awaitingDirector: number; // open tickets whose owner is a reviewer
  outWithTeachers: number;  // open tickets whose owner is not a reviewer
  byTeacher: TeacherBreakupRow[];
}
