const jwt = require('jsonwebtoken');
import { DB, singleLineString } from '../../shared/lib/db';

export interface EmployeeLogin {
  uuid: string;
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
    const rolesQuery = singleLineString`select r.code from employee_role er join role r on er.role_id = r.uuid where er.employee_id = $1 and er.school_id = $2`;
    const rolesResults = await DB.query(rolesQuery, [employeeUuid, schoolId]);

    const roles = rolesResults.map((row: any) => row.code);

    return {
      uuid: employeeUuid,
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

