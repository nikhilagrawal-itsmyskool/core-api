import { DB, singleLineString } from '../../shared/lib/db';

// Shared helpers used across the assembly services: school resolution,
// cross-entity existence checks (no FKs — validated in app code), and
// name resolution for denormalized display of responsible parties.

// True only for a real yyyy-mm-dd calendar date (rejects e.g. 2026-13-40).
export function isValidDate(s: string | undefined | null): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const results = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return results.length > 0 ? results[0].uuid : null;
}

// The academic-calendar module's daily "thought of the day" (Theme entry). Read
// directly from the calendar tables (same DB, no FK). Returns null when the calendar
// isn't in use or its tables aren't installed — assembly must never fail because the
// calendar module is absent, so the query is wrapped defensively.
export async function dailyThemeFor(schoolId: string, date: string): Promise<string | null> {
  try {
    const rows = await DB.query(
      singleLineString`
        select e.value from calendar_entry e
        join calendar_type t on t.uuid = e.type_id and t.school_id = e.school_id
        where e.school_id = $1 and e.entry_date = $2 and e.status = 'active'
          and t.code = 'theme' and t.status = 'active'
        order by e.sort_order nulls last limit 1
      `,
      [schoolId, date],
    );
    return rows.length > 0 ? rows[0].value : null;
  } catch {
    return null;
  }
}

// Daily themes for a date range -> { 'yyyy-mm-dd': theme }. First entry per date wins.
export async function dailyThemesForRange(
  schoolId: string, from: string, to: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = await DB.query(
      singleLineString`
        select to_char(e.entry_date, 'YYYY-MM-DD') as entry_date, e.value from calendar_entry e
        join calendar_type t on t.uuid = e.type_id and t.school_id = e.school_id
        where e.school_id = $1 and e.status = 'active'
          and e.entry_date >= $2 and e.entry_date <= $3
          and t.code = 'theme' and t.status = 'active'
        order by e.entry_date, e.sort_order nulls last
      `,
      [schoolId, from, to],
    );
    for (const r of rows) if (!map.has(r.entryDate)) map.set(r.entryDate, r.value);
  } catch {
    /* calendar module not installed — no daily themes */
  }
  return map;
}

export async function academicYearExists(schoolId: string, academicYearId: string): Promise<boolean> {
  const rows = await DB.query(
    singleLineString`select 1 from academic_year where uuid = $1 and school_id = $2`,
    [academicYearId, schoolId],
  );
  return rows.length > 0;
}

export async function findClass(schoolId: string, classId: string): Promise<any | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from class where uuid = $1 and school_id = $2`,
    [classId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function findEmployee(schoolId: string, employeeId: string): Promise<any | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from employee where uuid = $1 and school_id = $2 and status != 'deleted'`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

export async function findStudent(schoolId: string, studentId: string): Promise<any | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from student where uuid = $1 and school_id = $2 and status = 'active'`,
    [studentId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// Resolve a student's display name + their class name within an academic year
// (for denormalizing roster speakers/anchors). Returns null when not found.
export async function resolveStudentInfo(
  schoolId: string, studentId: string, academicYearId?: string,
): Promise<{ name: string; className?: string } | null> {
  const params: any[] = [studentId, schoolId];
  let ayJoin = '';
  if (academicYearId) { params.push(academicYearId); ayJoin = ` and sc.academic_year_id = $${params.length}`; }
  const rows = await DB.query(
    singleLineString`
      select s.name, c.name as class_name
      from student s
      left join student_class sc on sc.student_id = s.uuid and sc.school_id = s.school_id and sc.status = 'active'${ayJoin}
      left join class c on c.uuid = sc.class_id
      where s.uuid = $1 and s.school_id = $2 and s.status = 'active'
      limit 1
    `,
    params,
  );
  return rows.length > 0 ? { name: rows[0].name, className: rows[0].className || undefined } : null;
}

// Resolve a set of ids of one entity type -> { id: name } for denormalized display.
async function resolveNames(schoolId: string, table: string, ids: (string | undefined | null)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return {};
  const placeholders = unique.map((_, i) => `$${i + 2}`).join(', ');
  const rows = await DB.query(
    singleLineString`select uuid, name from ${table} where school_id = $1 and uuid in (${placeholders})`,
    [schoolId, ...unique],
  );
  const map: Record<string, string> = {};
  for (const r of rows) map[r.uuid] = r.name;
  return map;
}

export const resolveEmployeeNames = (schoolId: string, ids: (string | undefined | null)[]) =>
  resolveNames(schoolId, 'employee', ids);
export const resolveClassNames = (schoolId: string, ids: (string | undefined | null)[]) =>
  resolveNames(schoolId, 'class', ids);
export const resolveStudentNames = (schoolId: string, ids: (string | undefined | null)[]) =>
  resolveNames(schoolId, 'student', ids);
