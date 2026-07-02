// Dedicated jest config for the CP-SAT dump spec (dump-solver-input.test.ts).
//
// Why a separate config: the root jest.config.js only discovers __tests__/**, and its
// setupFilesAfterEnv (tests/setup.ts) force-loads configs/local/local.yml into
// POSTGRES_* — which would clobber the prod env that ./load-env sets and point the
// dump at the wrong database. This config matches the co-located cpsat spec and omits
// that setup file, so load-env (configs/prod/prod.yml) wins.
//
// Run (from repo root, Windows):
//   $env:DUMP_RUN_ID="<run-uuid>"; node node_modules/jest/bin/jest.js \
//     --config modules/timetable/cpsat/jest.config.js --forceExit
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "../../..",
  testMatch: ["**/modules/timetable/cpsat/*.test.ts"],
  testTimeout: 130000,
  maxWorkers: 1,
};
