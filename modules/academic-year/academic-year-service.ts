import { DB, singleLineString } from '../../shared/lib/db';
import { AcademicYearDropdownItem } from './academic-year-interfaces';

class AcademicYearService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async search(schoolId: string): Promise<AcademicYearDropdownItem[]> {
    const query = singleLineString`
      select uuid, name from academic_year
      where school_id = $1
      order by start_date desc
    `;

    return DB.query(query, [schoolId]);
  }
}

export const academicYearService = new AcademicYearService();
