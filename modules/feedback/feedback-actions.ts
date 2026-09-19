import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per feedback endpoint, keyed by the `handler:` reference in
// feedback-endpoints.yml (`file.export`). Single naming site for feedback authz.
//
// feedback.view    = category lookup (teachers need it to record)
// feedback.record  = record + assign a home-visit feedback (teachers)
// feedback.respond = teacher /me surface (read own tickets, comment, forward/send back)
// feedback.review  = director dashboard + list/summary + complete/cancel/reopen/assign/comment
//                    on any ticket (god-only for now — the "education director")
const { FEEDBACK_VIEW, FEEDBACK_RECORD, FEEDBACK_RESPOND, FEEDBACK_REVIEW } = ACTIONS;

export const FEEDBACK_ACTIONS: Record<string, string> = {
  // Office / director surface
  "feedback-handler.listCategories": FEEDBACK_VIEW,
  "feedback-handler.record": FEEDBACK_RECORD,
  "feedback-handler.list": FEEDBACK_REVIEW,
  "feedback-handler.grouped": FEEDBACK_REVIEW,
  "feedback-handler.summary": FEEDBACK_REVIEW,
  "feedback-handler.getById": FEEDBACK_REVIEW,
  "feedback-handler.comment": FEEDBACK_REVIEW,
  "feedback-handler.assign": FEEDBACK_REVIEW,
  "feedback-handler.complete": FEEDBACK_REVIEW,
  "feedback-handler.cancel": FEEDBACK_REVIEW,
  "feedback-handler.reopen": FEEDBACK_REVIEW,
  "feedback-handler.seen": FEEDBACK_REVIEW,
  "feedback-handler.getAttachment": FEEDBACK_REVIEW,

  // Teacher PWA surface
  "feedback-me-handler.list": FEEDBACK_RESPOND,
  "feedback-me-handler.getById": FEEDBACK_RESPOND,
  "feedback-me-handler.comment": FEEDBACK_RESPOND,
  "feedback-me-handler.assign": FEEDBACK_RESPOND,
  "feedback-me-handler.seen": FEEDBACK_RESPOND,
  "feedback-me-handler.getAttachment": FEEDBACK_RESPOND,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const FEEDBACK_PUBLIC: string[] = ["health-handler.health"];
