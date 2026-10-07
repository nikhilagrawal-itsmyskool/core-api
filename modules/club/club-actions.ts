import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per club endpoint, keyed by the `handler:` reference in
// club-endpoints.yml (`file.export`). Single naming site for club authz — wired at the
// export site of each handler via guard(). Effective permission honours god's live
// grant/revoke overrides (see shared/lib/authz-policy.ts can()).
const {
  CLUB_SETUP_VIEW,
  CLUB_SETUP_MANAGE,
  CLUB_ACTIVITY_VIEW,
  CLUB_ACTIVITY_MANAGE,
  CLUB_ACTIVITY_APPROVE,
  CLUB_ACTIVITY_REVIEW,
  CLUB_PLAN_VIEW,
  CLUB_PLAN_MANAGE,
  CLUB_PLAN_PUBLISH,
  CLUB_PLAN_CONDUCT,
} = ACTIONS;

export const CLUB_ACTIONS: Record<string, string> = {
  // Clubs, config & programme settings (setup resource)
  "club-handler.listClubs": CLUB_SETUP_VIEW,
  "club-handler.getClub": CLUB_SETUP_VIEW,
  "club-handler.createClub": CLUB_SETUP_MANAGE,
  "club-handler.updateClub": CLUB_SETUP_MANAGE,
  "club-handler.getConfig": CLUB_SETUP_VIEW,
  "club-handler.updateConfig": CLUB_SETUP_MANAGE,
  "club-handler.getSettings": CLUB_SETUP_VIEW,
  "club-handler.updateSettings": CLUB_SETUP_MANAGE,
  "club-handler.listGrades": CLUB_SETUP_VIEW,

  // Activity bank (identity + versioned content + materials)
  "club-activity-handler.listActivities": CLUB_ACTIVITY_VIEW,
  "club-activity-handler.getActivity": CLUB_ACTIVITY_VIEW,
  "club-activity-handler.createActivity": CLUB_ACTIVITY_MANAGE,
  "club-activity-handler.updateDraft": CLUB_ACTIVITY_MANAGE,
  "club-activity-handler.createRevision": CLUB_ACTIVITY_MANAGE,
  "club-activity-handler.replaceMaterials": CLUB_ACTIVITY_MANAGE,
  "club-activity-handler.approve": CLUB_ACTIVITY_APPROVE,
  "club-activity-handler.setAvailability": CLUB_ACTIVITY_APPROVE,

  // Bulk import / export round-trip
  "club-import-handler.exportBank": CLUB_ACTIVITY_VIEW,
  "club-import-handler.preview": CLUB_ACTIVITY_MANAGE,
  "club-import-handler.commit": CLUB_ACTIVITY_MANAGE,
  "club-import-handler.listImports": CLUB_ACTIVITY_VIEW,
  "club-import-handler.downloadImport": CLUB_ACTIVITY_VIEW,

  // Review queue (activity improvement)
  "club-activity-handler.listReviews": CLUB_ACTIVITY_REVIEW,
  "club-activity-handler.decideReview": CLUB_ACTIVITY_REVIEW,
  "club-activity-handler.flagReview": CLUB_ACTIVITY_REVIEW,

  // Planning board — read
  "club-plan-handler.listPlans": CLUB_PLAN_VIEW,
  "club-plan-handler.getPlan": CLUB_PLAN_VIEW,
  "club-plan-handler.validate": CLUB_PLAN_VIEW,
  // Planning board — build a DRAFT (manage)
  "club-plan-handler.createPlan": CLUB_PLAN_MANAGE,
  "club-plan-handler.updatePlan": CLUB_PLAN_MANAGE,
  "club-plan-handler.addSlot": CLUB_PLAN_MANAGE,
  "club-plan-handler.removeSlot": CLUB_PLAN_MANAGE,
  "club-plan-handler.addGroup": CLUB_PLAN_MANAGE,
  "club-plan-handler.removeGroup": CLUB_PLAN_MANAGE,
  "club-plan-handler.generateGroups": CLUB_PLAN_MANAGE,
  "club-plan-handler.saveAssignment": CLUB_PLAN_MANAGE,
  // Planning board — publish & after-publish operations (publish)
  "club-plan-handler.publish": CLUB_PLAN_PUBLISH,
  "club-plan-handler.changeAssignment": CLUB_PLAN_PUBLISH,
  "club-plan-handler.cancelAssignment": CLUB_PLAN_PUBLISH,
  "club-plan-handler.adminComplete": CLUB_PLAN_PUBLISH,
  "club-plan-handler.close": CLUB_PLAN_PUBLISH,
  "club-plan-handler.reopen": CLUB_PLAN_PUBLISH,
  "club-plan-handler.cancelPlan": CLUB_PLAN_PUBLISH,

  // Teacher PWA conduct surface
  "club-me-handler.mySaturday": CLUB_PLAN_CONDUCT,
  "club-me-handler.guide": CLUB_PLAN_CONDUCT,
  "club-me-handler.close": CLUB_PLAN_CONDUCT,
  "club-me-handler.reportSafety": CLUB_PLAN_CONDUCT,
};

// Endpoints intentionally NOT gated by requireAction:
//   - health: authorizer-exempt readiness probe
export const CLUB_PUBLIC: string[] = ["health-handler.health"];
