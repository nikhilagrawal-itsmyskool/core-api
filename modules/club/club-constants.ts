// Club module constants — the controlled vocabulary (blueprint §40). Club-specific
// capability blocks may add their own values without changing these core semantics.

export const CLUB_STATUSES = ["planned", "active", "inactive"] as const;
export const ACTIVITY_AVAILABILITY = ["planned", "available", "suspended", "archived"] as const;
export const VERSION_STATUSES = ["draft", "trial", "approved", "superseded"] as const;
export const PLAN_STATUSES = ["draft", "published", "closed", "cancelled"] as const;
export const ASSIGNMENT_STATES = ["scheduled", "cancelled"] as const;
export const CONDUCT_OUTCOMES = ["fully", "partly", "not"] as const;
export const ISSUE_TYPES = ["none", "material", "time", "venue", "safety", "other"] as const;
export const QUALITY_SIGNALS = ["as-planned", "minor-change", "needs-review"] as const;
export const REVIEW_DECISIONS = ["keep", "revise", "suspend", "archive"] as const;
export const SAFETY_LEVELS = ["routine", "supervised", "special-approval"] as const;
export const ACTIVITY_MODES = [
  "individual",
  "pair",
  "small-group",
  "team",
  "whole-group",
  "mixed-group",
] as const;
export const GROUP_SOURCE_TYPES = ["class", "club", "house", "mixed", "selected"] as const;
export const PARTICIPATION_SCOPES = ["whole", "grades", "groups"] as const;
export const COVERAGE_EXPECTATIONS = ["complete", "selective"] as const;

export type ClubStatus = (typeof CLUB_STATUSES)[number];
export type ActivityAvailability = (typeof ACTIVITY_AVAILABILITY)[number];
export type VersionStatus = (typeof VERSION_STATUSES)[number];
export type PlanStatus = (typeof PLAN_STATUSES)[number];

// Capability blocks a club may enable (blueprint §6). Fixed, versioned set — a new block
// is added only when reusable across clubs; one-off needs stay as notes/metadata.
export const CAPABILITY_BLOCKS = [
  "safety",
  "equipment",
  "laboratory",
  "food-hygiene",
  "performance",
  "team-game",
  "portfolio",
  "exhibition",
  "research",
  "external",
  "competition",
  "project",
] as const;
export type CapabilityBlock = (typeof CAPABILITY_BLOCKS)[number];

// Shared file_storage entity types owned by this module.
export const FILE_ENTITY_RESOURCE = "club";
export const FILE_ENTITY_IMPORT = "club-import";

// Audit actions worth logging (blueprint §26) — state/security changes, not UI noise.
export const AUDIT_ACTIONS = [
  "club.create",
  "club.update",
  "activity.create",
  "activity.approve",
  "activity.suspend",
  "activity.archive",
  "activity.revise",
  "activity.import",
  "plan.publish",
  "plan.change",
  "plan.close",
  "plan.reopen",
  "plan.cancel",
  "assignment.cancel",
  "review.decide",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
