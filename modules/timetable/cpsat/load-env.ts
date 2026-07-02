// Side-effect import: populate POSTGRES_* env from configs/<stage>/<stage>.yml
// BEFORE shared/lib/db.ts is evaluated (that module reads process.env once, at load).
//
// Only acts when DUMP_RUN_ID is set, so a normal `npx jest` / test:all run is a
// pure no-op and never points the pool at prod. Existing env vars win, so you can
// still override host/db from the shell (e.g. a WSL -> Windows host IP). Default
// stage = prod (override with DUMP_STAGE).
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

if (process.env.DUMP_RUN_ID) {
  const stage = process.env.DUMP_STAGE || "prod";
  const cfgPath = path.join(__dirname, "..", "..", "..", "configs", stage, `${stage}.yml`);
  if (fs.existsSync(cfgPath)) {
    const cfg = (yaml.load(fs.readFileSync(cfgPath, "utf8")) || {}) as Record<string, string>;
    const keys = [
      "POSTGRES_HOST",
      "POSTGRES_ENDPOINT",
      "POSTGRES_DATABASE",
      "POSTGRES_USERNAME",
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "POSTGRES_PORT",
      "POSTGRES_SSL",
    ];
    for (const k of keys) {
      if (cfg[k] != null && !process.env[k]) process.env[k] = String(cfg[k]);
    }
    // eslint-disable-next-line no-console
    console.log(
      `[load-env] stage=${stage} host=${process.env.POSTGRES_HOST || process.env.POSTGRES_ENDPOINT} db=${process.env.POSTGRES_DATABASE}`,
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(`[load-env] config not found: ${cfgPath} (relying on shell env)`);
  }
}
