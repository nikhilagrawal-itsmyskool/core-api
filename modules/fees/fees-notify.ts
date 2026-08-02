import { COMM_BASE_URL, FEE_RECEIPT_TEMPLATE_KEY } from './fees-constants';
const { serviceAuthHeader } = require('../../shared/util/service-token.js');

// Fire-and-forget receipt confirmation to the parent via the communication module.
// Never throws — a notify failure must not fail the collection.
export async function notifyReceipt(
  schoolCode: string,
  studentId: string,
  context: Record<string, any>
): Promise<string | null> {
  try {
    const res = await fetch(`${COMM_BASE_URL}/communication/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-School-Code': schoolCode,
        Authorization: serviceAuthHeader({ name: 'fees' }),
      },
      body: JSON.stringify({
        templateKey: FEE_RECEIPT_TEMPLATE_KEY,
        source: 'fees',
        audience: { students: { studentIds: [studentId] } },
        context,
      }),
    });
    if (!res.ok) { console.error(`[fees] receipt notify failed: HTTP ${res.status}`); return null; }
    const data: any = await res.json();
    return data.jobId || null;
  } catch (err: any) {
    console.error(`[fees] receipt notify error: ${err.message}`);
    return null;
  }
}
