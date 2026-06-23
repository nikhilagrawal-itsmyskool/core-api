import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { CatalogRequest } from "./library-interfaces";
import { workService } from "./library-work-service";
import { titleService } from "./library-title-service";
import { copyService } from "./library-copy-service";
import { callnoService } from "./library-callno-service";

// One-shot "catalog once, add N copies" flow: find-or-create the Work, create
// the Title (edition+language), and insert all Copies in a single transaction.
class CatalogService {
  public async catalog(
    req: CatalogRequest,
    schoolId: string,
    userId: string,
  ): Promise<any> {
    if (!req.title) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "title is required",
      );
    }
    const copies = req.copies || [];
    if (copies.length > 0) {
      await copyService.assertAccessionsFree(
        copies.map((c) => c.accessionNo),
        schoolId,
      );
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Resolve the work: attach to an existing one, or create a new work row.
    let workId: string;
    let workCutter: string | undefined;
    let workDdc: string | undefined;
    let createdWork = false;

    if (req.workId) {
      const work = await workService.getById(req.workId, schoolId);
      if (!work)
        throw new BusinessErrorResult(
          ErrorCode.BusinessError,
          "Work not found",
        );
      workId = work.uuid;
      workCutter = work.cutter;
      workDdc = work.ddcNumber;
    } else {
      if (!req.work)
        throw new BusinessErrorResult(
          ErrorCode.BusinessError,
          "work or workId is required",
        );
      const ins = workService.buildInsert(req.work, schoolId, userId, now);
      queries.push(ins.query);
      params.push(ins.params);
      workId = ins.uuid;
      workCutter = ins.cutter || undefined;
      workDdc = ins.ddcNumber || undefined;
      createdWork = true;
    }

    // Title.
    const titleIns = titleService.buildInsert(
      req.title,
      workId,
      schoolId,
      userId,
      now,
      workCutter,
      workDdc,
    );
    queries.push(titleIns.query);
    params.push(titleIns.params);

    // Copies (shared acquisition batch).
    const batchId =
      copies.length > 0 ? `bat-${titleIns.uuid.slice(0, 8)}` : null;
    for (const copy of copies) {
      const ci = copyService.buildInsert(
        copy,
        titleIns.uuid,
        schoolId,
        userId,
        batchId,
        now,
      );
      queries.push(ci.query);
      params.push(ci.params);
    }

    const results = await DB.queriesInTransaction(queries, params);

    // Unpack in insertion order.
    let idx = 0;
    const work = createdWork
      ? results[idx++][0]
      : await workService.getById(workId, schoolId);
    const title = results[idx++][0];
    const createdCopies = results.slice(idx).map((r: any[]) => r[0]);

    const collisions = await callnoService.findCollisions(
      titleIns.localCallNo,
      schoolId,
      workId,
    );

    return {
      work,
      title,
      copies: createdCopies,
      localCallNo: titleIns.localCallNo,
      callNoCollision: collisions.length > 0 ? collisions : undefined,
    };
  }
}

export const catalogService = new CatalogService();
