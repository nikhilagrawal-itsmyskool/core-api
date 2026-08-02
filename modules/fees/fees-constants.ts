// Shared constants for the fees module.

export const FEE_HEAD_KINDS = ['recurring', 'admission', 'caution', 'transport', 'exam', 'annual', 'other'] as const;
export const CONCESSION_TYPES = ['sibling', 'sibling_elder', 'sibling_younger', 'staff', 'ews', 'other'] as const;
export const CONCESSION_VALUE_TYPES = ['amount', 'percent'] as const;
export const PAYMENT_MODES = ['cash', 'cheque', 'draft', 'ecs', 'bank-deposit', 'card', 'neft', 'online', 'rte'] as const;
export const RECEIVED_FROM = ['father', 'mother', 'guardian', 'other'] as const;
export const RECEIPT_TYPES = ['fee', 'transport', 'adhoc', 'refund'] as const;
export const LEDGER_CATEGORIES = ['fee', 'transport', 'library', 'fine', 'misc'] as const;
export const LEDGER_KINDS = ['charge', 'concession', 'payment', 'waiver', 'adjust'] as const;
export const LATE_FEE_MODES = ['flat', 'perday', 'pct'] as const;
export const REFUND_STATUSES = ['not_refunded', 'refunded', 'dispersed'] as const;

// Receipt-number series prefixes (our own numbering; legacy_receipt_no preserves SchoolPad's).
export const RECEIPT_SERIES = {
  fee: 'FR',
  transport: 'TR',
  adhoc: 'AR',
  refund: 'RF',
} as const;

export const DEFAULTS = {
  STATUS_ACTIVE: 'active',
  STATUS_DELETED: 'deleted',
  RECEIPT_STATUS_ACTIVE: 'active',
  RECEIPT_STATUS_CANCELLED: 'cancelled',
  SOURCE_NATIVE: 'native',
  SOURCE_SCHOOLPAD: 'schoolpad',
  ALLOCATION_EXPLICIT: 'explicit',
  ALLOCATION_FIFO: 'fifo-reconstructed',
};

// Communication (auto WhatsApp/SMS receipt confirmation) — pre-approved template key.
export const FEE_RECEIPT_TEMPLATE_KEY = 'fee_receipt';
export const COMM_BASE_URL = process.env.COMM_BASE_URL || 'http://localhost:3000';
