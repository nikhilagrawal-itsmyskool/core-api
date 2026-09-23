export const ITEM_TYPES = [
  { value: 'book', label: 'Book' },
  { value: 'notebook', label: 'Notebook' },
  { value: 'stationery', label: 'Stationery' },
] as const;

export const SECTIONS = [
  { value: 'main', label: 'Main' },
  { value: 'additional', label: 'Additional Reading' },
  { value: 'other', label: 'Other' },
] as const;

export const PAYMENT_STATUSES = [
  { value: 'paid', label: 'Fully Paid' },
  { value: 'partial', label: 'Partially Paid' },
  { value: 'due', label: 'Due' },
] as const;

export const CLASS_NOS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

// Grades a set can be keyed to. Matches the school's class-name prefix convention
// (class "I-A" -> grade "I"); pre-primary grades are spelled out. This is the
// canonical ordering used for sorting set lists.
export const GRADES = [
  'Nursery', 'LKG', 'UKG',
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
] as const;

// Ordinal for sorting grades (lower = earlier). Unknown grades sort last.
export const GRADE_ORDER: Record<string, number> =
  GRADES.reduce((acc, g, i) => { acc[g.toLowerCase()] = i; return acc; }, {} as Record<string, number>);

// Loose-box movement reasons (see shop_loose_movement).
export const LOOSE_REASONS = [
  { value: 'decline', label: 'Declined at assignment' },
  { value: 'issue', label: 'Issued from loose stock' },
  { value: 'return_vendor', label: 'Returned to vendor' },
  { value: 'writeoff', label: 'Written off' },
  { value: 'adjust', label: 'Manual adjustment' },
] as const;

export const ITEM_TYPE_VALUES = ITEM_TYPES.map(t => t.value);
export const SECTION_VALUES = SECTIONS.map(s => s.value);
export const PAYMENT_STATUS_VALUES = PAYMENT_STATUSES.map(p => p.value);
export const LOOSE_REASON_VALUES = LOOSE_REASONS.map(r => r.value);

export type ItemType = typeof ITEM_TYPE_VALUES[number];
export type Section = typeof SECTION_VALUES[number];
export type PaymentStatus = typeof PAYMENT_STATUS_VALUES[number];
export type LooseReason = typeof LOOSE_REASON_VALUES[number];

export const DEFAULTS = {
  STATUS: 'active',
  CURRENT_STOCK: 0,
  RETURNED_QUANTITY: 0,
};
