import { ACTIONS } from "../../shared/lib/authz-policy";

// Required permission per website endpoint, keyed by the `handler:` ref in website-endpoints.yml.
// Single action for the whole tool (website.publish) — it's one curation surface, per-school
// gated (only a school with a website_config row + the action granted sees it). The push worker
// is EventBridge-driven (no HTTP) so it is PUBLIC.
const { WEBSITE_PUBLISH } = ACTIONS;

export const WEBSITE_ACTIONS: Record<string, string> = {
  "website-handler.config": WEBSITE_PUBLISH,
  "website-handler.tags": WEBSITE_PUBLISH,
  "website-handler.sourceMoments": WEBSITE_PUBLISH,
  "website-handler.sourceMoment": WEBSITE_PUBLISH,
  "website-handler.pushEvent": WEBSITE_PUBLISH,
  "website-handler.listPublications": WEBSITE_PUBLISH,
  "website-handler.getPublication": WEBSITE_PUBLISH,
  "website-handler.publish": WEBSITE_PUBLISH,
};

export const WEBSITE_PUBLIC: string[] = [
  "health-handler.health",
  "website-process-handler.drain",
];
