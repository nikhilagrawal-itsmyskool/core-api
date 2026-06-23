import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  IssueRequest,
  ReturnRequest,
  RenewRequest,
  LibraryCirculation,
} from "./library-interfaces";
import { BORROWER_TYPES } from "./library-constants";
import { policyService } from "./library-policy-service";
import { fineService } from "./library-fine-service";
import { resolveBorrowerName } from "./library-common";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
// Normalize a date-only value (a 'YYYY-MM-DD' string, or a Date as pg returns
// for `date` columns) to a UTC-midnight epoch millis, by calendar date.
function toUtcDay(value: string | Date): number {
  if (value instanceof Date) {
    return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const [y, m, d] = String(value)
    .slice(0, 10)
    .split("-")
    .map((n) => parseInt(n, 10));
  return Date.UTC(y, m - 1, d);
}
function addDays(date: string | Date, days: number): string {
  return new Date(toUtcDay(date) + days * 86400000).toISOString().slice(0, 10);
}
function diffDays(later: string | Date, earlier: string | Date): number {
  return Math.round((toUtcDay(later) - toUtcDay(earlier)) / 86400000);
}

class CirculationService {
  // Resolve a copy reference (copyId or accessionNo) to its raw row.
  private async resolveCopy(
    ref: { copyId?: string; accessionNo?: string },
    schoolId: string,
  ): Promise<any> {
    let rows: any[] = [];
    if (ref.copyId) {
      rows = await DB.query(
        singleLineString`select * from library_copy where uuid = $1 and school_id = $2 and status <> 'deleted'`,
        [ref.copyId, schoolId],
      );
    } else if (ref.accessionNo) {
      rows = await DB.query(
        singleLineString`select * from library_copy where lower(accession_no) = lower($1) and school_id = $2 and status <> 'deleted'`,
        [ref.accessionNo, schoolId],
      );
    } else {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "copyId or accessionNo is required",
      );
    }
    if (rows.length === 0)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Copy not found");
    return rows[0];
  }

  private async activeLoanForCopy(
    copyId: string,
    schoolId: string,
  ): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select * from library_circulation where copy_id = $1 and school_id = $2 and status = 'issued' order by created_at desc limit 1`,
      [copyId, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async issue(
    req: IssueRequest,
    schoolId: string,
    userId: string,
  ): Promise<LibraryCirculation> {
    if (!BORROWER_TYPES.includes(req.borrowerType)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Invalid borrowerType. Must be one of: ${BORROWER_TYPES.join(", ")}`,
      );
    }
    const copy = await this.resolveCopy(req, schoolId);
    if (copy.status !== "available") {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Copy is not available (status: ${copy.status})`,
      );
    }
    const borrowerName = await resolveBorrowerName(
      req.borrowerType,
      req.borrowerId,
      schoolId,
    );
    if (!borrowerName) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Borrower not found for this school",
      );
    }

    const policy = await policyService.get(schoolId);
    const outstanding = await DB.query(
      singleLineString`select count(*)::int as count from library_circulation where school_id = $1 and borrower_type = $2 and borrower_id = $3 and status = 'issued'`,
      [schoolId, req.borrowerType, req.borrowerId],
    );
    if (outstanding[0].count >= policy.maxCopiesPerBorrower) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Borrower already has the maximum ${policy.maxCopiesPerBorrower} book(s) issued`,
      );
    }

    const issueDate = req.issueDate || today();
    const dueDate = addDays(issueDate, policy.loanPeriodDays);
    const uuid = generateShortUuid(12);
    const now = new Date();

    const results = await DB.queriesInTransaction(
      [
        singleLineString`
          insert into library_circulation
          (uuid, school_id, copy_id, borrower_type, borrower_id, borrower_name, issue_date, due_date,
           renew_count, status, issuedby_userid, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,0,'issued',$9,$10,$11)
          returning *
        `,
        singleLineString`update library_copy set status = 'issued', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      ],
      [
        [
          uuid,
          schoolId,
          copy.uuid,
          req.borrowerType,
          req.borrowerId,
          borrowerName,
          issueDate,
          dueDate,
          userId,
          userId,
          now,
        ],
        [userId, now, copy.uuid, schoolId],
      ],
    );
    return results[0][0];
  }

  public async returnBook(
    req: ReturnRequest,
    schoolId: string,
    userId: string,
  ): Promise<any> {
    const copy = await this.resolveCopy(req, schoolId);
    const loan = await this.activeLoanForCopy(copy.uuid, schoolId);
    if (!loan) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Copy is not currently issued",
      );
    }
    const policy = await policyService.get(schoolId);
    const returnDate = req.returnDate || today();
    const daysOverdue = Math.max(diffDays(returnDate, loan.dueDate), 0);
    const now = new Date();

    if (req.markLost) {
      await DB.queriesInTransaction(
        [
          singleLineString`update library_circulation set status = 'lost', return_date = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
          singleLineString`update library_copy set status = 'lost', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
        ],
        [
          [returnDate, userId, now, loan.uuid, schoolId],
          [userId, now, copy.uuid, schoolId],
        ],
      );
      const amount = fineService.computeLostAmount(policy, copy.price);
      const fine = await fineService.createFine(
        {
          circulationId: loan.uuid,
          copyId: copy.uuid,
          borrowerType: loan.borrowerType,
          borrowerId: loan.borrowerId,
          fineType: "lost",
          amount,
        },
        schoolId,
        userId,
      );
      const circ = await DB.query(
        singleLineString`select * from library_circulation where uuid = $1`,
        [loan.uuid],
      );
      return { circulation: circ[0], fine };
    }

    await DB.queriesInTransaction(
      [
        singleLineString`update library_circulation set status = 'returned', return_date = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
        singleLineString`update library_copy set status = 'available', updatedby_userid = $1, updated_at = $2 where uuid = $3 and school_id = $4`,
      ],
      [
        [returnDate, userId, now, loan.uuid, schoolId],
        [userId, now, copy.uuid, schoolId],
      ],
    );

    let fine = null;
    if (daysOverdue > (policy.graceDays || 0)) {
      const amount = fineService.computeOverdueAmount(daysOverdue, policy);
      fine = await fineService.createFine(
        {
          circulationId: loan.uuid,
          copyId: copy.uuid,
          borrowerType: loan.borrowerType,
          borrowerId: loan.borrowerId,
          fineType: "overdue",
          daysOverdue,
          amount,
        },
        schoolId,
        userId,
      );
    }
    const circ = await DB.query(
      singleLineString`select * from library_circulation where uuid = $1`,
      [loan.uuid],
    );
    return { circulation: circ[0], daysOverdue, fine };
  }

  public async renew(
    req: RenewRequest,
    schoolId: string,
    userId: string,
  ): Promise<LibraryCirculation> {
    const copy = await this.resolveCopy(req, schoolId);
    const loan = await this.activeLoanForCopy(copy.uuid, schoolId);
    if (!loan) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Copy is not currently issued",
      );
    }
    const policy = await policyService.get(schoolId);
    if ((loan.renewCount || 0) >= policy.renewLimit) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Renewal limit (${policy.renewLimit}) reached`,
      );
    }
    const newDue = addDays(loan.dueDate, policy.loanPeriodDays);
    const rows = await DB.query(
      singleLineString`
        update library_circulation
        set due_date = $1, renew_count = $2, updatedby_userid = $3, updated_at = $4
        where uuid = $5 and school_id = $6 and status = 'issued'
        returning *
      `,
      [
        newDue,
        (loan.renewCount || 0) + 1,
        userId,
        new Date(),
        loan.uuid,
        schoolId,
      ],
    );
    return rows[0];
  }

  public async list(
    schoolId: string,
    opts: {
      status?: string;
      copyId?: string;
      borrowerType?: string;
      borrowerId?: string;
    },
  ): Promise<LibraryCirculation[]> {
    const params: any[] = [schoolId];
    let where = `circ.school_id = $1`;
    if (opts.status) {
      params.push(opts.status);
      where += ` and circ.status = $${params.length}`;
    }
    if (opts.copyId) {
      params.push(opts.copyId);
      where += ` and circ.copy_id = $${params.length}`;
    }
    if (opts.borrowerType) {
      params.push(opts.borrowerType);
      where += ` and circ.borrower_type = $${params.length}`;
    }
    if (opts.borrowerId) {
      params.push(opts.borrowerId);
      where += ` and circ.borrower_id = $${params.length}`;
    }
    // Join book details so the UI can show what was issued (title/author/call no).
    return DB.query(
      singleLineString`
        select circ.*, c.accession_no, t.title_as_printed, t.local_call_no, w.author_display
        from library_circulation circ
        left join library_copy c on circ.copy_id = c.uuid
        left join library_title t on c.title_id = t.uuid
        left join library_work w on t.work_id = w.uuid
        where ${where}
        order by circ.created_at desc
      `,
      params,
    );
  }

  public async loansByBorrower(
    borrowerType: string,
    borrowerId: string,
    schoolId: string,
  ): Promise<any[]> {
    return DB.query(
      singleLineString`
        select circ.*, c.accession_no, t.title_as_printed, t.local_call_no
        from library_circulation circ
        left join library_copy c on circ.copy_id = c.uuid
        left join library_title t on c.title_id = t.uuid
        where circ.school_id = $1 and circ.borrower_type = $2 and circ.borrower_id = $3
        order by circ.created_at desc
      `,
      [schoolId, borrowerType, borrowerId],
    );
  }
}

export const circulationService = new CirculationService();
