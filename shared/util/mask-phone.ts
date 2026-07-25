// Partial redaction for sensitive contact numbers (mobile / WhatsApp).
//
// Policy: numbers are revealed only to admin/god employees or the number's own
// owner; everyone else (and tokenless callers) sees the masked value. This is the
// authoritative masking — it runs in the API before the value leaves the backend,
// because there is no gateway authorizer and the raw JSON would otherwise be
// readable by anyone with the (non-secret) X-School-Code.
//
// Format: keep the last 2 digits, mask the rest — "9876543210" -> "••••••••10".
// Use the default '•' for JSON/UI; pass ch:'*' for CSV/plaintext exports.

const DOT = '•';

export function maskPhone(value: unknown, opts: { visible?: number; ch?: string } = {}): string {
  const visible = opts.visible ?? 2;
  const ch = opts.ch ?? DOT;
  if (value === null || value === undefined || value === '') return value as string;
  const v = String(value).trim();
  if (v.length <= visible) return ch.repeat(Math.max(v.length, 4));
  return ch.repeat(v.length - visible) + v.slice(-visible);
}

// Masks the given top-level keys on an object in place (no-op when reveal is true,
// or the value is null/empty). Returns the same object for chaining. `keys` are
// camelCase response keys (e.g. 'mobile', 'whatsapp', 'fatherMobile', 'toNumber').
export function maskContactFields<T extends Record<string, any>>(
  target: T | null | undefined,
  keys: string[],
  reveal: boolean,
  opts?: { ch?: string }
): T | null | undefined {
  if (!target || reveal) return target;
  for (const k of keys) {
    const val = target[k];
    if (val !== null && val !== undefined && val !== '') {
      (target as Record<string, any>)[k] = maskPhone(val, opts);
    }
  }
  return target;
}
