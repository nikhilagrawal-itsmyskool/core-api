// Pure parsers/formatters for the ZKTeco iclock wire format. Kept DB-free so they can be
// unit-tested directly (the parsing is the error-prone part of the protocol).

export interface AttlogRecord {
  pin: string;
  time: string;
  statusCode: string | null;
  verifyMode: string | null;
  workCode: string | null;
}

// `<pin>\t<yyyy-MM-dd HH:mm:ss>\t<status>\t<verify>\t<workcode>...` → record, or null if
// the line lacks a pin+time.
export function parseAttlogLine(line: string): AttlogRecord | null {
  const f = line.split('\t');
  const pin = (f[0] || '').trim();
  const time = (f[1] || '').trim();
  if (!pin || !time) return null;
  return {
    pin,
    time,
    statusCode: (f[2] || '').trim() || null,
    verifyMode: (f[3] || '').trim() || null,
    workCode: (f[4] || '').trim() || null,
  };
}

// Tab-separated `key=value` pairs after a record's leading tag.
export function parseFields(rest: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of rest.split(/\t/)) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1);
  }
  return out;
}

export interface OperlogRecord {
  type: 'user' | 'fp' | 'face' | 'other';
  tag: string;
  fields: Record<string, string>;
}

// Classify an OPERLOG line (`USER PIN=…`, `FP PIN=…`, `FACE …`, `BIODATA …`, `OPLOG …`).
export function parseOperlogLine(line: string): OperlogRecord {
  const sp = line.indexOf(' ');
  const tag = (sp > 0 ? line.slice(0, sp) : line).toUpperCase();
  const rest = sp > 0 ? line.slice(sp + 1) : '';
  const fields = parseFields(rest);
  let type: OperlogRecord['type'] = 'other';
  if (tag === 'USER') type = 'user';
  else if (tag === 'FP') type = 'fp';
  else if (tag === 'FACE') type = 'face';
  else if (tag === 'BIODATA') type = fields.Type === '2' ? 'face' : 'fp';
  return { type, tag, fields };
}

// `ID=<id>&Return=0&CMD=DATA` → object.
export function parseDeviceCmdResult(body: string): { id: string | null; ret: string | null; cmd: string | null } {
  const kv: Record<string, string> = {};
  for (const part of body.split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) kv[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return { id: kv.ID || kv.Id || null, ret: kv.Return != null ? kv.Return : null, cmd: kv.CMD || kv.Cmd || null };
}

// getrequest INFO = "Ver x.y.z,userCount,fpCount,faceCount,ip,...".
export function parseInfo(info: string | undefined): { firmware: string | null; userCount: number | null; fpCount: number | null; ip: string | null } {
  const out = { firmware: null as string | null, userCount: null as number | null, fpCount: null as number | null, ip: null as string | null };
  if (!info) return out;
  const parts = info.split(',');
  if (parts[0]) out.firmware = parts[0].replace(/^Ver\s*/i, '').trim();
  if (parts[1] && /^\d+$/.test(parts[1])) out.userCount = parseInt(parts[1], 10);
  if (parts[2] && /^\d+$/.test(parts[2])) out.fpCount = parseInt(parts[2], 10);
  if (parts[4] && /^\d+\.\d+\.\d+\.\d+$/.test(parts[4])) out.ip = parts[4];
  return out;
}

// Device name field: no tabs/newlines, bounded length (the K30 name field is short).
export function deviceName(name: string | null | undefined): string {
  return (name || '').replace(/[\t\r\n]+/g, ' ').trim().slice(0, 24);
}

// Create/update a device user. `pri` is the privilege/role: 0 = normal user,
// 14 = super admin (can enrol others at the keypad). Default 0.
export function buildPushUserPayload(pin: string, name: string, pri: number = 0): string {
  return `DATA UPDATE USERINFO PIN=${pin}\tName=${name}\tPri=${pri}\tPasswd=\tCard=\tGrp=1\tTZ=`;
}

export function buildDeleteUserPayload(pin: string): string {
  return `DATA DELETE USERINFO PIN=${pin}`;
}

// Push a stored fingerprint template back to the device (replay after a wipe or on
// restoring a reactivated employee, so they need not re-enrol at the keypad). fid is
// the finger index (0..9); tmp is the base64 template captured from the device.
export function buildFpPayload(pin: string, fid: number, size: number, valid: number, tmp: string): string {
  return `DATA UPDATE FINGERTMP PIN=${pin}\tFID=${fid}\tSize=${size}\tValid=${valid}\tTMP=${tmp}`;
}
