// Transfer (TC) module constants.

export const TC_STATUS_VALUES = ['applied', 'issued', 'cancelled', 'deleted'] as const;

export const DEFAULTS = {
  STATUS: 'applied',
} as const;

export type TcStatus = typeof TC_STATUS_VALUES[number];

// ── TC Config (per-school, god-only) ──────────────────────────────────────────
// Issue-time dues gate behaviour: block (default) stops non-god issue while dues
// are outstanding; warn surfaces the amount but allows; off skips the check.
export const DUES_GATE_MODES = ['block', 'warn', 'off'] as const;
export type DuesGateMode = typeof DUES_GATE_MODES[number];

// Field 10 "whether failed, once/twice in the same class" and field 12 promotion.
export const FAILED_VALUES = ['no', 'once', 'twice'] as const;
export const YES_NO_VALUES = ['yes', 'no'] as const;

// Factory config used when a school has no transfer_config row (or for unset fields).
// Schools override these on the Config screen; the certificate adapts without code changes.
export const CONFIG_DEFAULTS = {
  duesGateMode: 'block' as DuesGateMode,
  tcBookNo: '',
  srnPrefix: '',
  tcNumberPrefix: '',
  defaultResult: 'EXCELLENT',
  defaultConduct: 'EXCELLENT',
  defaultPromotion: 'yes',
  defaultFailed: 'no',
  defaultDuesPaidUpto: 'MARCH',
  defaultNcc: '-',
  resultOptions: ['EXCELLENT', 'VERY GOOD', 'GOOD', 'SATISFACTORY', 'PASS'],
  conductOptions: ['EXCELLENT', 'VERY GOOD', 'GOOD', 'SATISFACTORY'],
  autoDeriveSubjects: true,
  // Off by default: identity (DOB/parents/category/etc.) is entered on the STUDENT record
  // and derived live. Turn on only to allow filling/correcting it from the TC form.
  allowIdentityOverride: false,
} as const;
