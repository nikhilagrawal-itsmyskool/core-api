// Website module constants.

export const CONTENT_TYPES = ["event", "blogPost", "mediaCoverage", "schoolAnnouncement"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

// School Event ("event") controlled fields — mirrors the Contentful content-type validations
// (zzk3vvolguvu/master). Keep in sync if the content model changes.
export const EVENT_TYPES = [
  "Sports Achievement", "Weekly Activity", "Summer Camp", "Raamleela", "Night Camp",
  "Basant Panchami", "Trips and Excursion", "Celebration", "Training",
] as const;
export const ACADEMIC_SESSIONS = ["2022-2023", "2023-2024", "2024-2025", "2025-2026", "2026-2027"] as const;

// eventMemories field size validation (Array<Link:Asset>, min 4 / max 30).
export const EVENT_MEMORIES_MIN = 4;
export const EVENT_MEMORIES_MAX = 30;

export const DEFAULT_LOCALE = "en-US";

export const PUB_STATUSES = ["active", "deleted"] as const;
export const CONTENTFUL_STATUSES = ["draft", "published", "unpublished"] as const;

// The CMA token for Contentful is read from this env var (resolved from SSM at deploy).
export const CMA_TOKEN_ENV = "WEBSITE_CTF_TOKEN";
