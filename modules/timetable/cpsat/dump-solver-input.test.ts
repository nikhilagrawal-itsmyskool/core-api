// Faithful dump of the assembled SolverInput for one GENERATION RUN, by running the
// REAL loader + build-lessons (the exact path generation-service uses). This guarantees
// the CP-SAT spike solves the *same* problem the engine sees — no reconstruction drift.
//
// Keyed on the run id (generation_run.uuid), so the manual CP-SAT engine slots into the
// existing flow exactly where the in-house worker would: it CLAIMS the run (queued ->
// running) so an automated worker can't steal it, derives config/wing/year from the run
// row, and writes everything for one run under cpsat/<run-id>/:
//     solver-input.json   the exact SolverInput the engine feeds its solver (+ labels)
//     registration.json   per-class 0th-period rows (not solved; needed at import time)
//     meta.json           run row + counts, for the solver/import to read back
//
// It's a jest spec so it runs on the project's existing TS toolchain (no ts-node needed).
// It SKIPS unless DUMP_RUN_ID is set, so normal test runs don't try to hit a DB.
// configs/prod/prod.yml is auto-loaded (see ./load-env) — on Windows, localhost works
// directly, so no POSTGRES_* env vars are needed. Override stage with DUMP_STAGE.
//
// Run (from Windows, against prod):
//   $env:DUMP_RUN_ID="<run-uuid>"; node node_modules/jest/bin/jest.js \
//     modules/timetable/cpsat/dump-solver-input.test.ts --runTestsByPath --forceExit
//
// Set DUMP_NO_CLAIM=1 to dump without flipping the run to 'running' (read-only rebuild).

import "./load-env"; // MUST be first: sets POSTGRES_* before shared/lib/db loads
import * as fs from "fs";
import * as path from "path";
import { DB } from "../../../shared/lib/db";
import { loadConfigForSolve } from "../generation-data-loader";
import { wingService } from "../wing-service";
import { buildLessons } from "../solver/build-lessons";
import { computeRegistrationEntries } from "../registration";
import { SolverInput } from "../solver/types";

const RUN_ID = process.env.DUMP_RUN_ID;
const OUT_DIR = process.env.DUMP_OUT_DIR || path.join(__dirname, RUN_ID || "");
const NO_CLAIM = process.env.DUMP_NO_CLAIM === "1";

const maybe = RUN_ID ? it : it.skip;

describe("dump SolverInput for a generation run (faithful, via the real loader)", () => {
  maybe(
    "claims the run and writes solver-input.json + registration.json + meta.json",
    async () => {
      // 1. Load the run row — it carries everything the loader needs.
      const runs = await DB.query(
        "select * from generation_run where uuid = $1",
        [RUN_ID],
      );
      if (runs.length === 0) throw new Error(`generation_run ${RUN_ID} not found`);
      const run = runs[0];
      const { schoolId, configId, wingId, academicYearId } = run;
      // eslint-disable-next-line no-console
      console.log(
        `run ${RUN_ID}: status=${run.status} config=${configId} wing=${wingId ?? "(whole school)"} year=${academicYearId}`,
      );

      // 2. Claim it (queued -> running) so an automated worker can't pick it up.
      // Atomic + idempotent: only claims if still queued; re-dumps of an already
      // 'running' run are fine. Skip with DUMP_NO_CLAIM=1.
      if (!NO_CLAIM) {
        const claimed = await DB.query(
          `update generation_run
             set status = 'running', worker_id = 'cpsat-manual', heartbeat_at = now(),
                 started_at = coalesce(started_at, now()),
                 attempts = coalesce(attempts, 0) + 1, updated_at = now()
           where uuid = $1 and status = 'queued'
           returning uuid`,
          [RUN_ID],
        );
        // eslint-disable-next-line no-console
        console.log(
          claimed.length > 0
            ? `claimed run -> running`
            : `run not in 'queued' (status=${run.status}); proceeding without re-claim`,
        );
      }

      // 3. Resolve wing scope (null = whole school) and build the input the same way
      // generation-service.buildSolverInput does.
      const wingClassIds = wingId
        ? await wingService.getWingClassIds(schoolId, wingId)
        : null;
      const loaded = await loadConfigForSolve(schoolId, configId, wingClassIds);
      if (!loaded) throw new Error("loadConfigForSolve returned null");
      const built = buildLessons(loaded.buildInput);

      const input: SolverInput = {
        classIds: loaded.buildInput.classIds,
        grid: loaded.grid,
        lessons: built.lessons,
        constraints: loaded.constraints,
        objectiveWeights: run.objectiveWeights ?? undefined,
        cohorts: loaded.cohorts,
      };

      // Registration (0th period) is deterministic, not solved — compute it now so the
      // import doesn't have to re-hit the DB (see HANDOFF: only registration is per-class).
      const registrationEntries = computeRegistrationEntries(
        loaded.grid,
        loaded.buildInput.classTeachers,
        loaded.buildInput.classIds,
      );

      // Labels (id -> human name) aren't part of SolverInput but make solution.json
      // readable and let the CP-SAT side render real names/codes. Serialize the Maps.
      const labels = {
        class: Object.fromEntries(loaded.labels.class),
        subject: Object.fromEntries(loaded.labels.subject),
        teacher: Object.fromEntries(loaded.labels.teacher),
      };

      const warnings = [...loaded.warnings, ...built.warnings];
      const meta = {
        runId: RUN_ID,
        schoolId,
        configId,
        wingId: wingId ?? null,
        academicYearId,
        numCandidates: run.numCandidates ?? 1,
        objectiveWeights: run.objectiveWeights ?? null,
        createdbyUserid: run.createdbyUserid ?? null,
        dumpedAt: new Date().toISOString(),
        classCount: input.classIds.length,
        lessonCount: input.lessons.length,
        constraintCount: input.constraints.length,
        registrationEntryCount: registrationEntries.length,
      };

      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(
        path.join(OUT_DIR, "solver-input.json"),
        JSON.stringify({ meta, input, labels, warnings }, null, 2),
      );
      fs.writeFileSync(
        path.join(OUT_DIR, "registration.json"),
        JSON.stringify(registrationEntries, null, 2),
      );
      fs.writeFileSync(
        path.join(OUT_DIR, "meta.json"),
        JSON.stringify(meta, null, 2),
      );

      // eslint-disable-next-line no-console
      console.log(
        `wrote ${OUT_DIR}: ${input.classIds.length} classes, ${input.lessons.length} lessons, ` +
          `${input.constraints.length} constraints, ${registrationEntries.length} registration rows` +
          (warnings.length ? `, ${warnings.length} warning(s)` : ""),
      );
      if (warnings.length) {
        // eslint-disable-next-line no-console
        console.log("warnings:\n  " + warnings.join("\n  "));
      }
      expect(input.lessons.length).toBeGreaterThan(0);
    },
    120000,
  );
});

afterAll(async () => {
  // best-effort: close the pg pool so jest can exit cleanly (else use --forceExit)
  const anyDB = DB as any;
  try {
    if (anyDB.pool?.end) await anyDB.pool.end();
    else if (anyDB.end) await anyDB.end();
  } catch {
    /* ignore */
  }
});
