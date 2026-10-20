// Outreach ("Moments") module constants.

export const MOMENT_STATUSES = ["draft", "published"] as const;
export const PHOTO_STATUSES = ["active", "deleted"] as const;
export const AUDIENCE_SCOPES = ["school", "grade", "class"] as const;
export const AUDIT_ACTIONS = ["create", "edit", "photo-add", "photo-remove", "publish", "unpublish"] as const;

export type MomentStatus = (typeof MOMENT_STATUSES)[number];
export type PhotoStatus = (typeof PHOTO_STATUSES)[number];
export type AudienceScope = (typeof AUDIENCE_SCOPES)[number];
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

// Reaction palette — short tokens; the app maps each to an emoji. One per family (child).
export const REACTION_EMOJIS = ["love", "like", "clap", "smile", "celebrate"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

// Image validation — same limits as the homework photo surface.
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const IMAGE_ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

// Shared file_storage partition for Moments photos.
export const FILE_ENTITY_TYPE = "outreach";

// Notification category key (deep-links the app to the Moment).
export const NOTIFY_KEY = "outreach.moment";
