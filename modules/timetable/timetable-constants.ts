// Timetable module constants.
// Subjects, the grid, teacher constraints and electives are all per-school.
// Enum-like values mirror the CHECK constraints in timetable-setup.sql.

export const SUBJECT_KINDS = [
  { value: 'academic', label: 'Academic' },
  { value: 'games', label: 'Games' },
  { value: 'library', label: 'Library' },
  { value: 'activity', label: 'Activity' },
] as const;

export const SLOT_TYPES = [
  { value: 'teaching', label: 'Teaching' },
  { value: 'assembly', label: 'Assembly' },
  { value: 'break', label: 'Break' },
  { value: 'lunch', label: 'Lunch' },
  { value: 'reserved', label: 'Reserved' },
  { value: 'activity', label: 'Activity' },
  { value: 'registration', label: 'Registration (0th period)' },
] as const;

export const CONSTRAINT_TYPES = [
  { value: 'max_per_day', label: 'Max periods per day' },
  { value: 'max_consecutive', label: 'Max consecutive periods' },
  { value: 'weekly_max', label: 'Weekly maximum' },
  { value: 'day_off', label: 'Day off' },
  { value: 'available_slot', label: 'Available periods (only here)' },
  { value: 'unavailable_slot', label: 'Unavailable periods' },
  { value: 'preferred_slot', label: 'Preferred period (soft)' },
] as const;

export const HARDNESS_VALUES = ['hard', 'soft'] as const;

export const DAYS_OF_WEEK = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
] as const;

export const STATUS_VALUES = ['active', 'deleted'] as const;
export const CONFIG_STATUS_VALUES = ['active', 'archived'] as const;

export const DEFAULTS = {
  STATUS: 'active',
} as const;

// Type exports
export type SubjectKind = typeof SUBJECT_KINDS[number]['value'];
export type SlotType = typeof SLOT_TYPES[number]['value'];
export type ConstraintType = typeof CONSTRAINT_TYPES[number]['value'];
export type Hardness = typeof HARDNESS_VALUES[number];
export type StatusValue = typeof STATUS_VALUES[number];
export type ConfigStatus = typeof CONFIG_STATUS_VALUES[number];

export const SUBJECT_KIND_VALUES = SUBJECT_KINDS.map((k) => k.value);
export const SLOT_TYPE_VALUES = SLOT_TYPES.map((s) => s.value);
export const CONSTRAINT_TYPE_VALUES = CONSTRAINT_TYPES.map((c) => c.value);
