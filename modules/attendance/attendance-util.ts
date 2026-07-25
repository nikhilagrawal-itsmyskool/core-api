import { ABSENT_TEMPLATE_KEY } from './attendance-constants';
const { serviceAuthHeader } = require('../../shared/util/service-token');

// Base URL of the communication module. Points at the gateway in deployed envs;
// override with COMM_BASE_URL to target the module's own port for standalone runs.
const COMM_BASE_URL = process.env.COMM_BASE_URL || 'http://localhost:3000';

// Fire-and-forget absence notification. Enqueues a communication job for the
// absent students; never throws so a notify failure can't fail finalize (delivery
// is async anyway). Returns the created jobId when known.
export async function notifyAbsences(
  schoolCode: string,
  absentStudentIds: string[],
  context: Record<string, any>,
): Promise<string | null> {
  if (!absentStudentIds.length) return null;
  try {
    const res = await fetch(`${COMM_BASE_URL}/communication/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-School-Code': schoolCode,
        // Service token so this call passes the API authorizer once communication is protected.
        Authorization: serviceAuthHeader({ name: 'attendance' }),
      },
      body: JSON.stringify({
        templateKey: ABSENT_TEMPLATE_KEY,
        source: 'attendance',
        audience: { students: { studentIds: absentStudentIds } },
        context,
      }),
    });
    if (!res.ok) {
      console.error(`[attendance] absence notify failed: HTTP ${res.status}`);
      return null;
    }
    const data: any = await res.json();
    console.log(`[attendance] absence notify enqueued job ${data.jobId} for ${absentStudentIds.length} student(s)`);
    return data.jobId || null;
  } catch (err: any) {
    console.error(`[attendance] absence notify error: ${err.message}`);
    return null;
  }
}
