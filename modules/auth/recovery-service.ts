const jwt = require('jsonwebtoken');
import { createHash } from 'crypto';
import { DB, singleLineString } from '../../shared/lib/db';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');
const { serviceAuthHeader } = require('../../shared/util/service-token.js');

// Forgot-username / forgot-password engine shared by the parent app and the staff
// app. One phone number is the entry point; it hops to login accounts and drives an
// SMS OTP challenge. There is deliberately NO new password hashing here — the login
// tables store plaintext today, so a reset just writes the new plaintext (same as the
// existing change-password path). See modules/auth/DESIGN.md for the full flow.

export type UserType = 'parent' | 'staff';
export type Purpose = 'username' | 'password';

// --- guardrails (all enforced here, not in DDL) ------------------------------
const CODE_TTL_MIN = 10;       // OTP lifetime
const MAX_ATTEMPTS = 5;        // verify tries before an OTP is burned
const RESEND_COOLDOWN_SEC = 60;// min gap between two requests for the same phone
const REQUESTS_PER_HOUR = 5;   // per (school, phone) request cap in a rolling 60 min
const RESET_TOKEN_TTL_MIN = 5; // window to actually set the new password after verify
const MIN_PASSWORD_LEN = 6;
const MAX_PASSWORD_LEN = 128;

interface MatchedAccount {
  username: string;
  loginId: string;
}

export interface RequestCtx {
  schoolId: string;
  userType: UserType;
  purpose: Purpose;
  phone: string;
  schoolCode: string; // needed to call the communication module
  ip?: string;
  userAgent?: string;
}

export interface RequestResult {
  otpId: string;
  expiresInSec: number;
  resendInSec: number;
  devCode?: string; // only populated when OTP_DEV_ECHO=true and a real account matched
}

export interface VerifyResult {
  purpose: Purpose;
  usernames?: string[]; // purpose = username
  resetToken?: string;  // purpose = password
}

const pepper = (): string => process.env.OTP_PEPPER || process.env.JWT_SECRET || 'otp-pepper';

const hashCode = (code: string): string =>
  createHash('sha256').update(`${pepper()}:${code}`).digest('hex');

// 6-digit numeric OTP, uniformly in [100000, 999999]. Not for cryptographic keying —
// it is a short-lived, attempt-capped, rate-limited challenge — but drawn from crypto
// randomness anyway so it is not predictable.
const generateCode = (): string => {
  const { randomInt } = require('crypto');
  return String(randomInt(100000, 1000000));
};

const last10 = (raw: string): string => String(raw || '').replace(/\D/g, '').slice(-10);

export class RecoveryService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const rows = await DB.query(singleLineString`select uuid from school where lower(code) = lower($1)`, [schoolCode]);
    return rows.length > 0 ? rows[0].uuid : null;
  }

  // Resolve every login account reachable from this phone. Parents match any of the
  // six student contact columns; staff match the two employee columns. The phone is
  // compared on its last-10 digits so stored country codes / spacing don't matter.
  private async resolveAccounts(schoolId: string, userType: UserType, phone: string): Promise<MatchedAccount[]> {
    if (userType === 'parent') {
      const q = singleLineString`
        select distinct sl.uuid as login_id, sl.username
        from student s
        join student_login sl on sl.username = s.family_unique_number and sl.school_id = s.school_id
        where s.school_id = $1 and (s.status is null or s.status <> 'deleted') and (
             right(regexp_replace(coalesce(s.father_mobile,''),'\\D','','g'),10) = $2
          or right(regexp_replace(coalesce(s.father_whatsapp,''),'\\D','','g'),10) = $2
          or right(regexp_replace(coalesce(s.mother_mobile,''),'\\D','','g'),10) = $2
          or right(regexp_replace(coalesce(s.mother_whatsapp,''),'\\D','','g'),10) = $2
          or right(regexp_replace(coalesce(s.guardian_mobile,''),'\\D','','g'),10) = $2
          or right(regexp_replace(coalesce(s.guardian_whatsapp,''),'\\D','','g'),10) = $2)`;
      const rows = await DB.query(q, [schoolId, phone]);
      return rows.map((r: any) => ({ username: r.username, loginId: r.loginId }));
    }
    const q = singleLineString`
      select distinct el.uuid as login_id, el.username
      from employee e
      join employee_login el on el.username = e.family_unique_number and el.school_id = e.school_id
      where e.school_id = $1 and e.status = 'active' and (
           right(regexp_replace(coalesce(e.mobile,''),'\\D','','g'),10) = $2
        or right(regexp_replace(coalesce(e.whatsapp,''),'\\D','','g'),10) = $2)`;
    const rows = await DB.query(q, [schoolId, phone]);
    return rows.map((r: any) => ({ username: r.username, loginId: r.loginId }));
  }

  private async audit(
    schoolId: string, userType: UserType, username: string | null, phone: string,
    event: 'otp_requested' | 'username_revealed' | 'password_reset', ip?: string, userAgent?: string
  ): Promise<void> {
    try {
      await DB.query(
        singleLineString`insert into auth_recovery_audit (uuid, school_id, user_type, username, phone, event, ip, user_agent, created_at) values ($1,$2,$3,$4,$5,$6,$7,$8, now())`,
        [generateShortUuid(12), schoolId, userType, username, phone, event, ip || null, (userAgent || '').slice(0, 400) || null]
      );
    } catch (e) {
      console.error('recovery audit insert failed (non-fatal):', e);
    }
  }

  // Step 1. Always responds the same shape whether or not the phone matched an
  // account (anti-enumeration): a non-matching phone still gets an otpId and a stored
  // row, it just carries an unmatchable code and sends no SMS, so verify fails exactly
  // like a wrong code would.
  public async requestOtp(ctx: RequestCtx): Promise<RequestResult> {
    const phone = last10(ctx.phone);
    const nowResp: RequestResult = { otpId: '', expiresInSec: CODE_TTL_MIN * 60, resendInSec: RESEND_COOLDOWN_SEC };
    // OTP_DEV_ECHO is a local/test convenience; it also relaxes the per-phone rate
    // limits so a test suite can run the whole flow repeatedly without tripping them.
    const devEcho = process.env.OTP_DEV_ECHO === 'true';

    // Cooldown + hourly cap over recent rows for this (school, phone).
    if (!devEcho) {
      const recent = await DB.query(
        singleLineString`select created_at from login_otp where school_id = $1 and phone = $2 and created_at > now() - make_interval(mins => $3) order by created_at desc`,
        [ctx.schoolId, phone, 60]
      );
      if (recent.length > 0) {
        const lastAt = new Date(recent[0].createdAt).getTime();
        const sinceSec = (Date.now() - lastAt) / 1000;
        if (sinceSec < RESEND_COOLDOWN_SEC) {
          const err: any = new Error(`Please wait ${Math.ceil(RESEND_COOLDOWN_SEC - sinceSec)}s before requesting another code.`);
          err.retryable = true;
          throw err;
        }
      }
      if (recent.length >= REQUESTS_PER_HOUR) {
        throw new Error('Too many code requests. Please try again later.');
      }
    }

    const accounts = await this.resolveAccounts(ctx.schoolId, ctx.userType, phone);
    const code = generateCode();
    const otpId = generateShortUuid(12);
    const codeHash = accounts.length > 0 ? hashCode(code) : hashCode(generateShortUuid(12)); // unmatchable hash when no account

    await DB.query(
      singleLineString`insert into login_otp (uuid, school_id, user_type, purpose, phone, code_hash, matched_accounts, expires_at, attempts, consumed_at, reset_done_at, ip, user_agent, created_at, updated_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb, now() + make_interval(mins => $8), 0, null, null, $9, $10, now(), now())`,
      [otpId, ctx.schoolId, ctx.userType, ctx.purpose, phone, codeHash, JSON.stringify(accounts), CODE_TTL_MIN, ctx.ip || null, (ctx.userAgent || '').slice(0, 400) || null]
    );

    await this.audit(ctx.schoolId, ctx.userType, null, phone, 'otp_requested', ctx.ip, ctx.userAgent);

    if (accounts.length > 0) {
      await this.sendOtpSms(ctx.schoolCode, phone, code);
    }

    nowResp.otpId = otpId;
    if (accounts.length > 0 && process.env.OTP_DEV_ECHO === 'true') {
      nowResp.devCode = code;
    }
    return nowResp;
  }

  // Fire the OTP SMS through the communication module's synchronous endpoint. The
  // call is authenticated with a short-lived service token (the comm module sits
  // behind the verify-token authorizer). Failure here is surfaced to the caller so
  // the UI can tell the user the SMS could not be sent.
  private async sendOtpSms(schoolCode: string, phone: string, code: string): Promise<void> {
    const base = process.env.COMM_BASE_URL || 'http://localhost:3000';
    const res = await fetch(`${base}/communication/otp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-School-Code': schoolCode,
        Authorization: serviceAuthHeader({ name: 'auth' }),
      },
      body: JSON.stringify({ toNumber: phone, code }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error('OTP SMS send failed:', res.status, text);
      throw new Error('Could not send the verification code. Please try again.');
    }
  }

  // Step 2. Check the code. On success either reveals the username(s) (purpose=username)
  // or mints a one-shot reset token (purpose=password).
  public async verifyOtp(schoolId: string, otpId: string, code: string, ip?: string, userAgent?: string): Promise<VerifyResult> {
    const rows = await DB.query(
      singleLineString`select uuid, user_type, purpose, phone, code_hash, matched_accounts, expires_at, attempts, consumed_at from login_otp where uuid = $1 and school_id = $2`,
      [otpId, schoolId]
    );
    if (rows.length === 0) throw new Error('Invalid or expired code.');
    const row = rows[0];

    if (row.consumedAt) throw new Error('This code has already been used.');
    if (new Date(row.expiresAt).getTime() < Date.now()) throw new Error('Invalid or expired code.');
    if (row.attempts >= MAX_ATTEMPTS) throw new Error('Too many incorrect attempts. Please request a new code.');

    const supplied = String(code || '').replace(/\D/g, '');
    if (supplied.length !== 6 || hashCode(supplied) !== row.codeHash) {
      await DB.query(singleLineString`update login_otp set attempts = attempts + 1, updated_at = now() where uuid = $1`, [otpId]);
      const remaining = MAX_ATTEMPTS - (row.attempts + 1);
      throw new Error(remaining > 0 ? `Incorrect code. ${remaining} attempt(s) left.` : 'Too many incorrect attempts. Please request a new code.');
    }

    const accounts: MatchedAccount[] = Array.isArray(row.matchedAccounts) ? row.matchedAccounts : [];
    const userType: UserType = row.userType;

    if (row.purpose === 'username') {
      // Username reveal consumes the OTP outright (nothing more to do).
      await DB.query(singleLineString`update login_otp set consumed_at = now(), updated_at = now() where uuid = $1`, [otpId]);
      const usernames = accounts.map((a) => a.username);
      await this.audit(schoolId, userType, usernames[0] || null, row.phone, 'username_revealed', ip, userAgent);
      return { purpose: 'username', usernames };
    }

    // Password: mark verified and hand back a reset token distinct from any login token.
    await DB.query(singleLineString`update login_otp set consumed_at = now(), updated_at = now() where uuid = $1`, [otpId]);
    const resetToken = jwt.sign(
      { kind: 'recovery-reset', otpId, sid: schoolId, auth: 'recovery' },
      process.env.JWT_SECRET,
      { expiresIn: `${RESET_TOKEN_TTL_MIN}m` }
    );
    return { purpose: 'password', resetToken };
  }

  // Step 3. Consume the reset token and write the new password to every matched login
  // row. One-shot: reset_done_at guards against replay.
  public async setPassword(schoolId: string, resetToken: string, newPassword: string, ip?: string, userAgent?: string): Promise<{ count: number }> {
    if (!newPassword || newPassword.length < MIN_PASSWORD_LEN) {
      throw new Error(`Password must be at least ${MIN_PASSWORD_LEN} characters.`);
    }
    if (newPassword.length > MAX_PASSWORD_LEN) {
      throw new Error(`Password must be at most ${MAX_PASSWORD_LEN} characters.`);
    }

    let decoded: any;
    try {
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (e) {
      throw new Error('Your reset session has expired. Please start again.');
    }
    if (!decoded || decoded.kind !== 'recovery-reset' || decoded.sid !== schoolId || !decoded.otpId) {
      throw new Error('Invalid reset session. Please start again.');
    }

    const rows = await DB.query(
      singleLineString`select uuid, user_type, phone, matched_accounts, consumed_at, reset_done_at from login_otp where uuid = $1 and school_id = $2`,
      [decoded.otpId, schoolId]
    );
    if (rows.length === 0) throw new Error('Invalid reset session. Please start again.');
    const row = rows[0];
    if (!row.consumedAt) throw new Error('This code was never verified. Please start again.');
    if (row.resetDoneAt) throw new Error('This reset link has already been used.');

    const accounts: MatchedAccount[] = Array.isArray(row.matchedAccounts) ? row.matchedAccounts : [];
    const userType: UserType = row.userType;
    if (accounts.length === 0) throw new Error('No account is linked to this request.');

    const table = userType === 'parent' ? 'student_login' : 'employee_login';
    for (const acct of accounts) {
      if (userType === 'staff') {
        await DB.query(
          singleLineString`update employee_login set password = $1, must_change_password = false, updated_at = now() where uuid = $2 and school_id = $3`,
          [newPassword, acct.loginId, schoolId]
        );
      } else {
        await DB.query(
          singleLineString`update student_login set password = $1, updated_at = now() where uuid = $2 and school_id = $3`,
          [newPassword, acct.loginId, schoolId]
        );
      }
      await this.audit(schoolId, userType, acct.username, row.phone, 'password_reset', ip, userAgent);
    }

    await DB.query(singleLineString`update login_otp set reset_done_at = now(), updated_at = now() where uuid = $1`, [decoded.otpId]);
    return { count: accounts.length };
  }
}

export const recoveryService = new RecoveryService();
