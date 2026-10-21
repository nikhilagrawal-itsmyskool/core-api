import { ContentType } from "./website-constants";

export interface WebsiteConfig {
  spaceId: string;
  environment: string;
  defaultLocale: string;
}

export interface CtfTag {
  id: string;
  name: string;
}

// ---- Source (read from Moments) ----
export interface SourcePhoto {
  photoId: string;
  fileId: string | null;
  caption?: string | null;
  imageUrl?: string | null;
}

export interface SourceMoment {
  uuid: string;
  title?: string | null;
  body?: string | null;
  status: string;
  publishedAt?: string | null;
  photos: SourcePhoto[];
}

// ---- Push request ----
export interface PushPhoto {
  photoId: string;
  tags: string[]; // Contentful tag ids applied to THIS image's asset
}

export interface EventFields {
  eventTitle: string;
  eventDetails: string;
  eventDate: string;        // YYYY-MM-DD
  eventType: string[];      // from EVENT_TYPES
  academicSession: string[]; // from ACADEMIC_SESSIONS
}

export interface PushEventRequest {
  sourceMomentId?: string;
  photos: PushPhoto[];      // selected photos + per-image tags
  fields: EventFields;
  entryTags?: string[];     // optional entry-level tags
  publish?: boolean;        // publish in Contentful now; else leave as a draft
}

// ---- Read models ----
export interface PublicationView {
  uuid: string;
  contentType: ContentType | string;
  contentfulEntryId?: string | null;
  contentfulStatus: string;
  pushStatus: string;          // queued | processing | done | failed
  pushDetail?: string | null;  // progress ("12/30") or error text
  title?: string | null;
  sourceMomentId?: string | null;
  assetCount: number;
  fields?: any;
  createdbyName?: string | null;
  createdAt?: string | null;
  publishedAt?: string | null;
}
