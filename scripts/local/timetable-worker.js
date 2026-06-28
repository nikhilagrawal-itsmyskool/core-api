// Timetable generation worker (local).
//
// The generation_run table IS the queue. This worker just polls the timetable
// module's internal endpoint, which atomically claims one queued run
// (`for update skip locked`), solves it, and writes candidates. All solver
// logic lives in the TS Lambda; on AWS this poller is replaced by an
// EventBridge/SQS trigger and the endpoint stays the same.
//
// Usage:
//   node scripts/local/timetable-worker.js [--port 3000] [--host 127.0.0.1] [--interval 2000] [--worker-id w1]
//
// Defaults to the gateway port (3000) so it works against /timetable/* whether
// the module runs standalone or behind the gateway. Uses http.request instead of
// fetch: Node's built-in fetch (Undici) blocks port 6000 as a WHATWG "bad port"
// (X11), which breaks prod-stage usage. http.request has no such restriction.

const fs = require('fs');
const http = require('http');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { port: null, host: '127.0.0.1', interval: 2000, workerId: `worker-${process.pid}` };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') { out.port = parseInt(args[++i], 10); }
    else if (args[i] === '--host') { out.host = args[++i]; }
    else if (args[i] === '--interval') { out.interval = parseInt(args[++i], 10); }
    else if (args[i] === '--worker-id') { out.workerId = args[++i]; }
  }
  return out;
}

function resolvePort(explicit) {
  if (explicit) return explicit;
  if (process.env.GATEWAY_PORT) return parseInt(process.env.GATEWAY_PORT, 10);
  // fall back to the timetable module's own http port
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../modules/timetable/local.config.json'), 'utf8'));
    return cfg.httpPort;
  } catch (e) {
    return 3000;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpPost(host, port, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({ host, port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
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

async function main() {
  const opts = parseArgs();
  const port = resolvePort(opts.port);
  const url = `http://${opts.host}:${port}/timetable/runs/process-next`;
  console.log(`[timetable-worker] ${opts.workerId} polling ${url} every ${opts.interval}ms`);

  let running = true;
  let lastErr = null; // dedupe repeated poll errors so they're visible but not spammy
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    try {
      const data = await httpPost(opts.host, port, '/timetable/runs/process-next', { workerId: opts.workerId });
      lastErr = null;
      if (data.claimed) {
        console.log(`[timetable-worker] processed run ${data.runId}: ${data.status}` + (data.candidateCount != null ? ` (${data.candidateCount} candidates)` : '') + (data.error ? ` — ${data.error}` : ''));
        continue; // immediately try the next queued run
      }
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (msg !== lastErr) { console.error(`[timetable-worker] poll error: ${msg}`); lastErr = msg; }
    }
    await sleep(opts.interval);
  }
  console.log('[timetable-worker] stopped');
}

main();
