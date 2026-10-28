// Default credential used when an employee login is auto-created or reset.
// NOTE: passwords are stored in plain text for now (accepted tradeoff).
export const DEFAULT_PASSWORD = 'Itsmyskool@123';

export const DEFAULT_STATUS = 'active';

// Status sets used for soft-delete filtering in queries.
export const ACTIVE_STATUS = "('active')";
export const ACTIVE_AND_DELETED_STATUS = "('active', 'deleted')";

// Employee photos go to the shared file_storage (entity_type='employee'), mirroring students.
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const PHOTO_ALLOWED_MIME = ['image/jpeg', 'image/png'] as const;
export const PHOTO_ENTITY_TYPE = 'employee';
export const PHOTO_VARIANTS = ['original', 'thumb'] as const;
