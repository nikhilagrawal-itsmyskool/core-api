import * as crypto from "crypto";
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";

// Thin Razorpay client — no SDK dependency for the API itself. MULTI-SCHOOL: each school's
// credentials live in an SSM SecureString `/itsmyskool/prod/razorpay/<schoolcode>` (JSON:
// { keyId, keySecret, webhookSecret, enabled }), so onboarding a school = drop in one SSM
// param, NO redeploy. Money settles to each school's OWN Razorpay/bank. Falls back to env
// (global `RAZORPAY_*` + `PAYMENTS_ENABLED`) — the current DBPASN wiring — when no SSM param
// exists. The shared Lambda role already grants ssm:GetParameter + kms:Decrypt on
// /itsmyskool/prod/*. Inert until a school's keys are set AND enabled.

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  configured: boolean; // keys present → could transact
  enabled: boolean;    // configured AND turned on
}

const norm = (schoolCode: string): string => String(schoolCode || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const REGION = process.env.AWS_REGION || "ap-south-1";
let ssm: SSMClient | null = null;
const client = (): SSMClient => (ssm ||= new SSMClient({ region: REGION }));

// Cache resolved config per school (incl. "not configured") so warm Lambdas don't hit SSM
// every request. A new/changed SSM param takes effect within the TTL.
const cache = new Map<string, { cfg: RazorpayConfig; exp: number }>();
const TTL_MS = 5 * 60 * 1000;

async function fromSsm(s: string): Promise<Partial<RazorpayConfig> | null> {
  try {
    const res = await client().send(new GetParameterCommand({ Name: `/itsmyskool/prod/razorpay/${s}`, WithDecryption: true }));
    const v = res.Parameter?.Value;
    if (!v) return null;
    const j = JSON.parse(v);
    return {
      keyId: j.keyId || "",
      keySecret: j.keySecret || "",
      webhookSecret: j.webhookSecret || "",
      enabled: j.enabled === true || String(j.enabled).toLowerCase() === "true",
    };
  } catch {
    return null; // ParameterNotFound / transient → fall back to env (fail closed)
  }
}

function fromEnv(s: string): RazorpayConfig {
  const upper = s.toUpperCase();
  const keyId = process.env[`RAZORPAY_${upper}_KEY_ID`] || process.env.RAZORPAY_KEY_ID || "";
  const keySecret = process.env[`RAZORPAY_${upper}_KEY_SECRET`] || process.env.RAZORPAY_KEY_SECRET || "";
  const webhookSecret = process.env[`RAZORPAY_${upper}_WEBHOOK_SECRET`] || process.env.RAZORPAY_WEBHOOK_SECRET || "";
  const flag = process.env[`PAYMENTS_${upper}_ENABLED`] ?? process.env.PAYMENTS_ENABLED;
  const configured = !!(keyId && keySecret);
  return { keyId, keySecret, webhookSecret, configured, enabled: configured && String(flag || "").toLowerCase() === "true" };
}

// Resolve a school's Razorpay config (SSM first, env fallback), cached.
export async function resolveConfig(schoolCode: string): Promise<RazorpayConfig> {
  const s = norm(schoolCode);
  const hit = cache.get(s);
  if (hit && hit.exp > Date.now()) return hit.cfg;

  let cfg: RazorpayConfig;
  const ssmCfg = await fromSsm(s);
  if (ssmCfg && ssmCfg.keyId && ssmCfg.keySecret) {
    cfg = { keyId: ssmCfg.keyId, keySecret: ssmCfg.keySecret, webhookSecret: ssmCfg.webhookSecret || "", configured: true, enabled: !!ssmCfg.enabled };
  } else {
    cfg = fromEnv(s);
  }
  cache.set(s, { cfg, exp: Date.now() + TTL_MS });
  return cfg;
}

// Create an order with a school's credentials. amountPaise is an integer (₹ * 100).
export async function createOrder(
  cfg: RazorpayConfig,
  amountPaise: number,
  receipt: string,
  notes: Record<string, string>,
): Promise<{ id: string; amount: number; currency: string }> {
  const auth = Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt, notes, payment_capture: 1 }),
  });
  const json: any = await res.json();
  if (!res.ok || !json?.id) {
    throw new Error(`Razorpay order failed: ${res.status} ${json?.error?.description || JSON.stringify(json)}`);
  }
  return { id: json.id, amount: json.amount, currency: json.currency };
}

const hmac = (payload: string, secret: string): string =>
  crypto.createHmac("sha256", secret).update(payload).digest("hex");

// constant-time compare to avoid timing leaks.
const safeEqual = (a: string, b: string): boolean => {
  const ba = Buffer.from(a || "", "utf8");
  const bb = Buffer.from(b || "", "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

// Checkout callback: signature = HMAC(order_id | payment_id, key_secret).
export const verifyCheckoutSignature = (orderId: string, paymentId: string, signature: string, keySecret: string): boolean =>
  !!keySecret && safeEqual(hmac(`${orderId}|${paymentId}`, keySecret), signature);

// Webhook: signature (X-Razorpay-Signature) = HMAC(raw_request_body, webhook_secret).
export const verifyWebhookSignature = (rawBody: string, signature: string, webhookSecret: string): boolean =>
  !!webhookSecret && safeEqual(hmac(rawBody, webhookSecret), signature);
