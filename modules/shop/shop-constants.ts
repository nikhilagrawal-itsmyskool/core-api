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

export const ITEM_TYPE_VALUES = ITEM_TYPES.map(t => t.value);
export const SECTION_VALUES = SECTIONS.map(s => s.value);
export const PAYMENT_STATUS_VALUES = PAYMENT_STATUSES.map(p => p.value);

export type ItemType = typeof ITEM_TYPE_VALUES[number];
export type Section = typeof SECTION_VALUES[number];
export type PaymentStatus = typeof PAYMENT_STATUS_VALUES[number];

export const DEFAULTS = {
  STATUS: 'active',
  CURRENT_STOCK: 0,
  RETURNED_QUANTITY: 0,
};
