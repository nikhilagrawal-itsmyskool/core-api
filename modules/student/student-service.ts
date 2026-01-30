import { DB, singleLineString } from '../../shared/lib/db';
import { Student, StudentWithClass } from './student-interfaces';

class StudentService {
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
    classId?: string,
    academicYearId?: string
  ): Promise<Student[] | StudentWithClass[]> {
    const searchPattern = name && name.trim() ? `%${name.trim()}%` : '%';

    if (classId) {
      // Query with class join
      const params: any[] = [schoolId, classId, searchPattern];
      let academicYearCondition = '';

      if (academicYearId) {
        academicYearCondition = 'and sc.academic_year_id = $4';
        params.push(academicYearId);
      }

      const query = singleLineString`
        select s.*, sc.class_id, c.name as class_name, sc.academic_year_id, ay.name as academic_year_name
        from student s
        inner join student_class sc on s.uuid = sc.student_id and s.school_id = sc.school_id
        left join class c on sc.class_id = c.uuid
        left join academic_year ay on sc.academic_year_id = ay.uuid
        where s.school_id = $1
          and sc.class_id = $2
          and lower(s.name) like lower($3)
          ${academicYearCondition}
        order by s.name
      `;

      return DB.query(query, params);
    }

    // Simple query without class join
    const query = singleLineString`
      select * from student
      where school_id = $1
        and lower(name) like lower($2)
      order by name
    `;

    return DB.query(query, [schoolId, searchPattern]);
  }
}

export const studentService = new StudentService();
