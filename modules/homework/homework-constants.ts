// Homework module constants.

export const DAY_STATUSES = ["draft", "published"] as const;
export const ITEM_STATUSES = ["active", "deleted"] as const;
export const AUDIT_ACTIONS = ["upload", "remove", "edit", "publish", "unpublish"] as const;

export type DayStatus = (typeof DAY_STATUSES)[number];
export type ItemStatus = (typeof ITEM_STATUSES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Image validation — same limits as student/guardian photos.
export const HW_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB (a homework photo can be bigger than an ID photo)
export const HW_IMAGE_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

export const FILE_ENTITY_TYPE = "homework";
