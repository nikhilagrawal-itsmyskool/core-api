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

// Uploaded videos (short clips) live in R2, uploaded straight from the phone (direct PUT,
// bypassing the API's base64 path). Longer event recordings still go to YouTube as a link.
export const VIDEO_MAX_BYTES = 250 * 1024 * 1024; // 250 MB size backstop
export const VIDEO_MAX_SECONDS = 300; // 5 minutes
export const VIDEO_ALLOWED_MIME = ["video/mp4", "video/quicktime", "video/webm"] as const;
// R2 key prefix for uploaded videos: {school}/outreach-video/{momentId}/original/{uuid}{ext}.
// (The row lives in moment_video with storage_key, not in file_storage.)
export const VIDEO_ENTITY_TYPE = "outreach-video";

// Notification category key (deep-links the app to the Moment).
export const NOTIFY_KEY = "outreach.moment";
