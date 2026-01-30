import { DB, singleLineString } from '../../shared/lib/db';
import { Employee } from './employee-interfaces';

class EmployeeService {
  public async getSchoolIdByCode(schoolCode: string): Promise<string | null> {
    const query = singleLineString`
      select uuid from school where lower(code) = lower($1)
    `;
    const results = await DB.query(query, [schoolCode]);
    return results.length > 0 ? results[0].uuid : null;
  }

  public async search(schoolId: string, name?: string): Promise<Employee[]> {
    const searchPattern = name && name.trim() ? `%${name.trim()}%` : '%';

    const query = singleLineString`
      select * from employee
      where school_id = $1
        and lower(name) like lower($2)
      order by name
    `;

    return DB.query(query, [schoolId, searchPattern]);
  }
}

export const employeeService = new EmployeeService();
