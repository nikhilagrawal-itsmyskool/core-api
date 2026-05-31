export const FINE_CATEGORIES = [
  { value: 'library', label: 'Library' },
  { value: 'infrastructure_movable', label: 'Infrastructure - Movable' },
  { value: 'infrastructure_immovable', label: 'Infrastructure - Immovable' },
  { value: 'library_books', label: 'Library Books' },
  { value: 'medical', label: 'Medical' },
  { value: 'labs', label: 'Labs' },
] as const;

export const FINE_STATUSES = [
  { value: 'open', label: 'Open', description: 'Incident reported, pending action' },
  { value: 'under_review', label: 'Under Review', description: 'Assigned and being investigated' },
  { value: 'decision_made', label: 'Decision Made', description: 'Fine amount decided or waived' },
  { value: 'closed', label: 'Closed', description: 'Fine collected or case closed' },
] as const;

export const FINE_DECISIONS = [
  { value: 'collect', label: 'Collect Fine', description: 'Collect the decided fine amount' },
  { value: 'waive', label: 'Waive Fine', description: 'No fine to be collected' },
] as const;

export const FINE_PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online Transfer' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'dd', label: 'Demand Draft' },
] as const;

export const PERSON_TYPES = ['student', 'employee'] as const;

export const CATEGORY_VALUES = FINE_CATEGORIES.map(c => c.value);
export const STATUS_VALUES = FINE_STATUSES.map(s => s.value);
export const DECISION_VALUES = FINE_DECISIONS.map(d => d.value);
export const PAYMENT_METHOD_VALUES = FINE_PAYMENT_METHODS.map(p => p.value);

// Valid status transitions: key = current status, value = allowed next statuses
export const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  open: ['under_review', 'decision_made'],
  under_review: ['open', 'decision_made'],
  decision_made: ['closed'],
  closed: [],
};

export type FineCategory = typeof CATEGORY_VALUES[number];
export type FineStatus = typeof STATUS_VALUES[number];
export type FineDecision = typeof DECISION_VALUES[number];
export type FinePaymentMethod = typeof PAYMENT_METHOD_VALUES[number];
export type PersonType = typeof PERSON_TYPES[number];

export const DEFAULTS = {
  STATUS: 'open' as FineStatus,
};
