// Feedback / complaint module constants — open-routing ticketing model.

// Lifecycle:
//   open       -> live; being worked/routed among staff (teacher or director).
//                 Current owner = feedback.assigned_to. "Awaiting the director" is derived
//                 (open AND the owner holds a reviewer role) — not a stored status.
//   completed  -> the director resolved & closed it (satisfied). Terminal.
//   cancelled  -> recorded in error / duplicate / withdrawn. Terminal.
// A completed/cancelled ticket can be reopened (-> open).
export const FEEDBACK_STATUSES = ["open", "completed", "cancelled"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

// Timeline event types (feedback_event.event_type).
//   record   -> ticket created (carries evidence files)
//   comment  -> status-neutral note (may carry @mentions + files)
//   assign   -> owner changed (forward / send back); comment mandatory unless the actor is god
//   complete -> director closed it (satisfied)
//   cancel   -> director voided it
//   reopen   -> director revived a terminal ticket (-> open)
export const EVENT_TYPES = ["record", "comment", "assign", "complete", "reopen", "cancel"] as const;
export type FeedbackEventType = (typeof EVENT_TYPES)[number];

export const CATEGORY_STATUSES = ["active", "deleted"] as const;

// Category taxonomy seeded on first use (per school; schools can add their own later).
export interface CategorySeed {
  name: string;
  sortOrder: number;
}
export const CATEGORY_SEED: CategorySeed[] = [
  { name: "Academic", sortOrder: 1 },
  { name: "Behaviour", sortOrder: 2 },
  { name: "Attendance", sortOrder: 3 },
  { name: "Health", sortOrder: 4 },
  { name: "Fees", sortOrder: 5 },
  { name: "Other", sortOrder: 9 },
];

// Evidence / comment attachments — bytes live in the shared file_storage table keyed by
// entity_type='feedback' + entity_id = the owning feedback_event uuid.
export const FILE_ENTITY_TYPE = "feedback";
export const ATTACHMENT_MAX_BYTES = 8 * 1024 * 1024; // 8 MB per file
export const ATTACHMENT_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

// Notification keys (consumed by the communication in-app inbox). The admin-portal bell
// deep-links any key starting with "feedback" (and prefers entityType/entityId when set).
export const NOTIFY = {
  ASSIGNED: "feedback_assigned",     // -> new owner (+ watchers) on record / assign
  COMMENTED: "feedback_commented",   // -> watchers on a new comment
  MENTIONED: "feedback_mentioned",   // -> the @mentioned people (stronger ping)
  COMPLETED: "feedback_completed",   // -> watchers on complete
  CANCELLED: "feedback_cancelled",   // -> watchers on cancel
  REOPENED: "feedback_reopened",     // -> new owner (+ watchers) on reopen
} as const;

// Entity type used when linking a notification back to a ticket (drives bell deep-link).
export const NOTIFY_ENTITY_TYPE = "feedback";

// Roles that review + complete/cancel/reopen feedback (the "education director"). GOD-ONLY
// for now by decision. Single flip point: introduce an `education-director` role, grant it
// feedback.review in authz-policy, and add its code here so it becomes a reviewer.
export const REVIEWER_ROLE_CODES = ["god"] as const;
