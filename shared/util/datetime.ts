// AWS Lambdas run in UTC, so new Date()/Date.now() is a UTC instant and
// new Date().toISOString() is the UTC calendar day — which reads as YESTERDAY
// between 00:00 and 05:30 IST. The school runs on IST (UTC+5:30, no DST), so any
// server-computed "today"/current day must be shifted to IST first.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Today's calendar date in IST as YYYY-MM-DD. Use this instead of
 * new Date().toISOString().slice(0,10) anywhere a "current day" is needed.
 */
export function istToday(): string {
  return new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Get the default start date (30 days ago, IST)
 */
export function getDefaultStartDate(): string {
  const date = new Date(Date.now() + IST_OFFSET_MS);
  date.setUTCDate(date.getUTCDate() - 30);
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (IST)
}

/**
 * Get the default end date (today, IST)
 */
export function getDefaultEndDate(): string {
  return istToday();
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
