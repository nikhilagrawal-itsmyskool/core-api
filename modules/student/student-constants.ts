// Student module constants.

export const STATUS_VALUES = ['active', 'inactive', 'deleted'] as const;

export const GUARDIAN_RELATIONS = ['father', 'mother', 'guardian', 'other'] as const;

export const GENDERS = ['M', 'F', 'O'] as const;

// Photo upload guards (student & guardian photos go to shared file_storage).
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const PHOTO_ALLOWED_MIME = ['image/jpeg', 'image/png'] as const;

export const PHOTO_ENTITY_TYPES = ['student', 'guardian'] as const;

export const DEFAULTS = {
  STATUS: 'active',
} as const;

export type StatusValue = typeof STATUS_VALUES[number];
export type GuardianRelation = typeof GUARDIAN_RELATIONS[number];
export type Gender = typeof GENDERS[number];
export type PhotoEntityType = typeof PHOTO_ENTITY_TYPES[number];
