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

  // House-balance analytics for one academic year: house sizes, gender split per
  // house, the grade×house spread, the unassigned roster (with a balance-preserving
  // suggested house), and same-house sibling clusters (siblings-apart rule). One
  // roster query; everything else is computed in memory.
  public async analytics(schoolId: string, academicYearId: string): Promise<any> {
    const houses = await DB.query(
      singleLineString`select uuid, name, code, color from house where school_id = $1 and status = 'active' order by name`,
      [schoolId]
    );
    const roster = await DB.query(
      singleLineString`
        select s.uuid, s.name, s.gender, s.house_id,
               s.family_unique_number as fk,
               split_part(c.name, '-', 1) as grade, c.name as class_name
        from student_class sc
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id
        left join class c on c.uuid = sc.class_id
        where sc.school_id = $1 and sc.academic_year_id = $2
          and (sc.status is null or sc.status <> 'deleted') and s.status <> 'deleted'
      `,
      [schoolId, academicYearId]
    );

    const perHouse: Record<string, { total: number; boys: number; girls: number }> = {};
    houses.forEach((h: any) => (perHouse[h.uuid] = { total: 0, boys: 0, girls: 0 }));
    const grades: Record<string, { counts: Record<string, number>; none: number; total: number }> = {};
    const famMap: Record<string, any[]> = {};
    const unassigned: any[] = [];
    let boys = 0, girls = 0, assigned = 0;

    for (const r of roster) {
      const g = String(r.gender || '').toUpperCase();
      if (g === 'M') boys++; else if (g === 'F') girls++;
      const grade = r.grade || '?';
      if (!grades[grade]) grades[grade] = { counts: {}, none: 0, total: 0 };
      grades[grade].total++;
      if (r.houseId && perHouse[r.houseId]) {
        assigned++;
        perHouse[r.houseId].total++;
        if (g === 'M') perHouse[r.houseId].boys++; else if (g === 'F') perHouse[r.houseId].girls++;
        grades[grade].counts[r.houseId] = (grades[grade].counts[r.houseId] || 0) + 1;
      } else {
        grades[grade].none++;
        unassigned.push(r);
      }
      if (r.fk) (famMap[r.fk] = famMap[r.fk] || []).push(r);
    }

    // Same-house sibling clusters: 2+ children on roll, all in one house, none
    // unassigned. Families of 5+ are exempt (auto-exception in the siblings-apart rule).
    const clustered: any[] = [];
    for (const fk of Object.keys(famMap)) {
      const members = famMap[fk];
      if (members.length < 2 || members.length >= 5) continue;
      if (members.some((m: any) => !m.houseId)) continue;
      const houseIds = new Set(members.map((m: any) => m.houseId));
      if (houseIds.size !== 1) continue;
      const houseId = members[0].houseId;
      const house = houses.find((h: any) => h.uuid === houseId);
      clustered.push({
        familyKey: fk,
        houseId,
        houseName: house ? house.name : null,
        members: members
          .map((m: any) => ({ uuid: m.uuid, name: m.name, className: m.className, gender: m.gender }))
          .sort((a: any, b: any) => String(a.className || '').localeCompare(String(b.className || ''))),
      });
    }
    clustered.sort((a, b) => String(a.houseName || '').localeCompare(String(b.houseName || '')));

    const GRADE_RANK: Record<string, number> = {
      NURSERY: 0, LKG: 1, UKG: 2, I: 3, II: 4, III: 5, IV: 6, V: 7, VI: 8, VII: 9, VIII: 10, IX: 11, X: 12, XI: 13, XII: 14,
    };
    const gradeArr = Object.keys(grades)
      .map((grade) => ({
        grade,
        counts: houses.map((h: any) => ({ houseId: h.uuid, n: grades[grade].counts[h.uuid] || 0 })),
        none: grades[grade].none,
        total: grades[grade].total,
      }))
      .sort((a, b) => (GRADE_RANK[a.grade] ?? 99) - (GRADE_RANK[b.grade] ?? 99) || a.grade.localeCompare(b.grade));

    // Balance-preserving suggestions for the WHOLE unassigned batch. Each student is
    // suggested the house currently holding the fewest of their grade (tie → smallest
    // house overall), and the running counts are updated as we go — so a large batch
    // (e.g. a full unassigned section) fans out across houses instead of all piling
    // into whichever house happens to be the current minimum.
    const workGrade: Record<string, Record<string, number>> = {};
    Object.keys(grades).forEach((g) => (workGrade[g] = { ...grades[g].counts }));
    const workTotal: Record<string, number> = {};
    houses.forEach((h: any) => (workTotal[h.uuid] = perHouse[h.uuid].total));
    const unassignedList = unassigned
      .sort(
        (a, b) =>
          String(a.className || '').localeCompare(String(b.className || '')) ||
          String(a.name || '').localeCompare(String(b.name || ''))
      )
      .map((r: any) => {
        const grade = r.grade || '?';
        const gc = (workGrade[grade] = workGrade[grade] || {});
        let best: string | null = null, bestN = Infinity, bestTotal = Infinity;
        for (const h of houses) {
          const n = gc[h.uuid] || 0;
          const t = workTotal[h.uuid] || 0;
          if (n < bestN || (n === bestN && t < bestTotal)) { best = h.uuid; bestN = n; bestTotal = t; }
        }
        if (best) { gc[best] = (gc[best] || 0) + 1; workTotal[best] = (workTotal[best] || 0) + 1; }
        return { uuid: r.uuid, name: r.name, className: r.className, gender: r.gender, suggestedHouseId: best };
      });

    const onRoll = roster.length;
    return {
      academicYearId,
      summary: {
        onRoll,
        assigned,
        unassigned: onRoll - assigned,
        boys,
        girls,
        familiesClustered: clustered.length,
      },
      houses: houses.map((h: any) => ({
        uuid: h.uuid,
        name: h.name,
        code: h.code,
        color: h.color,
        total: perHouse[h.uuid].total,
        boys: perHouse[h.uuid].boys,
        girls: perHouse[h.uuid].girls,
      })),
      grades: gradeArr,
      unassigned: unassignedList,
      siblingsClustered: clustered,
    };
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
