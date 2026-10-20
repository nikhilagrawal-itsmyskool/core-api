import { NOTIFY_KEY } from "./outreach-constants";
import { MomentView } from "./outreach-interfaces";
const { serviceAuthHeader } = require("../../shared/util/service-token.js");

// Base URL of the communication module. Points at the gateway in deployed envs;
// override with COMM_BASE_URL to target the module's own port for standalone runs.
const COMM_BASE_URL = process.env.COMM_BASE_URL || "http://localhost:3000";

export type RecipientType = "employee" | "student";

// Fire-and-forget in-app notification via the communication module's inbox. Never throws
// — a notify failure must not fail the publish (delivery is async + best-effort). Hits the
// free/instant in-app channel (no SMS/WhatsApp cost). Mirrors leave-notify / fees-notify.
export async function notifyInApp(
  schoolCode: string,
  recipientType: RecipientType,
  recipientIds: string[],
  key: string,
  title: string,
  body: string,
  entity?: { entityType?: string; entityId?: string },
): Promise<void> {
  const ids = (recipientIds || []).filter(Boolean);
  if (!schoolCode || !ids.length) return;
  try {
    const res = await fetch(`${COMM_BASE_URL}/communication/notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-School-Code": schoolCode,
        Authorization: serviceAuthHeader({ name: "outreach" }),
      },
      body: JSON.stringify({
        recipientType,
        recipientIds: ids,
        key,
        title,
        body,
        entityType: entity?.entityType,
        entityId: entity?.entityId,
      }),
    });
    if (!res.ok) {
      console.error(`[outreach] in-app notify failed: HTTP ${res.status}`);
    }
  } catch (err: any) {
    console.error(`[outreach] in-app notify error: ${err.message}`);
  }
}

// Higher-level helper: ping the audience families that a Moment was published. The title
// is the Moment's own title; the body a short preview. Best-effort (never throws).
export async function notifyMomentPublished(
  schoolCode: string,
  studentIds: string[],
  momentId: string,
  moment: MomentView,
): Promise<void> {
  const title = moment.title?.trim() || "New photos shared";
  const body = moment.body?.trim()?.slice(0, 140) || "Tap to see the latest from school.";
  await notifyInApp(schoolCode, "student", studentIds, NOTIFY_KEY, title, body, {
    entityType: "outreach",
    entityId: momentId,
  });
}
