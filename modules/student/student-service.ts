import { DB, singleLineString } from '../../shared/lib/db';
import { Student, StudentWithClass } from './student-interfaces';

export interface StudentSearchFilters {
  name?: string;
  classId?: string;
  academicYearId?: string;
  admissionNumber?: string;
  phone?: string;
}

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
    filters: StudentSearchFilters = {}
  ): Promise<Student[] | StudentWithClass[]> {
    const { name, classId, academicYearId, admissionNumber, phone } = filters;
    const namePattern = name && name.trim() ? `%${name.trim()}%` : '%';

    // Extra predicates shared by both query shapes. Built against the `student`
    // alias `s` (class shape) or bare `student` (simple shape).
    const buildExtras = (alias: string, params: any[]): string => {
      const parts: string[] = [];
      if (admissionNumber && admissionNumber.trim()) {
        params.push(`%${admissionNumber.trim()}%`);
        parts.push(`and ${alias}admission_number ilike $${params.length}`);
      }
      if (phone && phone.trim()) {
        params.push(`%${phone.trim()}%`);
        const p = `$${params.length}`;
        parts.push(
          `and (${alias}father_mobile ilike ${p} or ${alias}father_whatsapp ilike ${p} ` +
            `or ${alias}mother_mobile ilike ${p} or ${alias}mother_whatsapp ilike ${p} ` +
            `or ${alias}guardian_mobile ilike ${p} or ${alias}guardian_whatsapp ilike ${p})`
        );
      }
      return parts.join(' ');
    };

    if (classId) {
      const params: any[] = [schoolId, classId, namePattern];
      let academicYearCondition = '';

      if (academicYearId) {
        params.push(academicYearId);
        academicYearCondition = `and sc.academic_year_id = $${params.length}`;
      }

      const extras = buildExtras('s.', params);

      const query = singleLineString`
        select s.*, sc.class_id, c.name as class_name, sc.academic_year_id, ay.name as academic_year_name, sc.roll_number
        from student s
        inner join student_class sc on s.uuid = sc.student_id and s.school_id = sc.school_id
        left join class c on sc.class_id = c.uuid
        left join academic_year ay on sc.academic_year_id = ay.uuid
        where s.school_id = $1
          and sc.class_id = $2
          and (sc.status is null or sc.status <> 'deleted')
          and lower(s.name) like lower($3)
          ${academicYearCondition}
          ${extras}
        order by sc.roll_number nulls last, s.name
      `;

      return DB.query(query, params);
    }

    const params: any[] = [schoolId, namePattern];
    const extras = buildExtras('', params);

    const query = singleLineString`
      select * from student
      where school_id = $1
        and lower(name) like lower($2)
        ${extras}
      order by name
    `;

    return DB.query(query, params);
  }
}

export const studentService = new StudentService();
