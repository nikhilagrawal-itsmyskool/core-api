#!/usr/bin/env node
/*
 * LAN→prod bridge for the ESSL K30 Pro.
 *
 * The device's ADMS "Server Address" field is numeric (IP) and the firmware speaks plain
 * HTTP to a fixed /iclock/ path — it can't carry the `/biometric` base path or (reliably)
 * do HTTPS. So we keep the device pointed at THIS box on the LAN exactly like the probe
 * (IP 192.168.68.53, port 8080, Domain Name OFF, HTTPS OFF) and this process forwards every
 * /iclock/* request to the prod Lambda over HTTPS:
 *
 *     device  →  http://<box-lan-ip>:8080/iclock/...   (plain, numeric, unchanged)
 *                      │  this forwarder
 *                      ▼
 *     prod    →  https://api-prod.itsmyskool.com/biometric/iclock/...   (TLS hop)
 *
 * Punches / enrolments land in the PROD database via the deployed biometric module.
 * Requires this box to be on + on the same LAN as the device. (Long-term, a dedicated
 * root-path device subdomain would remove the box dependency.)
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const UPSTREAM_HOST = process.env.UPSTREAM_HOST || 'api-prod.itsmyskool.com';
const BASE_PATH = process.env.BASE_PATH || '/biometric'; // prepended to the device's path
const LOG_FILE = path.join(__dirname, 'forward.log');

function stamp() { return new Date().toISOString().replace('T', ' ').replace('Z', ''); }
function log(line) {
  const out = `[${stamp()}] ${line}`;
  console.log(out);
  try { fs.appendFileSync(LOG_FILE, out + '\n'); } catch (_) {}
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    // Device path (e.g. /iclock/cdata.aspx?SN=...) -> /biometric/iclock/cdata.aspx?SN=...
    const upstreamPath = BASE_PATH + req.url;

    const headers = {};
    if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
    headers['Content-Length'] = Buffer.byteLength(body);
    headers['Host'] = UPSTREAM_HOST; // CloudFront/API-GW route by Host + SNI

    const options = {
      hostname: UPSTREAM_HOST,
      port: 443,
      method: req.method,
      path: upstreamPath,
      headers,
      servername: UPSTREAM_HOST, // SNI
    };

    const started = Date.now();
    const up = https.request(options, (upRes) => {
      const outChunks = [];
      upRes.on('data', (c) => outChunks.push(c));
      upRes.on('end', () => {
        const outBody = Buffer.concat(outChunks);
        log(`${req.method} ${req.url}  ->  ${upstreamPath}  [${upRes.statusCode}] ${Date.now() - started}ms  in=${body.length}b out=${outBody.length}b`);
        if (body.length && body.length < 400) log(`  req: ${body.toString('utf8').replace(/\s+/g, ' ').slice(0, 300)}`);
        if (outBody.length && outBody.length < 400) log(`  res: ${outBody.toString('utf8').replace(/\s+/g, ' ').slice(0, 300)}`);
        res.writeHead(upRes.statusCode || 502, { 'Content-Type': upRes.headers['content-type'] || 'text/plain' });
        res.end(outBody);
      });
    });
    up.on('error', (err) => {
      // Never hard-fail the device; reply OK so it retries on its next poll.
      log(`UPSTREAM ERROR for ${req.url}: ${err.message} — replying OK`);
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });
    up.setTimeout(25000, () => up.destroy(new Error('upstream timeout')));
    if (body.length) up.write(body);
    up.end();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  log('='.repeat(70));
  log(`LAN->prod forwarder listening on 0.0.0.0:${PORT}`);
  log(`Forwarding /iclock/* -> https://${UPSTREAM_HOST}${BASE_PATH}/iclock/*`);
  log('Point the K30 ADMS at this box: Server Address = this PC LAN IP, Port = ' + PORT + ', Domain Name OFF, HTTPS OFF');
  log('Logs -> ' + LOG_FILE);
  log('='.repeat(70));
});
