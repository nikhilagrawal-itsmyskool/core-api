// Faithful dump of the assembled SolverInput for one config, by running the REAL
// loader + build-lessons (the exact path generation-service uses). This guarantees the
// CP-SAT spike solves the *same* problem the engine sees — no reconstruction drift.
//
// It's a jest spec so it runs on the project's existing TS toolchain (no ts-node needed).
// It SKIPS unless DUMP_CONFIG_ID is set, so normal test runs don't try to hit a DB.
//
// Run (WSL -> Windows Postgres; see cpsat/HANDOFF.md §2 for the host IP):
//   DUMP_CONFIG_ID=5jqyyk2h2njw DUMP_OUT=/tmp/solver-input.json \
//   POSTGRES_HOST=$PGHOST POSTGRES_DATABASE=itsmyskool_prod POSTGRES_USERNAME=postgres \
//   POSTGRES_PASSWORD=itsmyskool POSTGRES_PORT=5432 POSTGRES_SSL=false \
//   npx jest modules/timetable/cpsat/dump-solver-input.test.ts --runTestsByPath --forceExit
//
// Optional: DUMP_WING=<wingClassId,csv> to scope to a wing (default = whole school).

import * as fs from "fs";
import { DB } from "../../../shared/lib/db";
import { loadConfigForSolve } from "../generation-data-loader";
import { buildLessons } from "../solver/build-lessons";
import { SolverInput } from "../solver/types";

const CONFIG_ID = process.env.DUMP_CONFIG_ID;
const OUT = process.env.DUMP_OUT || "/tmp/solver-input.json";
const WING = process.env.DUMP_WING ? process.env.DUMP_WING.split(",").filter(Boolean) : null;

const maybe = CONFIG_ID ? it : it.skip;

describe("dump SolverInput (faithful, via the real loader)", () => {
  maybe(
    "writes the assembled SolverInput to JSON",
    async () => {
      // Resolve the school for this config (loader needs schoolId as a filter).
      const rows = await DB.query(
        "select school_id, academic_year_id from timetable_config where uuid = $1",
        [CONFIG_ID],
      );
      if (rows.length === 0) throw new Error(`config ${CONFIG_ID} not found`);
      const schoolId: string = rows[0].schoolId;

      const loaded = await loadConfigForSolve(schoolId, CONFIG_ID!, WING);
      if (!loaded) throw new Error("loadConfigForSolve returned null");
      const built = buildLessons(loaded.buildInput);

      const input: SolverInput = {
        classIds: loaded.buildInput.classIds,
        grid: loaded.grid,
        lessons: built.lessons,
        constraints: loaded.constraints,
        cohorts: loaded.cohorts,
      };

      // Labels (id -> human name) are not part of SolverInput but make solution.json
      // readable and let the CP-SAT side render a grid. Serialize the Maps.
      const labels = {
        class: Object.fromEntries(loaded.labels.class),
        subject: Object.fromEntries(loaded.labels.subject),
        teacher: Object.fromEntries(loaded.labels.teacher),
      };

      const payload = {
        meta: {
          configId: CONFIG_ID,
          schoolId,
          academicYearId: loaded.academicYearId,
          wing: WING,
          dumpedAt: new Date().toISOString(),
          classCount: input.classIds.length,
          lessonCount: input.lessons.length,
        },
        input,
        labels,
        warnings: [...loaded.warnings, ...built.warnings],
      };

      fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
      // eslint-disable-next-line no-console
      console.log(
        `wrote ${OUT}: ${input.classIds.length} classes, ${input.lessons.length} lessons, ${input.constraints.length} constraints`,
      );
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
