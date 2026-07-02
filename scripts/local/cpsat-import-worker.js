// CP-SAT pipeline — STAGE 3 poller (Node): detect + import.
//
// Scans the artifact root (cpsat/<runId>/) for runs the Python solver has finished:
// a folder with solution.json (solved) OR solve-error.json (infeasible/no solution)
// and no .imported marker. For each, it calls the timetable module's
// /runs/import-solution endpoint (which writes the candidate + entries and flips the
// run to completed, or marks it failed), then drops an .imported marker so the folder
// isn't processed again.
//
// In AWS this poller is replaced by an S3 ObjectCreated trigger on solution.json; the
// endpoint stays the same. Kept separate from the dump worker on purpose so it maps to
// a distinct Lambda.
//
// Usage:
//   node scripts/local/cpsat-import-worker.js [--port 3000] [--host 127.0.0.1] [--interval 5000] [--dir <artifact-root>]

const fs = require('fs');
const http = require('http');
const path = require('path');

const DEFAULT_ROOT = path.join(__dirname, '../../modules/timetable/cpsat');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { port: null, host: '127.0.0.1', interval: 5000, dir: process.env.CPSAT_ARTIFACT_DIR || DEFAULT_ROOT };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') { out.port = parseInt(args[++i], 10); }
    else if (args[i] === '--host') { out.host = args[++i]; }
    else if (args[i] === '--interval') { out.interval = parseInt(args[++i], 10); }
    else if (args[i] === '--dir') { out.dir = args[++i]; }
  }
  return out;
}

function resolvePort(explicit) {
  if (explicit) return explicit;
  if (process.env.GATEWAY_PORT) return parseInt(process.env.GATEWAY_PORT, 10);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../modules/timetable/local.config.json'), 'utf8'));
    return cfg.httpPort;
  } catch (e) {
    return 3000;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpPost(host, port, reqPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host, port, path: reqPath, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`bad JSON: ${raw}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// Folders ready to import: have a solver result, not yet imported.
function readyRuns(root) {
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return []; }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const hasResult = fs.existsSync(path.join(dir, 'solution.json')) || fs.existsSync(path.join(dir, 'solve-error.json'));
    const done = fs.existsSync(path.join(dir, '.imported'));
    if (hasResult && !done) out.push({ runId: e.name, dir });
  }
  return out;
}

async function main() {
  const opts = parseArgs();
  const port = resolvePort(opts.port);
  console.log(`[cpsat-import-worker] scanning ${opts.dir}, importing via http://${opts.host}:${port}/timetable/runs/import-solution every ${opts.interval}ms`);

  let running = true;
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    const runs = readyRuns(opts.dir);
    for (const { runId, dir } of runs) {
      if (!running) break;
      try {
        const data = await httpPost(opts.host, port, '/timetable/runs/import-solution', { runId });
        // Mark imported regardless of completed/failed so we don't reprocess; the DB
        // status is the source of truth for the outcome.
        fs.writeFileSync(path.join(dir, '.imported'), new Date().toISOString());
        console.log(`[cpsat-import-worker] imported run ${runId}: ${data.status}` + (data.score != null ? ` (score ${data.score})` : '') + (data.error ? ` — ${data.error}` : ''));
      } catch (err) {
        console.error(`[cpsat-import-worker] import error for run ${runId}: ${(err && err.message) || err}`);
      }
    }
    await sleep(opts.interval);
  }
  console.log('[cpsat-import-worker] stopped');
}

main();
