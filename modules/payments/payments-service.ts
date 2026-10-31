import { DB, singleLineString } from "../../shared/lib/db";
import { BadRequestResult, BusinessErrorResult, NotFoundResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { resolveStudentEnrollment } from "../../shared/lib/student-context";
import { PAISE, PROVIDER, isFineLabel } from "./payments-constants";
import { Allocation, PayableCycle, PayableResponse, CreateOrderResponse, PaymentResult } from "./payments-interfaces";
import * as rzp from "./razorpay";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");
const { serviceAuthHeader } = require("../../shared/util/service-token.js");

// Other modules sit behind the same API domain; default to the local gateway for dev.
const API_BASE = process.env.FEES_BASE_URL || process.env.COMM_BASE_URL || "http://localhost:3000";
const n = (v: any): number => (v == null ? 0 : Number(v));
const nrm = (s: any): string => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

class PaymentsService {
  // ── fees public API (service token) ─────────────────────────────────────────
  private svcHeaders(schoolCode: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "X-School-Code": schoolCode,
      Authorization: serviceAuthHeader({ name: "payments", secret: process.env.JWT_SECRET, magicKey: process.env.JWT_MAGIC_KEY }),
    };
  }

  private async feesLedger(schoolCode: string, studentId: string, academicYearId: string): Promise<{ lines: any[] }> {
    const res = await fetch(`${API_BASE}/fees/students/${studentId}/ledger?academicYearId=${encodeURIComponent(academicYearId)}`, {
      headers: this.svcHeaders(schoolCode),
    });
    if (!res.ok) throw new BusinessErrorResult(ErrorCode.BusinessError, `Could not load fees (${res.status})`);
    const json: any = await res.json();
    return { lines: Array.isArray(json?.lines) ? json.lines : [] };
  }

  private async feesCollect(schoolCode: string, body: any): Promise<{ uuid?: string; receiptNo?: string }> {
    const res = await fetch(`${API_BASE}/fees/receipts`, { method: "POST", headers: this.svcHeaders(schoolCode), body: JSON.stringify(body) });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new BusinessErrorResult(ErrorCode.BusinessError, `Fee receipt failed (${res.status}): ${json?.error?.message || JSON.stringify(json)}`);
    // collect() returns the receipt; tolerate a couple of shapes.
    const r = json?.receipt || json;
    return { uuid: r?.uuid || r?.receiptId, receiptNo: r?.receiptNo || r?.receipt_no };
  }

  // ── payable cycles ──────────────────────────────────────────────────────────
  // Group the student's open charges into payable units (a fee cycle, or a standalone
  // head), folding each cycle's late fine into it. Returns the cycles + their ledger ids
  // keyed by an opaque `key` (we keep the ids server-side).
  private group(lines: any[]): Map<string, { cycle: PayableCycle; allocs: Allocation[] }> {
    const today = todayIso();
    const groups = new Map<string, { cycle: PayableCycle; allocs: Allocation[] }>();
    for (const l of lines) {
      if (n(l.remaining) <= 0) continue;
      const key = l.cycleId ? `cyc:${l.cycleId}` : l.cycleLabel ? `lbl:${nrm(l.cycleLabel)}` : `chg:${l.chargeId}`;
      let g = groups.get(key);
      if (!g) {
        g = { cycle: { key, cycleLabel: l.cycleLabel || l.headLabel || "Fee", amount: 0, fine: 0, total: 0, dueDate: l.dueDate || null, overdue: false, due: false }, allocs: [] };
        groups.set(key, g);
      }
      const rem = n(l.remaining);
      if (isFineLabel(l.headLabel)) g.cycle.fine += rem;
      else g.cycle.amount += rem;
      g.cycle.total += rem;
      if (!g.cycle.dueDate && l.dueDate) g.cycle.dueDate = l.dueDate;
      if (l.dueDate && l.dueDate < today) g.cycle.overdue = true;
      if (l.bucket === "due") g.cycle.due = true;
      g.allocs.push({ ledgerId: l.chargeId, amount: rem });
    }
    return groups;
  }

  async payable(schoolId: string, schoolCode: string, studentId: string, academicYearId: string | null): Promise<PayableResponse> {
    const enabled = (await rzp.resolveConfig(schoolCode)).enabled;
    const ay = academicYearId || (await resolveStudentEnrollment(schoolId, studentId))?.academicYearId || null;
    if (!ay) return { enabled, academicYearId: null, currency: "INR", cycles: [], totalDue: 0 };
    const { lines } = await this.feesLedger(schoolCode, studentId, ay);
    const groups = this.group(lines);
    const cycles = [...groups.values()].map((g) => g.cycle);
    const totalDue = cycles.reduce((s, c) => s + c.total, 0);
    return { enabled, academicYearId: ay, currency: "INR", cycles, totalDue };
  }

  // ── create order ──────────────────────────────────────────────────────────────
  async createOrder(args: {
    schoolId: string; schoolCode: string; studentId: string; academicYearId: string | null;
    userId: string; cycleKeys: string[];
  }): Promise<CreateOrderResponse> {
    const cfg = await rzp.resolveConfig(args.schoolCode);
    if (!cfg.enabled) throw new BusinessErrorResult(ErrorCode.BusinessError, "Online payment is not available yet");
    const keys = [...new Set((args.cycleKeys || []).filter(Boolean))];
    if (!keys.length) throw new BadRequestResult(ErrorCode.InvalidInput, "Select at least one cycle to pay");

    // Payer: the family login username is the father's mobile (doubles as Razorpay prefill).
    const payerRows: any[] = await DB.query(
      singleLineString`select name, family_unique_number from student where uuid=$1 and school_id=$2`,
      [args.studentId, args.schoolId],
    );
    const studentName: string | null = payerRows[0]?.name || null;
    const familyNumber: string | null = (payerRows[0]?.familyUniqueNumber || "").trim() || null;

    const enroll = await resolveStudentEnrollment(args.schoolId, args.studentId);
    const ay = args.academicYearId || enroll?.academicYearId || null;
    if (!ay) throw new BusinessErrorResult(ErrorCode.BusinessError, "No active academic year for this student");

    // Re-fetch the ledger NOW and resolve the selected keys to their current charges —
    // we charge exactly what's open at order time and snapshot it on the intent.
    const { lines } = await this.feesLedger(args.schoolCode, args.studentId, ay);
    const groups = this.group(lines);
    const allocations: Allocation[] = [];
    for (const k of keys) {
      const g = groups.get(k);
      if (!g) throw new BusinessErrorResult(ErrorCode.BusinessError, "Those dues have changed — please reopen the payment and try again");
      allocations.push(...g.allocs);
    }
    const amount = Math.round(allocations.reduce((s, a) => s + n(a.amount), 0) * 100) / 100;
    if (amount <= 0) throw new BusinessErrorResult(ErrorCode.BusinessError, "Nothing to pay on the selected cycles");
    const amountPaise = Math.round(amount * PAISE);

    const intentId = generateShortUuid(12);
    const order = await rzp.createOrder(cfg, amountPaise, intentId, {
      schoolCode: args.schoolCode, studentId: args.studentId, intentId,
    });

    const now = new Date();
    await DB.query(
      singleLineString`insert into payment_intent
        (uuid, school_id, school_code, student_id, academic_year_id, family_number, amount, allocations, provider, order_id, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'created',$11,$12)`,
      [intentId, args.schoolId, args.schoolCode, args.studentId, ay, familyNumber, amount, JSON.stringify(allocations), PROVIDER, order.id, args.userId, now],
    );

    return {
      intentId, orderId: order.id, amount, amountPaise, currency: "INR",
      keyId: cfg.keyId,
      prefill: { name: studentName || undefined, contact: familyNumber || undefined },
      studentName,
    };
  }

  // ── reconcile (idempotent) ──────────────────────────────────────────────────
  // CAS claim: only the caller that moves created→paid collects. The verify/webhook
  // race therefore yields at most ONE fee receipt. A mid-collect crash strands at
  // 'paid' (money captured, receipt pending) — safe + recoverable, never a double.
  private async reconcile(intentId: string, paymentId: string, signature: string): Promise<PaymentResult> {
    const now = new Date();
    const claim: any[] = await DB.query(
      singleLineString`update payment_intent set status='paid', payment_id=$2, signature=$3, updated_at=$4
        where uuid=$1 and status='created' returning *`,
      [intentId, paymentId, signature, now],
    );
    if (!claim.length) {
      // We lost the claim (or it's a repeat). Report the current terminal/interim state.
      const cur: any[] = await DB.query(singleLineString`select status, receipt_id from payment_intent where uuid=$1`, [intentId]);
      const row = cur[0];
      if (!row) throw new NotFoundResult(ErrorCode.InvalidId, "Payment not found");
      return { status: row.status, receiptId: row.receiptId || null };
    }

    const intent = claim[0];
    const allocations: Allocation[] = Array.isArray(intent.allocations) ? intent.allocations : JSON.parse(intent.allocations || "[]");
    try {
      const receipt = await this.feesCollect(intent.schoolCode, {
        studentId: intent.studentId, academicYearId: intent.academicYearId,
        paymentMode: "online", txnRef: paymentId, receivedFrom: intent.familyNumber || undefined,
        remarks: "Online payment (Razorpay)", type: "fee",
        allocations: allocations.map((a) => ({ ledgerId: a.ledgerId, amount: a.amount })),
      });
      await DB.query(
        singleLineString`update payment_intent set status='reconciled', receipt_id=$2, updated_at=$3 where uuid=$1`,
        [intentId, receipt.uuid || null, new Date()],
      );
      return { status: "reconciled", receiptId: receipt.uuid || null, receiptNo: receipt.receiptNo || null };
    } catch (e: any) {
      // Leave at 'paid' (money captured; receipt pending) — do NOT revert to 'created',
      // which could double-collect if the fees write actually landed. Recoverable.
      await DB.query(singleLineString`update payment_intent set error=$2, updated_at=$3 where uuid=$1`, [intentId, String(e?.message || e).slice(0, 500), new Date()]);
      return { status: "paid", receiptId: null };
    }
  }

  // App confirm path: verify the checkout signature, then reconcile. Ownership-checked.
  async verify(schoolId: string, studentId: string, body: { intentId: string; orderId: string; paymentId: string; signature: string }): Promise<PaymentResult> {
    if (!body?.intentId || !body?.orderId || !body?.paymentId || !body?.signature)
      throw new BadRequestResult(ErrorCode.InvalidInput, "intentId, orderId, paymentId, signature are required");
    const rows: any[] = await DB.query(
      singleLineString`select * from payment_intent where uuid=$1 and school_id=$2 and student_id=$3 and order_id=$4`,
      [body.intentId, schoolId, studentId, body.orderId],
    );
    if (!rows.length) throw new NotFoundResult(ErrorCode.InvalidId, "Payment not found");
    const cfg = await rzp.resolveConfig(rows[0].schoolCode);
    if (!rzp.verifyCheckoutSignature(body.orderId, body.paymentId, body.signature, cfg.keySecret))
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Payment signature verification failed");
    return this.reconcile(body.intentId, body.paymentId, body.signature);
  }

  // Webhook path: find the intent by order id FIRST (so we know which school's webhook
  // secret to verify with — each school's Razorpay signs with its own secret), verify, then
  // reconcile. Reading order_id from the unverified body is safe: reconcile is still gated by
  // the HMAC check over the raw body with that school's secret.
  async handleWebhookEvent(payload: any, signature: string, rawBody: string): Promise<{ ok: boolean }> {
    const event = payload?.event;
    const entity = payload?.payload?.payment?.entity;
    if (!entity || !["payment.captured", "payment.authorized"].includes(event)) return { ok: true }; // ignore others
    const orderId = entity.order_id;
    const paymentId = entity.id;
    if (!orderId || !paymentId) return { ok: true };
    const rows: any[] = await DB.query(singleLineString`select uuid, school_code from payment_intent where order_id=$1 and provider=$2`, [orderId, PROVIDER]);
    if (!rows.length) return { ok: true }; // unknown order — nothing to do
    const cfg = await rzp.resolveConfig(rows[0].schoolCode);
    if (!rzp.verifyWebhookSignature(rawBody, signature, cfg.webhookSecret)) throw new BusinessErrorResult(ErrorCode.BusinessError, "Invalid webhook signature");
    await this.reconcile(rows[0].uuid, paymentId, "webhook");
    return { ok: true };
  }
}

export const paymentsService = new PaymentsService();
