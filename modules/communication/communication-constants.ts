// Communication module constants.

export const CHANNELS = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'sms', label: 'SMS' },
] as const;

export type Channel = 'sms' | 'whatsapp';
export type ContactRole = 'father' | 'mother' | 'guardian' | 'self';
export type RecipientType = 'student' | 'employee';

export const CHANNEL_VALUES: Channel[] = ['sms', 'whatsapp'];

// Roles that exist per recipient type, in default preference order.
export const STUDENT_ROLES: ContactRole[] = ['father', 'mother', 'guardian'];
export const EMPLOYEE_ROLES: ContactRole[] = ['self'];

// Default channel order when communication_preference is empty: WhatsApp first,
// then SMS (confirmed product decision).
export const DEFAULT_CHANNEL_ORDER: Channel[] = ['whatsapp', 'sms'];

export const TEMPLATE_STATUSES = ['active', 'inactive', 'deleted'] as const;
export const HEADER_TYPES = ['none', 'text', 'image'] as const;

// Job lifecycle: queued -> expanding (roster being resolved into recipient rows)
// -> sending (recipients being drained in batches) -> completed. `running` is
// retained for backward-compat with any pre-batching in-flight jobs.
export const JOB_STATUSES = ['queued', 'expanding', 'sending', 'running', 'completed', 'failed', 'canceled'] as const;
// Recipient lifecycle: pending -> sending (claimed by a send batch) -> sent/failed/skipped.
export const RECIPIENT_STATUSES = ['pending', 'sending', 'sent', 'delivered', 'read', 'failed', 'skipped'] as const;

export const DEFAULTS = {
  STATUS: 'active',
  LANGUAGE: 'en',
  PROVIDER: process.env.COMM_PROVIDER || 'stub',
} as const;

// Job-level retry policy. A job that throws (e.g. no active template, DB blip,
// audience-resolution error) is requeued with exponential backoff until
// MAX_ATTEMPTS is exhausted, then marked terminally failed. Note: this governs
// whole-job failures only; a single recipient's send failure is recorded on its
// message_recipient row and does not retry.
export const RETRY = {
  MAX_ATTEMPTS: 5,
  BASE_BACKOFF_SECONDS: 30,
  MAX_BACKOFF_SECONDS: 900,
} as const;

// A large broadcast (e.g. "all students") is NOT sent in one shot. The job is
// expanded once into per-recipient rows, then those rows are drained a small
// batch at a time — one batch per processNext call — so no single invocation can
// run long enough to hit the Lambda timeout. A 1000-person send simply spans a
// few 1-minute EventBridge ticks, with durable per-row progress in between.
export const SEND_BATCH_SIZE = 20;

// Crash recovery thresholds (seconds), swept by the reaper on each processNext.
// Delivery is at-least-once: a recipient claimed for sending whose result was
// never written (invocation killed mid-batch) is returned to `pending` and
// retried — worst case one duplicate message. Per-row marking keeps that window
// to a single recipient. An `expanding` job that stalled is requeued to `queued`
// (expansion is atomic + idempotent, so re-running is safe).
export const REAPER = {
  EXPANDING_STALE_SECONDS: 120,
  SENDING_RECIPIENT_STALE_SECONDS: 120,
} as const;

export type TemplateStatus = typeof TEMPLATE_STATUSES[number];
export type HeaderType = typeof HEADER_TYPES[number];
export type JobStatus = typeof JOB_STATUSES[number];
export type RecipientStatus = typeof RECIPIENT_STATUSES[number];
