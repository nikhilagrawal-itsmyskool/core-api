// Default credential used when an employee login is auto-created or reset.
// NOTE: passwords are stored in plain text for now (accepted tradeoff).
export const DEFAULT_PASSWORD = 'Itsmyskool@123';

export const DEFAULT_STATUS = 'active';

// Status sets used for soft-delete filtering in queries.
export const ACTIVE_STATUS = "('active')";
export const ACTIVE_AND_DELETED_STATUS = "('active', 'deleted')";
