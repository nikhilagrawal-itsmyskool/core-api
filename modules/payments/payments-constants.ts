// Razorpay works in paise (₹1 = 100). Our ledger is in rupees.
export const PAISE = 100;

export type IntentStatus = "created" | "paid" | "reconciled" | "failed" | "cancelled";

export const PROVIDER = "razorpay";

// A fine charge in the ledger is a 'charge' row whose head label mentions "late".
export const isFineLabel = (headLabel?: string | null): boolean =>
  !!headLabel && /late/i.test(headLabel);
