import { IntentStatus } from "./payments-constants";

// One allocation = pay `amount` toward a specific fees charge ledger entry.
export interface Allocation {
  ledgerId: string;
  amount: number;
}

// A payable unit shown to the parent — a fee cycle (or a standalone head), with its
// amount + any late fine folded in. `key` is an opaque selection key; the ledger ids
// behind it stay server-side (resolved fresh at order time).
export interface PayableCycle {
  key: string;
  cycleLabel: string;   // "Quarter 1" / head label for non-cycle charges
  amount: number;       // sum of non-fine remaining in this group
  fine: number;         // sum of fine remaining in this group
  total: number;        // amount + fine
  dueDate: string | null;
  overdue: boolean;
  due: boolean;         // due now (through end of this month) — pre-checked in the app
}

export interface PayableResponse {
  enabled: boolean;         // the gateway is configured + turned on (gates the app button)
  academicYearId: string | null;
  currency: "INR";
  cycles: PayableCycle[];
  totalDue: number;         // sum of all payable cycles' totals (due + upcoming)
}

export interface CreateOrderRequest {
  cycleKeys: string[];      // which payable cycles the parent selected
}

export interface CreateOrderResponse {
  intentId: string;
  orderId: string;
  amount: number;           // rupees
  amountPaise: number;
  currency: "INR";
  keyId: string;            // Razorpay public key_id for the checkout SDK
  prefill: { name?: string; email?: string; contact?: string };
  studentName?: string | null;
}

export interface VerifyRequest {
  intentId: string;
  orderId: string;
  paymentId: string;
  signature: string;
}

export interface PaymentResult {
  status: IntentStatus;
  receiptId?: string | null;
  receiptNo?: string | null;
}
