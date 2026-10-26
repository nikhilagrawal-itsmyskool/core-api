import { DB, singleLineString } from '../../shared/lib/db';
import { findDeviceBySn, employeeByDeviceNumber } from './biometric-common';
import { parseAttlogLine, parseOperlogLine, parseDeviceCmdResult, parseInfo } from './biometric-parse';

const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// ─────────────────────────────────────────────────────────────────────────────
// ESSL / ZKTeco K30 Pro ADMS ("iclock" push) protocol.
//
// The device is the CLIENT: once its cloud-server (ADMS) IP+port is set, it polls us.
// All responses are plain text in ZKTeco's line format (NOT JSON). Identity is the
// serial number (SN) in the query string — the device carries no JWT, so a registered
// SN is both the identity and the allowlist. Validated end-to-end against a real device
// (see scripts/biometric-probe + the module memory) before this port was written.
//
// Endpoints (the firmware may append `.aspx`; we strip it):
//   GET  /iclock/cdata?SN=&options=all   → handshake: return the config block
//   GET  /iclock/getrequest?SN=          → command poll: return `OK` or `C:<id>:<cmd>`
//   POST /iclock/cdata?SN=&table=ATTLOG  → punches (tab-separated)
//   POST /iclock/cdata?SN=&table=OPERLOG → USER / FP / FACE / OPLOG records
//   POST /iclock/devicecmd?SN=           → result of a pushed command (ID=&Return=&CMD=)
// ─────────────────────────────────────────────────────────────────────────────

export interface IclockRequest {
  method: string;
  proxy: string; // path after /iclock/, e.g. 'cdata' or 'cdata.aspx'
  query: Record<string, string>;
  body: string;
  sourceIp?: string;
}

class DeviceService {
  // Entry point: dispatch one device request, return the plain-text body to reply with.
  public async handle(req: IclockRequest): Promise<string> {
    const sn = req.query.SN || req.query.sn || '';
    if (!sn) return 'OK';

    const op = req.proxy.replace(/\.aspx$/i, '').replace(/^\/+|\/+$/g, '').toLowerCase();
    const device = await findDeviceBySn(sn);

    // Unknown or disabled SN: stay polite (so the device doesn't error-loop) but store
    // nothing and serve no commands. A device must be registered (status active) first.
    if (!device || device.status !== 'active') {
      console.warn(`[biometric] ignoring request from unregistered/disabled SN=${sn} op=${op}`);
      return 'OK';
    }

    await this.touch(device, req);

    if (op === 'getrequest') return this.pollCommands(device, req);
    if (op === 'cdata') {
      return req.method.toUpperCase() === 'GET'
        ? this.handshake(device, req)
        : this.upload(device, req);
    }
    if (op === 'devicecmd') return this.deviceCmdResult(device, req);
    return 'OK';
  }

  // Update last-seen + heartbeat facts (firmware, counts, ip, pushver) best-effort.
  private async touch(device: any, req: IclockRequest): Promise<void> {
    // getrequest INFO carries firmware + counts + the device's own IP.
    const info = parseInfo(req.query.INFO);
    const ip = info.ip || req.sourceIp || null;
    await DB.query(
      singleLineString`update biometric_device set
        last_seen_at = now(),
        last_ip = coalesce($2, last_ip),
        firmware = coalesce($3, firmware),
        push_version = coalesce($4, push_version),
        user_count = coalesce($5, user_count),
        fp_count = coalesce($6, fp_count),
        updated_at = now()
        where uuid = $1`,
      [device.uuid, ip, info.firmware, req.query.pushver || null, info.userCount, info.fpCount],
    );
  }

  // Handshake config. Stamps are the device-reported high-water marks we've persisted,
  // so after the initial catch-up the device stops re-dumping history (Realtime=1 keeps
  // new punches flowing live regardless).
  private handshake(device: any, _req: IclockRequest): string {
    const attStamp = device.attlogStamp != null ? device.attlogStamp : 0;
    const opStamp = device.operlogStamp != null ? device.operlogStamp : 0;
    return [
      `GET OPTION FROM: ${device.serialNumber}`,
      `Stamp=${attStamp}`,
      `OpStamp=${opStamp}`,
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

  // Claim ONE queued command for this device (for update skip locked, like communication),
  // mark it sent, and return it as `C:<cmd_id>:<payload>`. The device reports the result
  // later via /iclock/devicecmd, matched on cmd_id.
  private async pollCommands(device: any, _req: IclockRequest): Promise<string> {
    // Small numeric id (fits the firmware's int range; the device echoes it on devicecmd).
    const cmdId = String((Date.now() % 1000000) * 10 + Math.floor(Math.random() * 10));
    const claimed = await DB.query(
      singleLineString`update biometric_command
        set status = 'sent', cmd_id = $2, sent_at = now(),
            attempts = coalesce(attempts, 0) + 1, updated_at = now()
        where uuid = (
          select uuid from biometric_command
          where device_sn = $1 and status = 'queued'
          order by created_at limit 1 for update skip locked
        )
        returning *`,
      [device.serialNumber, cmdId],
    );
    if (claimed.length === 0) return 'OK';
    const cmd = claimed[0];
    console.log(`[biometric] pushing command ${cmd.uuid} (${cmd.kind}) to SN=${device.serialNumber}`);
    return `C:${cmdId}:${cmd.payload}\n`;
  }

  // POST /iclock/cdata — a batch of uploaded records. table=ATTLOG | OPERLOG | ...
  private async upload(device: any, req: IclockRequest): Promise<string> {
    const table = (req.query.table || '').toUpperCase();
    const lines = req.body.split(/\r?\n/).map((l) => l).filter((l) => l.trim().length > 0);

    if (table === 'ATTLOG') {
      let count = 0;
      for (const line of lines) {
        if (await this.storePunch(device, line)) count++;
      }
      await this.advanceStamp(device, 'attlog_stamp', req.query.Stamp);
      return `OK: ${count}`;
    }

    if (table === 'OPERLOG') {
      for (const line of lines) {
        await this.storeOperlogLine(device, line);
      }
      await this.advanceStamp(device, 'operlog_stamp', req.query.OpStamp || req.query.Stamp);
      return 'OK';
    }

    // Other tables (ATTPHOTO, USERPIC, BIODATA photos, …) — acked, not stored in v1.
    return 'OK';
  }

  // One ATTLOG line: `<pin>\t<yyyy-MM-dd HH:mm:ss>\t<status>\t<verify>\t<workcode>...`.
  private async storePunch(device: any, line: string): Promise<boolean> {
    const rec = parseAttlogLine(line);
    if (!rec) return false;
    const emp = await employeeByDeviceNumber(device.schoolId, rec.pin);
    const res = await DB.query(
      singleLineString`insert into biometric_punch
        (uuid, school_id, device_sn, device_number, employee_id, punched_at, status_code, verify_mode, work_code, raw, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
        on conflict (device_sn, device_number, punched_at) do nothing
        returning uuid`,
      [generateShortUuid(12), device.schoolId, device.serialNumber, rec.pin, emp ? emp.uuid : null, rec.time, rec.statusCode, rec.verifyMode, rec.workCode, line],
    );
    return res.length > 0;
  }

  // One OPERLOG line. We care about USER (identity), FP/FACE (templates); OPLOG and the
  // rest are acknowledged and ignored in v1.
  private async storeOperlogLine(device: any, line: string): Promise<void> {
    const rec = parseOperlogLine(line);
    const f = rec.fields;

    if (rec.type === 'user') {
      const pin = (f.PIN || '').trim();
      if (!pin) return;
      const emp = await employeeByDeviceNumber(device.schoolId, pin);
      await this.upsertEnrollment(device, pin, {
        employeeId: emp ? emp.uuid : null,
        name: f.Name || null,
        privilege: f.Pri != null && /^\d+$/.test(f.Pri) ? parseInt(f.Pri, 10) : null,
        card: f.Card || null,
        markSynced: true,
      });
      return;
    }

    if (rec.type === 'fp' || rec.type === 'face') {
      const pin = (f.PIN || '').trim();
      if (!pin) return;
      const kind = rec.type;
      const fid = f.FID != null && /^\d+$/.test(f.FID) ? parseInt(f.FID, 10) : 0;
      const emp = await employeeByDeviceNumber(device.schoolId, pin);
      await DB.query(
        singleLineString`insert into biometric_template
          (uuid, school_id, device_sn, employee_id, device_number, kind, fid, size, valid, template, captured_at, created_at, updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now(), now(), now())
          on conflict (device_sn, device_number, kind, fid)
          do update set size = excluded.size, valid = excluded.valid, template = excluded.template,
                        employee_id = excluded.employee_id, captured_at = now(), updated_at = now()`,
        [
          generateShortUuid(12), device.schoolId, device.serialNumber, emp ? emp.uuid : null, pin, kind, fid,
          f.Size && /^\d+$/.test(f.Size) ? parseInt(f.Size, 10) : null,
          f.Valid && /^\d+$/.test(f.Valid) ? parseInt(f.Valid, 10) : null,
          f.TMP || f.Tmp || null,
        ],
      );
      await this.bumpCredentialCount(device, pin, kind, emp ? emp.uuid : null);
      return;
    }
    // OPLOG and anything else: ignore.
  }

  // Upsert the per-(device, pin) enrolment row. markSynced flips status to at least
  // 'synced' (a user record exists on the device).
  private async upsertEnrollment(
    device: any,
    pin: string,
    data: { employeeId: string | null; name: string | null; privilege: number | null; card: string | null; markSynced: boolean },
  ): Promise<void> {
    await DB.query(
      singleLineString`insert into biometric_enrollment
        (uuid, school_id, device_sn, employee_id, device_number, name, privilege, card, fp_count, face_count, status, synced_at, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,0,0,'synced', now(), now(), now())
        on conflict (device_sn, device_number)
        do update set name = coalesce(excluded.name, biometric_enrollment.name),
                      privilege = coalesce(excluded.privilege, biometric_enrollment.privilege),
                      card = coalesce(excluded.card, biometric_enrollment.card),
                      employee_id = coalesce(excluded.employee_id, biometric_enrollment.employee_id),
                      status = case when biometric_enrollment.status = 'enrolled' then 'enrolled' else 'synced' end,
                      synced_at = coalesce(biometric_enrollment.synced_at, now()),
                      updated_at = now()`,
      [generateShortUuid(12), device.schoolId, device.serialNumber, data.employeeId, pin, data.name, data.privilege, data.card],
    );
  }

  // A credential arrived → ensure an enrolment row exists, recount templates, flip to
  // 'enrolled', stamp enrolled_at.
  private async bumpCredentialCount(device: any, pin: string, kind: string, employeeId: string | null): Promise<void> {
    await this.upsertEnrollment(device, pin, { employeeId, name: null, privilege: null, card: null, markSynced: true });
    const col = kind === 'face' ? 'face_count' : 'fp_count';
    await DB.query(
      singleLineString`update biometric_enrollment e set
        ${col} = (select count(*) from biometric_template t
                  where t.device_sn = e.device_sn and t.device_number = e.device_number and t.kind = $3),
        status = 'enrolled',
        enrolled_at = coalesce(e.enrolled_at, now()),
        updated_at = now()
        where e.device_sn = $1 and e.device_number = $2`,
      [device.serialNumber, pin, kind],
    );
  }

  // POST /iclock/devicecmd — body like `ID=<id>&Return=0&CMD=DATA`. Confirm/fail the
  // matching command row (matched on the cmd_id we issued).
  private async deviceCmdResult(device: any, req: IclockRequest): Promise<string> {
    const { id, ret } = parseDeviceCmdResult(req.body);
    if (!id) return 'OK';
    const ok = ret === '0';
    await DB.query(
      singleLineString`update biometric_command
        set status = $3, return_code = $4, confirmed_at = now(), updated_at = now()
        where device_sn = $1 and cmd_id = $2 and status = 'sent'`,
      [device.serialNumber, id, ok ? 'confirmed' : 'failed', ret],
    );
    return 'OK';
  }

  // Persist a device-reported stamp as the new high-water mark (max of current/new).
  private async advanceStamp(device: any, column: 'attlog_stamp' | 'operlog_stamp', raw?: string): Promise<void> {
    if (raw == null || !/^\d+$/.test(raw)) return;
    const value = parseInt(raw, 10);
    await DB.query(
      singleLineString`update biometric_device set ${column} = greatest(coalesce(${column}, 0), $2), updated_at = now() where uuid = $1`,
      [device.uuid, value],
    );
  }
}

export const deviceService = new DeviceService();
