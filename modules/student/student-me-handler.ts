import { ApiCallback, ApiContext, ApiEvent } from '../../shared/lib/api.interfaces';
import { DB, singleLineString } from '../../shared/lib/db';
import { getSignedPhotoUrl } from '../../shared/lib/file-storage';
import { ResponseBuilder } from '../../shared/lib/response-builder';
import { ErrorCode } from '../../shared/lib/error-codes';
import { guardActiveStudent } from '../auth/auth-utils';
import { studentAdminService } from './student-admin-service';

// The family login's DISABLED app-feature keys (admin "App Access" toggles). [] = all on.
async function resolveDisabledFeatures(schoolId: string, studentId: string): Promise<string[]> {
  const rows = await DB.query(
    singleLineString`
      select sl.disabled_features from student_login sl
      where sl.school_id = $1
        and sl.username = (select family_unique_number from student where uuid = $2 and school_id = $1)
      limit 1`,
    [schoolId, studentId],
  );
  const raw = rows[0]?.disabledFeatures;
  if (!raw) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v.filter((x: any) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// The family's children (siblings share family_unique_number) with current class
// + a presigned thumb photo URL, so the parent app's child switcher shows faces.
async function resolveFamily(schoolId: string, studentId: string) {
  const fam = await DB.query(
    singleLineString`select family_unique_number from student where uuid = $1 and school_id = $2`,
    [studentId, schoolId],
  );
  const familyNo = (fam[0]?.familyUniqueNumber || '').trim();
  if (!familyNo) return [];

  const rows = await DB.query(
    singleLineString`
      select s.uuid, s.name, cur.class_name, cur.roll_number,
        (select fs.storage_key from file_storage fs
           where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id
             and fs.variant = 'thumb' order by fs.created_at desc limit 1) as thumb_key,
        (select fs.storage_key from file_storage fs
           where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id
             and (fs.variant = 'original' or fs.variant is null) order by fs.created_at desc limit 1) as orig_key
      from student s
      left join lateral (
        select sc.class_id, c.name as class_name, sc.roll_number
        from student_class sc join academic_year ay on sc.academic_year_id = ay.uuid
        left join class c on c.uuid = sc.class_id
        where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
        order by ay.start_date desc nulls last limit 1
      ) cur on true
      where s.school_id = $1 and s.family_unique_number = $2 and (s.status is null or s.status <> 'deleted')
      order by s.admission_date asc nulls last, s.name`,
    [schoolId, familyNo],
  );

  return Promise.all(
    rows.map(async (r: any) => {
      const key = r.thumbKey || r.origKey;
      let photoUrl: string | null = null;
      if (key) { try { photoUrl = await getSignedPhotoUrl(key, 21600); } catch { photoUrl = null; } }
      return { id: r.uuid, name: r.name, className: r.className ?? null, rollNumber: r.rollNumber ?? null, photoUrl };
    }),
  );
}

// Map getDetail's enrollment rows (current + gap + historical, newest-first) into the
// parent-app's year-by-year shape. The oldest real year is tagged as the admission year.
function mapEnrollments(detail: any) {
  const records = (detail.enrollments || []).map((e: any) => ({
    academicYearName: e.academicYearName ?? null,
    className: e.className ?? null,
    section: e.streamName ?? null,
    rollNumber: e.rollNumber ?? null,
    schoolName: null,
    status: e.kind === 'current' ? 'active' : e.kind === 'gap' ? 'gap' : 'past',
    isAdmission: false,
    note: e.note ?? null,
  }));
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].status !== 'gap') { records[i].isAdmission = true; break; }
  }
  return { admissionNumber: detail.admissionNumber ?? null, records };
}

// Parent-app profile: GET /student/me. The active child comes from the family
// token + X-Student-Id (resolveActiveStudent, no DB round-trip); schoolId comes
// from the token. Returns a curated profile — not the full admin record — so the
// app screen gets exactly what it renders and no internal fields leak.
class StudentMeHandler {
  public getMe = async (event: ApiEvent, _context: ApiContext, callback: ApiCallback) => {
    _context.callbackWaitsForEmptyEventLoop = false;
    try {
      const auth = guardActiveStudent(event, callback);
      if (!auth) return;

      const schoolId = auth.token.school_id;
      const studentId = auth.activeStudentId;

      const detail: any = await studentAdminService.getDetail(studentId, schoolId);
      if (!detail) {
        ResponseBuilder.notFound(ErrorCode.InvalidId, 'Student not found', callback);
        return;
      }

      const profile = {
        id: detail.uuid,
        name: detail.name,
        admissionNumber: detail.admissionNumber,
        gender: detail.gender ?? null,
        dob: detail.dob ?? null,
        bloodGroupCode: detail.bloodGroupCode ?? null,
        className: detail.currentClassName ?? null,
        rollNumber: detail.currentRollNumber ?? null,
        academicYear: detail.currentAcademicYearId
          ? { id: detail.currentAcademicYearId, name: detail.currentAcademicYearName ?? null }
          : null,
        house: detail.houseName
          ? { name: detail.houseName, color: detail.houseColor ?? null }
          : null,
        photoId: detail.photoId ?? null,
        photoThumbId: detail.photoThumbId ?? null,
        family: await resolveFamily(schoolId, studentId),
        enrollments: mapEnrollments(detail),
        disabledFeatures: await resolveDisabledFeatures(schoolId, studentId),
      };
      ResponseBuilder.ok(profile, callback);
    } catch (err: any) {
      ResponseBuilder.handleError(err, callback);
    }
  };
}

const handler = new StudentMeHandler();
export const getMe = handler.getMe;
