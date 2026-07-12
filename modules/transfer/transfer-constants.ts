// Transfer (TC) module constants.

export const TC_STATUS_VALUES = ['applied', 'issued', 'cancelled', 'deleted'] as const;

export const DEFAULTS = {
  STATUS: 'applied',
} as const;

export type TcStatus = typeof TC_STATUS_VALUES[number];
