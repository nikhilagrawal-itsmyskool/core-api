const jwt = require('jsonwebtoken');
import { DB, singleLineString } from '../../shared/lib/db';

export interface FamilyStudent {
  id: string;
  name: string;
  className: string | null;
  rollNumber: number | null;
}

export interface FamilyLogin {
  loginId: string;
  students: FamilyStudent[];
}

export class StudentAuthService {
  public signToken(data: any): string {
    let token = undefined;
    try {
      token = jwt.sign(data, process.env.JWT_SECRET, { expiresIn: process.env.JWT_STUDENT_EXPIRY_TIME || process.env.JWT_ADMIN_EXPIRY_TIME });
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

  // Family login: the username is a family_unique_number shared by all siblings.
  // Validate the single login row, then fan out to every active student in that
  // family so the app can render a child switcher.
  public async validateFamilyLogin(username: string, password: string, schoolId: string): Promise<FamilyLogin | null> {
    const loginQuery = singleLineString`select uuid, password from student_login where username = $1 and school_id = $2`;
    const loginResults = await DB.query(loginQuery, [username, schoolId]);

    if (loginResults.length === 0) {
      return null;
    }

    const storedPassword = loginResults[0].password;
    if (password !== storedPassword) {
      return null;
    }

    // Current class/roll via the same latest-enrollment lateral join used by
    // student-admin-service.getDetail.
    const studentsQuery = singleLineString`
      select s.uuid as id, s.name, cur.class_name, cur.roll_number
      from student s
      left join lateral (
        select c.name as class_name, sc.roll_number
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        left join class c on sc.class_id = c.uuid
        where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
        order by ay.start_date desc nulls last limit 1
      ) cur on true
      where s.family_unique_number = $1 and s.school_id = $2 and (s.status is null or s.status <> 'deleted')
      order by s.name
    `;
    const studentRows = await DB.query(studentsQuery, [username, schoolId]);

    return {
      loginId: loginResults[0].uuid,
      students: studentRows.map((r: any) => ({
        id: r.id,
        name: r.name,
        className: r.className ?? null,
        rollNumber: r.rollNumber ?? null,
      })),
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
