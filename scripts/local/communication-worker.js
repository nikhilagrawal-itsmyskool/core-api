// Communication send worker (local).
//
// The message_job table IS the queue. This worker just polls the communication
// module's internal endpoint, which atomically claims one DUE job
// (`status='queued' and scheduled_at <= now()`, `for update skip locked`),
// resolves its audience, runs the channel ladder, and sends via the provider
// (stub by default). All logic lives in the TS Lambda; on AWS this poller is
// replaced by an EventBridge/SQS trigger and the endpoint stays the same.
//
// Usage:
//   node scripts/local/communication-worker.js [--port 3000] [--interval 2000] [--worker-id w1]
//
// Defaults to the gateway port (3000) so it works against /communication/*
// whether the module runs standalone or behind the gateway.

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { port: null, interval: 2000, workerId: `comm-worker-${process.pid}` };
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
  // fall back to the communication module's own http port
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../modules/communication/local.config.json'), 'utf8'));
    return cfg.httpPort;
  } catch (e) {
    return 3000;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const opts = parseArgs();
  const port = resolvePort(opts.port);
  const url = `http://localhost:${port}/communication/messages/process-next`;
  console.log(`[communication-worker] ${opts.workerId} polling ${url} every ${opts.interval}ms`);

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
          const c = data.counts || {};
          console.log(`[communication-worker] processed job ${data.jobId}: ${data.status}` +
            (data.counts ? ` (sent=${c.sent || 0} failed=${c.failed || 0} skipped=${c.skipped || 0})` : '') +
            (data.error ? ` — ${data.error}` : ''));
          continue; // immediately try the next due job
        }
      } else {
        console.error(`[communication-worker] process-next HTTP ${res.status}`);
      }
    } catch (err) {
      // module not up yet / transient — keep polling quietly
    }
    await sleep(opts.interval);
  }
  console.log('[communication-worker] stopped');
}

main();
