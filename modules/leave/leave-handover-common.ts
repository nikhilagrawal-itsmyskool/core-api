import { DB, singleLineString } from "../../shared/lib/db";
import { getCurrentAcademicYearId } from "./leave-common";

// Cross-module reads for the leave "academic handover": the teacher's affected periods
// (from the published timetable) and a best-effort "current topic" (from the syllabus plan).
// Every query is defensive — a missing/unpopulated timetable or syllabus never breaks apply.

// Grade = class name minus a trailing "-<section>": "I-A" -> "I", "XII" -> "XII".
export function parseGrade(className: string): string {
  const s = String(className || "").trim();
  const m = s.match(/^(.*?)[-\s]+[A-Za-z0-9]+$/);
  return (m ? m[1] : s).trim();
}

// Calendar date (YYYY-MM-DD) -> ISO weekday 1=Mon..7=Sun (matches published_entry.day_of_week).
function isoWeekday(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export interface AffectedPeriod {
  seq: number | null;
  slotLabel: string | null;
  classId: string;
  className: string | null;
  subjectId: string | null;
  subjectName: string | null;
}
export interface AffectedDay {
  date: string;
  dayOfWeek: number;
  periods: AffectedPeriod[];
}

// Is this employee teaching staff? True if they hold any teaching assignment or appear as a
// teacher on the active published timetable. Defensive → false when neither table exists.
export async function isTeachingStaff(schoolId: string, employeeId: string): Promise<boolean> {
  try {
    const rows = await DB.query(
      singleLineString`select
        (exists(select 1 from teaching_assignment where school_id = $1 and teacher_id = $2)
         or exists(select 1 from published_entry pe join published_timetable pt on pt.uuid = pe.published_timetable_id and pt.status = 'active'
                   where pe.school_id = $1 and pe.teacher_id = $2)) as teaching`,
      [schoolId, employeeId],
    );
    return rows.length ? rows[0].teaching === true : false;
  } catch {
    return false;
  }
}

// The teacher's periods on each given date, from the active published timetable. Dates that
// have no periods (or when no timetable is published) return an empty period list.
export async function affectedPeriods(schoolId: string, employeeId: string, dates: string[]): Promise<AffectedDay[]> {
  const out: AffectedDay[] = [];
  for (const date of dates) {
    const dow = isoWeekday(date);
    let periods: AffectedPeriod[] = [];
    try {
      const rows = await DB.query(
        singleLineString`select ts.sequence, coalesce(ts.label, '') as slot_label,
            pe.class_id, c.name as class_name, pe.subject_id, s.name as subject_name
          from published_entry pe
          join published_timetable pt on pt.uuid = pe.published_timetable_id and pt.status = 'active'
          join time_slot ts on ts.uuid = pe.time_slot_id
          left join subject s on s.uuid = pe.subject_id
          left join class c on c.uuid = pe.class_id
          where pe.school_id = $1 and pe.teacher_id = $2 and pe.day_of_week = $3
          order by ts.sequence asc nulls last`,
        [schoolId, employeeId, dow],
      );
      periods = rows.map((r: any) => ({
        seq: r.sequence ?? null, slotLabel: r.slotLabel || null,
        classId: r.classId, className: r.className || null,
        subjectId: r.subjectId || null, subjectName: r.subjectName || null,
      }));
    } catch {
      periods = [];
    }
    out.push({ date, dayOfWeek: dow, periods });
  }
  return out;
}

// Best-effort "current topic" for a class + subject: the first uncovered content leaf (with
// its parent chapter) in the syllabus plan for the class's grade, matching the subject by
// NAME (the syllabus has its own subject catalog, independent of timetable subjects). Falls
// back to null so the teacher fills it in manually. Never throws.
export async function currentTopic(
  schoolId: string,
  grade: string,
  subjectName: string,
  classId: string,
): Promise<{ chapter: string | null; topic: string } | null> {
  if (!subjectName) return null;
  try {
    const ay = await getCurrentAcademicYearId(schoolId);
    if (!ay) return null;
    const rows = await DB.query(
      singleLineString`select e.title, e.topic_no, parent.title as parent_title
        from syllabus_entry e
        join syllabus s on s.uuid = e.syllabus_id
        join syllabus_subject ss on ss.uuid = s.subject_id
        left join syllabus_entry parent on parent.uuid = e.parent_entry_id
        left join syllabus_progress p on p.syllabus_entry_id = e.uuid and p.class_id = $5
        where s.school_id = $1 and s.academic_year_id = $2 and lower(s.grade) = lower($3)
          and lower(ss.name) = lower($4) and s.status = 'active' and e.status = 'active'
          and e.entry_type not in ('unit','section','exam','revision')
          and not exists (select 1 from syllabus_entry c where c.parent_entry_id = e.uuid and c.status = 'active')
          and coalesce(p.status,'pending') <> 'covered'
        order by e.seq asc
        limit 1`,
      [schoolId, ay, grade, subjectName, classId],
    );
    if (!rows.length) return null;
    const r = rows[0];
    const topic = r.topicNo ? `${r.topicNo} ${r.title}` : r.title;
    return { chapter: r.parentTitle || null, topic: String(topic || "").trim() };
  } catch {
    return null;
  }
}
