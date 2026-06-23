// Supplies module constants.
//
// Unlike `sports` (where sport_type is a hardcoded enum), supply CATEGORIES are
// a per-school managed lookup (`supply_category`). The list below is only the
// default set seeded into a school on first use (see supply-service.ts:
// seedForSchool). Schools can add/rename/remove categories freely afterwards.

export const SUPPLY_UNITS = [
  { value: 'piece', label: 'Piece' },
  { value: 'set', label: 'Set' },
  { value: 'pair', label: 'Pair' },
  { value: 'box', label: 'Box' },
  { value: 'packet', label: 'Packet' },
  { value: 'pkt', label: 'Pkt' },
  { value: 'roll', label: 'Roll' },
  { value: 'ream', label: 'Ream' },
  { value: 'sheet', label: 'Sheet' },
  { value: 'pad', label: 'Pad' },
  { value: 'bundle', label: 'Bundle' },
  { value: 'dozen', label: 'Dozen' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'jar', label: 'Jar' },
  { value: 'can', label: 'Can' },
  { value: 'tube', label: 'Tube' },
  { value: 'tin', label: 'Tin' },
  { value: 'bar', label: 'Bar' },
  { value: 'ml', label: 'ML (Milliliter)' },
  { value: 'litre', label: 'Litre' },
  { value: 'gm', label: 'GM (Gram)' },
  { value: 'kg', label: 'KG (Kilogram)' },
  { value: 'metre', label: 'Metre' },
] as const;

export const ITEM_TYPES = ['consumable', 'equipment'] as const;

export const ITEM_CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'needs_repair', label: 'Needs Repair' },
  { value: 'condemned', label: 'Condemned' },
] as const;

export const ISSUE_TYPES = [
  { value: 'class_use', label: 'Class Use' },
  { value: 'department', label: 'Department' },
  { value: 'individual', label: 'Individual Issue' },
  { value: 'event', label: 'Event' },
  { value: 'disposed', label: 'Disposed' },
  { value: 'transferred', label: 'Transferred' },
] as const;

export const ISSUED_TO_TYPES = ['student', 'employee', 'class'] as const;

export const WASTAGE_REASONS = [
  { value: 'spoiled', label: 'Spoiled' },
  { value: 'expired', label: 'Expired' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'lost', label: 'Lost' },
  { value: 'used_up', label: 'Used Up' },
  { value: 'other', label: 'Other' },
] as const;

export const WASTAGE_ACTIONS = ['written_off', 'replaced', 'cost_recovered'] as const;

export const WASTAGE_STATUSES = ['reported', 'resolved'] as const;

export const RESPONSIBLE_TYPES = ['student', 'teacher', 'wear_and_tear', 'unknown'] as const;

export const RETURN_CONDITIONS = ['good', 'damaged', 'lost'] as const;

export const STATUS_VALUES = ['active', 'deleted'] as const;

// Default categories seeded per school on first use. `code` is the stable key
// the item master references; `name` is the editable display label.
export const DEFAULT_SUPPLY_CATEGORIES: { code: string; name: string }[] = [
  { code: 'stationery', name: 'Stationery & Writing' },
  { code: 'paper', name: 'Paper Products' },
  { code: 'art_craft', name: 'Art & Craft' },
  { code: 'office', name: 'Office & Admin' },
  { code: 'printing', name: 'Printing & Toner' },
  { code: 'cleaning', name: 'Cleaning & Janitorial' },
  { code: 'sanitation', name: 'Housekeeping & Sanitation' },
  { code: 'electrical', name: 'Electrical Consumables' },
  { code: 'hardware', name: 'Hardware & Maintenance' },
  { code: 'events', name: 'Events & Decoration' },
  { code: 'identity', name: 'Identity & Labels' },
  { code: 'kitchen', name: 'Kitchen & Canteen' },
  { code: 'garden', name: 'Garden & Landscaping' },
  { code: 'first_aid', name: 'First-Aid Consumables' },
  { code: 'classroom', name: 'Classroom Teaching Aids' },
  { code: 'other', name: 'Other' },
];

export const DEFAULTS = {
  REORDER_LEVEL: 0,
  CURRENT_STOCK: 0,
  STATUS: 'active',
  QUANTITY: 1,
  ITEM_TYPE: 'consumable',
  ITEM_CONDITION: 'good',
  WASTAGE_STATUS: 'reported',
} as const;

// Type exports
export type SupplyUnit = typeof SUPPLY_UNITS[number]['value'];
export type ItemType = typeof ITEM_TYPES[number];
export type ItemCondition = typeof ITEM_CONDITIONS[number]['value'];
export type IssueType = typeof ISSUE_TYPES[number]['value'];
export type IssuedToType = typeof ISSUED_TO_TYPES[number];
export type WastageReason = typeof WASTAGE_REASONS[number]['value'];
export type WastageAction = typeof WASTAGE_ACTIONS[number];
export type WastageStatus = typeof WASTAGE_STATUSES[number];
export type ResponsibleType = typeof RESPONSIBLE_TYPES[number];
export type ReturnCondition = typeof RETURN_CONDITIONS[number];
export type StatusValue = typeof STATUS_VALUES[number];
