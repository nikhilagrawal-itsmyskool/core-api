import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { istToday } from "../../shared/util/datetime";
import { DEFAULTS } from "./library-constants";
import {
  LibraryFine,
  LibraryPolicy,
  CollectFineRequest,
  WaiveFineRequest,
} from "./library-interfaces";
import { BorrowerType, FineType } from "./library-constants";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

class FineService {
  public generateReceiptNumber(): string {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
    const random = generateShortUuid(6).toUpperCase();
    return `${DEFAULTS.RECEIPT_PREFIX}-${dateStr}-${random}`;
  }

  // Overdue charge = days beyond grace * per-day rate, capped at max_fine_cap.
  public computeOverdueAmount(
    daysOverdue: number,
    policy: LibraryPolicy,
  ): number {
    const billable = Math.max(daysOverdue - (policy.graceDays || 0), 0);
    const amount = billable * Number(policy.overdueRatePerDay || 0);
    const cap = Number(policy.maxFineCap || 0);
    const capped = cap > 0 ? Math.min(amount, cap) : amount;
    return Math.round(capped * 100) / 100;
  }

  // Lost-book charge depends on the configured mode.
  public computeLostAmount(
    policy: LibraryPolicy,
    price?: number | null,
  ): number {
    const value = Number(policy.lostChargeValue || 0);
    const p = price != null ? Number(price) : 0;
    let amount: number;
    switch (policy.lostChargeMode) {
      case "price":
        amount = p;
        break;
      case "fixed":
        amount = value;
        break;
      case "multiplier":
        amount = (p || 0) * value;
        break;
      default:
        amount = p;
    }
    if (!amount && policy.lostChargeMode !== "fixed") amount = value; // sensible fallback when price unknown
    return Math.round(amount * 100) / 100;
  }

  public async createFine(
    data: {
      circulationId?: string;
      copyId: string;
      borrowerType: BorrowerType;
      borrowerId: string;
      fineType: FineType;
      daysOverdue?: number;
      amount: number;
    },
    schoolId: string,
    userId: string,
  ): Promise<LibraryFine | null> {
    if (data.amount <= 0) return null; // nothing to charge
    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into library_fine
        (uuid, school_id, circulation_id, copy_id, borrower_type, borrower_id, fine_type,
         days_overdue, amount, amount_collected, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,$12)
        returning *
      `,
      [
        uuid,
        schoolId,
        data.circulationId || null,
        data.copyId,
        data.borrowerType,
        data.borrowerId,
        data.fineType,
        data.daysOverdue ?? null,
        data.amount,
        0,
        userId,
        now,
      ],
    );
    return rows[0];
  }

  public async getById(
    id: string,
    schoolId: string,
  ): Promise<LibraryFine | null> {
    const r = await DB.query(
      singleLineString`select * from library_fine where uuid = $1 and school_id = $2`,
      [id, schoolId],
    );
    return r.length > 0 ? r[0] : null;
  }

  public async list(
    schoolId: string,
    opts: { status?: string; borrowerType?: string; borrowerId?: string },
  ): Promise<LibraryFine[]> {
    const params: any[] = [schoolId];
    let where = `school_id = $1`;
    if (opts.status) {
      params.push(opts.status);
      where += ` and status = $${params.length}`;
    }
    if (opts.borrowerType) {
      params.push(opts.borrowerType);
      where += ` and borrower_type = $${params.length}`;
    }
    if (opts.borrowerId) {
      params.push(opts.borrowerId);
      where += ` and borrower_id = $${params.length}`;
    }
    return DB.query(
      singleLineString`select * from library_fine where ${where} order by created_at desc`,
      params,
    );
  }

  public async collect(
    id: string,
    data: CollectFineRequest,
    schoolId: string,
    userId: string,
  ): Promise<LibraryFine | null> {
    const fine = await this.getById(id, schoolId);
    if (!fine) return null;
    if (fine.status !== "pending") {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Fine is already ${fine.status}`,
      );
    }
    const amountCollected = data.amountCollected ?? Number(fine.amount);
    const receipt = this.generateReceiptNumber();
    const paidDate = data.paidDate || istToday();
    const rows = await DB.query(
      singleLineString`
        update library_fine
        set status = 'paid', amount_collected = $1, receipt_number = $2, paid_date = $3,
            notes = $4, updatedby_userid = $5, updated_at = $6
        where uuid = $7 and school_id = $8 and status = 'pending'
        returning *
      `,
      [
        amountCollected,
        receipt,
        paidDate,
        data.notes || null,
        userId,
        new Date(),
        id,
        schoolId,
      ],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async waive(
    id: string,
    data: WaiveFineRequest,
    schoolId: string,
    userId: string,
  ): Promise<LibraryFine | null> {
    const fine = await this.getById(id, schoolId);
    if (!fine) return null;
    if (fine.status !== "pending") {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Fine is already ${fine.status}`,
      );
    }
    const rows = await DB.query(
      singleLineString`
        update library_fine
        set status = 'waived', notes = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and status = 'pending'
        returning *
      `,
      [data.notes || null, userId, new Date(), id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }
}

export const fineService = new FineService();
