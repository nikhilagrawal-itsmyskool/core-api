import { DB, singleLineString } from "../../shared/lib/db";

// Shared cross-entity lookups against existing ERP masters (no FKs — validated here).
// Mirrors the small helpers the homework/syllabus modules use so the club module stays
// self-contained and never duplicates institutional data.

export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// "Current" academic year = the year whose date range contains today, else the
// latest-starting year.
export async function getCurrentAcademicYearId(schoolId: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`
      select uuid from academic_year
      where school_id = $1
      order by (case when current_date between start_date and end_date then 0 else 1 end),
               start_date desc nulls last
      limit 1
    `,
    [schoolId],
  );
  return rows.length > 0 ? rows[0].uuid : null;
}

// An active employee (teacher/in-charge) by uuid, or null.
export async function findEmployee(
  schoolId: string,
  employeeId: string,
): Promise<{ uuid: string; name: string } | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name from employee where uuid = $1 and school_id = $2 and status <> 'deleted'`,
    [employeeId, schoolId],
  );
  return rows.length > 0 ? rows[0] : null;
}

// A class name by uuid (base or stream-child), or null.
export async function findClassName(schoolId: string, classId: string): Promise<string | null> {
  const rows = await DB.query(
    singleLineString`select name from class where uuid = $1 and school_id = $2`,
    [classId, schoolId],
  );
  return rows.length > 0 ? rows[0].name : null;
}

// Append one row to club_audit (the meaningful-changes log). Best-effort shape; `before`/
// `after` are short summaries (jsonb), not whole rows.
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");
export async function writeAudit(
  schoolId: string,
  actorUserId: string,
  action: string,
  objectType: string,
  objectId: string,
  opts?: { before?: unknown; after?: unknown; reason?: string; actorRole?: string },
): Promise<void> {
  await DB.query(
    singleLineString`insert into club_audit
        (uuid, school_id, at, actor_userid, actor_role, action, object_type, object_id, before, after, reason)
      values ($1,$2,now(),$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
    [
      generateShortUuid(12),
      schoolId,
      actorUserId,
      opts?.actorRole || null,
      action,
      objectType,
      objectId,
      opts?.before != null ? JSON.stringify(opts.before) : null,
      opts?.after != null ? JSON.stringify(opts.after) : null,
      opts?.reason || null,
    ],
  );
}
