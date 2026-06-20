export const LAB_TYPES = [
  { value: 'physics', label: 'Physics' },
  { value: 'chemistry', label: 'Chemistry' },
  { value: 'biology', label: 'Biology' },
  { value: 'computer', label: 'Computer' },
  { value: 'language', label: 'Language' },
  { value: 'mathematics', label: 'Mathematics' },
  { value: 'composite', label: 'Composite' },
  { value: 'other', label: 'Other' }
] as const;

export const LAB_UNITS = [
  { value: 'piece', label: 'Piece' },
  { value: 'set', label: 'Set' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'packet', label: 'Packet' },
  { value: 'ml', label: 'ML (Milliliter)' },
  { value: 'gm', label: 'GM (Gram)' },
  { value: 'kg', label: 'KG (Kilogram)' },
  { value: 'box', label: 'Box' },
  { value: 'roll', label: 'Roll' },
  { value: 'pair', label: 'Pair' },
  { value: 'strip', label: 'Strip' },
  { value: 'litre', label: 'Litre' },
  { value: 'dozen', label: 'Dozen' },
  { value: 'ream', label: 'Ream' },
] as const;

export const ITEM_TYPES = ['equipment', 'consumable'] as const;

export const ITEM_CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'needs_repair', label: 'Needs Repair' },
  { value: 'condemned', label: 'Condemned' },
] as const;

export const ISSUE_TYPES = [
  { value: 'class_use', label: 'Class Use' },
  { value: 'individual', label: 'Individual Issue' },
  { value: 'disposed', label: 'Disposed' },
  { value: 'transferred', label: 'Transferred' },
] as const;

export const ISSUED_TO_TYPES = ['student', 'employee', 'class'] as const;

export const RESPONSIBLE_TYPES = ['student', 'teacher', 'wear_and_tear', 'unknown'] as const;

export const BREAKAGE_CAUSES = ['accident', 'mishandling', 'wear_and_tear', 'manufacturing_defect'] as const;

export const BREAKAGE_ACTIONS = ['replaced', 'repaired', 'written_off', 'cost_recovered'] as const;

export const BREAKAGE_STATUSES = ['reported', 'resolved'] as const;

export const RETURN_CONDITIONS = ['good', 'damaged', 'lost'] as const;

export const CATEGORIES_BY_LAB_TYPE: Record<string, string[]> = {
  physics: ['Electricity', 'Electronics', 'Electromagnetic', 'Optics', 'Mechanics', 'Measurement', 'Thermodynamics', 'Waves', 'General'],
  chemistry: ['Chemicals', 'Glassware', 'Apparatus', 'Safety Equipment', 'Reagents', 'General'],
  biology: ['Microscopy', 'Specimens', 'Dissection', 'Lab Ware', 'Cultures', 'General'],
  computer: ['Hardware', 'Peripherals', 'Networking', 'Cables', 'General'],
  language: ['Audio', 'Recording', 'Display', 'General'],
  mathematics: ['Measurement', 'Models', 'Geometry', 'General'],
  other: ['General'],
};

export const STATUS_VALUES = ['active', 'deleted'] as const;
export const LAB_STATUS_VALUES = ['active', 'inactive', 'deleted'] as const;

export const DEFAULTS = {
  REORDER_LEVEL: 0,
  CURRENT_STOCK: 0,
  STATUS: 'active',
  QUANTITY: 1,
  ITEM_CONDITION: 'good',
  BREAKAGE_STATUS: 'reported',
} as const;

// Type exports
export type LabType = typeof LAB_TYPES[number]['value'];
export type LabUnit = typeof LAB_UNITS[number]['value'];
export type ItemType = typeof ITEM_TYPES[number];
export type ItemCondition = typeof ITEM_CONDITIONS[number]['value'];
export type IssueType = typeof ISSUE_TYPES[number]['value'];
export type IssuedToType = typeof ISSUED_TO_TYPES[number];
export type ResponsibleType = typeof RESPONSIBLE_TYPES[number];
export type BreakageCause = typeof BREAKAGE_CAUSES[number];
export type BreakageAction = typeof BREAKAGE_ACTIONS[number];
export type BreakageStatus = typeof BREAKAGE_STATUSES[number];
export type ReturnCondition = typeof RETURN_CONDITIONS[number];
export type StatusValue = typeof STATUS_VALUES[number];
export type LabStatusValue = typeof LAB_STATUS_VALUES[number];
