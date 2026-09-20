import { CLOSURE_TEMPLATE_KEY } from "./academic-calendar-constants";
const { serviceAuthHeader } = require("../../shared/util/service-token.js");

// Base URL of the communication module. Points at the gateway in deployed envs;
// override with COMM_BASE_URL to target the module's own port for standalone runs.
// (Same convention as modules/attendance/attendance-util.ts.)
const COMM_BASE_URL = process.env.COMM_BASE_URL || "http://localhost:3000";

function commHeaders(schoolCode: string) {
  return {
    "Content-Type": "application/json",
    "X-School-Code": schoolCode,
    // Service token so these calls pass the API authorizer.
    Authorization: serviceAuthHeader({ name: "academic-calendar" }),
  };
}

// Parents: enqueue an SMS/WhatsApp broadcast to every student's contacts via the
// approved `school_closure` template. Fire-and-forget — never throws.
export async function notifyClosureParents(
  schoolCode: string,
  period: string,
  reason: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${COMM_BASE_URL}/communication/messages`, {
      method: "POST",
      headers: commHeaders(schoolCode),
      body: JSON.stringify({
        templateKey: CLOSURE_TEMPLATE_KEY,
        source: "academic-calendar",
        audience: { students: { all: true } },
        context: { period, reason },
      }),
    });
    if (!res.ok) {
      console.error(`[academic-calendar] closure parent-notify failed: HTTP ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    return data.jobId || null;
  } catch (err: any) {
    console.error(`[academic-calendar] closure parent-notify error: ${err.message}`);
    return null;
  }
}

// Staff: drop a free in-app notification into every active employee's inbox (no
// template / approval needed). Fire-and-forget — never throws.
export async function notifyClosureStaff(
  schoolCode: string,
  period: string,
  reason: string,
): Promise<number> {
  try {
    const res = await fetch(`${COMM_BASE_URL}/communication/notifications`, {
      method: "POST",
      headers: commHeaders(schoolCode),
      body: JSON.stringify({
        recipientType: "employee",
        all: true,
        key: CLOSURE_TEMPLATE_KEY,
        title: "School closure",
        body: `School will remain closed ${period}${reason ? ` — ${reason}` : ""}. Staff please note.`,
        entityType: "academic-calendar",
      }),
    });
    if (!res.ok) {
      console.error(`[academic-calendar] closure staff-notify failed: HTTP ${res.status}`);
      return 0;
    }
    const data: any = await res.json();
    return data.created || 0;
  } catch (err: any) {
    console.error(`[academic-calendar] closure staff-notify error: ${err.message}`);
    return 0;
  }
}
