import * as crypto from "crypto";

// Thin Razorpay client — no SDK dependency. Order creation via the REST API + the two
// HMAC-SHA256 signature verifications (checkout + webhook). Every call is gated on config
// so the module deploys inert until the keys are set and PAYMENTS_ENABLED='true'.

const keyId = () => process.env.RAZORPAY_KEY_ID || "";
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || "";
const webhookSecret = () => process.env.RAZORPAY_WEBHOOK_SECRET || "";

// Keys present → we *could* transact. Enabled → the owner has flipped it on. The app
// button is gated on enabled(); order creation requires it too.
export const paymentsConfigured = (): boolean => !!(keyId() && keySecret());
export const paymentsEnabled = (): boolean =>
  paymentsConfigured() && String(process.env.PAYMENTS_ENABLED || "").toLowerCase() === "true";

export const publicKeyId = (): string => keyId();

// Create an order. amountPaise is an integer (₹ * 100). `notes` ride along for the
// dashboard + the webhook payload.
export async function createOrder(
  amountPaise: number,
  receipt: string,
  notes: Record<string, string>,
): Promise<{ id: string; amount: number; currency: string }> {
  const auth = Buffer.from(`${keyId()}:${keySecret()}`).toString("base64");
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
export const verifyCheckoutSignature = (orderId: string, paymentId: string, signature: string): boolean =>
  safeEqual(hmac(`${orderId}|${paymentId}`, keySecret()), signature);

// Webhook: signature (X-Razorpay-Signature) = HMAC(raw_request_body, webhook_secret).
export const verifyWebhookSignature = (rawBody: string, signature: string): boolean =>
  !!webhookSecret() && safeEqual(hmac(rawBody, webhookSecret()), signature);
