const { serviceAuthHeader } = require("../../shared/util/service-token.js");

// Base URL of the communication module. Points at the gateway in deployed envs; override
// with COMM_BASE_URL for standalone runs. Mirrors leave-notify.
const COMM_BASE_URL = process.env.COMM_BASE_URL || "http://localhost:3000";

// Fire-and-forget in-app notification to staff about a document that needs signing. Never
// throws — a notify failure must not fail the document action (free/instant in-app channel,
// no SMS/WhatsApp cost).
export async function notifyDoc(
  schoolCode: string,
  employeeIds: string[],
  key: string,
  title: string,
  body: string,
  docId: string,
): Promise<void> {
  const ids = (employeeIds || []).filter(Boolean);
  if (!ids.length) return;
  try {
    const res = await fetch(`${COMM_BASE_URL}/communication/notifications`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-School-Code": schoolCode,
        Authorization: serviceAuthHeader({ name: "employee" }),
      },
      body: JSON.stringify({
        recipientType: "employee",
        recipientIds: ids,
        key,
        title,
        body,
        entityType: "employee_document",
        entityId: docId,
      }),
    });
    if (!res.ok) console.error(`[employee] doc notify failed: HTTP ${res.status}`);
  } catch (err: any) {
    console.error(`[employee] doc notify error: ${err.message}`);
  }
}
