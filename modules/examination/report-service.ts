import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { gradeOf } from "./examination-common";
import { fileStorageService } from "../../shared/lib/file-storage";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// ── Report cards (Term-1 marks + co-scholastic). Data-driven: a per-(school, AY, band)
// scheme is the blueprint; student values reference it by stable codes. See examination-setup.sql.

// A co-scholastic area entry: a pre-primary direct-grade area (string), a free-text area
// ([label,"text"]), or a MARKS area (object) — max = out-of, scale = which grade table, denom =
// the "out of" is entered per class at marking time (GA / Reasoning / Value Education).
type MarksArea = { label: string; max: number; scale: "coscholastic" | "coscholastic10"; denom?: boolean };
type AreaEntry = string | [string, "text"] | MarksArea;
type Band = {
  band: string;
  name: string;
  grades: string; // csv of grade prefixes
  components: Record<number, [string, string, number][]>; // term -> [code, label, max][]
  subjects: [string, string, string, string?][]; // [code, reportLabel, syllabusSubject, appliesToGrades?]
  areas: Record<string, AreaEntry[]>; // section -> entries[]
  scholastic?: [string, string, number, number][]; // default = SCHOLASTIC_SCALE; [] = none (pre-primary)
  coscholastic?: [string, string][]; // default = COSCHOLASTIC_SCALE
};

const SCHOLASTIC_SCALE: [string, string, number, number][] = [
  ["A1", "Outstanding", 91, 100], ["A2", "Excellent", 81, 90], ["B1", "Very Good", 71, 80],
  ["B2", "Good", 61, 70], ["C1", "Fair", 51, 60], ["C2", "Scope for Improvement", 41, 50],
  ["D", "Need to work very hard", 33, 40], ["E", "Should upgrade to meet the minimum requirement", 0, 32],
];
// Co-scholastic is marks-based. Two internal scales, both A/B/C/D:
//   coscholastic   — used by the /100 areas (GA, Reasoning, Value Education, Art & Craft/Education);
//                    grade from the PERCENT (marks ÷ max × 100). THIS is the legend printed on the card.
//   coscholastic10 — used by the /10 areas (everything else); grade from the RAW mark (1–10).
//                    Internal only — never printed on the card.
const COSCHOLASTIC_SCALE: [string, string, number, number][] = [
  ["A", "Excellent", 85, 100], ["B", "Very Good", 70, 84], ["C", "Good", 55, 69], ["D", "Fair", 0, 54],
];
const COSCHOLASTIC10_SCALE: [string, string, number, number][] = [
  ["A", "Excellent", 9, 10], ["B", "Very Good", 7, 8], ["C", "Good", 5, 6], ["D", "Fair", 1, 4],
];
// Pre-primary uses a finer grade scale (with +'s) and no numeric marks.
const PREPRIMARY_SCALE: [string, string][] = [
  ["A+", "Outstanding"], ["A", "Excellent"], ["B+", "Very Good"], ["B", "Good"], ["C", "Fair"], ["D", "Scope of Improvement"],
];

// Marks-area builders: m10 = out of 10 (10-point table); m100 = out of 100 (percent table, fixed);
// mDen = out of 100 (percent table) but the denominator is entered per class at marking time.
const m10 = (label: string): MarksArea => ({ label, max: 10, scale: "coscholastic10" });
const m100 = (label: string): MarksArea => ({ label, max: 100, scale: "coscholastic" });
const mDen = (label: string): MarksArea => ({ label, max: 100, scale: "coscholastic", denom: true });

// Co-scholastic / personality / other areas shared by bands 1-2, 3 and 4-5. GA/Reasoning/Value
// Education carry a per-class denominator; Art and Craft is /100 fixed; everything else is /10.
const JUNIOR_AREAS: Record<string, AreaEntry[]> = {
  "Co-Scholastic": [mDen("General Awareness"), mDen("Reasoning"), mDen("Value Education"), m100("Art and Craft"), m10("Games"), m10("Music"), m10("Dance"), m10("English Conversation")],
  "Personality Development": [m10("Courteousness"), m10("Confidence"), m10("Sense of Responsibility"), m10("Initiative"), m10("Sharing & Caring"), m10("Neatness")],
  "Other Areas": [m10("Discipline"), m10("Value Systems"), m10("Social Skills"), m10("Scientific Skills"), m10("Thinking Skills"), m10("Emotional Skills")],
};
// 6-8: Work Education/Physical Education /10, Art Education /100, GA/Reasoning/Value Education per-class.
const SENIOR_AREAS_68: Record<string, AreaEntry[]> = {
  "Co Scholastic Areas": [m10("Work Education"), mDen("Value Education"), mDen("General Awareness"), mDen("Reasoning"), m100("Art Education"), m10("Physical Education")],
  "Other Areas": [m10("Discipline"), m10("English Conversation"), m10("Value System"), m10("Performing Art"), m10("Sports & Games")],
};
// 9: same as 6-8 but WITHOUT General Awareness/Reasoning and Value Education.
const SENIOR_AREAS_9: Record<string, AreaEntry[]> = {
  "Co Scholastic Areas": [m10("Work Education"), m100("Art Education"), m10("Physical Education")],
  "Other Areas": [m10("Discipline"), m10("English Conversation"), m10("Value System"), m10("Performing Art"), m10("Sports & Games")],
};

// Grade-band structure (school-specific). Each scheme = one distinct (subjects × mark-columns)
// combination: 1-2 (EVS, junior 7-col), 3 alone (Science/Social Studies subjects but still the
// junior 7-col), 4-5 (same subjects, 5-col), 6-8 (Sanskrit in), 9 (Computer→IT, no Sanskrit).
const JUNIOR_7COL = {
  1: [["PT1", "PT-I", 10], ["CT1", "Class Test", 10], ["NB1", "NB-I", 5], ["SEA1", "SEA", 5], ["CP1", "Class Perf", 10], ["ORAL1", "Oral", 10], ["HY", "Half Yearly", 50]],
  2: [["PT2", "PT-II", 10], ["CT2", "Class Test", 10], ["NB2", "NB-II", 5], ["SEA2", "SEA", 5], ["CP2", "Class Perf", 10], ["ORAL2", "Oral", 10], ["ANNUAL", "Annual Exam", 50]],
} as Record<number, [string, string, number][]>;
const SENIOR_4COL = {
  1: [["PT1", "PT-I", 10], ["NB1", "NB-I", 5], ["SEA1", "SEA", 5], ["HY", "Half Yearly", 80]],
  2: [["PT2", "PT-II", 10], ["NB2", "NB-II", 5], ["SEA2", "SEA", 5], ["ANNUAL", "Annual Exam", 80]],
} as Record<number, [string, string, number][]>;
const MIDDLE_SUBJECTS: [string, string, string, string?][] = [["ENG", "English", "English,English I"], ["HIN", "Hindi", "Hindi,Hindi I"], ["MATH", "Mathematics", "Mathematics"], ["SCI", "Science", "Science"], ["SST", "Social Studies", "Social Studies"], ["COMP", "Computer Science", "Computer"]];
const BANDS: Band[] = [
  {
    band: "1-2", name: "Achievement Record · 1-2", grades: "I,II",
    components: JUNIOR_7COL,
    subjects: [["ENG", "English", "English,English I"], ["HIN", "Hindi", "Hindi,Hindi I"], ["MATH", "Mathematics", "Mathematics"], ["EVS", "EVS", "Environmental Science"], ["COMP", "Computer Science", "Computer"]],
    areas: JUNIOR_AREAS,
  },
  {
    // Class 3 alone: the 4-5 subject set (Science + Social Studies) on the junior 7-column
    // structure — fits neither 1-2 (different subjects) nor 4-5 (different columns).
    band: "3", name: "Achievement Record · 3", grades: "III",
    components: JUNIOR_7COL,
    subjects: MIDDLE_SUBJECTS,
    areas: JUNIOR_AREAS,
  },
  {
    band: "4-5", name: "Achievement Record · 4-5", grades: "IV,V",
    components: {
      1: [["PT1", "PT-I", 10], ["CT1", "Class Test", 10], ["NB1", "NB-I", 5], ["SEA1", "SEA", 5], ["HY", "Half Yearly", 70]],
      2: [["PT2", "PT-II", 10], ["CT2", "Class Test", 10], ["NB2", "NB-II", 5], ["SEA2", "SEA", 5], ["ANNUAL", "Annual Exam", 70]],
    },
    subjects: MIDDLE_SUBJECTS,
    areas: JUNIOR_AREAS,
  },
  {
    band: "6-8", name: "Achievement Record · 6-8", grades: "VI,VII,VIII",
    components: SENIOR_4COL,
    subjects: [["ENG", "English", "English,English I"], ["HIN", "Hindi", "Hindi,Hindi I"], ["SANS", "Sanskrit", "Sanskrit"], ["MATH", "Mathematics", "Mathematics"], ["SCI", "Science", "Science"], ["SST", "Social Science", "Social Science,Social Science (Part 1),Social Studies"], ["COMP", "Computer Science", "Computer"]],
    areas: SENIOR_AREAS_68,
  },
  {
    band: "9", name: "Achievement Record · 9", grades: "IX",
    components: SENIOR_4COL,
    subjects: [["ENG", "English", "English,English I"], ["HIN", "Hindi", "Hindi,Hindi I"], ["MATH", "Mathematics", "Mathematics"], ["SCI", "Science", "Science"], ["SST", "Social Science", "Social Science,Social Science (Part 1),Social Studies"], ["COMP", "IT", "Computer"]],
    areas: SENIOR_AREAS_9,
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
      for (const [code, label, syl, grades] of b.subjects) {
        await DB.query(
          singleLineString`insert into exam_report_subject (uuid, school_id, academic_year_id, scheme_id, code, report_label, syllabus_subject, applies_to_grades, sort_order, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$11)`,
          [generateShortUuid(12), schoolId, ayId, schemeId, code, label, syl, grades || null, ssort++, userId, now],
        );
      }
      // sort_order runs CONTINUOUSLY across sections (not reset per section) so the sections stay
      // grouped when ordered globally — otherwise every section's item-0 sorts together, etc.
      let asort = 0;
      for (const section of Object.keys(b.areas)) {
        for (const entry of b.areas[section]) {
          let label: string, valueType: string, scaleKind = "coscholastic", max: number | null = null, denom: number | null = null;
          if (typeof entry === "string") { label = entry; valueType = "grade"; }            // pre-primary direct grade
          else if (Array.isArray(entry)) { label = entry[0]; valueType = entry[1]; }         // free-text
          else { label = entry.label; valueType = "marks"; scaleKind = entry.scale; max = entry.max; denom = entry.denom ? 1 : null; }
          await DB.query(
            singleLineString`insert into exam_report_area (uuid, school_id, academic_year_id, scheme_id, section, label, scale_kind, value_type, max_marks, denominator_editable, sort_order, status, createdby_userid, created_at)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$13)`,
            [generateShortUuid(12), schoolId, ayId, schemeId, section, label, scaleKind, valueType, max, denom, asort++, userId, now],
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
      const coschRow = async (kind: string, grade: string, label: string, min: number | null, max: number | null, sort: number) =>
        DB.query(
          singleLineString`insert into exam_report_grade_scale (uuid, school_id, academic_year_id, scheme_id, kind, grade, label, min_pct, max_pct, sort_order, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'active',$11,$12)`,
          [generateShortUuid(12), schoolId, ayId, schemeId, kind, grade, label, min, max, sort, userId, now],
        );
      if (b.band === "pre-primary") {
        // pre-primary areas are direct-grade (A+..D), no marks → one scale, no thresholds.
        gsort = 0;
        for (const [grade, label] of (b.coscholastic ?? PREPRIMARY_SCALE)) await coschRow("coscholastic", grade, label, null, null, gsort++);
      } else {
        // marks model: the /100 percent scale (printed on the card) + the internal /10 scale.
        gsort = 0;
        for (const [grade, label, min, max] of COSCHOLASTIC_SCALE) await coschRow("coscholastic", grade, label, min, max, gsort++);
        gsort = 0;
        for (const [grade, label, min, max] of COSCHOLASTIC10_SCALE) await coschRow("coscholastic10", grade, label, min, max, gsort++);
      }
    }
  }

  // The active scheme for a class (resolved by its grade prefix). Seeds on first use.
  async schemeForClass(schoolId: string, ayId: string, classId: string, userId: string): Promise<any | null> {
    await this.ensureSchemes(schoolId, ayId, userId);
    const cls = await this.classInfo(schoolId, classId);
    if (!cls) return null;
    const grade = gradeOf(cls.name).toLowerCase();
    const rows = await DB.query(
      singleLineString`select uuid, band, name, applies_to_grades from exam_report_scheme where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ayId],
    );
    for (const s of rows) {
      // Case-insensitive: a class may be "NURSERY-A" while the scheme lists "Nursery".
      const grades = String(s.appliesToGrades || "").split(",").map((g: string) => g.trim().toLowerCase());
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
      singleLineString`select code, report_label, syllabus_subject, applies_to_grades from exam_report_subject where scheme_id = $1 and status = 'active' order by sort_order asc nulls last`,
      [schemeId],
    );
  }

  // A subject with a grade scope (applies_to_grades) shows only for those grades; blank = all
  // grades in the band. gradeLower is the class's grade, lowercased.
  private subjectInGrade(subj: any, gradeLower: string): boolean {
    const scope = String(subj.appliesToGrades || "").trim();
    if (!scope) return true;
    return scope.split(",").map((g) => g.trim().toLowerCase()).includes(gradeLower);
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
    const covered = new Set<string>(schemes.flatMap((s: any) => String(s.appliesToGrades || "").split(",").map((g: string) => g.trim().toLowerCase())));
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
    // Drop classes whose grade has no report scheme (junk/placeholder classes). Case-insensitive
    // so "NURSERY-A" matches a scheme listing "Nursery".
    return rows.filter((r: any) => covered.has(gradeOf(r.className).toLowerCase()));
  }

  // Every class that has a report scheme (seq-ordered) — the Report Cards surface for the
  // incharge/admin/god, who print for any class (not scoped to class-teacher assignment).
  async schemeClasses(schoolId: string, ayId: string, userId: string): Promise<any[]> {
    await this.ensureSchemes(schoolId, ayId, userId);
    const schemes = await DB.query(
      singleLineString`select applies_to_grades from exam_report_scheme where school_id = $1 and academic_year_id = $2 and status = 'active'`,
      [schoolId, ayId],
    );
    const covered = new Set<string>(schemes.flatMap((s: any) => String(s.appliesToGrades || "").split(",").map((g: string) => g.trim().toLowerCase())));
    const rows = await DB.query(
      singleLineString`select distinct sc.class_id, c.name as class_name, c.seq
        from student_class sc join class c on c.uuid = sc.class_id and c.school_id = sc.school_id and c.base_class_id is null
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status = 'active'
        where sc.school_id = $1 and sc.academic_year_id = $2 and (sc.status is null or sc.status <> 'deleted')
        order by c.seq asc nulls last, c.name`,
      [schoolId, ayId],
    );
    return rows.filter((r: any) => covered.has(gradeOf(r.className).toLowerCase()));
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
    // Order by grade sequence (class.seq) — not class name, which sorts Roman numerals wrongly
    // (I, II, III, IV, IX, V, …). Fall back to name, then subject label.
    const seqRows = await DB.query(singleLineString`select uuid, seq from class where school_id = $1`, [schoolId]);
    const seqOf = new Map<string, number>(seqRows.map((r: any) => [r.uuid, r.seq == null ? 9999 : Number(r.seq)]));
    out.sort((a, b) => (seqOf.get(a.classId) ?? 9999) - (seqOf.get(b.classId) ?? 9999)
      || String(a.className).localeCompare(String(b.className))
      || String(a.reportLabel).localeCompare(String(b.reportLabel)));
    return out;
  }

  // ── Subject mapping (exam-incharge) ─────────────────────────────────────────────────
  // Per class: each report subject, the syllabus subjects it draws from, the syllabus-derived
  // teacher(s), and the currently-effective teacher (an explicit assignment wins over syllabus).
  async subjectMapping(schoolId: string, ayId: string, classId: string, userId: string): Promise<any> {
    const scheme = await this.schemeForClass(schoolId, ayId, classId, userId);
    if (!scheme) throw new BusinessErrorResult(ErrorCode.BusinessError, "No report scheme for this class");
    const grade = gradeOf(scheme.className).toLowerCase();
    const subjects = (await this.schemeSubjects(scheme.uuid)).filter((s: any) => this.subjectInGrade(s, grade));
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

  // ── Format config (Phase B.2): edit a scheme's labels/columns/areas/scale ───────────
  // EDIT-only (update existing rows by uuid). Codes stay fixed — marks reference component_code
  // + subject_code, and area grades reference the area uuid — so changing a label/max/range/etc.
  // never orphans a value. (Add/remove/reorder is a later pass.)
  async getScheme(schoolId: string, ayId: string, band: string, userId: string): Promise<any> {
    await this.ensureSchemes(schoolId, ayId, userId);
    const sc = await DB.query(
      singleLineString`select uuid, band, name, applies_to_grades from exam_report_scheme where school_id = $1 and academic_year_id = $2 and band = $3 and status = 'active' limit 1`,
      [schoolId, ayId, band],
    );
    if (!sc.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "No scheme for that band");
    const s = sc[0];
    const [components, subjects, areas, gradeScales] = await Promise.all([
      DB.query(singleLineString`select uuid, term, code, label, max_marks, sort_order from exam_report_component where scheme_id = $1 and status = 'active' order by term, sort_order asc nulls last`, [s.uuid]),
      DB.query(singleLineString`select uuid, code, report_label, syllabus_subject, applies_to_grades, sort_order from exam_report_subject where scheme_id = $1 and status = 'active' order by sort_order asc nulls last`, [s.uuid]),
      DB.query(singleLineString`select uuid, section, label, value_type, scale_kind, max_marks, denominator_editable, sort_order from exam_report_area where scheme_id = $1 and status = 'active' order by sort_order asc nulls last`, [s.uuid]),
      DB.query(singleLineString`select uuid, kind, grade, label, min_pct, max_pct, sort_order from exam_report_grade_scale where scheme_id = $1 and status = 'active' order by kind, sort_order asc nulls last`, [s.uuid]),
    ]);
    return { scheme: { uuid: s.uuid, band: s.band, name: s.name, appliesToGrades: s.appliesToGrades }, components, subjects, areas, gradeScales };
  }

  async saveScheme(schoolId: string, ayId: string, band: string, payload: any, userId: string): Promise<any> {
    const sc = await DB.query(
      singleLineString`select uuid from exam_report_scheme where school_id = $1 and academic_year_id = $2 and band = $3 and status = 'active' limit 1`,
      [schoolId, ayId, band],
    );
    if (!sc.length) throw new BusinessErrorResult(ErrorCode.BusinessError, "No scheme for that band");
    const schemeId = sc[0].uuid;
    const now = new Date();
    for (const c of payload.components || []) {
      if (!c.uuid) continue;
      await DB.query(singleLineString`update exam_report_component set label = $2, max_marks = $3, updatedby_userid = $4, updated_at = $5 where uuid = $1 and scheme_id = $6 and status = 'active'`,
        [c.uuid, String(c.label || "").slice(0, 64), Number(c.maxMarks) || 0, userId, now, schemeId]);
    }
    for (const s of payload.subjects || []) {
      if (!s.uuid) continue;
      const ssort = typeof s.sortOrder === "number" ? s.sortOrder : null; // reorder support
      await DB.query(singleLineString`update exam_report_subject set report_label = $2, syllabus_subject = $3, applies_to_grades = $4, sort_order = coalesce($5, sort_order), updatedby_userid = $6, updated_at = $7 where uuid = $1 and scheme_id = $8 and status = 'active'`,
        [s.uuid, String(s.reportLabel || "").slice(0, 64), s.syllabusSubject ? String(s.syllabusSubject).slice(0, 128) : null, s.appliesToGrades ? String(s.appliesToGrades).slice(0, 64) : null, ssort, userId, now, schemeId]);
    }
    for (const a of payload.areas || []) {
      if (!a.uuid) continue;
      const asort = typeof a.sortOrder === "number" ? a.sortOrder : null; // reorder support
      const amax = a.max === "" || a.max == null ? null : Number(a.max); // co-scholastic out-of
      const adenom = a.denomEditable ? 1 : null;
      await DB.query(singleLineString`update exam_report_area set section = $2, label = $3, max_marks = $4, denominator_editable = $5, sort_order = coalesce($6, sort_order), updatedby_userid = $7, updated_at = $8 where uuid = $1 and scheme_id = $9 and status = 'active'`,
        [a.uuid, String(a.section || "").slice(0, 48), String(a.label || "").slice(0, 128), amax, adenom, asort, userId, now, schemeId]);
    }
    for (const g of payload.gradeScales || []) {
      if (!g.uuid) continue;
      const min = g.minPct === "" || g.minPct == null ? null : Number(g.minPct);
      const max = g.maxPct === "" || g.maxPct == null ? null : Number(g.maxPct);
      await DB.query(singleLineString`update exam_report_grade_scale set label = $2, min_pct = $3, max_pct = $4, updatedby_userid = $5, updated_at = $6 where uuid = $1 and scheme_id = $7 and status = 'active'`,
        [g.uuid, String(g.label || "").slice(0, 64), min, max, userId, now, schemeId]);
    }
    if (payload.appliesToGrades !== undefined || payload.name !== undefined) {
      await DB.query(singleLineString`update exam_report_scheme set applies_to_grades = coalesce($2, applies_to_grades), name = coalesce($3, name), updatedby_userid = $4, updated_at = $5 where uuid = $1`,
        [schemeId, payload.appliesToGrades ?? null, payload.name ?? null, userId, now]);
    }
    return this.getScheme(schoolId, ayId, band, userId);
  }

  // ── Report config (term-2 start → default term) ─────────────────────────────────────
  async getConfig(schoolId: string, ayId: string): Promise<{ term2StartsOn: string | null; remarkRequiredFinal: boolean }> {
    const r = await DB.query(
      singleLineString`select to_char(term2_starts_on, 'YYYY-MM-DD') as term2_starts_on, remark_required_final from exam_report_config where school_id = $1 and academic_year_id = $2`,
      [schoolId, ayId],
    );
    return { term2StartsOn: r.length ? r[0].term2StartsOn : null, remarkRequiredFinal: r.length ? r[0].remarkRequiredFinal === 1 : false };
  }

  // The default term for today: before term2_starts_on → 1, on/after → 2 (blank → 1). Not hard-coded.
  async currentTerm(schoolId: string, ayId: string): Promise<number> {
    const { term2StartsOn } = await this.getConfig(schoolId, ayId);
    if (!term2StartsOn) return 1;
    const today = new Date().toISOString().slice(0, 10);
    return today >= term2StartsOn ? 2 : 1;
  }

  async setConfig(schoolId: string, ayId: string, cfg: { term2StartsOn?: string | null; remarkRequiredFinal?: boolean }, userId: string): Promise<any> {
    const val = cfg.term2StartsOn && /^\d{4}-\d{2}-\d{2}$/.test(cfg.term2StartsOn) ? cfg.term2StartsOn : null;
    const rrf = cfg.remarkRequiredFinal ? 1 : null;
    const now = new Date();
    const ex = await DB.query(singleLineString`select 1 from exam_report_config where school_id = $1 and academic_year_id = $2`, [schoolId, ayId]);
    if (ex.length) {
      await DB.query(singleLineString`update exam_report_config set term2_starts_on = $3, remark_required_final = $4, updatedby_userid = $5, updated_at = $6 where school_id = $1 and academic_year_id = $2`, [schoolId, ayId, val, rrf, userId, now]);
    } else {
      await DB.query(singleLineString`insert into exam_report_config (school_id, academic_year_id, term2_starts_on, remark_required_final, updatedby_userid, updated_at) values ($1,$2,$3,$4,$5,$6)`, [schoolId, ayId, val, rrf, userId, now]);
    }
    return { term2StartsOn: val, remarkRequiredFinal: !!rrf, currentTerm: await this.currentTerm(schoolId, ayId) };
  }

  // ── Printed report cards (Phase B) ──────────────────────────────────────────────────
  private matchScholastic(scale: any[], pct: number): string | null {
    const r = scale.find((s: any) => s.minPct != null && s.maxPct != null && pct >= Number(s.minPct) && pct <= Number(s.maxPct));
    return r ? r.grade : null;
  }

  private async brandingBlock(schoolId: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select school_name, motto, address, affiliation_no, school_code, contact, email, website,
          logo_file_id, board_logo_file_id, stamp_file_id from school_branding where school_id = $1`,
      [schoolId],
    );
    const b: any = rows[0] || {};
    const dataUri = async (fileId: string | null | undefined) => {
      if (!fileId) return null;
      try { const f = await fileStorageService.getWithData(fileId, schoolId); return f ? `data:${f.mimeType};base64,${f.data}` : null; } catch { return null; }
    };
    return {
      schoolName: b.schoolName || null, motto: b.motto || null, address: b.address || null,
      affiliationNo: b.affiliationNo || null, schoolCode: b.schoolCode || null,
      contact: b.contact || null, email: b.email || null, website: b.website || null,
      logoDataUri: await dataUri(b.logoFileId), boardLogoDataUri: await dataUri(b.boardLogoFileId), stampDataUri: await dataUri(b.stampFileId),
    };
  }

  // All the data to render a class's report cards for a term: scheme (columns/subjects/areas/
  // scales), branding masthead, and each student's header + marks + area grades + computed
  // subject totals/grades. exam.manage-only (incharge/admin/god) — enforced at the handler.
  async reportCards(schoolId: string, ayId: string, classId: string, term: number, userId: string): Promise<any> {
    const scheme = await this.schemeForClass(schoolId, ayId, classId, userId);
    if (!scheme) throw new BusinessErrorResult(ErrorCode.BusinessError, "No report scheme for this class");
    const components = await this.schemeComponents(scheme.uuid, term);
    const cardGrade = gradeOf(scheme.className).toLowerCase();
    const subjects = (await this.schemeSubjects(scheme.uuid)).filter((s: any) => this.subjectInGrade(s, cardGrade));
    const areas = await DB.query(
      singleLineString`select uuid, section, label, value_type, scale_kind, max_marks from exam_report_area where scheme_id = $1 and status = 'active' order by sort_order asc nulls last`,
      [scheme.uuid],
    );
    const scholScale = await DB.query(
      singleLineString`select grade, label, min_pct, max_pct from exam_report_grade_scale where scheme_id = $1 and kind = 'scholastic' and status = 'active' order by sort_order asc nulls last`,
      [scheme.uuid],
    );
    const scales = await this.coschScales(scheme.uuid); // .cosch (printed /100 legend) + .cosch10 (internal)
    const coschScale = scales.cosch;
    const branding = await this.brandingBlock(schoolId);
    const ayRow = await DB.query(singleLineString`select name from academic_year where uuid = $1`, [ayId]);
    const academicYear = ayRow[0]?.name || null;

    const students = await DB.query(
      singleLineString`select s.uuid as student_id, s.name, s.admission_number, s.dob, sc.roll_number,
          (select h.name from house h where h.uuid = s.house_id) as house_name,
          (select g.name from student_guardian g where g.student_id = s.uuid and g.relation = 'father' and g.status = 'active' limit 1) as father_name,
          (select g.name from student_guardian g where g.student_id = s.uuid and g.relation = 'mother' and g.status = 'active' limit 1) as mother_name,
          (select fs.uuid from file_storage fs where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id order by fs.created_at desc limit 1) as photo_file_id
        from student_class sc
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status = 'active'
        where sc.class_id = $1 and sc.academic_year_id = $2 and sc.school_id = $3 and (sc.status is null or sc.status <> 'deleted')
        order by sc.roll_number asc nulls last, s.name`,
      [classId, ayId, schoolId],
    );
    const marks = await DB.query(
      singleLineString`select student_id, subject_code, component_code, value, absent from exam_report_mark
        where school_id = $1 and academic_year_id = $2 and term = $3 and class_id = $4`,
      [schoolId, ayId, term, classId],
    );
    const mMap = new Map<string, { value: number | null; absent: boolean }>();
    for (const m of marks) mMap.set(`${m.studentId}|${m.subjectCode}|${m.componentCode}`, { value: m.value == null ? null : Number(m.value), absent: m.absent === 1 });
    const grades = await DB.query(
      singleLineString`select student_id, area_id, grade, text_value, marks, max_marks, absent from exam_report_area_grade
        where school_id = $1 and academic_year_id = $2 and term = $3 and class_id = $4`,
      [schoolId, ayId, term, classId],
    );
    const gMap = new Map<string, any>();
    for (const g of grades) gMap.set(`${g.studentId}|${g.areaId}`, g);
    const headers = await DB.query(
      singleLineString`select student_id, attendance_present, attendance_total, house, remark, promoted_to, print_count, to_char(printed_at, 'YYYY-MM-DD HH24:MI') as printed_at
        from exam_report where school_id = $1 and academic_year_id = $2 and term = $3 and class_id = $4 and status = 'active'`,
      [schoolId, ayId, term, classId],
    );
    const hMap = new Map<string, any>(headers.map((h: any) => [h.studentId, h]));

    const outStudents: any[] = [];
    for (const s of students) {
      const h: any = hMap.get(s.studentId) || {};
      const subjectTotals: Record<string, any> = {};
      let overallTotal = 0, overallMax = 0;
      for (const subj of subjects) {
        let t = 0, max = 0, any = false;
        for (const c of components) {
          max += Number(c.maxMarks);
          const v = mMap.get(`${s.studentId}|${subj.code}|${c.code}`);
          if (v) { if (v.absent) any = true; else if (v.value != null) { t += v.value; any = true; } } // absent counts as 0
        }
        const pct = max ? (t / max) * 100 : 0;
        subjectTotals[subj.code] = { total: any ? t : null, max, grade: any ? this.matchScholastic(scholScale, pct) : null };
        if (any) { overallTotal += t; overallMax += max; }
      }
      // Co-scholastic areas: grade computed from marks (absent → 'ABSENT' sentinel = red-circle A).
      const areaGrades: Record<string, any> = {};
      for (const a of areas as any[]) {
        const g: any = gMap.get(`${s.studentId}|${a.uuid}`);
        if (!g) { areaGrades[a.uuid] = null; continue; }
        if (a.valueType === "text") areaGrades[a.uuid] = g.textValue;
        else if (a.valueType === "grade") areaGrades[a.uuid] = g.grade; // pre-primary direct grade
        else if (g.absent === 1) areaGrades[a.uuid] = "ABSENT";
        else areaGrades[a.uuid] = this.coschGrade(a.scaleKind, g.marks != null ? Number(g.marks) : null, g.maxMarks != null ? Number(g.maxMarks) : a.maxMarks, scales);
      }
      outStudents.push({
        studentId: s.studentId, name: s.name, admissionNumber: s.admissionNumber, rollNumber: s.rollNumber,
        dob: s.dob ? new Date(s.dob).toISOString().slice(0, 10) : null, fatherName: s.fatherName, motherName: s.motherName,
        house: h.house ?? s.houseName ?? null,
        attendancePresent: h.attendancePresent ?? null, attendanceTotal: h.attendanceTotal ?? null,
        remark: h.remark ?? null, promotedTo: h.promotedTo ?? null,
        // Photos are NOT embedded here — a class of pre-primary photos (unresized, ~900KB each)
        // blew past API Gateway's 10MB response limit. The id is returned; the print pass will
        // fetch + resize per student. (photoFileId kept for that.)
        photoFileId: s.photoFileId || null, photoDataUri: null,
        marks: subjects.reduce((acc: any, subj: any) => { acc[subj.code] = components.reduce((mm: any, c: any) => { const v = mMap.get(`${s.studentId}|${subj.code}|${c.code}`); mm[c.code] = !v ? null : (v.absent ? "ABSENT" : v.value); return mm; }, {}); return acc; }, {}),
        subjectTotals,
        overall: { total: overallTotal, max: overallMax, percentage: overallMax ? Math.round((overallTotal / overallMax) * 1000) / 10 : null },
        areaGrades,
        printCount: h.printCount ?? 0, printedAt: h.printedAt ?? null,
      });
    }
    return {
      className: scheme.className, band: scheme.band, term, branding, academicYear,
      scheme: {
        components: components.map((c: any) => ({ code: c.code, label: c.label, max: c.maxMarks })),
        subjects: subjects.map((s: any) => ({ code: s.code, label: s.reportLabel })),
        areas: areas.map((a: any) => ({ id: a.uuid, section: a.section, label: a.label, valueType: a.valueType })),
        scholasticScale: scholScale.map((s: any) => ({ grade: s.grade, label: s.label, minPct: s.minPct, maxPct: s.maxPct })),
        coscholasticScale: coschScale.map((s: any) => ({ grade: s.grade, label: s.label })),
      },
      students: outStudents,
    };
  }

  // Record a print for a set of students (increments print_count, stamps printed_at). Creates a
  // header row if none exists yet.
  async recordPrint(schoolId: string, ayId: string, classId: string, term: number, studentIds: string[], userId: string): Promise<any> {
    const now = new Date();
    for (const sid of studentIds || []) {
      const studentId = (sid || "").trim();
      if (!studentId) continue;
      const ex = await DB.query(
        singleLineString`select uuid, print_count from exam_report where school_id = $1 and academic_year_id = $2 and term = $3 and student_id = $4 and status = 'active'`,
        [schoolId, ayId, term, studentId],
      );
      if (ex.length) {
        await DB.query(
          singleLineString`update exam_report set print_count = $2, printed_at = $3, updatedby_userid = $4, updated_at = $3 where uuid = $1`,
          [ex[0].uuid, Number(ex[0].printCount || 0) + 1, now, userId],
        );
      } else {
        await DB.query(
          singleLineString`insert into exam_report (uuid, school_id, academic_year_id, term, student_id, class_id, print_count, printed_at, status, createdby_userid, created_at)
            values ($1,$2,$3,$4,$5,$6,1,$7,'active',$8,$7)`,
          [generateShortUuid(12), schoolId, ayId, term, studentId, classId, now, userId],
        );
      }
    }
    return { ok: true, printed: (studentIds || []).length };
  }

  // One student's latest photo as a data URI. Fetched ONE student at a time (not embedded in the
  // whole-class reportCards payload, which blew API Gateway's 10MB limit) — the print pass calls
  // this per pre-primary student, then resizes client-side before printing.
  async reportPhoto(schoolId: string, studentId: string): Promise<{ dataUri: string | null }> {
    const rows = await DB.query(
      singleLineString`select uuid from file_storage where entity_type = 'student' and entity_id = $1 and school_id = $2 order by created_at desc limit 1`,
      [studentId, schoolId],
    );
    const fileId = rows[0]?.uuid;
    if (!fileId) return { dataUri: null };
    try {
      const f = await fileStorageService.getWithData(fileId, schoolId);
      return { dataUri: f ? `data:${f.mimeType};base64,${f.data}` : null };
    } catch { return { dataUri: null }; }
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
    if (!this.subjectInGrade(subject, gradeOf(scheme.className).toLowerCase())) return false; // subject not offered in this grade
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
      singleLineString`select student_id, component_code, value, absent from exam_report_mark
        where school_id = $1 and academic_year_id = $2 and term = $3 and class_id = $4 and subject_code = $5`,
      [schoolId, ayId, term, classId, subjectCode],
    );
    const map = new Map<string, { value: number | null; absent: boolean }>();
    for (const m of marks) map.set(`${m.studentId}|${m.componentCode}`, { value: m.value == null ? null : Number(m.value), absent: m.absent === 1 });
    const rows = students.map((s: any) => ({
      studentId: s.studentId, name: s.name, admissionNumber: s.admissionNumber, rollNumber: s.rollNumber,
      // 'A' = Absent (entered as a/A); a number otherwise; null = not entered.
      marks: Object.fromEntries(components.map((c: any) => { const v = map.get(`${s.studentId}|${c.code}`); return [c.code, !v ? null : (v.absent ? "A" : v.value)]; })),
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
        const isAbsent = typeof raw === "string" && raw.trim().toUpperCase() === "A"; // a/A = Absent
        const val = isAbsent || raw === "" || raw == null ? null : Number(raw);
        const absent = isAbsent ? 1 : null;
        if (val != null && (isNaN(val) || val < 0 || val > (maxByCode.get(code) as number))) {
          throw new BusinessErrorResult(ErrorCode.BusinessError, `Mark for ${code} must be 0–${maxByCode.get(code)} (or A for Absent)`);
        }
        const ex = await DB.query(
          singleLineString`select uuid from exam_report_mark where school_id = $1 and academic_year_id = $2 and term = $3 and student_id = $4 and subject_code = $5 and component_code = $6`,
          [schoolId, ayId, term, studentId, subjectCode, code],
        );
        if (ex.length) {
          await DB.query(
            singleLineString`update exam_report_mark set value = $2, absent = $3, class_id = $4, updatedby_userid = $5, updated_at = $6 where uuid = $1`,
            [ex[0].uuid, val, absent, classId, employeeId, now],
          );
        } else if (val != null || absent != null) {
          await DB.query(
            singleLineString`insert into exam_report_mark (uuid, school_id, academic_year_id, term, student_id, class_id, subject_code, component_code, value, absent, createdby_userid, created_at)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
            [generateShortUuid(12), schoolId, ayId, term, studentId, classId, subjectCode, code, val, absent, employeeId, now],
          );
        }
      }
    }
    return this.marksGrid(schoolId, ayId, classId, subjectCode, term, employeeId);
  }

  // ── Co-scholastic entry (class teacher) ─────────────────────────────────────────────
  // Both co-scholastic grade tables for a scheme: cosch (/100 percent, printed) + cosch10 (/10 raw).
  private async coschScales(schemeId: string): Promise<{ cosch: any[]; cosch10: any[] }> {
    const rows = await DB.query(
      singleLineString`select kind, grade, label, min_pct, max_pct, sort_order from exam_report_grade_scale where scheme_id = $1 and kind in ('coscholastic','coscholastic10') and status = 'active' order by sort_order asc nulls last`,
      [schemeId],
    );
    return { cosch: rows.filter((r: any) => r.kind === "coscholastic"), cosch10: rows.filter((r: any) => r.kind === "coscholastic10") };
  }

  // Compute a co-scholastic grade from marks: /10 areas grade the raw mark, /100 areas grade the
  // percent (marks ÷ effective-max × 100). Highest band the value meets, else the lowest grade.
  private coschGrade(scaleKind: string, marks: number | null, effMax: number | null, scales: { cosch: any[]; cosch10: any[] }): string | null {
    if (marks == null || isNaN(marks)) return null;
    const table = scaleKind === "coscholastic10" ? scales.cosch10 : scales.cosch;
    if (!table.length) return null;
    const value = scaleKind === "coscholastic10" ? marks : (effMax ? (marks / effMax) * 100 : 0);
    const sorted = [...table].sort((a, b) => (Number(b.minPct) || 0) - (Number(a.minPct) || 0));
    const hit = sorted.find((r) => value >= (Number(r.minPct) || 0));
    return (hit ?? sorted[sorted.length - 1]).grade;
  }

  async coscholasticGrid(schoolId: string, ayId: string, classId: string, term: number, userId: string): Promise<any> {
    const scheme = await this.schemeForClass(schoolId, ayId, classId, userId);
    if (!scheme) throw new BusinessErrorResult(ErrorCode.BusinessError, "No report scheme for this class");
    const areas = await DB.query(
      singleLineString`select uuid, section, label, scale_kind, value_type, max_marks, denominator_editable from exam_report_area where scheme_id = $1 and status = 'active' order by sort_order asc nulls last`,
      [scheme.uuid],
    );
    const scales = await this.coschScales(scheme.uuid);
    const students = await this.classStudents(schoolId, ayId, classId);
    const grades = await DB.query(
      singleLineString`select student_id, area_id, grade, text_value, marks, max_marks, absent from exam_report_area_grade
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
    // Per-class denominator for the editable areas (GA/Reasoning/Value Education) — from any saved row.
    const denominators: Record<string, any> = {};
    for (const a of areas as any[]) if (a.denominatorEditable) {
      const row = (grades as any[]).find((g) => g.areaId === a.uuid && g.maxMarks != null);
      denominators[a.uuid] = row ? Number(row.maxMarks) : null;
    }
    return {
      className: scheme.className, term,
      scale: scales.cosch.map((s: any) => ({ grade: s.grade, label: s.label, minPct: s.minPct, maxPct: s.maxPct })),
      scale10: scales.cosch10.map((s: any) => ({ grade: s.grade, label: s.label, minPct: s.minPct, maxPct: s.maxPct })),
      houses: houses.map((h: any) => h.name),
      denominators,
      areas: (areas as any[]).map((a) => ({ id: a.uuid, section: a.section, label: a.label, valueType: a.valueType, scaleKind: a.scaleKind, max: a.maxMarks, denomEditable: a.denominatorEditable === 1 })),
      students: students.map((s: any) => {
        const h: any = hmap.get(s.studentId) || {};
        return {
          studentId: s.studentId, name: s.name, admissionNumber: s.admissionNumber, rollNumber: s.rollNumber,
          attendancePresent: h.attendancePresent ?? (att.present.get(s.studentId) ?? 0),
          attendanceTotal: h.attendanceTotal ?? att.total,
          house: h.house ?? s.houseName ?? null, remark: h.remark ?? null,
          cells: Object.fromEntries((areas as any[]).map((a) => {
            const g: any = gmap.get(`${s.studentId}|${a.uuid}`);
            if (!g) return [a.uuid, {}];
            if (a.valueType === "text") return [a.uuid, { text: g.textValue }];
            if (a.valueType === "grade") return [a.uuid, { grade: g.grade }]; // pre-primary direct grade
            return [a.uuid, { marks: g.marks != null ? Number(g.marks) : null, absent: g.absent === 1 }];
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
    // Class-teacher remark is required for the FINAL term (Term 2) when the school opts in; never Term 1.
    if (term === 2) {
      const { remarkRequiredFinal } = await this.getConfig(schoolId, ayId);
      if (remarkRequiredFinal) {
        for (const e of entries || []) {
          if (!String(e.remark || "").trim()) throw new BusinessErrorResult(ErrorCode.BusinessError, "Class teacher remark is required for the final term");
        }
      }
    }
    const areas = await DB.query(
      singleLineString`select uuid, value_type, max_marks, denominator_editable from exam_report_area where scheme_id = $1 and status = 'active'`,
      [scheme.uuid],
    );
    const areaMap = new Map<string, any>((areas as any[]).map((a) => [a.uuid, a]));
    const now = new Date();
    for (const e of entries || []) {
      const studentId = (e.studentId || "").trim();
      if (!studentId) continue;
      // Header fields (attendance / house / remark) upsert.
      if (e.attendancePresent !== undefined || e.attendanceTotal !== undefined || e.house !== undefined || e.remark !== undefined) {
        await this.upsertHeader(schoolId, ayId, term, studentId, classId, e, employeeId, now);
      }
      const denoms = e.denominators || {}; // per-class 'out of' for the editable areas
      for (const areaId of Object.keys(e.cells || {})) {
        const a = areaMap.get(areaId);
        if (!a) continue;
        const cell = e.cells[areaId] || {};
        let grade: any = null, textValue: any = null, marks: any = null, maxMarks: any = null, absent: any = null;
        if (a.valueType === "text") {
          textValue = String(cell.text || "").trim() || null;
        } else if (a.valueType === "grade") {
          grade = cell.grade || null; // pre-primary direct grade
        } else { // marks
          absent = cell.absent ? 1 : null;
          marks = absent || cell.marks === "" || cell.marks == null ? null : Number(cell.marks);
          const d = denoms[areaId];
          maxMarks = a.denominatorEditable ? (d === "" || d == null ? null : Number(d)) : a.maxMarks;
        }
        const has = grade != null || textValue != null || marks != null || absent != null;
        const ex = await DB.query(
          singleLineString`select uuid from exam_report_area_grade where school_id = $1 and academic_year_id = $2 and term = $3 and student_id = $4 and area_id = $5`,
          [schoolId, ayId, term, studentId, areaId],
        );
        if (ex.length) {
          await DB.query(
            singleLineString`update exam_report_area_grade set grade = $2, text_value = $3, marks = $4, max_marks = $5, absent = $6, class_id = $7, updatedby_userid = $8, updated_at = $9 where uuid = $1`,
            [ex[0].uuid, grade, textValue, marks, maxMarks, absent, classId, employeeId, now],
          );
        } else if (has) {
          await DB.query(
            singleLineString`insert into exam_report_area_grade (uuid, school_id, academic_year_id, term, student_id, class_id, area_id, grade, text_value, marks, max_marks, absent, createdby_userid, created_at)
              values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
            [generateShortUuid(12), schoolId, ayId, term, studentId, classId, areaId, grade, textValue, marks, maxMarks, absent, employeeId, now],
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
      const pgGrade = gradeOf(c.className).toLowerCase();
      const subjects = (await this.schemeSubjects(scheme.uuid)).filter((s: any) => this.subjectInGrade(s, pgGrade));
      if (!subjects.length) continue; // grade-only schemes (pre-primary) have no marks to track
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

  // Co-scholastic completion per class (the class-teacher task) — mirrors progress() but tracks
  // area grades instead of marks. Powers the incharge's Co-Scholastic Progress tab; a class is
  // "done" when every student has a grade for every grade-type area.
  async coscholasticProgress(schoolId: string, ayId: string, term: number, userId: string): Promise<any> {
    await this.ensureSchemes(schoolId, ayId, userId);
    const classes = await DB.query(
      singleLineString`select distinct sc.class_id, c.name as class_name, c.seq
        from student_class sc join class c on c.uuid = sc.class_id and c.school_id = sc.school_id and c.base_class_id is null
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id and s.status = 'active'
        where sc.school_id = $1 and sc.academic_year_id = $2 and (sc.status is null or sc.status <> 'deleted')
        order by c.seq asc nulls last, c.name`,
      [schoolId, ayId],
    );
    const out: any[] = [];
    let doneClasses = 0, totalClasses = 0;
    for (const c of classes) {
      const scheme = await this.schemeForClass(schoolId, ayId, c.classId, userId);
      if (!scheme) continue;
      const areas = await DB.query(
        singleLineString`select uuid from exam_report_area where scheme_id = $1 and status = 'active' and (value_type is null or value_type <> 'text')`,
        [scheme.uuid],
      );
      if (!areas.length) continue; // nothing gradeable to track
      const students = await this.classStudents(schoolId, ayId, c.classId);
      const grades = await DB.query(
        singleLineString`select student_id, area_id from exam_report_area_grade
          where school_id = $1 and academic_year_id = $2 and term = $3 and class_id = $4
            and (marks is not null or absent = 1 or grade is not null or text_value is not null)`,
        [schoolId, ayId, term, c.classId],
      );
      const filled = new Set<string>(grades.map((g: any) => `${g.studentId}|${g.areaId}`));
      const complete = students.filter((s: any) => areas.every((a: any) => filled.has(`${s.studentId}|${a.uuid}`))).length;
      const done = students.length > 0 && complete === students.length;
      totalClasses++; if (done) doneClasses++;
      out.push({ classId: c.classId, className: c.className, band: scheme.band, total: students.length, complete, done });
    }
    return { term, classes: out, pctEntered: totalClasses ? Math.round((doneClasses / totalClasses) * 100) : 0, pendingClasses: totalClasses - doneClasses };
  }
}

export const reportService = new ReportService();
