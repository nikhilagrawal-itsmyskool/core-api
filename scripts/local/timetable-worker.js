// Timetable generation worker (local).
//
// The generation_run table IS the queue. This worker just polls the timetable
// module's internal endpoint, which atomically claims one queued run
// (`for update skip locked`), solves it, and writes candidates. All solver
// logic lives in the TS Lambda; on AWS this poller is replaced by an
// EventBridge/SQS trigger and the endpoint stays the same.
//
// Usage:
//   node scripts/local/timetable-worker.js [--port 3000] [--interval 2000] [--worker-id w1]
//
// Defaults to the gateway port (3000) so it works against /timetable/* whether
// the module runs standalone or behind the gateway.

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { port: null, interval: 2000, workerId: `worker-${process.pid}` };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') { out.port = parseInt(args[++i], 10); }
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

async function main() {
  const opts = parseArgs();
  const port = resolvePort(opts.port);
  const url = `http://localhost:${port}/timetable/runs/process-next`;
  console.log(`[timetable-worker] ${opts.workerId} polling ${url} every ${opts.interval}ms`);

  let running = true;
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workerId: opts.workerId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.claimed) {
          console.log(`[timetable-worker] processed run ${data.runId}: ${data.status}` + (data.candidateCount != null ? ` (${data.candidateCount} candidates)` : '') + (data.error ? ` — ${data.error}` : ''));
          continue; // immediately try the next queued run
        }
      } else {
        console.error(`[timetable-worker] process-next HTTP ${res.status}`);
      }
    } catch (err) {
      // module not up yet / transient — keep polling quietly
    }
    await sleep(opts.interval);
  }
  console.log('[timetable-worker] stopped');
}

main();
