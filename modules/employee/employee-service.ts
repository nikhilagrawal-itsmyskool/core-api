import { DB, singleLineString } from '../../shared/lib/db';
import {
  CreateEmployeeRequest,
  Employee,
  EmployeeCredentials,
  EmployeeRole,
  EmployeeWithRoles,
  UpdateEmployeeRequest,
} from './employee-interfaces';
import { ACTIVE_AND_DELETED_STATUS, ACTIVE_STATUS, DEFAULT_PASSWORD, DEFAULT_STATUS } from './employee-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Parse a CSV string (role codes / ids stored in a single column) into a trimmed, de-duped list.
function csvToList(raw: any): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      String(raw)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    )
  );
}

class EmployeeService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async search(
    schoolId: string,
    name?: string,
    includeDeleted?: boolean,
    roleCodes?: string[]
  ): Promise<EmployeeWithRoles[]> {
    const searchPattern = name && name.trim() ? `%${name.trim()}%` : '%';
    const statusFilter = includeDeleted ? ACTIVE_AND_DELETED_STATUS : ACTIVE_STATUS;
    const filterRoles = (roleCodes || []).map((c) => c.trim()).filter(Boolean);

    let query: string;
    let params: any[];
    if (filterRoles.length > 0) {
      // AND semantics: keep only employees that hold every selected role code.
      const placeholders = filterRoles.map((_, i) => `$${i + 3}`).join(', ');
      query = singleLineString`
        select e.* from employee e
        where e.school_id = $1
          and e.status in ${statusFilter}
          and lower(e.name) like lower($2)
          and (
            select count(distinct r.code)
            from employee_role er
            join role r on r.uuid = er.role_id
            where er.employee_id = e.uuid and er.school_id = e.school_id
              and r.code in (${placeholders})
          ) = ${filterRoles.length}
        order by e.name
      `;
      params = [schoolId, searchPattern, ...filterRoles];
    } else {
      query = singleLineString`
        select * from employee
        where school_id = $1
          and status in ${statusFilter}
          and lower(name) like lower($2)
        order by name
      `;
      params = [schoolId, searchPattern];
    }

    const employees = await DB.query(query, params);
    if (employees.length === 0) {
      return [];
    }

    // Attach each employee's full role list in one round-trip.
    const ids = employees.map((e: Employee) => e.uuid);
    const idPlaceholders = ids.map((_: string, i: number) => `$${i + 2}`).join(', ');
    const roleRows = await DB.query(
      singleLineString`
        select er.employee_id, r.uuid, r.code, r.name
        from employee_role er
        join role r on r.uuid = er.role_id
        where er.school_id = $1 and er.employee_id in (${idPlaceholders})
        order by r.name
      `,
      [schoolId, ...ids]
    );

    const rolesByEmployee = new Map<string, EmployeeRole[]>();
    for (const row of roleRows) {
      const list = rolesByEmployee.get(row.employeeId) || [];
      list.push({ uuid: row.uuid, code: row.code, name: row.name });
      rolesByEmployee.set(row.employeeId, list);
    }

    // One photo per employee for the grid avatar (prefer the thumb). The handler presigns a URL
    // from photoStorageKey when the caller asks (?withPhotos=true), then drops the raw key.
    const photoRows = await DB.query(
      singleLineString`
        select distinct on (entity_id) entity_id, storage_key, storage_provider
        from file_storage
        where entity_type = 'employee' and school_id = $1 and entity_id in (${idPlaceholders})
          and storage_key is not null
        order by entity_id, (variant = 'thumb') desc, created_at desc
      `,
      [schoolId, ...ids]
    );
    const photoByEmployee = new Map<string, { key: string; provider: string | null }>();
    for (const row of photoRows) {
      photoByEmployee.set(row.entityId, { key: row.storageKey, provider: row.storageProvider ?? null });
    }

    return employees.map((e: Employee) => {
      const photo = photoByEmployee.get(e.uuid);
      return {
        ...e,
        roles: rolesByEmployee.get(e.uuid) || [],
        photoStorageKey: photo?.key,
        photoProvider: photo?.provider,
      };
    });
  }

  public async getById(id: string, schoolId: string): Promise<EmployeeWithRoles | null> {
    const employeeQuery = singleLineString`
      select * from employee
      where uuid = $1 and school_id = $2 and status = 'active'
    `;
    const employees = await DB.query(employeeQuery, [id, schoolId]);
    if (employees.length === 0) {
      return null;
    }

    const roles = await this.getRolesForEmployee(id, schoolId);
    return { ...employees[0], roles };
  }

  public async create(data: CreateEmployeeRequest, schoolId: string, userId: string): Promise<EmployeeWithRoles> {
    const roleIds = data.roleIds || [];
    await this.assertFamilyNumberAvailable(data.familyUniqueNumber, schoolId);
    await this.assertRolesExist(roleIds, schoolId);
    await this.assertDeviceNumberValid(data.deviceNumber, schoolId, null);

    const employeeUuid = generateShortUuid(12);
    const loginUuid = generateShortUuid(12);
    const now = new Date();

    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into employee
      (uuid, employee_number, name, code, gender, dob, family_unique_number, mobile, whatsapp, email, status, school_id, createdby_userid, created_at, device_number)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `);
    params.push([
      employeeUuid,
      data.employeeNumber || null,
      data.name,
      data.code || null,
      data.gender || null,
      data.dob || null,
      data.familyUniqueNumber,
      data.mobile || null,
      data.whatsapp || null,
      data.email || null,
      DEFAULT_STATUS,
      schoolId,
      userId,
      now,
      data.deviceNumber ? String(data.deviceNumber).trim() : null,
    ]);

    queries.push(singleLineString`
      insert into employee_login
      (uuid, username, password, display_name, must_change_password, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
    `);
    params.push([loginUuid, data.familyUniqueNumber, DEFAULT_PASSWORD, data.name, true, schoolId, userId, now]);

    for (const roleId of roleIds) {
      queries.push(singleLineString`
        insert into employee_role
        (uuid, employee_id, role_id, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6)
      `);
      params.push([generateShortUuid(12), employeeUuid, roleId, schoolId, userId, now]);
    }

    await DB.queriesInTransaction(queries, params);

    const created = await this.getById(employeeUuid, schoolId);
    return created as EmployeeWithRoles;
  }

  public async update(
    id: string,
    data: UpdateEmployeeRequest,
    schoolId: string,
    userId: string
  ): Promise<EmployeeWithRoles | null> {
    const existingQuery = singleLineString`
      select family_unique_number from employee
      where uuid = $1 and school_id = $2 and status = 'active'
    `;
    const existing = await DB.query(existingQuery, [id, schoolId]);
    if (existing.length === 0) {
      return null;
    }
    const oldFamilyNumber = existing[0].familyUniqueNumber;

    const familyChanged = data.familyUniqueNumber !== undefined && data.familyUniqueNumber !== oldFamilyNumber;
    if (familyChanged) {
      await this.assertFamilyNumberAvailable(data.familyUniqueNumber as string, schoolId);
    }
    if (data.roleIds !== undefined) {
      await this.assertRolesExist(data.roleIds, schoolId);
    }
    if (data.deviceNumber !== undefined) {
      await this.assertDeviceNumberValid(data.deviceNumber, schoolId, id);
    }

    const now = new Date();
    const queries: string[] = [];
    const params: any[][] = [];

    // 1. Employee row update (dynamic set on provided fields)
    const updates: string[] = [];
    const employeeParams: any[] = [];
    let idx = 1;
    const setField = (column: string, value: any) => {
      updates.push(`${column} = $${idx++}`);
      employeeParams.push(value);
    };
    if (data.name !== undefined) setField('name', data.name);
    if (data.familyUniqueNumber !== undefined) setField('family_unique_number', data.familyUniqueNumber);
    if (data.employeeNumber !== undefined) setField('employee_number', data.employeeNumber);
    if (data.code !== undefined) setField('code', data.code);
    if (data.deviceNumber !== undefined) setField('device_number', data.deviceNumber ? String(data.deviceNumber).trim() : null);
    if (data.loginDisabled !== undefined) setField('login_disabled', data.loginDisabled === true);
    if (data.gender !== undefined) setField('gender', data.gender);
    if (data.dob !== undefined) setField('dob', data.dob);
    if (data.mobile !== undefined) setField('mobile', data.mobile);
    if (data.whatsapp !== undefined) setField('whatsapp', data.whatsapp);
    if (data.email !== undefined) setField('email', data.email);
    updates.push(`updatedby_userid = $${idx++}`);
    employeeParams.push(userId);
    updates.push(`updated_at = $${idx++}`);
    employeeParams.push(now);
    employeeParams.push(id);
    employeeParams.push(schoolId);
    queries.push(singleLineString`
      update employee set ${updates.join(', ')}
      where uuid = $${idx++} and school_id = $${idx++} and status = 'active'
    `);
    params.push(employeeParams);

    // 2. Keep the linked login in sync (username + display name), keyed by the OLD username.
    if (familyChanged || data.name !== undefined) {
      const loginUpdates: string[] = [];
      const loginParams: any[] = [];
      let lidx = 1;
      if (familyChanged) {
        loginUpdates.push(`username = $${lidx++}`);
        loginParams.push(data.familyUniqueNumber);
      }
      if (data.name !== undefined) {
        loginUpdates.push(`display_name = $${lidx++}`);
        loginParams.push(data.name);
      }
      loginUpdates.push(`updatedby_userid = $${lidx++}`);
      loginParams.push(userId);
      loginUpdates.push(`updated_at = $${lidx++}`);
      loginParams.push(now);
      loginParams.push(oldFamilyNumber);
      loginParams.push(schoolId);
      queries.push(singleLineString`
        update employee_login set ${loginUpdates.join(', ')}
        where username = $${lidx++} and school_id = $${lidx++}
      `);
      params.push(loginParams);
    }

    // 3. Reconcile roles (replace the full set) when roleIds is provided.
    if (data.roleIds !== undefined) {
      queries.push(singleLineString`
        delete from employee_role where employee_id = $1 and school_id = $2
      `);
      params.push([id, schoolId]);
      for (const roleId of data.roleIds) {
        queries.push(singleLineString`
          insert into employee_role
          (uuid, employee_id, role_id, school_id, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6)
        `);
        params.push([generateShortUuid(12), id, roleId, schoolId, userId, now]);
      }
    }

    await DB.queriesInTransaction(queries, params);

    return this.getById(id, schoolId);
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existingQuery = singleLineString`
      select family_unique_number from employee
      where uuid = $1 and school_id = $2 and status = 'active'
    `;
    const existing = await DB.query(existingQuery, [id, schoolId]);
    if (existing.length === 0) {
      return false;
    }
    const familyNumber = existing[0].familyUniqueNumber;
    const now = new Date();

    const queries = [
      singleLineString`
        update employee set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      singleLineString`
        delete from employee_login where username = $1 and school_id = $2
      `,
    ];
    const params = [
      [userId, now, id, schoolId],
      [familyNumber, schoolId],
    ];

    await DB.queriesInTransaction(queries, params);
    return true;
  }

  public async restore(id: string, schoolId: string, userId: string): Promise<EmployeeWithRoles | null> {
    const existingQuery = singleLineString`
      select family_unique_number, name from employee
      where uuid = $1 and school_id = $2 and status = 'deleted'
    `;
    const existing = await DB.query(existingQuery, [id, schoolId]);
    if (existing.length === 0) {
      return null;
    }
    const familyNumber = existing[0].familyUniqueNumber;
    const name = existing[0].name;
    const now = new Date();

    // The login row was hard-deleted on soft-delete, so re-create it (unless one
    // already exists for this username, e.g. created out-of-band).
    const loginExists = await DB.query(
      singleLineString`select uuid from employee_login where username = $1 and school_id = $2`,
      [familyNumber, schoolId]
    );

    const queries: string[] = [
      singleLineString`
        update employee set status = 'active', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'deleted'
      `,
    ];
    const params: any[][] = [[userId, now, id, schoolId]];

    if (loginExists.length === 0) {
      queries.push(singleLineString`
        insert into employee_login
        (uuid, username, password, display_name, must_change_password, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
      `);
      params.push([generateShortUuid(12), familyNumber, DEFAULT_PASSWORD, name, true, schoolId, userId, now]);
    }

    await DB.queriesInTransaction(queries, params);
    return this.getById(id, schoolId);
  }

  public async getCredentials(id: string, schoolId: string): Promise<EmployeeCredentials | null> {
    const employeeQuery = singleLineString`
      select family_unique_number from employee
      where uuid = $1 and school_id = $2 and status = 'active'
    `;
    const employees = await DB.query(employeeQuery, [id, schoolId]);
    if (employees.length === 0) {
      return null;
    }

    const loginQuery = singleLineString`
      select username, password, must_change_password, display_name
      from employee_login where username = $1 and school_id = $2
    `;
    const logins = await DB.query(loginQuery, [employees[0].familyUniqueNumber, schoolId]);
    if (logins.length === 0) {
      return null;
    }

    return {
      username: logins[0].username,
      password: logins[0].password,
      mustChangePassword: logins[0].mustChangePassword === true,
      displayName: logins[0].displayName,
    };
  }

  public async resetPassword(id: string, schoolId: string, userId: string): Promise<boolean> {
    const employeeQuery = singleLineString`
      select family_unique_number from employee
      where uuid = $1 and school_id = $2 and status = 'active'
    `;
    const employees = await DB.query(employeeQuery, [id, schoolId]);
    if (employees.length === 0) {
      return false;
    }
    const familyNumber = employees[0].familyUniqueNumber;

    const login = await DB.query(
      singleLineString`select uuid from employee_login where username = $1 and school_id = $2`,
      [familyNumber, schoolId]
    );
    if (login.length === 0) {
      return false;
    }

    const updateQuery = singleLineString`
      update employee_login
      set password = $1, must_change_password = true, updatedby_userid = $2, updated_at = $3
      where username = $4 and school_id = $5
    `;
    await DB.query(updateQuery, [DEFAULT_PASSWORD, userId, new Date(), familyNumber, schoolId]);
    return true;
  }

  // Force this employee to sign out and back in: bump the login's session_version so every live
  // token they hold (which carries the old version) is rejected by the authz layer within ~60s.
  // Used after a role change so the new roles take effect on the next login. Resolves the login the
  // same way resetPassword does (employee.family_unique_number = employee_login.username).
  public async forceReLogin(id: string, schoolId: string, userId: string): Promise<boolean> {
    const employees = await DB.query(
      singleLineString`select family_unique_number from employee where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    if (employees.length === 0) {
      return false;
    }
    const familyNumber = employees[0].familyUniqueNumber;

    const updated = await DB.query(
      singleLineString`
        update employee_login
        set session_version = coalesce(session_version, 1) + 1, updatedby_userid = $1, updated_at = $2
        where username = $3 and school_id = $4
        returning uuid
      `,
      [userId, new Date(), familyNumber, schoolId]
    );
    return updated.length > 0;
  }

  // ── Per-school employee config ──────────────────────────────────────────────────────
  // restrictRoledEdit: when true (the default when no row exists), admins can't edit/delete a
  // roled employee. Enforced in the handlers; the screen is god-only (employee.config.manage).
  public async getConfig(schoolId: string): Promise<{ editProtectedRoles: string[] }> {
    const rows = await DB.query(
      singleLineString`select edit_protected_roles from employee_config where school_id = $1`,
      [schoolId]
    );
    return { editProtectedRoles: csvToList(rows.length ? rows[0].editProtectedRoles : null) };
  }

  public async updateConfig(
    schoolId: string,
    data: { editProtectedRoles?: string[] },
    userId: string
  ): Promise<{ editProtectedRoles: string[] }> {
    const current = await this.getConfig(schoolId);
    const editProtectedRoles = Array.isArray(data.editProtectedRoles)
      ? data.editProtectedRoles.map((r) => String(r).trim()).filter(Boolean)
      : current.editProtectedRoles;
    const csv = editProtectedRoles.join(',');
    const now = new Date();
    const existing = await DB.query(
      singleLineString`select school_id from employee_config where school_id = $1`,
      [schoolId]
    );
    if (existing.length) {
      await DB.query(
        singleLineString`update employee_config set edit_protected_roles = $1, updatedby_userid = $2, updated_at = $3 where school_id = $4`,
        [csv, userId, now, schoolId]
      );
    } else {
      await DB.query(
        singleLineString`insert into employee_config (school_id, edit_protected_roles, updatedby_userid, updated_at) values ($1, $2, $3, $4)`,
        [schoolId, csv, userId, now]
      );
    }
    return { editProtectedRoles };
  }

  // True when this employee may NOT be edited/deleted by a non-god admin: the school configured a
  // set of edit-protected role codes AND this employee holds at least one of them. Empty config =
  // never restricted. Used to gate update/delete (god bypasses in the handler).
  public async isEditRestricted(id: string, schoolId: string): Promise<boolean> {
    const { editProtectedRoles } = await this.getConfig(schoolId);
    if (!editProtectedRoles.length) return false;
    const rows = await DB.query(
      singleLineString`select 1 from employee_role er join role r on r.uuid = er.role_id
        where er.employee_id = $1 and er.school_id = $2 and r.code = any($3::text[]) limit 1`,
      [id, schoolId, editProtectedRoles]
    );
    return rows.length > 0;
  }

  public async listRoles(schoolId: string): Promise<EmployeeRole[]> {
    const query = singleLineString`
      select uuid, code, name from role where school_id = $1 order by name
    `;
    return DB.query(query, [schoolId]);
  }

  private async getRolesForEmployee(employeeId: string, schoolId: string): Promise<EmployeeRole[]> {
    const query = singleLineString`
      select r.uuid, r.code, r.name
      from employee_role er
      join role r on r.uuid = er.role_id
      where er.employee_id = $1 and er.school_id = $2
      order by r.name
    `;
    return DB.query(query, [employeeId, schoolId]);
  }

  private async assertFamilyNumberAvailable(familyNumber: string, schoolId: string): Promise<void> {
    const employeeMatch = await DB.query(
      singleLineString`
        select uuid from employee
        where family_unique_number = $1 and school_id = $2 and status = 'active'
      `,
      [familyNumber, schoolId]
    );
    if (employeeMatch.length > 0) {
      throw new Error(`An employee with family unique number '${familyNumber}' already exists`);
    }

    const loginMatch = await DB.query(
      singleLineString`select uuid from employee_login where username = $1 and school_id = $2`,
      [familyNumber, schoolId]
    );
    if (loginMatch.length > 0) {
      throw new Error(`A login with username '${familyNumber}' already exists`);
    }
  }

  private async assertRolesExist(roleIds: string[], schoolId: string): Promise<void> {
    if (!roleIds || roleIds.length === 0) {
      return;
    }
    const placeholders = roleIds.map((_, i) => `$${i + 2}`).join(', ');
    const found = await DB.query(
      `select uuid from role where school_id = $1 and uuid in (${placeholders})`,
      [schoolId, ...roleIds]
    );
    if (found.length !== roleIds.length) {
      throw new Error('One or more role IDs are invalid for this school');
    }
  }

  // The biometric/attendance-device PIN must be numeric (<= 9 digits) and unique per
  // school. Only validated when a non-empty value is provided; '' / null clears it.
  private async assertDeviceNumberValid(deviceNumber: string | undefined, schoolId: string, excludeId: string | null): Promise<void> {
    if (deviceNumber === undefined || deviceNumber === null || deviceNumber === '') return;
    const value = String(deviceNumber).trim();
    if (!/^[0-9]{1,9}$/.test(value)) {
      throw new Error('Device number must be numeric (max 9 digits)');
    }
    const match = await DB.query(
      singleLineString`
        select uuid from employee
        where device_number = $1 and school_id = $2 and status <> 'deleted'
          and ($3::text is null or uuid <> $3)
      `,
      [value, schoolId, excludeId]
    );
    if (match.length > 0) {
      throw new Error(`Device number '${value}' is already assigned to another employee`);
    }
  }
}

export const employeeService = new EmployeeService();
