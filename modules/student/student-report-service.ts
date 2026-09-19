import { DB } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';

// ── Printable roster reports ────────────────────────────────────────────────
// A single generic engine: pick a set of classes (one academic year), pick the
// columns you want, optionally filter to RTE / exam-only students. The frontend
// turns the returned rows into a printable HTML table (portrait/landscape,
// optional page-break per class) or a CSV. Named reports (contact list, RTE,
// exam-only) are just this engine with different defaults on the frontend.

type FieldGroup = 'identity' | 'student' | 'father' | 'mother' | 'guardian' | 'attributes';

interface FieldDef {
  label: string;
  group: FieldGroup;
  expr: string; // SQL expression selected as "<key>"
  contact?: boolean; // masked for non admin/god (mirrors bulk-class roster)
}

// key → definition. Keys are the camelCase field ids the API speaks; the SQL
// alias is double-quoted so it survives the snake→camel transform untouched.
export const REPORT_FIELDS: Record<string, FieldDef> = {
  rollNumber: { label: 'Roll No', group: 'identity', expr: 'sc.roll_number' },
  admissionNumber: { label: 'Admission No', group: 'identity', expr: 's.admission_number' },
  studentName: { label: 'Student Name', group: 'identity', expr: 's.name' },
  className: { label: 'Class', group: 'identity', expr: 'c.name' },
  gender: { label: 'Gender', group: 'identity', expr: 's.gender' },
  dob: { label: 'Date of Birth', group: 'identity', expr: 's.dob' },
  admissionDate: { label: 'Admission Date', group: 'identity', expr: 's.admission_date' },

  studentMobile: { label: 'Student Mobile', group: 'student', expr: 's.student_mobile', contact: true },
  studentWhatsapp: { label: 'Student WhatsApp', group: 'student', expr: 's.student_whatsapp', contact: true },

  fatherName: { label: "Father's Name", group: 'father', expr: 'f.name' },
  fatherMobile: { label: 'Father Mobile', group: 'father', expr: 'coalesce(f.mobile, s.father_mobile)', contact: true },
  fatherWhatsapp: { label: 'Father WhatsApp', group: 'father', expr: 'coalesce(f.whatsapp, s.father_whatsapp)', contact: true },

  motherName: { label: "Mother's Name", group: 'mother', expr: 'm.name' },
  motherMobile: { label: 'Mother Mobile', group: 'mother', expr: 'coalesce(m.mobile, s.mother_mobile)', contact: true },
  motherWhatsapp: { label: 'Mother WhatsApp', group: 'mother', expr: 'coalesce(m.whatsapp, s.mother_whatsapp)', contact: true },

  guardianName: { label: "Guardian's Name", group: 'guardian', expr: 'g.name' },
  guardianMobile: { label: 'Guardian Mobile', group: 'guardian', expr: 'coalesce(g.mobile, s.guardian_mobile)', contact: true },
  guardianWhatsapp: { label: 'Guardian WhatsApp', group: 'guardian', expr: 'coalesce(g.whatsapp, s.guardian_whatsapp)', contact: true },

  house: { label: 'House', group: 'attributes', expr: 'h.name' },
  rte: { label: 'RTE', group: 'attributes', expr: 's.rte' },
  examOnly: { label: 'Exam Only', group: 'attributes', expr: 's.exam_only' },
};

// Contact field keys — the handler masks whichever of these were selected.
export const REPORT_CONTACT_FIELDS = Object.keys(REPORT_FIELDS).filter((k) => REPORT_FIELDS[k].contact);

export type ReportFilter = 'all' | 'rte' | 'examOnly';

export interface ReportRequest {
  academicYearId: string;
  classIds: string[];
  fields: string[];
  filter?: ReportFilter;
}

const MAX_CLASSES = 80;

class StudentReportService {
  // The field catalogue the column-picker renders (grouped, ordered as declared).
  public catalog(): Array<{ key: string; label: string; group: FieldGroup; contact: boolean }> {
    return Object.entries(REPORT_FIELDS).map(([key, d]) => ({
      key,
      label: d.label,
      group: d.group,
      contact: !!d.contact,
    }));
  }

  public async roster(schoolId: string, req: ReportRequest): Promise<any> {
    const academicYearId = (req.academicYearId || '').trim();
    if (!academicYearId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'academicYearId is required');
    }

    const classIds = Array.from(new Set((req.classIds || []).filter((x) => typeof x === 'string' && x.trim()))).map((x) =>
      x.trim()
    );
    if (!classIds.length) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Select at least one class');
    }
    if (classIds.length > MAX_CLASSES) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Too many classes (max ${MAX_CLASSES})`);
    }

    // Keep only known fields, preserving the caller's order. className is always
    // returned as row metadata (used for grouping/page-breaks) so it's dropped
    // from the extra-column list to avoid a duplicate alias.
    const fields = (req.fields || []).filter((k) => REPORT_FIELDS[k]);
    if (!fields.length) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Select at least one field');
    }

    const filter: ReportFilter = req.filter === 'rte' || req.filter === 'examOnly' ? req.filter : 'all';

    const meta = ['s.uuid as "studentId"', 'c.uuid as "classId"', 'c.name as "className"'];
    const cols = fields.filter((k) => k !== 'className').map((k) => `${REPORT_FIELDS[k].expr} as "${k}"`);
    const selectList = [...meta, ...cols].join(', ');

    const params: any[] = [schoolId, academicYearId];
    const inList = classIds.map((_, i) => `$${i + 3}`).join(', ');
    params.push(...classIds);

    let filterSql = '';
    if (filter === 'rte') filterSql = ' and s.rte = true';
    else if (filter === 'examOnly') filterSql = ' and s.exam_only = true';

    const sql = `
      select ${selectList}
      from student_class sc
      join student s on s.uuid = sc.student_id and s.school_id = sc.school_id
      join class c on c.uuid = sc.class_id and c.school_id = sc.school_id
      left join house h on h.uuid = s.house_id and h.school_id = s.school_id
      left join lateral (
        select uuid, name, mobile, whatsapp from student_guardian
        where student_id = s.uuid and school_id = s.school_id and status = 'active' and relation = 'father'
        order by created_at limit 1
      ) f on true
      left join lateral (
        select uuid, name, mobile, whatsapp from student_guardian
        where student_id = s.uuid and school_id = s.school_id and status = 'active' and relation = 'mother'
        order by created_at limit 1
      ) m on true
      left join lateral (
        select uuid, name, mobile, whatsapp from student_guardian
        where student_id = s.uuid and school_id = s.school_id and status = 'active' and relation = 'guardian'
        order by created_at limit 1
      ) g on true
      where sc.school_id = $1 and sc.academic_year_id = $2 and sc.class_id in (${inList})
        and (sc.status is null or sc.status <> 'deleted') and s.status <> 'deleted'${filterSql}
      order by c.name asc, sc.roll_number asc nulls last, s.name asc
    `;

    const rows = (await DB.query(sql, params)) as any[];

    // Per-class counts (order of first appearance), for the frontend summary/page-breaks.
    const classes: Array<{ classId: string; className: string; count: number }> = [];
    const seen: Record<string, number> = {};
    for (const r of rows) {
      let idx = seen[r.classId];
      if (idx === undefined) {
        idx = classes.length;
        seen[r.classId] = idx;
        classes.push({ classId: r.classId, className: r.className, count: 0 });
      }
      classes[idx].count++;
    }

    return {
      meta: {
        academicYearId,
        filter,
        fields,
        generatedAt: new Date().toISOString(),
        total: rows.length,
        classes,
      },
      rows,
    };
  }
}

export const studentReportService = new StudentReportService();
