import { DB, singleLineString } from '../../shared/lib/db';
import { ApiEvent } from '../../shared/lib/api.interfaces';
import { getCaller } from '../auth/authz';
import { can } from '../../shared/lib/authz-policy';
import { fileStorageService } from '../../shared/lib/file-storage';
import { DerivedStudent } from './transfer-interfaces';

// School resolution + cross-entity checks (no FKs — validated in app code).
export async function getSchoolIdByCode(schoolCode: string): Promise<string | null> {
  const results = await DB.query(
    singleLineString`select uuid from school where lower(code) = lower($1)`,
    [schoolCode]
  );
  return results.length > 0 ? results[0].uuid : null;
}

export async function findStudent(schoolId: string, studentId: string): Promise<any | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name, status from student where uuid = $1 and school_id = $2 and status <> 'deleted'`,
    [studentId, schoolId]
  );
  return rows.length > 0 ? rows[0] : null;
}

// Does the caller hold a specific permission (override-aware can())? Returns a boolean,
// never writes a response — used for the TC dues-gate override (transfer.dues.override),
// god-only by default but delegable from the Permissions grid.
export function callerCan(event: ApiEvent, action: string): boolean {
  const caller = getCaller(event);
  return !!caller && can(caller.roles, action);
}

// ── Date → words (for the certificate's "Date of Birth in words") ──────────────
const ONES = ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const TEENS = ['TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN'];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER'];
const ORDINAL: Record<number, string> = {
  1: 'FIRST', 2: 'SECOND', 3: 'THIRD', 4: 'FOURTH', 5: 'FIFTH', 6: 'SIXTH', 7: 'SEVENTH', 8: 'EIGHTH', 9: 'NINTH',
  10: 'TENTH', 11: 'ELEVENTH', 12: 'TWELFTH', 13: 'THIRTEENTH', 14: 'FOURTEENTH', 15: 'FIFTEENTH', 16: 'SIXTEENTH',
  17: 'SEVENTEENTH', 18: 'EIGHTEENTH', 19: 'NINETEENTH', 20: 'TWENTIETH', 30: 'THIRTIETH',
};

function cardinalUnder100(n: number): string {
  if (n < 10) return ONES[n];
  if (n < 20) return TEENS[n - 10];
  const t = TENS[Math.floor(n / 10)];
  return n % 10 ? `${t} ${ONES[n % 10]}` : t;
}

function ordinalDay(n: number): string {
  if (ORDINAL[n]) return ORDINAL[n];
  // 21-29, 31 → tens word + ordinal of the unit (e.g. 27 -> "TWENTY SEVENTH")
  return `${TENS[Math.floor(n / 10)]} ${ORDINAL[n % 10]}`.trim();
}

function yearWords(y: number): string {
  if (y >= 2000 && y < 2100) {
    const rem = y - 2000;
    return rem ? `TWO THOUSAND ${cardinalUnder100(rem)}` : 'TWO THOUSAND';
  }
  const hi = Math.floor(y / 100);
  const lo = y % 100;
  return `${cardinalUnder100(hi)} ${lo === 0 ? 'HUNDRED' : cardinalUnder100(lo)}`;
}

// 'YYYY-MM-DD' (or Date) -> "TWENTY SEVENTH APRIL TWO THOUSAND TEN".
export function dateInWords(dateStr: string | null): string | null {
  if (!dateStr) return null;
  const s = String(dateStr).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${ordinalDay(d)} ${MONTHS[mo - 1]} ${yearWords(y)}`;
}

// pg returns date columns as JS Date (local midnight). Format with local getters so the
// calendar day doesn't shift under IST; already-string values are sliced.
export function ymd(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

// ── Central school branding (shared table; TC reads header + CBSE no + logo) ────
export interface TcBranding {
  schoolName: string | null;
  motto: string | null;
  address: string | null;
  contact: string | null;
  email: string | null;
  website: string | null;
  cbseRegNo: string | null; // falls back to affiliation_no
  logoDataUri: string | null;
}

export async function getTcBranding(schoolId: string): Promise<TcBranding> {
  const rows = await DB.query(
    singleLineString`select school_name, motto, address, contact, email, website, affiliation_no,
        cbse_reg_no, logo_file_id from school_branding where school_id = $1`,
    [schoolId]
  );
  const b: any = rows.length ? rows[0] : {};
  let logoDataUri: string | null = null;
  if (b.logoFileId) {
    const f = await fileStorageService.getWithData(b.logoFileId, schoolId);
    if (f) logoDataUri = `data:${f.mimeType};base64,${f.data}`;
  }
  return {
    schoolName: b.schoolName || null,
    motto: b.motto || null,
    address: b.address || null,
    contact: b.contact || null,
    email: b.email || null,
    website: b.website || null,
    cbseRegNo: b.cbseRegNo || b.affiliationNo || null,
    logoDataUri,
  };
}

// ── Identity derivation (live from the student record; never stored on the TC) ──
async function lookupLabel(schoolId: string, type: string, code: string | null): Promise<string | null> {
  if (!code) return null;
  const rows = await DB.query(
    singleLineString`select label from student_lookup where school_id = $1 and lookup_type = $2 and lower(code) = lower($3) and status = 'active' limit 1`,
    [schoolId, type, code]
  );
  return rows.length ? (rows[0].label || code) : code;
}

export async function deriveStudent(schoolId: string, studentId: string): Promise<DerivedStudent | null> {
  const rows = await DB.query(
    singleLineString`select uuid, name, admission_number, dob, category_code, nationality_code, admission_date
      from student where uuid = $1 and school_id = $2 and status <> 'deleted'`,
    [studentId, schoolId]
  );
  if (!rows.length) return null;
  const st = rows[0];

  const guardians = await DB.query(
    singleLineString`select relation, name from student_guardian
      where school_id = $1 and student_id = $2 and (status is null or status <> 'deleted')`,
    [schoolId, studentId]
  );
  const byRel = (r: string) => (guardians.find((g: any) => g.relation === r) || {}).name || null;

  // Current/last enrolment (most recent academic year) — class figures + words.
  const cur = await DB.query(
    singleLineString`select c.code as class_code, c.name as class_name, sc.academic_year_id, sc.class_id
      from student_class sc
      join academic_year ay on sc.academic_year_id = ay.uuid
      left join class c on sc.class_id = c.uuid
      where sc.student_id = $1 and sc.school_id = $2 and (sc.status is null or sc.status <> 'deleted')
      order by ay.start_date desc nulls last limit 1`,
    [studentId, schoolId]
  );
  const e: any = cur.length ? cur[0] : {};
  const dob = ymd(st.dob);

  return {
    name: st.name,
    admissionNumber: st.admissionNumber || null,
    dob,
    dobInWords: dateInWords(dob),
    fatherName: byRel('father') || byRel('guardian'),
    motherName: byRel('mother'),
    nationality: await lookupLabel(schoolId, 'nationality', st.nationalityCode),
    category: await lookupLabel(schoolId, 'category', st.categoryCode),
    admissionDate: ymd(st.admissionDate),
    classFigures: e.classCode || null,
    classWords: e.className || null,
    academicYearId: e.academicYearId || null,
    classId: e.classId || null,
  };
}

// Field 14 — "NO" or the nature of the active concession(s) for the student.
export async function deriveConcession(schoolId: string, studentId: string): Promise<string> {
  try {
    const rows = await DB.query(
      singleLineString`select coalesce(fc.name, fc.type) as nature
        from fee_concession_student fcs
        join fee_concession fc on fc.uuid = fcs.concession_id and fc.school_id = fcs.school_id
        where fcs.school_id = $1 and fcs.student_id = $2
          and (fcs.status is null or fcs.status <> 'deleted')
          and (fc.status is null or fc.status <> 'deleted')`,
      [schoolId, studentId]
    );
    const names = [...new Set(rows.map((r: any) => String(r.nature || '').trim()).filter(Boolean))];
    return names.length ? names.join(', ') : 'NO';
  } catch {
    return 'NO';
  }
}

// Field 11 — academic subjects of the student's class, best-effort (operator-editable).
export async function deriveSubjects(schoolId: string, classId: string | null, academicYearId: string | null): Promise<string[]> {
  if (!classId || !academicYearId) return [];
  try {
    const rows = await DB.query(
      singleLineString`select s.name from class_subject cs
        join subject s on s.uuid = cs.subject_id and s.school_id = cs.school_id
        where cs.school_id = $1 and cs.class_id = $2 and cs.academic_year_id = $3
          and cs.status = 'active' and s.status = 'active' and s.kind = 'academic'
        order by s.name`,
      [schoolId, classId, academicYearId]
    );
    return rows.map((r: any) => String(r.name || '').toUpperCase()).filter(Boolean);
  } catch {
    return [];
  }
}
