// The one place that knows *where* a generation run's CP-SAT artifacts live.
//
// Locally that's a folder per run under this directory: cpsat/<runId>/. In AWS the
// same signatures will be re-implemented over S3 (PutObject/GetObject under a
// runs/<runId>/ prefix) — nothing else in the pipeline (endpoints, workers, the
// Python solver) needs to change. This is the fs → S3 swap seam. Keep it dependency
// -light (fs + path only) so it can be imported by both the Lambda service and any
// plain node tooling.
//
// The written files are BYTE-IDENTICAL to what dump-solver-input.test.ts produces,
// so solve_cpsat.py reads them unchanged:
//   solver-input.json   { meta, input, labels, warnings }   (the CP-SAT model input)
//   registration.json   RegistrationEntry[]                 (0th period, not solved)
//   meta.json           run row + counts
// The Python solver then writes back into the same folder:
//   solution.json       Placement[]                         (the solved grid), OR
//   solve-error.json    { reason, status? }                 (infeasible / no solution)

import * as fs from "fs";
import * as path from "path";

// Root that holds one subfolder per run. Overridable so a worker/Lambda can point
// it elsewhere (e.g. an EFS mount, or S3 later); defaults to this source cpsat/ dir.
//
// NOTE: the timetable module runs under serverless-webpack, so at runtime __dirname
// is the bundle path (modules/timetable/.webpack/service), NOT the source cpsat dir.
// If we defaulted to __dirname the module (writer) would drop artifacts into the
// bundle (which is also wiped on restart), while the pollers (readers) scan the source
// cpsat dir — they'd never meet. So strip a `.webpack/...` suffix back to the source
// cpsat dir. Unbundled (ts-node/tests) __dirname is already .../modules/timetable/cpsat.
function resolveArtifactRoot(): string {
  const override = process.env.CPSAT_ARTIFACT_DIR;
  if (override) return override;
  const lower = __dirname.toLowerCase();
  const wp = lower.indexOf(".webpack");
  if (wp === -1) return __dirname;
  const moduleRoot = __dirname.slice(0, wp - 1); // drop the separator before .webpack
  return path.join(moduleRoot, "cpsat");
}
const ARTIFACT_ROOT = resolveArtifactRoot();

export const SOLVER_INPUT_FILE = "solver-input.json";
export const REGISTRATION_FILE = "registration.json";
export const META_FILE = "meta.json";
export const SOLUTION_FILE = "solution.json";
export const SOLVE_ERROR_FILE = "solve-error.json";
// Human-readable exports rendered by render_xls.py / render_pdf.py (best-effort, by
// the solver poller) into the same run folder.
export const XLSX_FILE = "timetable.xlsx";
export const PDF_FILE = "timetable.pdf";

export interface InputArtifacts {
  // `meta` mirrors the dumper's meta.json (runId, schoolId, configId, counts, ...).
  meta: Record<string, any>;
  // `input` is the exact SolverInput the engine feeds its solver.
  input: unknown;
  // id -> human label maps, serialized (class/subject/teacher) — for readable output.
  labels: unknown;
  warnings: string[];
  // Deterministic 0th-period rows — not solved, needed at import time.
  registrationEntries: unknown[];
}

export function runDir(runId: string): string {
  return path.join(ARTIFACT_ROOT, runId);
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

// Stage 1 (claim + dump): write the three input files for a run.
export function writeInputArtifacts(runId: string, a: InputArtifacts): string {
  const dir = runDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, SOLVER_INPUT_FILE),
    JSON.stringify(
      { meta: a.meta, input: a.input, labels: a.labels, warnings: a.warnings },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(dir, REGISTRATION_FILE),
    JSON.stringify(a.registrationEntries, null, 2),
  );
  fs.writeFileSync(path.join(dir, META_FILE), JSON.stringify(a.meta, null, 2));
  return dir;
}

// Stage 3 (import): read back what the solver produced / what stage 1 wrote.
// `readInput` returns the inner SolverInput (unwrapped from the { meta, input, ... }
// envelope) so it can be fed straight to scoreTimetable.
export function readInput<T = any>(runId: string): T | null {
  const wrapped = readJson<{ input: T }>(
    path.join(runDir(runId), SOLVER_INPUT_FILE),
  );
  return wrapped ? wrapped.input : null;
}

export function readSolution<T = any>(runId: string): T[] | null {
  return readJson<T[]>(path.join(runDir(runId), SOLUTION_FILE));
}

export function readRegistration<T = any>(runId: string): T[] | null {
  return readJson<T[]>(path.join(runDir(runId), REGISTRATION_FILE));
}

export function readSolveError(
  runId: string,
): { reason?: string; status?: string } | null {
  return readJson(path.join(runDir(runId), SOLVE_ERROR_FILE));
}

// Read a rendered export (xlsx/pdf) as raw bytes; null if not rendered yet.
export function readExport(
  runId: string,
  format: "xlsx" | "pdf",
): Buffer | null {
  const file = path.join(
    runDir(runId),
    format === "pdf" ? PDF_FILE : XLSX_FILE,
  );
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}
