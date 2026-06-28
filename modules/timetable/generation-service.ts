import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { loadConfigForSolve } from "./generation-data-loader";
import { configService } from "./config-service";
import { wingService } from "./wing-service";
import { crossWingTeacherWarnings } from "./cross-wing";
import { buildLessons } from "./solver/build-lessons";
import { checkFeasibility } from "./solver/feasibility";
import { solve } from "./solver/solve";
import { classesOf, SolverInput } from "./solver/types";
import { humanizeMessages, SolverLabels } from "./message-labels";
import {
  computeRegistrationEntries,
  registrationClashMessages,
  RegistrationEntry,
} from "./registration";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Wall-clock budget for the solver. Must stay below the process-next function
// timeout (120s, see timetable-endpoints.yml) so the solver returns a clean result
// instead of being hard-killed mid-solve (which would strand the run as 'running').
// 60s gives a full-school (25-class) solve real margin — a stressed instance with
// electives + teacher constraints solves in ~25-35s (see solver-scale.test.ts).
const SOLVE_TIME_BUDGET_MS = 60000;

class GenerationService {
  // Build the solver input for a config (shared by feasibility + processing).
  // wingClassIds (optional) scopes the solve to one wing's classes.
  private async buildSolverInput(
    schoolId: string,
    configId: string,
    objectiveWeights: any,
    seed: number,
    wingClassIds?: string[] | null,
  ): Promise<{
    input: SolverInput;
    warnings: string[];
    registrationEntries: RegistrationEntry[];
    labels: SolverLabels;
  } | null> {
    const loaded = await loadConfigForSolve(schoolId, configId, wingClassIds);
    if (!loaded) return null;
    const built = buildLessons(loaded.buildInput);
    const lessons = built.lessons;
    // Merge loader warnings (e.g. deleted-subject rows skipped) with build warnings.
    const warnings = [...loaded.warnings, ...built.warnings];
    const input: SolverInput = {
      classIds: loaded.buildInput.classIds,
      grid: loaded.grid,
      lessons,
      constraints: loaded.constraints,
      objectiveWeights,
      seed,
      timeBudgetMs: SOLVE_TIME_BUDGET_MS,
      cohorts: loaded.cohorts,
    };
    // Registration (0th period) entries are deterministic — computed here, not solved.
    const registrationEntries = computeRegistrationEntries(
      loaded.grid,
      loaded.buildInput.classTeachers,
      loaded.buildInput.classIds,
    );
    return { input, warnings, registrationEntries, labels: loaded.labels };
  }

  // Fast pre-check; never enqueues. wingId (optional) scopes to one wing.
  public async feasibility(
    schoolId: string,
    configId: string,
    wingId?: string | null,
  ): Promise<any> {
    const wingClassIds = wingId
      ? await wingService.getWingClassIds(schoolId, wingId)
      : null;
    const built = await this.buildSolverInput(
      schoolId,
      configId,
      undefined,
      1,
      wingClassIds,
    );
    if (!built)
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Config not found",
      );
    const report = checkFeasibility(built.input);
    const regClashes = registrationClashMessages(built.registrationEntries);
    const wingWarnings =
      wingClassIds && wingClassIds.length > 0
        ? await this.crossWingWarnings(schoolId, configId, wingClassIds)
        : [];
    const issues = [...report.issues, ...regClashes];
    const warnings = [...report.warnings, ...built.warnings, ...wingWarnings];
    return {
      feasible: issues.length === 0,
      issues: humanizeMessages(issues, built.labels),
      warnings: humanizeMessages(warnings, built.labels),
      lessonCount: built.input.lessons.length,
      classCount: built.input.classIds.length,
      registrationEntryCount: built.registrationEntries.length,
    };
  }

  // "Assume wings are teacher-disjoint, but warn" — flag any teacher who teaches
  // both inside and outside the wing (teaching assignments + elective offerings),
  // scoped to the config's academic year.
  private async crossWingWarnings(
    schoolId: string,
    configId: string,
    wingClassIds: string[],
  ): Promise<string[]> {
    const cfg = await DB.query(
      singleLineString`select academic_year_id from timetable_config where uuid = $1 and school_id = $2`,
      [configId, schoolId],
    );
    if (cfg.length === 0) return [];
    const yearId = cfg[0].academicYearId;
    const pairs = await DB.query(
      singleLineString`
        select teacher_id, class_id from teaching_assignment
        where school_id = $1 and academic_year_id = $2 and status = 'active'
        union all
        select eo.teacher_id, eb.class_id
        from elective_offering eo join elective_band eb on eb.uuid = eo.band_id
        where eo.school_id = $1 and eb.academic_year_id = $2 and eo.status = 'active' and eb.status = 'active'
      `,
      [schoolId, yearId],
    );
    return crossWingTeacherWarnings(
      pairs.map((p: any) => ({ teacherId: p.teacherId, classId: p.classId })),
      wingClassIds,
    );
  }

  // Enqueue a run (the row IS the queue). Returns fast. wingId (optional) scopes
  // the run to one wing's classes; null = whole school.
  public async enqueue(
    schoolId: string,
    configId: string,
    academicYearId: string,
    objectiveWeights: any,
    numCandidates: number,
    userId: string,
    wingId?: string | null,
  ): Promise<string> {
    const configRows = await DB.query(
      singleLineString`select academic_year_id, locked_at from timetable_config where uuid = $1 and school_id = $2`,
      [configId, schoolId],
    );
    if (configRows.length === 0)
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Config not found",
      );
    // Only a locked (frozen) config may be generated, so candidates and published
    // timetables can never desync from a later grid edit.
    if (!configRows[0].lockedAt)
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Lock the grid config before generating timetables.",
      );
    const yearId = academicYearId || configRows[0].academicYearId;

    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`
        insert into generation_run
        (uuid, school_id, academic_year_id, config_id, wing_id, status, objective_weights, num_candidates, progress, attempts, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, 'queued', $6, $7, 0, 0, $8, $9)
      `,
      [
        uuid,
        schoolId,
        yearId,
        configId,
        wingId ?? null,
        objectiveWeights ?? null,
        numCandidates,
        userId,
        new Date(),
      ],
    );
    return uuid;
  }

  public async getRun(runId: string, schoolId: string): Promise<any | null> {
    const rows = await DB.query(
      singleLineString`select * from generation_run where uuid = $1 and school_id = $2`,
      [runId, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async getCandidates(runId: string, schoolId: string): Promise<any[]> {
    const candidates = await DB.query(
      singleLineString`select * from timetable_candidate where generation_run_id = $1 and school_id = $2 order by rank`,
      [runId, schoolId],
    );
    for (const cand of candidates) {
      const entries = await DB.query(
        singleLineString`
          select e.*, s.name as subject_name, s.code as subject_code
          from timetable_entry e
          left join subject s on s.uuid = e.subject_id
          where e.candidate_id = $1 and e.school_id = $2
          order by e.day_of_week, e.time_slot_id
        `,
        [cand.uuid, schoolId],
      );
      cand.entries = entries;
    }
    return candidates;
  }

  // Claim one queued run and solve it. Called by the worker poller.
  // Returns { claimed } so the worker knows whether to keep polling.
  public async processNext(workerId: string): Promise<{
    claimed: boolean;
    runId?: string;
    status?: string;
    candidateCount?: number;
    error?: string;
  }> {
    const claimed = await DB.query(
      singleLineString`
        update generation_run
        set status = 'running', worker_id = $1, heartbeat_at = now(), started_at = now(),
            attempts = coalesce(attempts, 0) + 1, updated_at = now()
        where uuid = (
          select uuid from generation_run where status = 'queued' order by created_at limit 1 for update skip locked
        )
        returning *
      `,
      [workerId],
    );
    if (claimed.length === 0) return { claimed: false };

    const run = claimed[0];
    try {
      const wingClassIds = run.wingId
        ? await wingService.getWingClassIds(run.schoolId, run.wingId)
        : null;
      const built = await this.buildSolverInput(
        run.schoolId,
        run.configId,
        run.objectiveWeights,
        Number(String(run.uuid).replace(/\D/g, "").slice(0, 6) || "1") || 1,
        wingClassIds,
      );
      if (!built) throw new Error("Config not found for run");

      const feas = checkFeasibility(built.input);
      const regClashes = registrationClashMessages(built.registrationEntries);
      const allIssues = humanizeMessages(
        [...feas.issues, ...regClashes],
        built.labels,
      );
      if (allIssues.length > 0) {
        await this.markFailed(run.uuid, `Infeasible: ${allIssues.join(" ")}`);
        return {
          claimed: true,
          runId: run.uuid,
          status: "failed",
          error: allIssues.join(" "),
        };
      }

      const numCandidates = run.numCandidates || 3;
      const result = solve(built.input, numCandidates);
      if (!result.feasible) {
        await this.markFailed(run.uuid, result.reason || "No solution found");
        return {
          claimed: true,
          runId: run.uuid,
          status: "failed",
          error: result.reason,
        };
      }

      await this.writeCandidates(
        run,
        result.candidates,
        built.registrationEntries,
      );
      return {
        claimed: true,
        runId: run.uuid,
        status: "completed",
        candidateCount: result.candidates.length,
      };
    } catch (err: any) {
      await this.markFailed(run.uuid, err.message || String(err));
      return {
        claimed: true,
        runId: run.uuid,
        status: "failed",
        error: err.message,
      };
    }
  }

  private async markFailed(runId: string, error: string): Promise<void> {
    await DB.query(
      singleLineString`update generation_run set status = 'failed', error = $1, finished_at = now(), progress = 100, updated_at = now() where uuid = $2`,
      [error.slice(0, 2000), runId],
    );
  }

  private async writeCandidates(
    run: any,
    candidates: any[],
    registrationEntries: RegistrationEntry[] = [],
  ): Promise<void> {
    const queries: string[] = [];
    const params: any[][] = [];
    const now = new Date();

    candidates.forEach((cand, idx) => {
      const candidateId = generateShortUuid(12);
      queries.push(singleLineString`
        insert into timetable_candidate (uuid, school_id, generation_run_id, rank, score, score_breakdown, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `);
      params.push([
        candidateId,
        run.schoolId,
        run.uuid,
        idx + 1,
        cand.score,
        cand.breakdown ?? null,
        run.createdbyUserid ?? "worker",
        now,
      ]);

      for (const p of cand.timetable.placements) {
        for (let k = 0; k < p.size; k++) {
          const timeSlotId = p.slotIds[k];
          const blockGroupId = p.size > 1 ? p.lessonId : null;
          // A cross-class lesson fans out to one row per class it co-schedules; the
          // shared band_id ties them (and each offering) together at the same slot.
          for (const cls of classesOf(p)) {
            for (const off of p.offerings) {
              queries.push(singleLineString`
                insert into timetable_entry
                (uuid, school_id, candidate_id, class_id, subject_id, teacher_id, day_of_week, time_slot_id, block_group_id, band_id, createdby_userid, created_at)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              `);
              params.push([
                generateShortUuid(12),
                run.schoolId,
                candidateId,
                cls,
                off.subjectId,
                off.teacherId,
                p.dayOfWeek,
                timeSlotId,
                blockGroupId,
                p.bandId ?? null,
                run.createdbyUserid ?? "worker",
                now,
              ]);
            }
          }
        }
      }

      // Registration (0th) entries: same for every candidate — class teacher, no subject.
      for (const reg of registrationEntries) {
        queries.push(singleLineString`
          insert into timetable_entry
          (uuid, school_id, candidate_id, class_id, subject_id, teacher_id, day_of_week, time_slot_id, block_group_id, band_id, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        `);
        params.push([
          generateShortUuid(12),
          run.schoolId,
          candidateId,
          reg.classId,
          null,
          reg.teacherId,
          reg.dayOfWeek,
          reg.timeSlotId,
          null,
          null,
          run.createdbyUserid ?? "worker",
          now,
        ]);
      }
    });

    queries.push(singleLineString`
      update generation_run set status = 'completed', progress = 100, finished_at = now(), updated_at = now() where uuid = $1
    `);
    params.push([run.uuid]);

    await DB.queriesInTransaction(queries, params);
  }

  // Publish a candidate as the active master (archives any prior active master for the year).
  public async publish(
    schoolId: string,
    candidateId: string,
    effectiveFrom: string | null,
    userId: string,
  ): Promise<any> {
    const candRows = await DB.query(
      singleLineString`
        select c.uuid, c.generation_run_id, r.academic_year_id, r.wing_id
        from timetable_candidate c
        join generation_run r on r.uuid = c.generation_run_id
        where c.uuid = $1 and c.school_id = $2
      `,
      [candidateId, schoolId],
    );
    if (candRows.length === 0)
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Candidate not found",
      );
    const academicYearId = candRows[0].academicYearId;
    const wingId = candRows[0].wingId ?? null;

    const entries = await DB.query(
      singleLineString`select * from timetable_entry where candidate_id = $1 and school_id = $2`,
      [candidateId, schoolId],
    );

    const publishedId = generateShortUuid(12);
    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // Archive only the prior active master for the SAME scope (year + wing), so
    // per-wing masters coexist. `is not distinct from` makes null (whole-school)
    // match null without clobbering wing masters.
    queries.push(singleLineString`
      update published_timetable set status = 'archived', updated_at = $1
      where school_id = $2 and academic_year_id = $3 and status = 'active' and wing_id is not distinct from $4
    `);
    params.push([now, schoolId, academicYearId, wingId]);

    queries.push(singleLineString`
      insert into published_timetable (uuid, school_id, academic_year_id, wing_id, source_candidate_id, status, effective_from, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, 'active', $6, $7, $8)
    `);
    params.push([
      publishedId,
      schoolId,
      academicYearId,
      wingId,
      candidateId,
      effectiveFrom,
      userId,
      now,
    ]);

    for (const e of entries) {
      queries.push(singleLineString`
        insert into published_entry
        (uuid, school_id, published_timetable_id, class_id, subject_id, teacher_id, day_of_week, time_slot_id, block_group_id, band_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `);
      params.push([
        generateShortUuid(12),
        schoolId,
        publishedId,
        e.classId,
        e.subjectId,
        e.teacherId,
        e.dayOfWeek,
        e.timeSlotId,
        e.blockGroupId ?? null,
        e.bandId ?? null,
        userId,
        now,
      ]);
    }

    await DB.queriesInTransaction(queries, params);
    return {
      publishedTimetableId: publishedId,
      academicYearId,
      wingId,
      entryCount: entries.length,
    };
  }

  // Active published master for an academic year + scope (wingId null = whole
  // school), plus the grid config it uses (so the UI can render the weekday×period
  // skeleton). Returns null when none.
  public async getActivePublished(
    schoolId: string,
    academicYearId: string,
    wingId?: string | null,
  ): Promise<any | null> {
    const pts = await DB.query(
      singleLineString`
        select * from published_timetable
        where school_id = $1 and academic_year_id = $2 and status = 'active' and wing_id is not distinct from $3
        order by created_at desc limit 1
      `,
      [schoolId, academicYearId, wingId ?? null],
    );
    if (pts.length === 0) return null;
    const pt = pts[0];

    const entries = await DB.query(
      singleLineString`
        select pe.*, s.name as subject_name, s.code as subject_code
        from published_entry pe
        left join subject s on s.uuid = pe.subject_id
        where pe.published_timetable_id = $1 and pe.school_id = $2
        order by pe.day_of_week, pe.time_slot_id
      `,
      [pt.uuid, schoolId],
    );

    // Resolve the grid config via the source candidate's run.
    let config = null;
    if (pt.sourceCandidateId) {
      const rows = await DB.query(
        singleLineString`
          select r.config_id from timetable_candidate c
          join generation_run r on r.uuid = c.generation_run_id
          where c.uuid = $1 and c.school_id = $2
        `,
        [pt.sourceCandidateId, schoolId],
      );
      if (rows.length > 0)
        config = await configService.getConfigById(rows[0].configId, schoolId);
    }

    return { publishedTimetable: pt, entries, config };
  }

  // All active published masters for a year (whole-school + each wing), with the
  // wing name and entry count — drives the Published view's scope selector.
  public async listActivePublished(
    schoolId: string,
    academicYearId: string,
  ): Promise<any[]> {
    return DB.query(
      singleLineString`
        select pt.uuid, pt.wing_id, w.name as wing_name, pt.effective_from, pt.created_at,
               (select count(*) from published_entry pe where pe.published_timetable_id = pt.uuid) as entry_count
        from published_timetable pt
        left join timetable_wing w on w.uuid = pt.wing_id
        where pt.school_id = $1 and pt.academic_year_id = $2 and pt.status = 'active'
        order by w.name nulls first
      `,
      [schoolId, academicYearId],
    );
  }

  // Lightweight clash check for moving a published entry to a new day/slot.
  // Foundation for Phase-3 live editing.
  public async validateMove(
    schoolId: string,
    publishedTimetableId: string,
    entryId: string,
    toDayOfWeek: number,
    toTimeSlotId: string,
  ): Promise<{ valid: boolean; issues: string[] }> {
    const entries = await DB.query(
      singleLineString`select * from published_entry where published_timetable_id = $1 and school_id = $2`,
      [publishedTimetableId, schoolId],
    );
    const moving = entries.find((e: any) => e.uuid === entryId);
    if (!moving) return { valid: false, issues: ["Entry not found"] };

    // band siblings move together; exclude them from clash comparison
    const siblingIds = new Set(
      moving.bandId
        ? entries
            .filter((e: any) => e.bandId === moving.bandId)
            .map((e: any) => e.uuid)
        : [moving.uuid],
    );

    const issues: string[] = [];
    for (const e of entries) {
      if (siblingIds.has(e.uuid)) continue;
      if (e.dayOfWeek !== toDayOfWeek || e.timeSlotId !== toTimeSlotId)
        continue;
      if (e.classId === moving.classId)
        issues.push(
          `Class ${moving.classId} already has a class at the target slot`,
        );
      if (e.teacherId === moving.teacherId)
        issues.push(
          `Teacher ${moving.teacherId} is already booked at the target slot`,
        );
    }
    return { valid: issues.length === 0, issues: [...new Set(issues)] };
  }
}

export const generationService = new GenerationService();
