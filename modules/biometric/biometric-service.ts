import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult, NotFoundResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { findEmployee, findDeviceBySn, activeDevicesForSchool, nextDeviceNumber, isValidDevicePin } from './biometric-common';
import { deviceName, buildPushUserPayload, buildDeleteUserPayload } from './biometric-parse';

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
      singleLineString`select e.*, emp.name as employee_name from biometric_enrollment e
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
    data: { deviceSn?: string; deviceNumber?: string },
  ): Promise<any> {
    const employee = await findEmployee(schoolId, employeeId);
    if (!employee) throw new NotFoundResult(ErrorCode.InvalidId, 'Employee not found');

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
          values ($1,$2,$3,$4,$5,$6,0,0,0,'pending', now(), now(), now())
          on conflict (device_sn, device_number)
          do update set employee_id = excluded.employee_id, name = excluded.name, updated_at = now()`,
        [generateShortUuid(12), schoolId, d.serialNumber, employeeId, deviceNumber, name],
      );
      // queue the user-create command
      await this.enqueue(schoolId, userId, d.serialNumber, employeeId, deviceNumber, 'push_user', buildPushUserPayload(deviceNumber, name));
    }
    return { employeeId, deviceNumber, devices: devices.map((d) => d.serialNumber), queued: devices.length };
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

  // ── Reads ────────────────────────────────────────────────────────────────────
  public async listEnrollments(schoolId: string, filter: { deviceSn?: string }): Promise<any[]> {
    return DB.query(
      singleLineString`select e.*, emp.name as employee_name, emp.employee_number
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
