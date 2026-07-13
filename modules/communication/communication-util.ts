import {
  Channel, ContactRole, RecipientType,
  CHANNEL_VALUES, STUDENT_ROLES, EMPLOYEE_ROLES, DEFAULT_CHANNEL_ORDER,
} from './communication-constants';
import { AudienceTarget, LadderMatch } from './communication-interfaces';

export function numberKey(role: ContactRole, channel: Channel): string {
  return `${role}:${channel}`;
}

function rolesFor(type: RecipientType): ContactRole[] {
  return type === 'student' ? STUDENT_ROLES : EMPLOYEE_ROLES;
}

function isValidChannel(c: string): c is Channel {
  return (CHANNEL_VALUES as string[]).includes(c);
}

// Parse a communication_preference string into an ordered token list, dropping
// tokens whose role/channel are invalid for the recipient type. Returns [] when
// nothing valid is present (caller falls back to the default ladder).
export function parsePreference(preference: string | null | undefined, type: RecipientType): LadderToken[] {
  if (!preference || !preference.trim()) return [];
  const validRoles = new Set<string>(rolesFor(type));
  const tokens: LadderToken[] = [];
  for (const raw of preference.split(',')) {
    const part = raw.trim().toLowerCase();
    if (!part) continue;
    const [role, channel] = part.split(':').map((s) => s.trim());
    if (!validRoles.has(role) || !isValidChannel(channel)) continue;
    tokens.push({ role: role as ContactRole, channel: channel as Channel });
  }
  return tokens;
}

export interface LadderToken {
  role: ContactRole;
  channel: Channel;
}

// Default ladder when no (valid) preference is set: WhatsApp-first, then SMS,
// across the recipient type's roles in order.
export function defaultLadder(type: RecipientType): LadderToken[] {
  const tokens: LadderToken[] = [];
  for (const channel of DEFAULT_CHANNEL_ORDER) {
    for (const role of rolesFor(type)) {
      tokens.push({ role, channel });
    }
  }
  return tokens;
}

// Tokens used when a fixed channel is forced (admin broadcast): that channel
// only, across the type's roles in order.
function forcedLadder(type: RecipientType, channel: Channel): LadderToken[] {
  return rolesFor(type).map((role) => ({ role, channel }));
}

// Walk the ladder for one target and return the first fully-resolvable token: a
// channel that has an approved template AND a non-empty contact number. Returns
// null when nothing in the ladder resolves (caller marks the recipient skipped).
export function resolveLadder(
  target: AudienceTarget,
  availableChannels: Set<Channel>,
  forceChannel?: Channel | null,
): LadderMatch | null {
  let tokens: LadderToken[];
  if (forceChannel) {
    tokens = forcedLadder(target.recipientType, forceChannel);
  } else {
    const pref = parsePreference(target.preference, target.recipientType);
    tokens = pref.length > 0 ? pref : defaultLadder(target.recipientType);
  }

  for (const { role, channel } of tokens) {
    if (!availableChannels.has(channel)) continue;
    const num = target.numbers[numberKey(role, channel)];
    if (!num || !String(num).trim()) continue;
    return { role, channel, toNumber: String(num).trim() };
  }
  return null;
}

// Build the role:channel -> number map for a student DB row (camelCase keys).
export function studentNumbers(row: any): Record<string, string | null | undefined> {
  return {
    'father:whatsapp': row.fatherWhatsapp,
    'father:sms': row.fatherMobile,
    'mother:whatsapp': row.motherWhatsapp,
    'mother:sms': row.motherMobile,
    'guardian:whatsapp': row.guardianWhatsapp,
    'guardian:sms': row.guardianMobile,
  };
}

// Build the role:channel -> number map for an employee DB row.
export function employeeNumbers(row: any): Record<string, string | null | undefined> {
  return {
    'self:whatsapp': row.whatsapp,
    'self:sms': row.mobile,
  };
}

// Context the worker auto-injects, so it's filled by the system NOT the sender —
// the Compose UI subtracts these from a template's variables and only prompts for
// the rest. `AUTO_CONTEXT_KEYS` is the authoritative list (exposed via the lookups
// endpoint); the builders below produce the values. Keep the two in sync.
//   common   — job-level, same for every recipient (from the school record)
//   student  — per-recipient (from the student row)
//   employee — per-recipient (from the employee row)
export const AUTO_CONTEXT_KEYS = {
  common: ['schoolCode', 'schoolName'],
  student: ['recipientName', 'studentName', 'admissionNumber'],
  employee: ['recipientName', 'employeeName'],
} as const;

export function autoContext(type: RecipientType, row: any): Record<string, string> {
  return type === 'student'
    ? { recipientName: row.name, studentName: row.name, admissionNumber: row.admissionNumber }
    : { recipientName: row.name, employeeName: row.name };
}

// Job-level context resolved once per job from the school record — keeps a single
// template usable across schools (e.g. a {{schoolName}} signature). Keys must
// match AUTO_CONTEXT_KEYS.common.
export function schoolContext(school: any): Record<string, string> {
  return { schoolCode: school?.code || '', schoolName: school?.name || '' };
}

// Resolve a template's ordered variables from a context object. Returns the
// ordered values plus any names that were missing/empty (so the caller can skip
// a recipient before sending an under-filled template).
export function resolveVariables(
  variables: string[] | null | undefined,
  context: Record<string, any>,
): { values: string[]; missing: string[] } {
  const values: string[] = [];
  const missing: string[] = [];
  for (const name of variables || []) {
    const v = context ? context[name] : undefined;
    if (v === undefined || v === null || String(v).trim() === '') {
      missing.push(name);
      values.push('');
    } else {
      values.push(String(v));
    }
  }
  return { values, missing };
}
