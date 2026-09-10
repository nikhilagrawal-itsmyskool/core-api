import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per feedback endpoint, keyed by the `handler:` reference in
// feedback-endpoints.yml (`file.export`). Single naming site for feedback authz.
//
// Rule of thumb: category lookup = feedback.view (teachers need it to record);
// record + assign = feedback.record (teachers); teacher /me respond = feedback.respond;
// director dashboard + complete/reopen = feedback.review (god-only for now).
const { FEEDBACK_VIEW, FEEDBACK_RECORD, FEEDBACK_RESPOND, FEEDBACK_REVIEW } = ACTIONS;

export const FEEDBACK_ACTIONS: Record<string, string> = {
  // Office / director surface
  "feedback-handler.listCategories": FEEDBACK_VIEW,
  "feedback-handler.record": FEEDBACK_RECORD,
  "feedback-handler.notifyVisit": FEEDBACK_RECORD,
  "feedback-handler.list": FEEDBACK_REVIEW,
  "feedback-handler.summary": FEEDBACK_REVIEW,
  "feedback-handler.getById": FEEDBACK_REVIEW,
  "feedback-handler.complete": FEEDBACK_REVIEW,
  "feedback-handler.reopen": FEEDBACK_REVIEW,

  // Teacher PWA surface
  "feedback-me-handler.list": FEEDBACK_RESPOND,
  "feedback-me-handler.getById": FEEDBACK_RESPOND,
  "feedback-me-handler.respond": FEEDBACK_RESPOND,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const FEEDBACK_PUBLIC: string[] = ["health-handler.health"];
