import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per outreach endpoint, keyed by the `handler:` reference in
// outreach-endpoints.yml (`file.export`). Wired at each handler's export site via guard().
//
// outreach-handler = admin/compose (any audience): reads -> moment.view, writes -> moment.manage.
// outreach-me-handler = the class teacher's own-class posting surface (resolveEmployee +
// canPostForClass + own-authored scope) -> moment.post. The parent/student app feed
// (feed/getFeedMoment/setReaction/getFeedPhotoImage) self-authorizes via the student token,
// so it is PUBLIC (not action-gated).
const { OUTREACH_MOMENT_VIEW, OUTREACH_MOMENT_POST, OUTREACH_MOMENT_MANAGE } = ACTIONS;

export const OUTREACH_ACTIONS: Record<string, string> = {
  // Admin / compose (outreach-handler)
  "outreach-handler.listMoments": OUTREACH_MOMENT_VIEW,
  "outreach-handler.getMoment": OUTREACH_MOMENT_VIEW,
  "outreach-handler.getPhotoImage": OUTREACH_MOMENT_VIEW,
  "outreach-handler.getAudit": OUTREACH_MOMENT_VIEW,
  "outreach-handler.audienceOptions": OUTREACH_MOMENT_VIEW,
  "outreach-handler.createMoment": OUTREACH_MOMENT_MANAGE,
  "outreach-handler.updateMoment": OUTREACH_MOMENT_MANAGE,
  "outreach-handler.addPhoto": OUTREACH_MOMENT_MANAGE,
  "outreach-handler.removePhoto": OUTREACH_MOMENT_MANAGE,
  "outreach-handler.publish": OUTREACH_MOMENT_MANAGE,
  "outreach-handler.unpublish": OUTREACH_MOMENT_MANAGE,
  "outreach-handler.addVideo": OUTREACH_MOMENT_MANAGE,
  "outreach-handler.removeVideo": OUTREACH_MOMENT_MANAGE,
  "outreach-handler.schedule": OUTREACH_MOMENT_MANAGE,
  "outreach-handler.unschedule": OUTREACH_MOMENT_MANAGE,

  // Class teacher's own-class posting (outreach-me-handler)
  "outreach-me-handler.myClasses": OUTREACH_MOMENT_POST,
  "outreach-me-handler.posted": OUTREACH_MOMENT_POST,
  "outreach-me-handler.createMoment": OUTREACH_MOMENT_POST,
  "outreach-me-handler.addPhoto": OUTREACH_MOMENT_POST,
  "outreach-me-handler.removePhoto": OUTREACH_MOMENT_POST,
  "outreach-me-handler.publish": OUTREACH_MOMENT_POST,
  "outreach-me-handler.unpublish": OUTREACH_MOMENT_POST,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
//   - me/feed* (feed/getFeedMoment/setReaction/getFeedPhotoImage): parent/student app;
//     self-authorizes via the student token (students carry no roles, so it cannot be gated).
export const OUTREACH_PUBLIC: string[] = [
  "health-handler.health",
  "outreach-me-handler.feed",
  "outreach-me-handler.getFeedMoment",
  "outreach-me-handler.setReaction",
  "outreach-me-handler.getFeedPhotoImage",
  // EventBridge-driven scheduled-publish worker — no HTTP/authorizer, invoked by the schedule event.
  "outreach-scheduled-handler.drain",
];
