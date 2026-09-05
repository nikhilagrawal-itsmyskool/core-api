const { serviceAuthHeader } = require("../../shared/util/service-token.js");

// Base URL of the communication module. Points at the gateway in deployed envs;
// override with COMM_BASE_URL to target the module's own port for standalone runs.
const COMM_BASE_URL = process.env.COMM_BASE_URL || "http://localhost:3000";

export type RecipientType = "employee" | "student";

// Fire-and-forget in-app notification via the communication module's inbox. Never
// throws — a notify failure must not fail the leave action (delivery is async). This
// hits the free/instant in-app channel (no SMS/WhatsApp cost). Mirrors fees-notify.
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
  if (!ids.length) return;
  try {
    const res = await fetch(`${COMM_BASE_URL}/communication/notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-School-Code": schoolCode,
        Authorization: serviceAuthHeader({ name: "leave" }),
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
      console.error(`[leave] in-app notify failed: HTTP ${res.status}`);
    }
  } catch (err: any) {
    console.error(`[leave] in-app notify error: ${err.message}`);
  }
}
