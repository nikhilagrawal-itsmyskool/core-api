/**
 * Get the default start date (30 days ago)
 */
export function getDefaultStartDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Get the default end date (today)
 */
export function getDefaultEndDate(): string {
  return new Date().toISOString().split('T')[0]; // YYYY-MM-DD
}

/**
 * Validate that a string is a valid date in YYYY-MM-DD format
 */
export function isValidDate(dateString: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  const date = new Date(dateString);
  return !isNaN(date.getTime());
}
