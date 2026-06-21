const jwt = require('jsonwebtoken');
import { DB, singleLineString } from '../../shared/lib/db';

export interface StudentLogin {
  uuid: string;
  displayName: string;
}

export class StudentAuthService {
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

  public async validateUsernameAndPassword(username: string, password: string, schoolId: string): Promise<StudentLogin | null> {
    const loginQuery = singleLineString`select uuid, password, display_name from student_login where username = $1 and school_id = $2`;
    const loginResults = await DB.query(loginQuery, [username, schoolId]);

    if (loginResults.length === 0) {
      return null;
    }

    const storedPassword = loginResults[0].password;
    if (password !== storedPassword) {
      return null;
    }

    return {
      uuid: loginResults[0].uuid,
      displayName: loginResults[0].displayName
    };
  }

  public async changePassword(loginId: string, currentPassword: string, newPassword: string, schoolId: string): Promise<{ success: boolean; message: string }> {
    const query = singleLineString`select uuid, password from student_login where uuid = $1 and school_id = $2`;
    const results = await DB.query(query, [loginId, schoolId]);

    if (results.length === 0) {
      return { success: false, message: 'Student login not found' };
    }

    if (results[0].password !== currentPassword) {
      return { success: false, message: 'Current password is incorrect' };
    }

    const updateQuery = singleLineString`update student_login set password = $1, updated_at = now() where uuid = $2 and school_id = $3`;
    await DB.query(updateQuery, [newPassword, loginId, schoolId]);

    return { success: true, message: 'Password changed successfully' };
  }
}

export const studentAuthService = new StudentAuthService();
