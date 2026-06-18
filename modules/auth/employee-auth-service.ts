const jwt = require('jsonwebtoken');
import { DB, singleLineString } from '../../shared/lib/db';

export interface EmployeeLogin {
  uuid: string;
  employeeId: string | null;
  displayName: string;
  roles: string[];
  mustChangePassword: boolean;
}

export class EmployeeAuthService {
  public signToken(data: any): string {
    let token = undefined;
    try {
      token = jwt.sign(data, process.env.JWT_SECRET, { expiresIn: process.env.JWT_ADMIN_EXPIRY_TIME });
    } catch (e) {
      console.log(e, 'Error');
      console.log('Error signing token: ', JSON.stringify(e));
    }
    return token;
  }

  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`select uuid from school where lower(code) = lower($1)`;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async validateUsernameAndPassword(username: string, password: string, schoolId: string): Promise<EmployeeLogin | null> {
    const loginQuery = singleLineString`select uuid, password, display_name, must_change_password from employee_login where username = $1 and school_id = $2`;
    const loginResults = await DB.query(loginQuery, [username, schoolId]);

    if (loginResults.length === 0) {
      return null;
    }

    const storedPassword = loginResults[0].password;
    if (password !== storedPassword) {
      return null;
    }

    const employeeUuid = loginResults[0].uuid;
    const displayName = loginResults[0].displayName;
    const mustChangePassword = loginResults[0].mustChangePassword === true;

    // The login links to the employee via username = family_unique_number.
    // Resolve the employee uuid (used as the actor id for audit columns) and
    // read that employee's roles.
    const employeeQuery = singleLineString`
      select uuid from employee
      where family_unique_number = $1 and school_id = $2 and status = 'active'
      order by created_at asc limit 1`;
    const employeeResults = await DB.query(employeeQuery, [username, schoolId]);
    const employeeId = employeeResults.length > 0 ? employeeResults[0].uuid : null;

    const rolesQuery = singleLineString`
      select distinct r.code
      from employee e
      join employee_role er on er.employee_id = e.uuid and er.school_id = e.school_id
      join role r on r.uuid = er.role_id
      where e.family_unique_number = $1 and e.school_id = $2`;
    const rolesResults = await DB.query(rolesQuery, [username, schoolId]);

    const roles = rolesResults.map((row: any) => row.code);

    return {
      uuid: employeeUuid,
      employeeId: employeeId,
      displayName: displayName,
      roles: roles,
      mustChangePassword: mustChangePassword
    };
  }
  public async changePassword(loginId: string, currentPassword: string, newPassword: string, schoolId: string): Promise<{ success: boolean; message: string }> {
    const query = singleLineString`select uuid, password from employee_login where uuid = $1 and school_id = $2`;
    const results = await DB.query(query, [loginId, schoolId]);

    if (results.length === 0) {
      return { success: false, message: 'Employee login not found' };
    }

    if (results[0].password !== currentPassword) {
      return { success: false, message: 'Current password is incorrect' };
    }

    const updateQuery = singleLineString`update employee_login set password = $1, must_change_password = false, updated_at = now() where uuid = $2 and school_id = $3`;
    await DB.query(updateQuery, [newPassword, loginId, schoolId]);

    return { success: true, message: 'Password changed successfully' };
  }

  public async resetPassword(employeeLoginId: string, schoolId: string): Promise<{ success: boolean; message: string }> {
    const checkQuery = singleLineString`select uuid from employee_login where uuid = $1 and school_id = $2`;
    const results = await DB.query(checkQuery, [employeeLoginId, schoolId]);

    if (results.length === 0) {
      return { success: false, message: 'Employee login not found' };
    }

    const updateQuery = singleLineString`update employee_login set password = 'Itsmyskool@123', must_change_password = true, updated_at = now() where uuid = $1 and school_id = $2`;
    await DB.query(updateQuery, [employeeLoginId, schoolId]);

    return { success: true, message: 'Password has been reset. User must change password on next login.' };
  }
}

export const employeeAuthService = new EmployeeAuthService();

