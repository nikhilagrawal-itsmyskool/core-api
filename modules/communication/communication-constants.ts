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

export const JOB_STATUSES = ['queued', 'running', 'completed', 'failed', 'canceled'] as const;
export const RECIPIENT_STATUSES = ['pending', 'sent', 'delivered', 'read', 'failed', 'skipped'] as const;

export const DEFAULTS = {
  STATUS: 'active',
  LANGUAGE: 'en',
  PROVIDER: process.env.COMM_PROVIDER || 'stub',
} as const;

export type TemplateStatus = typeof TEMPLATE_STATUSES[number];
export type HeaderType = typeof HEADER_TYPES[number];
export type JobStatus = typeof JOB_STATUSES[number];
export type RecipientStatus = typeof RECIPIENT_STATUSES[number];
