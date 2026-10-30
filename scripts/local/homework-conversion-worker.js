// Homework Word->PDF conversion worker (local).
//
// The homework_item table IS the queue. This poller hits the homework module's
// process-next endpoint, which atomically claims one pending Word item
// (`pdf_status='pending'`, `for update skip locked`), renders its Word source to
// PDF, stores it as the item's 'original', and marks it 'ready'. All logic lives in
// the TS Lambda; on AWS this poller is replaced by the drain-conversions EventBridge
// schedule.
//
// NOTE: conversion is DISABLED unless HOMEWORK_CONVERT_ENABLED=true (+ the LibreOffice
// layer, which only exists on AWS). Locally it returns {status:'skipped'} and this
// worker idles quietly — Word conversion is exercised in prod, not local dev.
//
// Usage:
//   node scripts/local/homework-conversion-worker.js [--port 3000] [--interval 2000]

const fs = require('fs');
const http = require('http');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { port: null, host: '127.0.0.1', interval: 2000 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') out.port = parseInt(args[++i], 10);
    else if (args[i] === '--host') out.host = args[++i];
    else if (args[i] === '--interval') out.interval = parseInt(args[++i], 10);
  }
  return out;
}

function resolvePort(explicit) {
  if (explicit) return explicit;
  if (process.env.GATEWAY_PORT) return parseInt(process.env.GATEWAY_PORT, 10);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../modules/homework/local.config.json'), 'utf8'));
    return cfg.httpPort;
  } catch (e) {
    return 3000;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpPost(host, port, reqPath) {
  return new Promise((resolve, reject) => {
    const payload = '{}';
    const req = http.request(
      { host, port, path: reqPath, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error(`bad JSON: ${raw}`)); } });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  const opts = parseArgs();
  const port = resolvePort(opts.port);
  const reqPath = '/homework/conversions/process-next';
  console.log(`[homework-conversion-worker] polling http://${opts.host}:${port}${reqPath} every ${opts.interval}ms`);

  let running = true;
  let lastErr = null;
  let idleLogged = false;
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  while (running) {
    try {
      const data = await httpPost(opts.host, port, reqPath);
      lastErr = null;
      if (data.status === 'converted' || data.status === 'retry' || data.status === 'failed') {
        console.log(`[homework-conversion-worker] ${data.status} ${data.itemId || ''}${data.error ? ` — ${data.error}` : ''}`);
        idleLogged = false;
        continue; // immediately try the next pending item
      }
      if ((data.status === 'skipped' || data.status === 'idle') && !idleLogged) {
        console.log(`[homework-conversion-worker] ${data.status}${data.reason ? ` (${data.reason})` : ''}`);
        idleLogged = true;
      }
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (msg !== lastErr) { console.error(`[homework-conversion-worker] poll error: ${msg}`); lastErr = msg; }
    }
    await sleep(opts.interval);
  }
  console.log('[homework-conversion-worker] stopped');
}

main();
