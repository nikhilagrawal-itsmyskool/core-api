import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult, NotFoundResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { findEmployee, findEmployeeAny, findDeviceBySn, activeDevicesForSchool, nextDeviceNumber, isValidDevicePin } from './biometric-common';
import { deviceName, buildPushUserPayload, buildDeleteUserPayload, buildFpPayload } from './biometric-parse';

// Device privilege/role: a normal user vs a super admin (who can enrol others at the
// keypad). The firmware only recognises these two for our purposes.
const PRI_USER = 0;
const PRI_SUPER_ADMIN = 14;

// One device-membership change a reconcile applied — surfaced so the UI can say WHO
// was suspended/restored rather than just a count.
interface ReconcileAction {
  action: 'suspended' | 'restored';
  name: string;
  deviceNumber: string;
  deviceSn: string;
}

const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class BiometricService {
  // ── Devices ────────────────────────────────────────────────────────────────
  public async listDevices(schoolId: string): Promise<any[]> {
    return DB.query(
      singleLineString`select d.*,
          (select count(*) from biometric_enrollment e where e.device_sn = d.serial_number) as enrollment_count
        from biometric_device d where d.school_id = $1 and d.status <> 'deleted'
        order by d.created_at`,
      [schoolId],
    );
  }

  public async registerDevice(
    schoolId: string,
    userId: string,
    data: { serialNumber?: string; name?: string; model?: string },
  ): Promise<any> {
    const sn = (data.serialNumber || '').trim();
    if (!sn) throw new BusinessErrorResult(ErrorCode.InvalidInput, 'serialNumber is required');
    const existing = await findDeviceBySn(sn);
    if (existing && existing.schoolId !== schoolId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'This device serial is registered to another school');
    }
    if (existing) {
      const rows = await DB.query(
        singleLineString`update biometric_device
          set name = coalesce($3, name), model = coalesce($4, model), status = 'active',
              updatedby_userid = $2, updated_at = now()
          where uuid = $1 returning *`,
        [existing.uuid, userId, data.name || null, data.model || null],
      );
      return rows[0];
    }
    const rows = await DB.query(
      singleLineString`insert into biometric_device
        (uuid, school_id, serial_number, name, model, status, createdby_userid, created_at, updated_at)
        values ($1,$2,$3,$4,$5,'active',$6, now(), now()) returning *`,
      [generateShortUuid(12), schoolId, sn, data.name || null, data.model || 'ESSL K30 Pro', userId],
    );
    return rows[0];
  }

  public async getDevice(schoolId: string, sn: string): Promise<any> {
    const device = await findDeviceBySn(sn);
    if (!device || device.schoolId !== schoolId || device.status === 'deleted') {
      throw new NotFoundResult(ErrorCode.InvalidId, 'Device not found');
    }
    const commands = await DB.query(
      singleLineString`select * from biometric_command where device_sn = $1 order by created_at desc limit 25`,
      [sn],
    );
    const enrollments = await DB.query(
      singleLineString`select e.*, emp.name as employee_name, emp.status as employee_status from biometric_enrollment e
        left join employee emp on emp.uuid = e.employee_id
        where e.device_sn = $1 order by e.updated_at desc`,
      [sn],
    );
    return { device, commands, enrollments };
  }

  public async updateDevice(
    schoolId: string,
    sn: string,
    userId: string,
    data: { name?: string; status?: string },
  ): Promise<any> {
    const device = await findDeviceBySn(sn);
    if (!device || device.schoolId !== schoolId || device.status === 'deleted') {
      throw new NotFoundResult(ErrorCode.InvalidId, 'Device not found');
    }
    if (data.status && !['active', 'disabled', 'deleted'].includes(data.status)) {
      throw new BusinessErrorResult(ErrorCode.InvalidInput, 'Invalid status');
    }
    const rows = await DB.query(
      singleLineString`update biometric_device
        set name = coalesce($3, name), status = coalesce($4, status), updatedby_userid = $2, updated_at = now()
        where uuid = $1 returning *`,
      [device.uuid, userId, data.name || null, data.status || null],
    );
    return rows[0];
  }

  // ── Sync (push a staff member to device(s)) ──────────────────────────────────
  public async syncEmployee(
    schoolId: string,
    userId: string,
    employeeId: string,
    data: { deviceSn?: string; deviceNumber?: string; privilege?: number },
  ): Promise<any> {
    const employee = await findEmployee(schoolId, employeeId);
    if (!employee) throw new NotFoundResult(ErrorCode.InvalidId, 'Employee not found');

    const privilege = data.privilege == null ? PRI_USER : this.normalizePrivilege(data.privilege);
    const deviceNumber = await this.resolveDeviceNumber(schoolId, employee, data.deviceNumber, userId);
    const devices = await this.targetDevices(schoolId, data.deviceSn);

    const name = deviceName(employee.name);
    for (const d of devices) {
      // If this employee was previously synced under a DIFFERENT device_number on this
      // device (admin changed the number), remove the stale user from the device first so
      // it doesn't keep an orphan.
      const stale = await DB.query(
        singleLineString`select device_number from biometric_enrollment
          where device_sn = $1 and employee_id = $2 and device_number <> $3 and status <> 'removed'`,
        [d.serialNumber, employeeId, deviceNumber],
      );
      for (const s of stale) {
        await this.enqueue(schoolId, userId, d.serialNumber, employeeId, s.deviceNumber, 'delete_user', buildDeleteUserPayload(s.deviceNumber));
        await DB.query(
          singleLineString`update biometric_enrollment set status = 'removed', updated_at = now()
            where device_sn = $1 and device_number = $2`,
          [d.serialNumber, s.deviceNumber],
        );
      }
      // pending enrolment (so the device/portal shows "awaiting fingerprint")
      await DB.query(
        singleLineString`insert into biometric_enrollment
          (uuid, school_id, device_sn, employee_id, device_number, name, privilege, fp_count, face_count, status, synced_at, created_at, updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,0,0,'pending', now(), now(), now())
          on conflict (device_sn, device_number)
          do update set employee_id = excluded.employee_id, name = excluded.name, privilege = excluded.privilege, updated_at = now()`,
        [generateShortUuid(12), schoolId, d.serialNumber, employeeId, deviceNumber, name, privilege],
      );
      // queue the user-create command
      await this.enqueue(schoolId, userId, d.serialNumber, employeeId, deviceNumber, 'push_user', buildPushUserPayload(deviceNumber, name, privilege));
    }
    return { employeeId, deviceNumber, privilege, devices: devices.map((d) => d.serialNumber), queued: devices.length };
  }

  public async unsyncEmployee(
    schoolId: string,
    userId: string,
    employeeId: string,
    data: { deviceSn?: string },
  ): Promise<any> {
    const employee = await findEmployee(schoolId, employeeId);
    if (!employee) throw new NotFoundResult(ErrorCode.InvalidId, 'Employee not found');
    if (!employee.deviceNumber) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Employee has no device number to remove');
    const devices = await this.targetDevices(schoolId, data.deviceSn);
    for (const d of devices) {
      await this.enqueue(schoolId, userId, d.serialNumber, employeeId, employee.deviceNumber, 'delete_user', buildDeleteUserPayload(employee.deviceNumber));
      await DB.query(
        singleLineString`update biometric_enrollment set status = 'removed', updated_at = now()
          where device_sn = $1 and device_number = $2`,
        [d.serialNumber, employee.deviceNumber],
      );
    }
    return { employeeId, devices: devices.map((d) => d.serialNumber), queued: devices.length };
  }

  // Change an employee's role (privilege) on the device(s) they are already synced to:
  // 0 = normal user, 14 = super admin. Re-pushes the user record with the new Pri and
  // updates the stored enrolment. Only touches live enrolments (not removed/suspended).
  public async setPrivilege(
    schoolId: string,
    userId: string,
    employeeId: string,
    data: { deviceSn?: string; privilege?: number },
  ): Promise<any> {
    const employee = await findEmployee(schoolId, employeeId);
    if (!employee) throw new NotFoundResult(ErrorCode.InvalidId, 'Employee not found');
    const privilege = this.normalizePrivilege(data.privilege);
    const devices = await this.targetDevices(schoolId, data.deviceSn);
    let queued = 0;
    for (const d of devices) {
      const enrs = await DB.query(
        singleLineString`select device_number, name from biometric_enrollment
          where device_sn = $1 and employee_id = $2 and status in ('pending', 'synced', 'enrolled')`,
        [d.serialNumber, employeeId],
      );
      for (const e of enrs) {
        await DB.query(
          singleLineString`update biometric_enrollment set privilege = $3, updated_at = now()
            where device_sn = $1 and device_number = $2`,
          [d.serialNumber, e.deviceNumber, privilege],
        );
        const name = deviceName(e.name || employee.name);
        await this.enqueue(schoolId, userId, d.serialNumber, employeeId, e.deviceNumber, 'push_user', buildPushUserPayload(e.deviceNumber, name, privilege));
        queued++;
      }
    }
    if (!queued) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Employee is not currently synced to a device');
    return { employeeId, privilege, queued };
  }

  // Push not-yet-synced staff to a device in one go ("sync all un-synced").
  // IMPORTANT: only employees who ALREADY HAVE a numeric device_number are candidates — a
  // bulk sweep must never INVENT numbers (that once auto-assigned arbitrary 1001+ PINs to
  // management who had no number). Assigning a device_number is a deliberate per-person act;
  // syncAll just pushes the people an admin has already made device-ready.
  // Skips anyone already holding a live enrolment on that device. `dryRun` returns the
  // candidate list WITHOUT syncing, so the UI can show exactly who will be pushed first.
  public async syncAll(
    schoolId: string,
    userId: string,
    deviceSn: string,
    data: { privilege?: number; dryRun?: boolean },
  ): Promise<any> {
    const [device] = await this.targetDevices(schoolId, deviceSn);
    const privilege = data.privilege == null ? PRI_USER : this.normalizePrivilege(data.privilege);
    const rows = await DB.query(
      singleLineString`select e.uuid, e.name, e.device_number from employee e
        where e.school_id = $1 and e.status = 'active'
          and e.device_number is not null and e.device_number ~ '^[0-9]+$'
          and not exists (select 1 from biometric_enrollment b
            where b.device_sn = $2 and b.employee_id = e.uuid and b.status in ('pending', 'synced', 'enrolled'))
        order by e.name`,
      [schoolId, device.serialNumber],
    );
    const candidates = rows.map((r) => ({ uuid: r.uuid, name: r.name, deviceNumber: r.deviceNumber }));
    if (data.dryRun) return { deviceSn: device.serialNumber, count: candidates.length, candidates };
    const people: Array<{ name: string; deviceNumber: string }> = [];
    for (const c of candidates) {
      await this.syncEmployee(schoolId, userId, c.uuid, { deviceSn: device.serialNumber, deviceNumber: c.deviceNumber, privilege });
      people.push({ name: c.name, deviceNumber: c.deviceNumber });
    }
    return { deviceSn: device.serialNumber, synced: people.length, people };
  }

  // ── Reconcile (device membership follows employee active/inactive) ───────────
  // Bring an employee's device presence in line with their current status, on every
  // ACTIVE device in their school:
  //   • employee no longer active (inactive/deleted) AND a live enrolment exists
  //       → enqueue delete_user + mark the enrolment 'suspended' (retained, not removed).
  //   • employee active again AND a 'suspended' enrolment exists
  //       → enqueue push_user (with the stored privilege) + replay every stored fingerprint
  //         template (push_fp) so no re-enrolment is needed + mark the enrolment 'synced'.
  // Idempotent: it only acts on enrolments whose state disagrees with the employee.
  public async reconcileEmployee(schoolId: string, employeeId: string, userId: string = 'system'): Promise<{ changed: number; actions: ReconcileAction[] }> {
    const employee = await findEmployeeAny(schoolId, employeeId);
    if (!employee) return { changed: 0, actions: [] };
    const active = employee.status === 'active';
    const devices = await activeDevicesForSchool(schoolId);
    let changed = 0;
    const actions: ReconcileAction[] = [];
    for (const d of devices) {
      const enrs = await DB.query(
        singleLineString`select device_number, name, privilege, status from biometric_enrollment
          where device_sn = $1 and employee_id = $2`,
        [d.serialNumber, employeeId],
      );
      for (const e of enrs) {
        if (!active && ['pending', 'synced', 'enrolled'].includes(e.status)) {
          await this.enqueue(schoolId, userId, d.serialNumber, employeeId, e.deviceNumber, 'delete_user', buildDeleteUserPayload(e.deviceNumber));
          await DB.query(
            singleLineString`update biometric_enrollment set status = 'suspended', updated_at = now()
              where device_sn = $1 and device_number = $2`,
            [d.serialNumber, e.deviceNumber],
          );
          actions.push({ action: 'suspended', name: employee.name, deviceNumber: e.deviceNumber, deviceSn: d.serialNumber });
          changed++;
        } else if (active && e.status === 'suspended') {
          const pri = e.privilege == null ? PRI_USER : e.privilege;
          const name = deviceName(e.name || employee.name);
          await this.enqueue(schoolId, userId, d.serialNumber, employeeId, e.deviceNumber, 'push_user', buildPushUserPayload(e.deviceNumber, name, pri));
          const tmps = await DB.query(
            singleLineString`select fid, size, valid, template from biometric_template
              where device_sn = $1 and device_number = $2 and kind = 'fp'`,
            [d.serialNumber, e.deviceNumber],
          );
          for (const t of tmps) {
            await this.enqueue(schoolId, userId, d.serialNumber, employeeId, e.deviceNumber, 'push_fp', buildFpPayload(e.deviceNumber, t.fid, t.size, t.valid, t.template));
          }
          await DB.query(
            singleLineString`update biometric_enrollment set status = 'synced', synced_at = now(), updated_at = now()
              where device_sn = $1 and device_number = $2`,
            [d.serialNumber, e.deviceNumber],
          );
          actions.push({ action: 'restored', name: employee.name, deviceNumber: e.deviceNumber, deviceSn: d.serialNumber });
          changed++;
        }
      }
    }
    return { changed, actions };
  }

  // Reconcile every enrolled employee on one device (on-demand "Reconcile now" button).
  public async reconcileDevice(schoolId: string, userId: string, deviceSn: string): Promise<any> {
    const device = await findDeviceBySn(deviceSn);
    if (!device || device.schoolId !== schoolId || device.status === 'deleted') {
      throw new NotFoundResult(ErrorCode.InvalidId, 'Device not found');
    }
    const rows = await DB.query(
      singleLineString`select distinct employee_id from biometric_enrollment
        where device_sn = $1 and employee_id is not null and status in ('pending', 'synced', 'enrolled', 'suspended')`,
      [deviceSn],
    );
    let changed = 0;
    const actions: ReconcileAction[] = [];
    for (const r of rows) {
      const res = await this.reconcileEmployee(schoolId, r.employeeId, userId);
      changed += res.changed;
      actions.push(...res.actions);
    }
    return { deviceSn, scanned: rows.length, changed, actions };
  }

  // Cross-school sweep for the scheduled job. Finds only the enrolments whose state
  // disagrees with the employee's current status (on active devices) and reconciles each,
  // so a tick is cheap when nothing changed.
  public async reconcileAll(): Promise<{ scanned: number; changed: number }> {
    const rows = await DB.query(
      singleLineString`select distinct e.school_id, e.employee_id from biometric_enrollment e
        join biometric_device d on d.serial_number = e.device_sn and d.status = 'active'
        join employee emp on emp.uuid = e.employee_id
        where (emp.status <> 'active' and e.status in ('pending', 'synced', 'enrolled'))
           or (emp.status = 'active' and e.status = 'suspended')`,
      [],
    );
    let changed = 0;
    for (const r of rows) {
      const res = await this.reconcileEmployee(r.schoolId, r.employeeId, 'system');
      changed += res.changed;
    }
    return { scanned: rows.length, changed };
  }

  // (type below) one membership change a reconcile made, for human-readable feedback.

  // ── Reads ────────────────────────────────────────────────────────────────────
  public async listEnrollments(schoolId: string, filter: { deviceSn?: string }): Promise<any[]> {
    return DB.query(
      singleLineString`select e.*, emp.name as employee_name, emp.employee_number, emp.status as employee_status
        from biometric_enrollment e
        left join employee emp on emp.uuid = e.employee_id
        where e.school_id = $1 and ($2::text is null or e.device_sn = $2)
        order by e.updated_at desc limit 500`,
      [schoolId, filter.deviceSn || null],
    );
  }

  public async listPunches(
    schoolId: string,
    filter: { from?: string; to?: string; employeeId?: string; deviceSn?: string },
  ): Promise<any[]> {
    return DB.query(
      singleLineString`select p.*, emp.name as employee_name
        from biometric_punch p
        left join employee emp on emp.uuid = p.employee_id
        where p.school_id = $1
          and ($2::text is null or p.punched_at >= $2::timestamp)
          and ($3::text is null or p.punched_at < ($3::timestamp + interval '1 day'))
          and ($4::text is null or p.employee_id = $4)
          and ($5::text is null or p.device_sn = $5)
        order by p.punched_at desc limit 1000`,
      [schoolId, filter.from || null, filter.to || null, filter.employeeId || null, filter.deviceSn || null],
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────────
  // Coerce + validate a privilege value to the two roles the firmware uses for us:
  // 0 (normal user) or 14 (super admin). Anything else is rejected.
  private normalizePrivilege(value: number | string | undefined): number {
    const n = typeof value === 'string' ? parseInt(value, 10) : value;
    if (n !== PRI_USER && n !== PRI_SUPER_ADMIN) {
      throw new BusinessErrorResult(ErrorCode.InvalidInput, 'privilege must be 0 (user) or 14 (super admin)');
    }
    return n;
  }

  // Resolve the device PIN for an employee, in priority order:
  //   1. an explicit override passed to sync (must be numeric + unique)
  //   2. the employee's already-assigned device_number
  //   3. DEFAULT: copy employee_number, else code, if numeric — the admin-filled identity
  //   4. fallback: auto-assign the next free number (1001+)
  // The chosen value is persisted back to employee.device_number.
  private async resolveDeviceNumber(
    schoolId: string,
    employee: { uuid: string; deviceNumber: string | null; employeeNumber: string | null; code: string | null },
    requested: string | undefined,
    userId: string,
  ): Promise<string> {
    const override = (requested || '').trim();
    if (override) {
      if (!isValidDevicePin(override)) throw new BusinessErrorResult(ErrorCode.InvalidInput, 'deviceNumber must be numeric (max 9 digits)');
      await this.assertUnique(schoolId, override, employee.uuid);
      return this.persistDeviceNumber(employee.uuid, override, userId);
    }
    if (employee.deviceNumber) return employee.deviceNumber;

    // Default: copy employee_number (or code) when it's a valid numeric PIN.
    const seed = isValidDevicePin(employee.employeeNumber)
      ? employee.employeeNumber!.trim()
      : isValidDevicePin(employee.code)
        ? employee.code!.trim()
        : null;
    if (seed) {
      const clash = await DB.query(
        singleLineString`select uuid from employee where school_id = $1 and device_number = $2 and uuid <> $3 and status <> 'deleted'`,
        [schoolId, seed, employee.uuid],
      );
      if (!clash.length) return this.persistDeviceNumber(employee.uuid, seed, userId);
      // seed is taken by someone else — fall through to auto-assign rather than fail.
    }
    const next = await nextDeviceNumber(schoolId);
    return this.persistDeviceNumber(employee.uuid, next, userId);
  }

  private async assertUnique(schoolId: string, num: string, employeeId: string): Promise<void> {
    const clash = await DB.query(
      singleLineString`select uuid from employee where school_id = $1 and device_number = $2 and uuid <> $3 and status <> 'deleted'`,
      [schoolId, num, employeeId],
    );
    if (clash.length) throw new BusinessErrorResult(ErrorCode.BusinessError, `Device number ${num} is already assigned to another employee`);
  }

  private async persistDeviceNumber(employeeId: string, num: string, userId: string): Promise<string> {
    await DB.query(
      singleLineString`update employee set device_number = $2, updatedby_userid = $3, updated_at = now() where uuid = $1`,
      [employeeId, num, userId],
    );
    return num;
  }

  private async targetDevices(schoolId: string, deviceSn?: string): Promise<any[]> {
    if (deviceSn) {
      const d = await findDeviceBySn(deviceSn);
      if (!d || d.schoolId !== schoolId || d.status !== 'active') {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Target device is not an active device for this school');
      }
      return [d];
    }
    const devices = await activeDevicesForSchool(schoolId);
    if (!devices.length) throw new BusinessErrorResult(ErrorCode.BusinessError, 'No active biometric devices registered for this school');
    return devices;
  }

  private async enqueue(
    schoolId: string,
    userId: string,
    deviceSn: string,
    employeeId: string | null,
    deviceNumber: string,
    kind: string,
    payload: string,
  ): Promise<void> {
    await DB.query(
      singleLineString`insert into biometric_command
        (uuid, school_id, device_sn, employee_id, device_number, kind, payload, status, attempts, createdby_userid, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,'queued',0,$8, now(), now())`,
      [generateShortUuid(12), schoolId, deviceSn, employeeId, deviceNumber, kind, payload, userId],
    );
  }
}

export const biometricService = new BiometricService();
