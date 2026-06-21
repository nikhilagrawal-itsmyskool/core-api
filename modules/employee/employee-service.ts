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

class EmployeeService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async search(schoolId: string, name?: string, includeDeleted?: boolean): Promise<Employee[]> {
    const searchPattern = name && name.trim() ? `%${name.trim()}%` : '%';
    const statusFilter = includeDeleted ? ACTIVE_AND_DELETED_STATUS : ACTIVE_STATUS;

    const query = singleLineString`
      select * from employee
      where school_id = $1
        and status in ${statusFilter}
        and lower(name) like lower($2)
      order by name
    `;

    return DB.query(query, [schoolId, searchPattern]);
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

    const employeeUuid = generateShortUuid(12);
    const loginUuid = generateShortUuid(12);
    const now = new Date();

    const queries: string[] = [];
    const params: any[][] = [];

    queries.push(singleLineString`
      insert into employee
      (uuid, employee_number, name, gender, dob, family_unique_number, mobile, whatsapp, email, status, school_id, createdby_userid, created_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `);
    params.push([
      employeeUuid,
      data.employeeNumber || null,
      data.name,
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
}

export const employeeService = new EmployeeService();
