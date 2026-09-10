// Feedback / complaint module constants.

// Lifecycle:
//   assigned   -> recorded by a teacher (home visit) + assigned to a teacher; awaiting that teacher
//   responded  -> the assigned teacher added their comment; awaiting director (god) review
//   completed  -> director reviewed + finalized (terminal)
//   reopened   -> director sent it back to the teacher; behaves like `assigned`
// "Open" is a filter (status <> 'completed'), not a stored state.
export const FEEDBACK_STATUSES = ["assigned", "responded", "completed", "reopened"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

// Statuses that count as "open" for the director dashboard.
export const OPEN_STATUSES = ["assigned", "responded", "reopened"] as const;

// The assigned teacher may still act on these (add / revise their comment).
export const TEACHER_ACTIONABLE = ["assigned", "reopened"] as const;

export const CATEGORY_STATUSES = ["active", "deleted"] as const;

// Category taxonomy seeded on first use (per school; schools can add their own later
// via direct rows — no category-admin UI in v1).
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

// Notification keys (consumed by the communication in-app inbox).
export const NOTIFY = {
  ASSIGNED: "feedback_assigned",     // -> assigned teacher (on record / reassign)
  RESPONDED: "feedback_responded",   // -> reviewers (god) + recorder
  COMPLETED: "feedback_completed",   // -> assigned teacher
  REOPENED: "feedback_reopened",     // -> assigned teacher
} as const;

// Entity type used when linking notifications back to a feedback item.
export const NOTIFY_ENTITY_TYPE = "feedback";

// Roles that review + complete feedback (the "education director"). GOD-ONLY for now
// by decision. This is the single flip point: introduce a real `education-director`
// role (grant it `feedback.review` in authz-policy) and add it here so it can be a
// notification recipient on `respond`.
export const REVIEWER_ROLE_CODES = ["god"] as const;
