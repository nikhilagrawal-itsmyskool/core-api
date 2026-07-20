import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { House, CreateHouseRequest, UpdateHouseRequest, HouseTeacher, HouseTeacherInput, HouseTeacherRole } from './student-interfaces';
import { DEFAULTS } from './student-constants';

const HOUSE_TEACHER_ROLES: HouseTeacherRole[] = ['incharge', 'coincharge', 'member'];
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
}

class HouseService {
  public async list(schoolId: string): Promise<House[]> {
    return DB.query(
      singleLineString`
        select * from house where school_id = $1 and status = 'active' order by name
      `,
      [schoolId]
    );
  }

  public async getById(id: string, schoolId: string): Promise<House | null> {
    const rows = await DB.query(
      singleLineString`select * from house where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async create(data: CreateHouseRequest, schoolId: string, userId: string): Promise<House> {
    if (!data.name || !data.name.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Name is required');
    }
    const code = (data.code && data.code.trim() ? slugify(data.code) : slugify(data.name)) || 'house';

    const dup = await DB.query(
      singleLineString`
        select 1 from house where school_id = $1 and lower(code) = lower($2) and status = 'active' limit 1
      `,
      [schoolId, code]
    );
    if (dup.length > 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `House "${code}" already exists`);
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into house
        (uuid, school_id, name, code, color, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning *
      `,
      [uuid, schoolId, data.name.trim(), code, data.color || null, DEFAULTS.STATUS, userId, now]
    );
    return rows[0];
  }

  public async update(
    id: string,
    data: UpdateHouseRequest,
    schoolId: string,
    userId: string
  ): Promise<House | null> {
    const fields: string[] = [];
    const params: any[] = [];
    const set = (col: string, val: any) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };
    if (data.name !== undefined) set('name', data.name.trim());
    if (data.color !== undefined) set('color', data.color);
    if (fields.length === 0) return this.getById(id, schoolId);

    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);
    const rows = await DB.query(
      `update house set ${fields.join(', ')}
       where uuid = $${params.length - 1} and school_id = $${params.length} and status = 'active'
       returning *`,
      params
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const inUse = await DB.query(
      singleLineString`
        select count(*)::int as count from student
        where school_id = $1 and house_id = $2 and status <> 'deleted'
      `,
      [schoolId, id]
    );
    if (inUse.length > 0 && inUse[0].count > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Cannot delete: ${inUse[0].count} student(s) still assigned to this house`
      );
    }
    const rows = await DB.query(
      singleLineString`
        update house set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
        returning uuid
      `,
      [userId, new Date(), id, schoolId]
    );
    return rows.length > 0;
  }

  // Assign (or clear) a student's lifelong House.
  public async assignToStudent(
    studentId: string,
    houseId: string | null,
    schoolId: string,
    userId: string
  ): Promise<boolean> {
    if (houseId) {
      const house = await this.getById(houseId, schoolId);
      if (!house) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid house');
      }
    }
    const rows = await DB.query(
      singleLineString`
        update student set house_id = $1, updatedby_userid = $2, updated_at = $3
        where uuid = $4 and school_id = $5 and status <> 'deleted'
        returning uuid
      `,
      [houseId, userId, new Date(), studentId, schoolId]
    );
    return rows.length > 0;
  }

  // ---- House staff (in-charge / co-in-charge / member teachers) ----

  public async listTeachers(houseId: string, schoolId: string): Promise<HouseTeacher[]> {
    return DB.query(
      singleLineString`
        select ht.uuid, ht.house_id, ht.employee_id, e.name as employee_name, ht.role
        from house_teacher ht
        left join employee e on e.uuid = ht.employee_id and e.school_id = ht.school_id
        where ht.house_id = $1 and ht.school_id = $2 and ht.status = 'active'
        order by case ht.role when 'incharge' then 0 when 'coincharge' then 1 else 2 end, e.name
      `,
      [houseId, schoolId]
    );
  }

  // Replace a house's staff set. Validates roles, employees, and enforces at most
  // one in-charge and one co-in-charge per house (members are unlimited).
  public async setTeachers(
    houseId: string,
    entries: HouseTeacherInput[],
    schoolId: string,
    userId: string
  ): Promise<HouseTeacher[]> {
    const house = await this.getById(houseId, schoolId);
    if (!house) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Invalid house');
    if (!Array.isArray(entries)) throw new BusinessErrorResult(ErrorCode.BusinessError, 'teachers array is required');

    const seenEmployees = new Set<string>();
    let inchargeCount = 0;
    let coinchargeCount = 0;
    for (const e of entries) {
      if (!HOUSE_TEACHER_ROLES.includes(e.role)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid role: ${e.role}`);
      }
      if (!e.employeeId) throw new BusinessErrorResult(ErrorCode.BusinessError, 'employeeId is required');
      if (seenEmployees.has(e.employeeId)) {
        throw new BusinessErrorResult(ErrorCode.BusinessError, 'A teacher can hold only one role in a house');
      }
      seenEmployees.add(e.employeeId);
      if (e.role === 'incharge') inchargeCount++;
      if (e.role === 'coincharge') coinchargeCount++;
      const emp = await DB.query(
        singleLineString`select 1 from employee where uuid = $1 and school_id = $2 and status <> 'deleted' limit 1`,
        [e.employeeId, schoolId]
      );
      if (emp.length === 0) throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid employee: ${e.employeeId}`);
    }
    if (inchargeCount > 1) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A house can have only one in-charge');
    if (coinchargeCount > 1) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A house can have only one co-in-charge');

    const now = new Date();
    const queries: string[] = [
      singleLineString`update house_teacher set status = 'deleted', updatedby_userid = $1, updated_at = $2 where house_id = $3 and status = 'active'`,
    ];
    const params: any[][] = [[userId, now, houseId]];
    for (const e of entries) {
      queries.push(
        singleLineString`insert into house_teacher (uuid, school_id, house_id, employee_id, role, status, createdby_userid, created_at) values ($1,$2,$3,$4,$5,'active',$6,$7)`
      );
      params.push([generateShortUuid(12), schoolId, houseId, e.employeeId, e.role, userId, now]);
    }
    await DB.queriesInTransaction(queries, params);
    return this.listTeachers(houseId, schoolId);
  }
}

export const houseService = new HouseService();
