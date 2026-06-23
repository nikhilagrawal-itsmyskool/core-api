import { DB, singleLineString } from "../../shared/lib/db";
import { DEFAULT_POLICY, LOST_CHARGE_MODES } from "./library-constants";
import { LibraryPolicy, UpdatePolicyRequest } from "./library-interfaces";

// Per-school loan/fine configuration. One row per school; seeded with defaults
// on first read so callers always get a complete policy.
class PolicyService {
  public async get(schoolId: string): Promise<LibraryPolicy> {
    const rows = await DB.query(
      singleLineString`select * from library_policy where school_id = $1`,
      [schoolId],
    );
    if (rows.length > 0) return rows[0];

    const now = new Date();
    await DB.query(
      singleLineString`
        insert into library_policy
        (school_id, loan_period_days, max_copies_per_borrower, grace_days, overdue_rate_per_day,
         max_fine_cap, renew_limit, lost_charge_mode, lost_charge_value, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        on conflict (school_id) do nothing
      `,
      [
        schoolId,
        DEFAULT_POLICY.loanPeriodDays,
        DEFAULT_POLICY.maxCopiesPerBorrower,
        DEFAULT_POLICY.graceDays,
        DEFAULT_POLICY.overdueRatePerDay,
        DEFAULT_POLICY.maxFineCap,
        DEFAULT_POLICY.renewLimit,
        DEFAULT_POLICY.lostChargeMode,
        DEFAULT_POLICY.lostChargeValue,
        now,
      ],
    );
    const seeded = await DB.query(
      singleLineString`select * from library_policy where school_id = $1`,
      [schoolId],
    );
    return seeded[0];
  }

  public async update(
    schoolId: string,
    data: UpdatePolicyRequest,
    userId: string,
  ): Promise<LibraryPolicy> {
    await this.get(schoolId); // ensure a row exists
    const fields: Record<string, any> = {
      loan_period_days: data.loanPeriodDays,
      max_copies_per_borrower: data.maxCopiesPerBorrower,
      grace_days: data.graceDays,
      overdue_rate_per_day: data.overdueRatePerDay,
      max_fine_cap: data.maxFineCap,
      renew_limit: data.renewLimit,
      lost_charge_mode:
        data.lostChargeMode && LOST_CHARGE_MODES.includes(data.lostChargeMode)
          ? data.lostChargeMode
          : undefined,
      lost_charge_value: data.lostChargeValue,
    };
    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    for (const [col, val] of Object.entries(fields)) {
      if (val !== undefined) {
        updates.push(`${col} = $${i++}`);
        params.push(val);
      }
    }
    if (updates.length > 0) {
      updates.push(`updatedby_userid = $${i++}`);
      params.push(userId);
      updates.push(`updated_at = $${i++}`);
      params.push(new Date());
      params.push(schoolId);
      await DB.query(
        singleLineString`update library_policy set ${updates.join(", ")} where school_id = $${i++}`,
        params,
      );
    }
    return this.get(schoolId);
  }
}

export const policyService = new PolicyService();
