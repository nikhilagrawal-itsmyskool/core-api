// CP-SAT pipeline — STAGE 1 poller (Node): claim + dump.
//
// Polls the timetable module's /runs/claim-and-dump endpoint. Each successful claim
// atomically flips one queued generation_run to 'running' and writes its SolverInput
// to the run's artifact folder (cpsat/<runId>/) for the Python solver to pick up.
// This worker does NOT solve — the Python poller does that next.
//
// In AWS this poller is replaced by an EventBridge schedule (~1 min) triggering the
// equivalent Lambda; the endpoint stays the same.
//
// Usage:
//   node scripts/local/cpsat-dump-worker.js [--port 3000] [--host 127.0.0.1] [--interval 5000] [--worker-id d1]
//
// Mirrors timetable-worker.js: defaults to the gateway port (3000) and uses
// http.request (not fetch) so prod-stage port 6000 isn't blocked as a WHATWG bad port.

const fs = require('fs');
const http = require('http');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { port: null, host: '127.0.0.1', interval: 5000, workerId: `cpsat-dump-${process.pid}` };
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

async function main() {
  const opts = parseArgs();
  const port = resolvePort(opts.port);
  console.log(`[cpsat-dump-worker] ${opts.workerId} polling http://${opts.host}:${port}/timetable/runs/claim-and-dump every ${opts.interval}ms`);

  let running = true;
  let lastErr = null;
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    try {
      const data = await httpPost(opts.host, port, '/timetable/runs/claim-and-dump', { workerId: opts.workerId });
      lastErr = null;
      if (data.claimed) {
        if (data.error) {
          console.error(`[cpsat-dump-worker] run ${data.runId} failed to dump: ${data.error}`);
        } else {
          console.log(`[cpsat-dump-worker] dumped run ${data.runId} (${data.classCount} classes, ${data.lessonCount} lessons)`);
        }
        continue; // immediately try the next queued run
      }
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (msg !== lastErr) { console.error(`[cpsat-dump-worker] poll error: ${msg}`); lastErr = msg; }
    }
    await sleep(opts.interval);
  }
  console.log('[cpsat-dump-worker] stopped');
}

main();
