// Cloudflare Turnstile (free CAPTCHA) verification for the login endpoints.
// The widget lives on the admin-portal login form; here we validate the token it
// produced against Cloudflare's siteverify API before accepting a login.
//
// FEATURE-FLAGGED by TURNSTILE_SECRET (injected via configs/<stage>/<stage>.yml):
//   - secret unset/empty -> DISABLED, verifyTurnstile() always passes. This is what
//     makes rollout safe: deploy the backend first (no-op), ship the frontend widget,
//     then set the secret to switch enforcement on once tokens are actually flowing.
//   - secret set -> a valid token is REQUIRED. A missing token fails closed (real
//     bot/misuse signal); a Cloudflare/network error fails OPEN (availability —
//     never lock staff out of the portal because Cloudflare is down).
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function turnstileEnabled(): boolean {
  return !!(process.env.TURNSTILE_SECRET && process.env.TURNSTILE_SECRET.trim());
}

export async function verifyTurnstile(token: string | undefined | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret || !secret.trim()) return true; // disabled -> pass through
  if (!token || !String(token).trim()) return false; // enabled but no token -> fail closed
  try {
    const form = new URLSearchParams();
    form.append('secret', secret.trim());
    form.append('response', String(token));
    if (ip && ip !== 'unknown') form.append('remoteip', ip);
    const resp = await fetch(VERIFY_URL, { method: 'POST', body: form });
    const data: any = await resp.json();
    return !!data.success;
  } catch (e) {
    console.error('turnstile verify failed (fail-open):', e);
    return true; // Cloudflare unreachable -> don't block logins
  }
}
