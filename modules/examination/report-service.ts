import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { gradeOf } from "./examination-common";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// ── Report cards (Term-1 marks + co-scholastic). Data-driven: a per-(school, AY, band)
// scheme is the blueprint; student values reference it by stable codes. See examination-setup.sql.

type AreaEntry = string | [string, "text"]; // a grade area (string) or a free-text area
type Band = {
  band: string;
  name: string;
  grades: string; // csv of grade prefixes
  components: Record<number, [string, string, number][]>; // term -> [code, label, max][]
  subjects: [string, string, string][]; // [code, reportLabel, syllabusSubject]
  areas: Record<string, AreaEntry[]>; // section -> entries[]
  scholastic?: [string, string, number, number][]; // default = SCHOLASTIC_SCALE; [] = none (pre-primary)
  coscholastic?: [string, string][]; // default = COSCHOLASTIC_SCALE
};

const SCHOLASTIC_SCALE: [string, string, number, number][] = [
  ["A1", "Outstanding", 91, 100], ["A2", "Excellent", 81, 90], ["B1", "Very Good", 71, 80],
  ["B2", "Good", 61, 70], ["C1", "Fair", 51, 60], ["C2", "Scope for Improvement", 41, 50],
  ["D", "Need to work very hard", 33, 40], ["E", "Should upgrade to meet the minimum requirement", 0, 32],
];
const COSCHOLASTIC_SCALE: [string, string][] = [
  ["A", "Excellent"], ["B", "Very Good"], ["C", "Good"], ["D", "Fair"],
];
// Pre-primary uses a finer grade scale (with +'s) and no numeric marks.
const PREPRIMARY_SCALE: [string, string][] = [
  ["A+", "Outstanding"], ["A", "Excellent"], ["B+", "Very Good"], ["B", "Good"], ["C", "Fair"], ["D", "Scope of Improvement"],
];

// Co-scholastic / personality / other areas shared by bands 1-3 and 4-5.
const JUNIOR_AREAS: Record<string, string[]> = {
  "Co-Scholastic": ["General Awareness and Reasoning", "Value Education", "Art and Craft", "Games", "Music", "Dance", "English Conversation"],
  "Personality Development": ["Courteousness", "Confidence", "Sense of Responsibility", "Initiative", "Sharing & Caring", "Neatness"],
  "Other Areas": ["Discipline", "Value Systems", "Social Skills", "Scientific Skills", "Thinking Skills", "Emotional Skills"],
};

const BANDS: Band[] = [
  {
    band: "1-3", name: "Achievement Record · 1-3", grades: "I,II,III",
    components: {
      1: [["PT1", "PT-I", 10], ["CT1", "Class Test", 10], ["NB1", "NB-I", 5], ["SEA1", "SEA", 5], ["CP1", "Class Perf", 10], ["ORAL1", "Oral", 10], ["HY", "Half Yearly", 50]],
      2: [["PT2", "PT-II", 10], ["CT2", "Class Test", 10], ["NB2", "NB-II", 5], ["SEA2", "SEA", 5], ["CP2", "Class Perf", 10], ["ORAL2", "Oral", 10], ["ANNUAL", "Annual Exam", 50]],
    },
    subjects: [["ENG", "English", "English,English I"], ["HIN", "Hindi", "Hindi,Hindi I"], ["MATH", "Mathematics", "Mathematics"], ["EVS", "EVS", "Environmental Science"], ["COMP", "Computer Science", "Computer"]],
    areas: JUNIOR_AREAS,
  },
  {
    band: "4-5", name: "Achievement Record · 4-5", grades: "IV,V",
    components: {
      1: [["PT1", "PT-I", 10], ["CT1", "Class Test", 10], ["NB1", "NB-I", 5], ["SEA1", "SEA", 5], ["HY", "Half Yearly", 70]],
      2: [["PT2", "PT-II", 10], ["CT2", "Class Test", 10], ["NB2", "NB-II", 5], ["SEA2", "SEA", 5], ["ANNUAL", "Annual Exam", 70]],
    },
    subjects: [["ENG", "English", "English,English I"], ["HIN", "Hindi", "Hindi,Hindi I"], ["MATH", "Mathematics", "Mathematics"], ["SCI", "Science", "Science"], ["SST", "Social Studies", "Social Studies"], ["COMP", "Computer Science", "Computer"]],
    areas: JUNIOR_AREAS,
  },
  {
    band: "6-9", name: "Achievement Record · 6-9", grades: "VI,VII,VIII,IX",
    components: {
      1: [["PT1", "PT-I", 10], ["NB1", "NB-I", 5], ["SEA1", "SEA", 5], ["HY", "Half Yearly", 80]],
      2: [["PT2", "PT-II", 10], ["NB2", "NB-II", 5], ["SEA2", "SEA", 5], ["ANNUAL", "Annual Exam", 80]],
    },
    subjects: [["ENG", "English", "English,English I"], ["HIN", "Hindi", "Hindi,Hindi I"], ["MATH", "Mathematics", "Mathematics"], ["SCI", "Science", "Science"], ["SST", "Social Science", "Social Science,Social Science (Part 1),Social Studies"], ["COMP", "Computer Science", "Computer"]],
    areas: {
      "Co-Scholastic": ["Work Education", "Value Education", "General Awareness and Reasoning", "Art Education", "Physical Education"],
      "Other Areas": ["Discipline", "English Conversation", "Value System", "Performing Art", "Sports & Games"],
    },
  },
  {
    // Pre-primary "Progress Report": no numeric marks — everything is graded (A+..D). Its two
    // free-text rows use value_type 'text'. Entered entirely by the class teacher.
    band: "pre-primary", name: "Progress Report · Pre-Primary", grades: "Nursery,LKG,UKG",
    components: { 1: [], 2: [] },
    subjects: [],
    coscholastic: PREPRIMARY_SCALE,
    scholastic: [], // no scholastic scale (no numeric marks)
    areas: {
      "My Performance": [
        "English Oral", "English Written", "English C.P", "Hindi Oral", "Hindi Written", "Hindi C.P.",
        "Maths Oral", "Maths Written", "Maths C.P.", "GA/EVS", "Art", "Craft", "Games", "Music", "Dance",
        "Library", "Physical Training", "Rhymes Hindi", "Rhymes English", "Story Time",
      ],
      "Personality Development": [
        "Courteousness", "Confidence", "Care of Belongings", "Neatness", "Regularity and Punctuality",
        "Initiative", "Sense of Responsibility", "Manners", "Eating Habits", "Discipline",
      ],
      "Specific Participation": [["Specific Participation", "text"]],
      "At school I enjoy": [["At school I enjoy", "text"]],
    },
  },
];

class ReportService {
  // ── Scheme seeding (on first use, idempotent) ──────────────────────────────────────
  async ensureSchemes(schoolId: string, ayId: string, userId: string): Promise<void> {
    for (const b of BANDS) {
      const existing = await DB.query(
        singleLineString`select uuid from exam_report_scheme where school_id = $1 and academic_year_id = $2 and band = $3 and status = 'active' limit 1`,
        [schoolId, ayId, b.band],
      );
      if (existing.length) continue;
      const now = new Date();
      const schemeId = generateShortUuid(12);
      await DB.query(
        singleLineString`insert into exam_report_scheme (uuid, school_id, academic_year_id, band, name, applies_to_grades, status, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,'active',$7,$8)`,
        [schemeId, schoolId, ayId, b.band, b.name, b.grades, userId, now],
      );
      for (const term of [1, 2]) {
        let sort = 0;
        for (const [code, label, max] of b.components[term]) {
          await DB.query(
            singleLineString`insert into exam_report_component (uuid, school_id, academic_year_id, scheme_id, term, code, label, max_marks, sort_order, status, createdby_userid, created_at)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11)`,
            [generateShortUuid(12), schoolId, ayId, schemeId, term, code, label, max, sort++, userId, now],
          );
        }
      }
      let ssort = 0;
      for (const [code, label, syl] of b.subjects) {
        await DB.query(
          singleLineString`insert into exam_report_subject (uuid, school_id, academic_year_id, scheme_id, code, report_label, syllabus_subject, sort_order, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9,$10)`,
          [generateShortUuid(12), schoolId, ayId, schemeId, code, label, syl, ssort++, userId, now],
        );
      }
      for (const section of Object.keys(b.areas)) {
        let asort = 0;
        for (const entry of b.areas[section]) {
          const label = Array.isArray(entry) ? entry[0] : entry;
          const valueType = Array.isArray(entry) ? entry[1] : "grade";
          await DB.query(
            singleLineString`insert into exam_report_area (uuid, school_id, academic_year_id, scheme_id, section, label, scale_kind, value_type, sort_order, status, createdby_userid, created_at)
              values ($1,$2,$3,$4,$5,$6,'coscholastic',$7,$8,'active',$9,$10)`,
            [generateShortUuid(12), schoolId, ayId, schemeId, section, label, valueType, asort++, userId, now],
          );
        }
      }
      let gsort = 0;
      for (const [grade, label, min, max] of (b.scholastic ?? SCHOLASTIC_SCALE)) {
        await DB.query(
          singleLineString`insert into exam_report_grade_scale (uuid, school_id, academic_year_id, scheme_id, kind, grade, label, min_pct, max_pct, sort_order, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,'scholastic',$5,$6,$7,$8,$9,'active',$10,$11)`,
          [generateShortUuid(12), schoolId, ayId, schemeId, grade, label, min, max, gsort++, userId, now],
        );
      }
      gsort = 0;
      for (const [grade, label] of (b.coscholastic ?? COSCHOLASTIC_SCALE)) {
        await DB.query(
          singleLineString`insert into exam_report_grade_scale (uuid, school_id, academic_year_id, scheme_id, kind, grade, label, min_pct, max_pct, sort_order, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,'coscholastic',$5,$6,null,null,$7,'active',$8,$9)`,
          [generateShortUuid(12), schoolId, ayId, schemeId, grade, label, gsort++, userId, now],
        );
      }
    }
  }

  // The active scheme for a class (resolved by its grade prefix). Seeds on first use.
  async schemeForClass(schoolId: string, ayId: string, classId: string, userId: string): Promise<any | null> {
    await this.ensureSchemes(schoolId, ayId, userId);
    const cls = await this.classInfo(schoolId, classId);
    if (!cls) return null;
    const grade = gradeOf(cls.name);
    const rows = await DB.query(
      singleLineString`select uuid, band, name, applies_to_grades from exam_report_scheme where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ayId],
    );
    for (const s of rows) {
      const grades = String(s.appliesToGrades || "").split(",").map((g: string) => g.trim());
      if (grades.includes(grade)) return { ...s, grade, className: cls.name };
    }
    return null;
  }

  private async classInfo(schoolId: string, classId: string): Promise<{ uuid: string; name: string } | null> {
    const r = await DB.query(singleLineString`select uuid, name from class where uuid = $1 and school_id = $2`, [classId, schoolId]);
    return r.length ? { uuid: r[0].uuid, name: r[0].name } : null;
  }

  private async classStudents(schoolId: string, ayId: string, classId: string): Promise<any[]> {
    return DB.query(
      singleLineString`select s.uuid as student_id, s.name, s.admission_number, sc.roll_number,
          (select h.name from house h where h.uuid = s.house_id) as house_name
        from student_class sc
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status = 'active'
        where sc.class_id = $1 and sc.academic_year_id = $2 and sc.school_id = $3 and (sc.status is null or sc.status <> 'deleted')
        order by sc.roll_number asc nulls last, s.name`,
      [classId, ayId, schoolId],
    );
  }

  // Live attendance for a class up to today: total finalized sessions (same for everyone) +
  // each student's present-or-late count. Prefills the report header (the class teacher can edit).
  private async attendanceSummary(schoolId: string, ayId: string, classId: string): Promise<{ total: number; present: Map<string, number> }> {
    const totalRows = await DB.query(
      singleLineString`select count(*)::int as n from attendance_session
        where school_id = $1 and academic_year_id = $2 and class_id = $3 and status = 'finalized' and attendance_date <= current_date`,
      [schoolId, ayId, classId],
    );
    const presentRows = await DB.query(
      singleLineString`select ar.student_id, count(*)::int as n from attendance_record ar
        join attendance_session ses on ses.uuid = ar.session_id and ses.status = 'finalized'
          and ses.academic_year_id = $2 and ses.class_id = $3 and ses.attendance_date <= current_date
        where ar.school_id = $1 and ar.status in ('present', 'late') group by ar.student_id`,
      [schoolId, ayId, classId],
    );
    return { total: Number(totalRows[0]?.n || 0), present: new Map(presentRows.map((r: any) => [r.studentId, Number(r.n)])) };
  }

  private async schemeComponents(schemeId: string, term: number): Promise<any[]> {
    return DB.query(
      singleLineString`select code, label, max_marks from exam_report_component where scheme_id = $1 and term = $2 and status = 'active' order by sort_order asc nulls last`,
      [schemeId, term],
    );
  }

  private async schemeSubjects(schemeId: string): Promise<any[]> {
    return DB.query(
      singleLineString`select code, report_label, syllabus_subject from exam_report_subject where scheme_id = $1 and status = 'active' order by sort_order asc nulls last`,
      [schemeId],
    );
  }

  // ── Access (via syllabus offerings) ────────────────────────────────────────────────
  // A report subject maps to one OR MORE syllabus subject names (a comma list), because a
  // school's syllabus is often more granular than the card (English = English + Grammar +
  // Phonics…). A teacher may enter marks for (class, subject) if the syllabus plan pins them to
  // that section for ANY of those names. god/exam-incharge override bypasses.
  private syllabusNames(list: string | null | undefined): string[] {
    return String(list || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  }
  async teachesSubject(schoolId: string, ayId: string, classId: string, syllabusSubjectList: string, employeeId: string): Promise<boolean> {
    const names = this.syllabusNames(syllabusSubjectList);
    if (!names.length) return false;
    const rows = await DB.query(
      singleLineString`select 1
        from syllabus_plan_teacher pt
        join syllabus sy on sy.uuid = pt.syllabus_id and sy.status = 'active' and sy.academic_year_id = $2
        join syllabus_subject ss on ss.uuid = sy.subject_id and ss.status = 'active'
        where pt.school_id = $1 and pt.class_id = $3 and pt.teacher_id = $4 and pt.status = 'active'
          and lower(trim(ss.name)) = any($5)
        limit 1`,
      [schoolId, ayId, classId, employeeId, names],
    );
    return rows.length > 0;
  }

  // The exam-incharge's explicit teacher for a (class, subject), or null (→ fall back to syllabus).
  private async explicitTeacherId(schoolId: string, ayId: string, classId: string, subjectCode: string): Promise<string | null> {
    const rows = await DB.query(
      singleLineString`select teacher_id from exam_report_teacher where school_id = $1 and academic_year_id = $2 and class_id = $3 and subject_code = $4 and status = 'active' limit 1`,
      [schoolId, ayId, classId, subjectCode],
    );
    return rows.length ? rows[0].teacherId : null;
  }

  // Can this employee enter marks for (class, subject)? An explicit assignment wins outright;
  // otherwise fall back to the syllabus offering.
  private async canTeach(schoolId: string, ayId: string, classId: string, subjectCode: string, syllabusSubjectList: string, employeeId: string): Promise<boolean> {
    const explicit = await this.explicitTeacherId(schoolId, ayId, classId, subjectCode);
    if (explicit) return explicit === employeeId;
    return this.teachesSubject(schoolId, ayId, classId, syllabusSubjectList, employeeId);
  }

  // Distinct syllabus teachers pinned to a (class) for any of a subject's syllabus names.
  private async syllabusTeachersFor(schoolId: string, ayId: string, classId: string, syllabusSubjectList: string): Promise<{ id: string; name: string }[]> {
    const names = this.syllabusNames(syllabusSubjectList);
    if (!names.length) return [];
    const rows = await DB.query(
      singleLineString`select distinct pt.teacher_id, e.name
        from syllabus_plan_teacher pt
        join syllabus sy on sy.uuid = pt.syllabus_id and sy.status = 'active' and sy.academic_year_id = $2
        join syllabus_subject ss on ss.uuid = sy.subject_id and ss.status = 'active'
        left join employee e on e.uuid = pt.teacher_id and e.school_id = pt.school_id
        where pt.school_id = $1 and pt.class_id = $3 and pt.status = 'active' and lower(trim(ss.name)) = any($4)`,
      [schoolId, ayId, classId, names],
    );
    return rows.map((r: any) => ({ id: r.teacherId, name: r.name }));
  }

  // Classes the caller may enter co-scholastic for: the class(es) they are class-teacher of,
  // or — for a god/exam-incharge override — every class with enrolment this year.
  async myReportClasses(schoolId: string, ayId: string, employeeId: string, isOverride: boolean): Promise<any[]> {
    await this.ensureSchemes(schoolId, ayId, employeeId);
    const schemes = await DB.query(
      singleLineString`select applies_to_grades from exam_report_scheme where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ayId],
    );
    const covered = new Set<string>(schemes.flatMap((s: any) => String(s.appliesToGrades || "").split(",").map((g: string) => g.trim())));
    const rows = isOverride
      ? await DB.query(
        singleLineString`select distinct sc.class_id, c.name as class_name, c.seq
          from student_class sc join class c on c.uuid = sc.class_id and c.school_id = sc.school_id and c.base_class_id is null
          join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status = 'active'
          where sc.school_id = $1 and sc.academic_year_id = $2 and (sc.status is null or sc.status <> 'deleted')
          order by c.seq asc nulls last, c.name`,
        [schoolId, ayId],
      )
      : await DB.query(
        singleLineString`select ct.class_id, c.name as class_name, c.seq
          from class_teacher ct join class c on c.uuid = ct.class_id and c.school_id = ct.school_id
          where ct.school_id = $1 and ct.academic_year_id = $2 and ct.teacher_id = $3 and ct.status = 'active'
          order by c.seq asc nulls last, c.name`,
        [schoolId, ayId, employeeId],
      );
    // Drop classes whose grade has no report scheme (junk/placeholder classes).
    return rows.filter((r: any) => covered.has(gradeOf(r.className)));
  }

  async isClassTeacher(schoolId: string, ayId: string, classId: string, employeeId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`select 1 from class_teacher where school_id = $1 and academic_year_id = $2 and class_id = $3 and teacher_id = $4 and status = 'active' limit 1`,
      [schoolId, ayId, classId, employeeId],
    );
    return rows.length > 0;
  }

  // The (class, subject) pairs a teacher may enter marks for — their syllabus offerings mapped
  // onto each class's report scheme.
  async mySubjects(schoolId: string, ayId: string, employeeId: string): Promise<any[]> {
    // Every explicit assignment for the year: whichever (class, subject) are pinned, and to whom.
    const explicit = await DB.query(
      singleLineString`select class_id, subject_code, teacher_id from exam_report_teacher where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ayId],
    );
    const explicitBy = new Map<string, string>(explicit.map((r: any) => [`${r.classId}|${r.subjectCode}`, r.teacherId]));

    const out: any[] = [];
    const seen = new Set<string>();
    const add = async (classId: string, subjectCode: string) => {
      const key = `${classId}|${subjectCode}`;
      if (seen.has(key)) return;
      const scheme = await this.schemeForClass(schoolId, ayId, classId, employeeId);
      if (!scheme) return;
      const subj = (await this.schemeSubjects(scheme.uuid)).find((s: any) => s.code === subjectCode);
      if (!subj) return;
      seen.add(key);
      out.push({ classId, className: scheme.className, subjectCode, reportLabel: subj.reportLabel, schemeId: scheme.uuid, band: scheme.band });
    };

    // 1) Subjects explicitly assigned to me — these hold even without a syllabus offering.
    for (const r of explicit as any[]) if (r.teacherId === employeeId) await add(r.classId, r.subjectCode);

    // 2) Syllabus-derived subjects — but skip any (class, subject) explicitly claimed by someone else.
    const syl = await DB.query(
      singleLineString`select distinct pt.class_id, c.name as class_name, ss.name as syllabus_subject
        from syllabus_plan_teacher pt
        join syllabus sy on sy.uuid = pt.syllabus_id and sy.status = 'active' and sy.academic_year_id = $2
        join syllabus_subject ss on ss.uuid = sy.subject_id and ss.status = 'active'
        join class c on c.uuid = pt.class_id and c.school_id = pt.school_id
        where pt.school_id = $1 and pt.teacher_id = $3 and pt.status = 'active'
        order by c.name`,
      [schoolId, ayId, employeeId],
    );
    for (const r of syl as any[]) {
      const scheme = await this.schemeForClass(schoolId, ayId, r.classId, employeeId);
      if (!scheme) continue;
      const target = String(r.syllabusSubject || "").trim().toLowerCase();
      const match = (await this.schemeSubjects(scheme.uuid)).find((s: any) => this.syllabusNames(s.syllabusSubject).includes(target));
      if (!match) continue;
      const claimed = explicitBy.get(`${r.classId}|${match.code}`);
      if (claimed && claimed !== employeeId) continue; // someone else owns this subject explicitly
      await add(r.classId, match.code);
    }
    return out;
  }

  // ── Subject mapping (exam-incharge) ─────────────────────────────────────────────────
  // Per class: each report subject, the syllabus subjects it draws from, the syllabus-derived
  // teacher(s), and the currently-effective teacher (an explicit assignment wins over syllabus).
  async subjectMapping(schoolId: string, ayId: string, classId: string, userId: string): Promise<any> {
    const scheme = await this.schemeForClass(schoolId, ayId, classId, userId);
    if (!scheme) throw new BusinessErrorResult(ErrorCode.BusinessError, "No report scheme for this class");
    const subjects = await this.schemeSubjects(scheme.uuid);
    const out: any[] = [];
    for (const subj of subjects) {
      const assignedId = await this.explicitTeacherId(schoolId, ayId, classId, subj.code);
      const assignedName = assignedId ? await this.empName(schoolId, assignedId) : null;
      const sylTeachers = await this.syllabusTeachersFor(schoolId, ayId, classId, subj.syllabusSubject);
      out.push({
        subjectCode: subj.code, reportLabel: subj.reportLabel,
        syllabusSubjects: this.syllabusNames(subj.syllabusSubject).length ? String(subj.syllabusSubject) : null,
        syllabusTeachers: sylTeachers,
        assignedTeacherId: assignedId, assignedTeacherName: assignedName,
        effectiveTeacher: assignedName || sylTeachers[0]?.name || null,
        source: assignedId ? "assigned" : (sylTeachers.length ? "syllabus" : "none"),
      });
    }
    return { className: scheme.className, band: scheme.band, subjects: out };
  }

  private async empName(schoolId: string, employeeId: string): Promise<string | null> {
    const r = await DB.query(singleLineString`select name from employee where uuid = $1 and school_id = $2`, [employeeId, schoolId]);
    return r.length ? r[0].name : null;
  }

  // Assign (or clear) the explicit teacher for a (class, subject). Empty teacherId reverts to syllabus.
  async assignSubjectTeacher(schoolId: string, ayId: string, classId: string, subjectCode: string, teacherId: string, userId: string): Promise<any> {
    const scheme = await this.schemeForClass(schoolId, ayId, classId, userId);
    if (!scheme) throw new BusinessErrorResult(ErrorCode.BusinessError, "No report scheme for this class");
    if (!(await this.schemeSubjects(scheme.uuid)).some((s: any) => s.code === subjectCode)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Subject not in this class's scheme");
    }
    const now = new Date();
    await DB.query(
      singleLineString`update exam_report_teacher set status = 'deleted', updatedby_userid = $4, updated_at = $5 where school_id = $1 and academic_year_id = $2 and class_id = $3 and subject_code = $6 and status = 'active'`,
      [schoolId, ayId, classId, userId, now, subjectCode],
    );
    if (teacherId && teacherId.trim()) {
      await DB.query(
        singleLineString`insert into exam_report_teacher (uuid, school_id, academic_year_id, class_id, subject_code, teacher_id, status, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,'active',$7,$8)`,
        [generateShortUuid(12), schoolId, ayId, classId, subjectCode, teacherId.trim(), userId, now],
      );
    }
    return this.subjectMapping(schoolId, ayId, classId, userId);
  }

  // Whether a caller may view/enter a (class, subject) — the assigned syllabus teacher, or
  // god/exam-incharge override.
  async canEnterSubject(schoolId: string, ayId: string, classId: string, subjectCode: string, employeeId: string, isOverride: boolean): Promise<boolean> {
    if (isOverride) return true;
    const scheme = await this.schemeForClass(schoolId, ayId, classId, employeeId);
    if (!scheme) return false;
    const subjects = await this.schemeSubjects(scheme.uuid);
    const subject = subjects.find((s: any) => s.code === subjectCode);
    if (!subject) return false;
    return this.canTeach(schoolId, ayId, classId, subjectCode, subject.syllabusSubject, employeeId);
  }

  // ── Marks entry ────────────────────────────────────────────────────────────────────
  async marksGrid(schoolId: string, ayId: string, classId: string, subjectCode: string, term: number, userId: string): Promise<any> {
    const scheme = await this.schemeForClass(schoolId, ayId, classId, userId);
    if (!scheme) throw new BusinessErrorResult(ErrorCode.BusinessError, "No report scheme for this class");
    const subjects = await this.schemeSubjects(scheme.uuid);
    const subject = subjects.find((s: any) => s.code === subjectCode);
    if (!subject) throw new BusinessErrorResult(ErrorCode.BusinessError, "Subject not in this class's scheme");
    const components = await this.schemeComponents(scheme.uuid, term);
    const students = await this.classStudents(schoolId, ayId, classId);
    const marks = await DB.query(
      singleLineString`select student_id, component_code, value from exam_report_mark
        where school_id = $1 and academic_year_id = $2 and term = $3 and class_id = $4 and subject_code = $5`,
      [schoolId, ayId, term, classId, subjectCode],
    );
    const map = new Map<string, number>();
    for (const m of marks) map.set(`${m.studentId}|${m.componentCode}`, m.value);
    const rows = students.map((s: any) => ({
      studentId: s.studentId, name: s.name, admissionNumber: s.admissionNumber, rollNumber: s.rollNumber,
      marks: Object.fromEntries(components.map((c: any) => [c.code, map.has(`${s.studentId}|${c.code}`) ? Number(map.get(`${s.studentId}|${c.code}`)) : null])),
    }));
    return {
      className: scheme.className, subject: { code: subject.code, label: subject.reportLabel }, term,
      components: components.map((c: any) => ({ code: c.code, label: c.label, max: c.maxMarks })),
      students: rows,
      total: rows.length,
      entered: rows.filter((r: any) => components.every((c: any) => r.marks[c.code] != null)).length,
    };
  }

  async saveMarks(schoolId: string, ayId: string, classId: string, subjectCode: string, term: number, entries: any[], employeeId: string, isOverride: boolean): Promise<any> {
    const scheme = await this.schemeForClass(schoolId, ayId, classId, employeeId);
    if (!scheme) throw new BusinessErrorResult(ErrorCode.BusinessError, "No report scheme for this class");
    const subjects = await this.schemeSubjects(scheme.uuid);
    const subject = subjects.find((s: any) => s.code === subjectCode);
    if (!subject) throw new BusinessErrorResult(ErrorCode.BusinessError, "Subject not in this class's scheme");
    if (!isOverride && !(await this.canTeach(schoolId, ayId, classId, subjectCode, subject.syllabusSubject, employeeId))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "You are not the assigned teacher for this subject in this class");
    }
    const components = await this.schemeComponents(scheme.uuid, term);
    const maxByCode = new Map<string, number>(components.map((c: any) => [c.code, Number(c.maxMarks)]));
    if (!Array.isArray(entries)) throw new BusinessErrorResult(ErrorCode.BusinessError, "entries must be an array");
    const now = new Date();
    for (const e of entries) {
      const studentId = (e.studentId || "").trim();
      if (!studentId || !e.marks) continue;
      for (const code of Object.keys(e.marks)) {
        if (!maxByCode.has(code)) continue;
        const raw = e.marks[code];
        const val = raw === "" || raw == null ? null : Number(raw);
        if (val != null && (isNaN(val) || val < 0 || val > (maxByCode.get(code) as number))) {
          throw new BusinessErrorResult(ErrorCode.BusinessError, `Mark for ${code} must be 0–${maxByCode.get(code)}`);
        }
        const ex = await DB.query(
          singleLineString`select uuid from exam_report_mark where school_id = $1 and academic_year_id = $2 and term = $3 and student_id = $4 and subject_code = $5 and component_code = $6`,
          [schoolId, ayId, term, studentId, subjectCode, code],
        );
        if (ex.length) {
          await DB.query(
            singleLineString`update exam_report_mark set value = $2, class_id = $3, updatedby_userid = $4, updated_at = $5 where uuid = $1`,
            [ex[0].uuid, val, classId, employeeId, now],
          );
        } else if (val != null) {
          await DB.query(
            singleLineString`insert into exam_report_mark (uuid, school_id, academic_year_id, term, student_id, class_id, subject_code, component_code, value, createdby_userid, created_at)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [generateShortUuid(12), schoolId, ayId, term, studentId, classId, subjectCode, code, val, employeeId, now],
          );
        }
      }
    }
    return this.marksGrid(schoolId, ayId, classId, subjectCode, term, employeeId);
  }

  // ── Co-scholastic entry (class teacher) ─────────────────────────────────────────────
  async coscholasticGrid(schoolId: string, ayId: string, classId: string, term: number, userId: string): Promise<any> {
    const scheme = await this.schemeForClass(schoolId, ayId, classId, userId);
    if (!scheme) throw new BusinessErrorResult(ErrorCode.BusinessError, "No report scheme for this class");
    const areas = await DB.query(
      singleLineString`select uuid, section, label, scale_kind, value_type from exam_report_area where scheme_id = $1 and status = 'active' order by sort_order asc nulls last`,
      [scheme.uuid],
    );
    const scale = await DB.query(
      singleLineString`select grade, label from exam_report_grade_scale where scheme_id = $1 and kind = 'coscholastic' and status = 'active' order by sort_order asc nulls last`,
      [scheme.uuid],
    );
    const students = await this.classStudents(schoolId, ayId, classId);
    const grades = await DB.query(
      singleLineString`select student_id, area_id, grade, text_value from exam_report_area_grade
        where school_id = $1 and academic_year_id = $2 and term = $3 and class_id = $4`,
      [schoolId, ayId, term, classId],
    );
    const gmap = new Map<string, any>();
    for (const g of grades) gmap.set(`${g.studentId}|${g.areaId}`, g);
    const headers = await DB.query(
      singleLineString`select student_id, attendance_present, attendance_total, house, remark from exam_report
        where school_id = $1 and academic_year_id = $2 and term = $3 and class_id = $4 and status = 'active'`,
      [schoolId, ayId, term, classId],
    );
    const hmap = new Map<string, any>(headers.map((h: any) => [h.studentId, h]));
    const houses = await DB.query(singleLineString`select name from house where school_id = $1 and status = 'active' order by name`, [schoolId]);
    const att = await this.attendanceSummary(schoolId, ayId, classId);
    return {
      className: scheme.className, term,
      scale: scale.map((s: any) => ({ grade: s.grade, label: s.label })),
      houses: houses.map((h: any) => h.name),
      areas: areas.map((a: any) => ({ id: a.uuid, section: a.section, label: a.label, valueType: a.valueType })),
      students: students.map((s: any) => {
        const h: any = hmap.get(s.studentId) || {};
        // Prefill house from the student's lifelong assignment and attendance live from records;
        // a saved header value (the class teacher's own edit) always wins.
        return {
          studentId: s.studentId, name: s.name, admissionNumber: s.admissionNumber, rollNumber: s.rollNumber,
          attendancePresent: h.attendancePresent ?? (att.present.get(s.studentId) ?? 0),
          attendanceTotal: h.attendanceTotal ?? att.total,
          house: h.house ?? s.houseName ?? null, remark: h.remark ?? null,
          grades: Object.fromEntries(areas.map((a: any) => {
            const g: any = gmap.get(`${s.studentId}|${a.uuid}`);
            return [a.uuid, g ? (a.valueType === "text" ? g.textValue : g.grade) : null];
          })),
        };
      }),
    };
  }

  async saveCoscholastic(schoolId: string, ayId: string, classId: string, term: number, entries: any[], employeeId: string, isOverride: boolean): Promise<any> {
    const scheme = await this.schemeForClass(schoolId, ayId, classId, employeeId);
    if (!scheme) throw new BusinessErrorResult(ErrorCode.BusinessError, "No report scheme for this class");
    if (!isOverride && !(await this.isClassTeacher(schoolId, ayId, classId, employeeId))) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Only the class teacher can enter co-scholastic grades for this class");
    }
    const areas = await DB.query(
      singleLineString`select uuid, value_type from exam_report_area where scheme_id = $1 and status = 'active'`,
      [scheme.uuid],
    );
    const typeByArea = new Map<string, string>(areas.map((a: any) => [a.uuid, a.valueType]));
    const now = new Date();
    for (const e of entries || []) {
      const studentId = (e.studentId || "").trim();
      if (!studentId) continue;
      // Header fields (attendance / house / remark) upsert.
      if (e.attendancePresent !== undefined || e.attendanceTotal !== undefined || e.house !== undefined || e.remark !== undefined) {
        await this.upsertHeader(schoolId, ayId, term, studentId, classId, e, employeeId, now);
      }
      for (const areaId of Object.keys(e.grades || {})) {
        if (!typeByArea.has(areaId)) continue;
        const isText = typeByArea.get(areaId) === "text";
        const raw = e.grades[areaId];
        const grade = isText ? null : (raw || null);
        const textValue = isText ? (raw || null) : null;
        const ex = await DB.query(
          singleLineString`select uuid from exam_report_area_grade where school_id = $1 and academic_year_id = $2 and term = $3 and student_id = $4 and area_id = $5`,
          [schoolId, ayId, term, studentId, areaId],
        );
        if (ex.length) {
          await DB.query(
            singleLineString`update exam_report_area_grade set grade = $2, text_value = $3, class_id = $4, updatedby_userid = $5, updated_at = $6 where uuid = $1`,
            [ex[0].uuid, grade, textValue, classId, employeeId, now],
          );
        } else if (grade != null || textValue != null) {
          await DB.query(
            singleLineString`insert into exam_report_area_grade (uuid, school_id, academic_year_id, term, student_id, class_id, area_id, grade, text_value, createdby_userid, created_at)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [generateShortUuid(12), schoolId, ayId, term, studentId, classId, areaId, grade, textValue, employeeId, now],
          );
        }
      }
    }
    return this.coscholasticGrid(schoolId, ayId, classId, term, employeeId);
  }

  private async upsertHeader(schoolId: string, ayId: string, term: number, studentId: string, classId: string, e: any, userId: string, now: Date): Promise<void> {
    const ex = await DB.query(
      singleLineString`select uuid from exam_report where school_id = $1 and academic_year_id = $2 and term = $3 and student_id = $4 and status = 'active'`,
      [schoolId, ayId, term, studentId],
    );
    const present = e.attendancePresent === "" || e.attendancePresent == null ? null : Number(e.attendancePresent);
    const total = e.attendanceTotal === "" || e.attendanceTotal == null ? null : Number(e.attendanceTotal);
    if (ex.length) {
      await DB.query(
        singleLineString`update exam_report set attendance_present = $2, attendance_total = $3, house = $4, remark = $5, class_id = $6, updatedby_userid = $7, updated_at = $8 where uuid = $1`,
        [ex[0].uuid, present, total, e.house ?? null, e.remark ?? null, classId, userId, now],
      );
    } else {
      await DB.query(
        singleLineString`insert into exam_report (uuid, school_id, academic_year_id, term, student_id, class_id, attendance_present, attendance_total, house, remark, status, createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12)`,
        [generateShortUuid(12), schoolId, ayId, term, studentId, classId, present, total, e.house ?? null, e.remark ?? null, userId, now],
      );
    }
  }

  // ── Incharge progress dashboard ─────────────────────────────────────────────────────
  // Per class × subject: how many students have all of that subject's components filled, out
  // of the class roster. Drives the "chase list" before the entry deadline.
  async progress(schoolId: string, ayId: string, term: number, userId: string): Promise<any> {
    await this.ensureSchemes(schoolId, ayId, userId);
    // Classes that have a scheme = classes with an active student_class enrolment this year.
    const classes = await DB.query(
      singleLineString`select distinct sc.class_id, c.name as class_name, c.seq
        from student_class sc join class c on c.uuid = sc.class_id and c.school_id = sc.school_id and c.base_class_id is null
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status = 'active'
        where sc.school_id = $1 and sc.academic_year_id = $2 and (sc.status is null or sc.status <> 'deleted')
        order by c.seq asc nulls last, c.name`,
      [schoolId, ayId],
    );
    const out: any[] = [];
    let doneSubjects = 0, totalSubjects = 0;
    for (const c of classes) {
      const scheme = await this.schemeForClass(schoolId, ayId, c.classId, userId);
      if (!scheme) continue;
      const subjects = await this.schemeSubjects(scheme.uuid);
      const components = await this.schemeComponents(scheme.uuid, term);
      const students = await this.classStudents(schoolId, ayId, c.classId);
      const marks = await DB.query(
        singleLineString`select student_id, subject_code, component_code from exam_report_mark
          where school_id = $1 and academic_year_id = $2 and term = $3 and class_id = $4`,
        [schoolId, ayId, term, c.classId],
      );
      const filled = new Set<string>(marks.map((m: any) => `${m.studentId}|${m.subjectCode}|${m.componentCode}`));
      const subjRows = subjects.map((subj: any) => {
        const complete = students.filter((s: any) => components.every((comp: any) => filled.has(`${s.studentId}|${subj.code}|${comp.code}`))).length;
        const done = students.length > 0 && complete === students.length;
        totalSubjects++; if (done) doneSubjects++;
        return { subjectCode: subj.code, label: subj.reportLabel, complete, total: students.length, done };
      });
      out.push({ classId: c.classId, className: c.className, band: scheme.band, total: students.length, subjects: subjRows,
        doneCount: subjRows.filter((x: any) => x.done).length, subjectCount: subjRows.length });
    }
    return { term, classes: out, pctEntered: totalSubjects ? Math.round((doneSubjects / totalSubjects) * 100) : 0, pendingSubjects: totalSubjects - doneSubjects };
  }
}

export const reportService = new ReportService();
