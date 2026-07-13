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
        select s.*, sc.class_id, c.name as class_name, sc.academic_year_id, ay.name as academic_year_name, sc.roll_number,
               ph.uuid as photo_id, ph.storage_key as photo_storage_key
        from student s
        inner join student_class sc on s.uuid = sc.student_id and s.school_id = sc.school_id
        left join class c on sc.class_id = c.uuid
        left join academic_year ay on sc.academic_year_id = ay.uuid
        left join lateral (
          select fs.uuid, fs.storage_key from file_storage fs
          where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id
            and (fs.variant = 'original' or fs.variant is null)
          order by fs.created_at desc limit 1
        ) ph on true
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
    const extras = buildExtras('s.', params);

    // Unfiltered list: join the latest enrollment so the grid shows the current
    // class/year/roll (same lateral pattern as student-admin-service.getDetail).
    const query = singleLineString`
      select s.*, cur.class_name, cur.academic_year_name, cur.roll_number,
             ph.uuid as photo_id, ph.storage_key as photo_storage_key
      from student s
      left join lateral (
        select ay.name as academic_year_name, c.name as class_name, sc.roll_number
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        left join class c on sc.class_id = c.uuid
        where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
        order by ay.start_date desc nulls last limit 1
      ) cur on true
      left join lateral (
        select fs.uuid, fs.storage_key from file_storage fs
        where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id
          and (fs.variant = 'original' or fs.variant is null)
        order by fs.created_at desc limit 1
      ) ph on true
      where s.school_id = $1
        and lower(s.name) like lower($2)
        ${extras}
      order by s.name
    `;

    return DB.query(query, params);
  }

  // Unified "type anything" search for the command palette: matches across student
  // name, admission number, father/mother/guardian names, and any phone. Returns
  // enough to render a rich row (class, parents, photo) and ranks exact-admission /
  // name-prefix matches first.
  public async omniSearch(schoolId: string, q: string, limit = 15): Promise<any[]> {
    const term = (q || '').trim();
    if (!term) return [];
    const like = `%${term}%`;
    const prefix = `${term}%`;
    const params: any[] = [schoolId, like, term, prefix, Math.min(Math.max(limit, 1), 30)];
    const query = singleLineString`
      select s.uuid, s.name, s.admission_number, s.gender, s.status,
        cur.class_name,
        gf.name as father_name, gm.name as mother_name,
        ph.uuid as photo_id, ph.storage_key as photo_storage_key
      from student s
      left join lateral (
        select fs.uuid, fs.storage_key from file_storage fs
        where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id
          and (fs.variant = 'original' or fs.variant is null)
        order by fs.created_at desc limit 1
      ) ph on true
      left join lateral (
        select c.name as class_name
        from student_class sc
        join academic_year ay on sc.academic_year_id = ay.uuid
        left join class c on sc.class_id = c.uuid
        where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
        order by ay.start_date desc nulls last limit 1
      ) cur on true
      left join lateral (select name from student_guardian where student_id = s.uuid and relation = 'father' and status = 'active' order by created_at limit 1) gf on true
      left join lateral (select name from student_guardian where student_id = s.uuid and relation = 'mother' and status = 'active' order by created_at limit 1) gm on true
      where s.school_id = $1 and s.status <> 'deleted'
        and (
          s.name ilike $2 or s.admission_number ilike $2
          or s.student_mobile ilike $2 or s.father_mobile ilike $2 or s.mother_mobile ilike $2 or s.guardian_mobile ilike $2
          or exists (select 1 from student_guardian g where g.student_id = s.uuid and g.status = 'active'
                       and (g.name ilike $2 or g.mobile ilike $2 or g.whatsapp ilike $2))
        )
      order by
        case when lower(s.admission_number) = lower($3) then 0
             when s.name ilike $4 then 1
             else 2 end,
        s.name
      limit $5
    `;
    return DB.query(query, params);
  }
}

export const studentService = new StudentService();
