// Hardcoded unit types for dropdown
export const MEDICAL_UNITS = [
  { value: 'tablet', label: 'Tablet' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'ml', label: 'ML (Milliliter)' },
  { value: 'tube', label: 'Tube' },
  { value: 'sachet', label: 'Sachet' },
  { value: 'strip', label: 'Strip' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'piece', label: 'Piece' },
  { value: 'roll', label: 'Roll' },
  { value: 'pair', label: 'Pair' },
  { value: 'box', label: 'Box' },
] as const;

export const ENTITY_TYPES = ['employee', 'student'] as const;
export const STATUS_VALUES = ['active', 'deleted'] as const;

// Default values (handled in application code, not DDL)
export const DEFAULTS = {
  REORDER_LEVEL: 0,
  CURRENT_STOCK: 0,
  STATUS: 'active',
  QUANTITY: 1,
  PARENT_CONSENT: false,
} as const;

// Type exports
export type MedicalUnit = typeof MEDICAL_UNITS[number]['value'];
export type EntityType = typeof ENTITY_TYPES[number];
export type StatusValue = typeof STATUS_VALUES[number];
