// Assembly module constants (dropdown catalogs + defaults).
// value/label arrays mirror the pattern in transport/fine constants.

export const WEEKDAYS = [
  { value: 'mon', label: 'Monday' },
  { value: 'tue', label: 'Tuesday' },
  { value: 'wed', label: 'Wednesday' },
  { value: 'thu', label: 'Thursday' },
  { value: 'fri', label: 'Friday' },
  { value: 'sat', label: 'Saturday' },
  { value: 'sun', label: 'Sunday' },
] as const;

// Suggested (not enforced) role labels for a responsible party on a node.
// Stored as free text, so schools may use their own.
export const RESPONSIBLE_ROLES = [
  { value: 'in-charge', label: 'In-charge' },
  { value: 'anchor', label: 'Anchor' },
  { value: 'presenter', label: 'Presenter' },
  { value: 'performers', label: 'Performers' },
] as const;

export const RESPONSIBLE_TARGET_TYPES = [
  { value: 'employee', label: 'Employee' },
  { value: 'class', label: 'Class / Section' },
  { value: 'student', label: 'Student' },
  { value: 'text', label: 'Free text' },
] as const;

export const PUBLISH_STATUSES = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
] as const;

export const WEEKDAY_VALUES = WEEKDAYS.map(w => w.value);
export const RESPONSIBLE_TARGET_TYPE_VALUES = RESPONSIBLE_TARGET_TYPES.map(t => t.value);
export const PUBLISH_STATUS_VALUES = PUBLISH_STATUSES.map(p => p.value);
export const OWNER_TYPES = ['plan', 'special'] as const;
export const SPECIAL_SOURCES = ['cloned', 'blank'] as const;
export const NODE_AUDIT_ACTIONS = ['create', 'update', 'delete', 'reorder'] as const;
export const ASSEMBLY_MODES = ['template', 'house'] as const;
export const FILL_MODES = ['auto', 'roster'] as const;
export const WEEK_STATUSES = ['draft', 'submitted', 'approved'] as const;
export const RESPONSIBLE_MODES = ['fixed', 'rotating'] as const;
export const CYCLE_UNITS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
] as const;
export const CYCLE_UNIT_VALUES = CYCLE_UNITS.map(c => c.value);

export type Weekday = typeof WEEKDAY_VALUES[number];
export type ResponsibleTargetType = typeof RESPONSIBLE_TARGET_TYPE_VALUES[number];
export type PublishStatus = typeof PUBLISH_STATUS_VALUES[number];
export type OwnerType = typeof OWNER_TYPES[number];
export type SpecialSource = typeof SPECIAL_SOURCES[number];
export type NodeAuditAction = typeof NODE_AUDIT_ACTIONS[number];
export type ResponsibleMode = typeof RESPONSIBLE_MODES[number];
export type CycleUnit = typeof CYCLE_UNIT_VALUES[number];
export type AssemblyMode = typeof ASSEMBLY_MODES[number];
export type FillMode = typeof FILL_MODES[number];
export type WeekStatus = typeof WEEK_STATUSES[number];

export const DEFAULTS = {
  STATUS: 'active' as const,
  PUBLISH_DRAFT: 'draft' as PublishStatus,
  // Seeded onto a new plan's weekday set unless the caller overrides it.
  PLAN_WEEKDAYS: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as Weekday[],
};
