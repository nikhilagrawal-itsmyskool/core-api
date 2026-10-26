#!/usr/bin/env node
/*
 * ESSL / ZKTeco K30 Pro — PASSIVE ADMS (iclock push) probe server.
 *
 * Purpose: capture exactly what the device sends over the LAN before we build
 * the real `biometric` Lambda module. This server is DELIBERATELY read-only /
 * non-destructive:
 *   - every device poll (/iclock/getrequest) is answered with "OK" = no commands,
 *     so we NEVER instruct the device to clear/delete/reconfigure anything.
 *   - every upload (punches, users, fingerprints) is just logged + saved to disk
 *     and acked with "OK" so the device stays happy and keeps talking.
 *
 * The ONLY things that change on the device are the cloud-server IP/port you type
 * on its keypad — reversible anytime from Menu -> Comm -> Cloud Server (ADMS).
 *
 * OPT-IN push test (OFF by default): to deliberately push ONE command (e.g. create
 * a throwaway test user) put lines in  scripts/biometric-probe/commands.txt  — see
 * the README section at the bottom of this file. Absent file = pure passive mode.
 *
 * Run:  node scripts/biometric-probe/probe-server.js        (defaults to port 8080)
 *       PORT=80 node scripts/biometric-probe/probe-server.js
 */

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '8080', 10);
const DIR = __dirname;
const CAPTURE_DIR = path.join(DIR, 'captures');
const LOG_FILE = path.join(DIR, 'probe.log');
const COMMANDS_FILE = path.join(DIR, 'commands.txt');

fs.mkdirSync(CAPTURE_DIR, { recursive: true });

// ---- logging helpers --------------------------------------------------------
function stamp() {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}
function log(line) {
  const out = `[${stamp()}] ${line}`;
  console.log(out);
  try {
    fs.appendFileSync(LOG_FILE, out + '\n');
  } catch (_) {}
}
function safeName(s) {
  return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
}

// ---- command queue (OPT-IN, off by default) ---------------------------------
// Returns an array of raw command strings (without the "C:<id>:" prefix), one per
// non-empty, non-# line in commands.txt. We serve them ONCE then clear the file so
// a single edit = a single push. If the file is absent -> [] (pure passive mode).
let cmdSeq = Date.now() % 100000;
function takePendingCommands() {
  if (!fs.existsSync(COMMANDS_FILE)) return [];
  let raw = '';
  try {
    raw = fs.readFileSync(COMMANDS_FILE, 'utf8');
  } catch (_) {
    return [];
  }
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    // allow literal \t in the file for the tab-separated field format
    .map((l) => l.replace(/\\t/g, '\t'));
  if (lines.length) {
    // consume: blank the file so we don't re-send on the next poll
    try {
      fs.writeFileSync(COMMANDS_FILE, '# consumed ' + stamp() + '\n');
    } catch (_) {}
  }
  return lines;
}

// ---- plain-text responses the device expects --------------------------------
function handshakeResponse(sn) {
  // Config block returned on the GET /iclock/cdata?options=all handshake.
  // Realtime=1 => device uploads punches immediately. Stamps are deliberately
  // high so the device doesn't believe it must resend huge historical batches;
  // we'll learn the exact dialect (Stamp vs ATTLOGStamp) from the FIRST capture.
  return [
    `GET OPTION FROM: ${sn || 'UNKNOWN'}`,
    'Stamp=9999',
    'OpStamp=9999',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;23:59',
    'TransInterval=1',
    'TransFlag=TransData AttLog OpLog AttPhoto EnrollUser ChgUser EnrollFP ChgFP UserPic',
    'TimeZone=330',
    'Realtime=1',
    'Encrypt=0',
    '',
  ].join('\n');
}

function reply(res, body, code = 200) {
  res.writeHead(code, { 'Content-Type': 'text/plain' });
  res.end(body);
}

// ---- request handler --------------------------------------------------------
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const u = new URL(req.url, `http://localhost:${PORT}`);
    const q = Object.fromEntries(u.searchParams.entries());
    const sn = q.SN || q.sn || '';
    const table = q.table || '';
    // Firmware hits /iclock/cdata.aspx, /iclock/getrequest.aspx etc. — strip the
    // optional .aspx suffix so our routes match both forms.
    const pathName = u.pathname.replace(/\.aspx$/i, '');

    // --- log the request ---
    log(`${req.method} ${pathName}  query=${JSON.stringify(q)}`);
    if (body.length) {
      const text = body.toString('utf8');
      const printable = /[\x00-\x08\x0e-\x1f]/.test(text) === false; // crude binary check
      const capName = `${safeName(stamp())}__${req.method}__${safeName(pathName)}__${safeName(table)}__SN${safeName(sn)}.bin`;
      try {
        fs.writeFileSync(path.join(CAPTURE_DIR, capName), body);
      } catch (_) {}
      if (printable) {
        log(`  body (${body.length} bytes):\n${text.replace(/^/gm, '    ')}`);
      } else {
        log(`  body (${body.length} bytes, looks binary) -> saved captures/${capName}`);
        log(`  preview: ${text.slice(0, 200).replace(/[\x00-\x1f]/g, '.')}`);
      }
    }

    // --- route (all answers are non-destructive) ---
    // GET /iclock/getrequest -> poll for commands
    if (req.method === 'GET' && pathName.endsWith('/iclock/getrequest')) {
      const cmds = takePendingCommands();
      if (!cmds.length) return reply(res, 'OK');
      const payload = cmds.map((c) => `C:${++cmdSeq}:${c}`).join('\n') + '\n';
      log(`  --> PUSHING ${cmds.length} command(s):\n${payload.replace(/^/gm, '    ')}`);
      return reply(res, payload);
    }

    // GET /iclock/cdata?...&options=all -> handshake
    if (req.method === 'GET' && pathName.endsWith('/iclock/cdata')) {
      return reply(res, handshakeResponse(sn));
    }

    // POST /iclock/cdata?table=ATTLOG|OPERLOG|ATTPHOTO... -> uploads
    if (req.method === 'POST' && pathName.endsWith('/iclock/cdata')) {
      return reply(res, 'OK');
    }

    // POST /iclock/devicecmd -> device reporting result of a pushed command
    if (req.method === 'POST' && pathName.endsWith('/iclock/devicecmd')) {
      return reply(res, 'OK');
    }

    // anything else the firmware might probe (fdata, edata, ping, etc.)
    return reply(res, 'OK');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === 'IPv4' && !i.internal) ips.push(`${i.address}  (${name})`);
    }
  }
  log('='.repeat(72));
  log(`ESSL/ZKTeco ADMS passive probe listening on 0.0.0.0:${PORT}`);
  log('Logs      -> ' + LOG_FILE);
  log('Raw bodies-> ' + CAPTURE_DIR);
  log('Commands  -> ' + COMMANDS_FILE + ' (absent = pure passive, no pushes)');
  log('-'.repeat(72));
  log('On the K30 Pro: Menu -> Comm -> Cloud Server (ADMS):');
  log('  Server Address = one of this PC\'s LAN IPs below');
  log(`  Server Port    = ${PORT}`);
  log('  Enable Domain Name = OFF    HTTPS = OFF');
  log('This PC\'s LAN IPs:');
  if (ips.length) ips.forEach((ip) => log('  ' + ip));
  else log('  (none found — are you on Wi-Fi/LAN?)');
  log('-'.repeat(72));
  log('NOTE: first incoming connection may be blocked by Windows Firewall —');
  log('allow "Node.js" on Private networks if the device can\'t reach you.');
  log('='.repeat(72));
});

/*
 * ---------------------------------------------------------------------------
 * OPT-IN push test (do this only when you deliberately want to try pushing):
 *
 * Create  scripts/biometric-probe/commands.txt  with ONE line, e.g. create a
 * throwaway test user with PIN 99001 (use literal \t for tab-separated fields):
 *
 *   DATA UPDATE USERINFO PIN=99001\tName=TEST USER\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=
 *
 * On the device's next poll the server serves it ONCE, logs it, then blanks the
 * file. To remove that test user afterwards:
 *
 *   DATA DELETE USERINFO PIN=99001
 *
 * Creating/deleting a throwaway PIN like 99001 is additive and reversible — it
 * does not touch real enrolled staff. Avoid "CLEAR DATA" / "CLEAR FP" entirely.
 * ---------------------------------------------------------------------------
 */
