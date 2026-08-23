import { DB, singleLineString } from '../../shared/lib/db';
import { resolveEffectiveClassId } from '../../shared/lib/effective-class';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  CreateStudentRequest,
  UpdateStudentRequest,
  StudentDetail,
  EnrollmentRow,
  BulkClassRosterRow,
  BulkUpdateRequest,
  BulkUpdateResult,
} from './student-interfaces';
import { DEFAULTS, DEFAULT_PASSWORD } from './student-constants';
import { studentGuardianService } from './student-guardian-service';
import { studentAddressService } from './student-address-service';
import { studentSiblingService } from './student-sibling-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class StudentAdminService {
  // ---- validation helpers (no FKs — app must guard school ownership) ----

  private async assertBelongsToSchool(
    table: 'house' | 'class' | 'academic_year',
    id: string | undefined | null,
    schoolId: string,
    label: string
  ): Promise<void> {
    if (!id) return;
    const statusFilter = table === 'house' ? "and status = 'active'" : '';
    const rows = await DB.query(
      `select 1 from ${table} where uuid = $1 and school_id = $2 ${statusFilter} limit 1`,
      [id, schoolId]
    );
    if (rows.length === 0) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Invalid ${label}`);
    }
  }

  private async assertAdmissionNumberFree(
    admissionNumber: string,
    schoolId: string,
    excludeStudentId?: string
  ): Promise<void> {
    const params: any[] = [schoolId, admissionNumber];
    let exclude = '';
    if (excludeStudentId) {
      params.push(excludeStudentId);
      exclude = `and uuid <> $${params.length}`;
    }
    const rows = await DB.query(
      singleLineString`
        select 1 from student
        where school_id = $1 and lower(admission_number) = lower($2)
          and status <> 'deleted' ${exclude}
        limit 1
      `,
      params
    );
    if (rows.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `Admission number "${admissionNumber}" already exists`
      );
    }
  }

  // Ensure a single family login row exists for this family_unique_number.
  // Siblings share it (username = family_unique_number); idempotent via the
  // unique (username, school_id) index. Mirrors employee login creation.
  private async ensureFamilyLogin(
    familyUniqueNumber: string | null | undefined,
    displayName: string,
    schoolId: string,
    userId: string
  ): Promise<void> {
    const family = (familyUniqueNumber || '').trim();
    if (!family) return;
    await DB.query(
      singleLineString`
        insert into student_login
        (uuid, username, password, display_name, school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (username, school_id) do nothing
      `,
      [generateShortUuid(12), family, DEFAULT_PASSWORD, displayName, schoolId, userId, new Date()]
    );
  }

  // ---- CRUD ----

  public async create(
    data: CreateStudentRequest,
    schoolId: string,
    userId: string
  ): Promise<StudentDetail> {
    if (!data.name || !data.name.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Name is required');
    }
    if (!data.admissionNumber || !data.admissionNumber.trim()) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'Admission number is required');
    }

    await this.assertAdmissionNumberFree(data.admissionNumber.trim(), schoolId);
    await this.assertBelongsToSchool('house', data.houseId, schoolId, 'house');
    await this.assertBelongsToSchool('class', data.classId, schoolId, 'class');
    await this.assertBelongsToSchool('academic_year', data.academicYearId, schoolId, 'academic year');

    const uuid = generateShortUuid(12);
    const now = new Date();

    await DB.query(
      singleLineString`
        insert into student
        (uuid, admission_number, name, gender, dob, family_unique_number,
         communication_preference, old_admission_number, house_id,
         student_email, student_mobile, student_whatsapp, category_code, nationality_code,
         mother_tongue_code, blood_group_code, aadhaar_number, previous_school,
         admission_date, withdrawal_date, withdrawal_remarks, exam_only, exam_only_reason, status,
         school_id, createdby_userid, created_at, rte)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
      `,
      [
        uuid,
        data.admissionNumber.trim(),
        data.name.trim(),
        data.gender || null,
        data.dob || null,
        data.familyUniqueNumber || null,
        data.communicationPreference || null,
        data.oldAdmissionNumber || null,
        data.houseId || null,
        data.studentEmail || null,
        data.studentMobile || null,
        data.studentWhatsapp || null,
        data.categoryCode || null,
        data.nationalityCode || null,
        data.motherTongueCode || null,
        data.bloodGroupCode || null,
        data.aadhaarNumber || null,
        data.previousSchool || null,
        data.admissionDate || null,
        data.withdrawalDate || null,
        data.withdrawalRemarks || null,
        data.examOnly ?? false,
        data.examOnlyReason || null,
        DEFAULTS.STATUS,
        schoolId,
        userId,
        now,
        data.rte ?? false,
      ]
    );

    // Ensure the family login exists so the student can sign in to the app.
    await this.ensureFamilyLogin(data.familyUniqueNumber, data.name.trim(), schoolId, userId);

    // Optional initial enrollment.
    if (data.classId && data.academicYearId) {
      await DB.query(
        singleLineString`
          insert into student_class
          (uuid, student_id, academic_year_id, class_id, stream_code, roll_number, join_date, status,
           school_id, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9, $10)
          on conflict (student_id, academic_year_id, class_id, school_id) do nothing
        `,
        [
          generateShortUuid(12),
          uuid,
          data.academicYearId,
          data.classId,
          data.streamCode || null,
          data.rollNumber ?? null,
          data.joinDate || null,
          schoolId,
          userId,
          now,
        ]
      );
    }

    // Optional inline guardians.
    if (Array.isArray(data.guardians)) {
      for (const g of data.guardians) {
        await studentGuardianService.create(uuid, g, schoolId, userId);
      }
    }

    // Optional inline addresses.
    if (Array.isArray(data.addresses)) {
      for (const a of data.addresses) {
        await studentAddressService.create(uuid, a, schoolId, userId);
      }
    }

    return this.getDetail(uuid, schoolId) as Promise<StudentDetail>;
  }

  public async update(
    id: string,
    data: UpdateStudentRequest,
    schoolId: string,
    userId: string
  ): Promise<StudentDetail | null> {
    const existing = await DB.query(
      `select uuid from student where uuid = $1 and school_id = $2 and status <> 'deleted'`,
      [id, schoolId]
    );
    if (existing.length === 0) return null;

    if (data.admissionNumber !== undefined) {
      await this.assertAdmissionNumberFree(data.admissionNumber.trim(), schoolId, id);
    }
    if (data.houseId) {
      await this.assertBelongsToSchool('house', data.houseId, schoolId, 'house');
    }

    const fields: string[] = [];
    const params: any[] = [];
    const set = (col: string, val: any) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };

    if (data.name !== undefined) set('name', data.name.trim());
    if (data.admissionNumber !== undefined) set('admission_number', data.admissionNumber.trim());
    if (data.gender !== undefined) set('gender', data.gender);
    if (data.dob !== undefined) set('dob', data.dob);
    if (data.familyUniqueNumber !== undefined) set('family_unique_number', data.familyUniqueNumber);
    if (data.communicationPreference !== undefined) set('communication_preference', data.communicationPreference);
    if (data.oldAdmissionNumber !== undefined) set('old_admission_number', data.oldAdmissionNumber);
    if (data.houseId !== undefined) set('house_id', data.houseId);
    if (data.studentEmail !== undefined) set('student_email', data.studentEmail);
    if (data.studentMobile !== undefined) set('student_mobile', data.studentMobile);
    if (data.studentWhatsapp !== undefined) set('student_whatsapp', data.studentWhatsapp);
    if (data.categoryCode !== undefined) set('category_code', data.categoryCode);
    if (data.nationalityCode !== undefined) set('nationality_code', data.nationalityCode);
    if (data.motherTongueCode !== undefined) set('mother_tongue_code', data.motherTongueCode);
    if (data.bloodGroupCode !== undefined) set('blood_group_code', data.bloodGroupCode);
    if (data.aadhaarNumber !== undefined) set('aadhaar_number', data.aadhaarNumber);
    if (data.previousSchool !== undefined) set('previous_school', data.previousSchool);
    if (data.admissionDate !== undefined) set('admission_date', data.admissionDate);
    if (data.withdrawalDate !== undefined) set('withdrawal_date', data.withdrawalDate);
    if (data.withdrawalRemarks !== undefined) set('withdrawal_remarks', data.withdrawalRemarks);
    if (data.examOnly !== undefined) set('exam_only', data.examOnly);
    if (data.examOnlyReason !== undefined) set('exam_only_reason', data.examOnlyReason);
    if (data.rte !== undefined) set('rte', data.rte);
    if (data.status !== undefined) set('status', data.status);

    if (fields.length > 0) {
      set('updatedby_userid', userId);
      set('updated_at', new Date());
      params.push(id, schoolId);
      await DB.query(
        `update student set ${fields.join(', ')} where uuid = $${params.length - 1} and school_id = $${params.length}`,
        params
      );
    }

    // Stream edit — apply to the student's current (latest) enrollment. The edit form has
    // no year selector, so we target the same row getDetail surfaces as "current".
    if (data.streamCode !== undefined) {
      await DB.query(
        singleLineString`
          update student_class set stream_code = $1, updatedby_userid = $2, updated_at = $3
          where uuid = (
            select sc.uuid from student_class sc
            left join academic_year ay on sc.academic_year_id = ay.uuid
            where sc.student_id = $4 and sc.school_id = $5 and (sc.status is null or sc.status <> 'deleted')
            order by ay.start_date desc nulls last limit 1
          )
        `,
        [data.streamCode || null, userId, new Date(), id, schoolId]
      );
    }

    // If a family number was set/changed, make sure its login row exists.
    if (data.familyUniqueNumber !== undefined) {
      const displayName = data.name?.trim()
        ? data.name.trim()
        : (await DB.query(`select name from student where uuid = $1 and school_id = $2`, [id, schoolId]))[0]?.name || '';
      await this.ensureFamilyLogin(data.familyUniqueNumber, displayName, schoolId, userId);
    }

    return this.getDetail(id, schoolId);
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`
        update student set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status <> 'deleted'
        returning uuid
      `,
      [userId, new Date(), id, schoolId]
    );
    return rows.length > 0;
  }

  // ---- Bulk class edit ----

  // The roster the bulk-edit grid loads: every active student in the class for the
  // given year, ordered by admission date (so rows line up with increasing roll
  // number), each with roll / house / father-mother-guardian contacts. Contacts are
  // the first active guardian per relation, falling back to the denormalised
  // student.* columns for legacy students with no guardian row.
  public async bulkClassRoster(
    schoolId: string,
    classId: string,
    academicYearId: string
  ): Promise<BulkClassRosterRow[]> {
    return (await DB.query(
      singleLineString`
        select
          s.uuid, s.admission_number, s.name, s.admission_date, s.house_id,
          s.exam_only, s.rte, sc.roll_number,
          f.uuid as father_guardian_id,
          coalesce(f.mobile, s.father_mobile) as father_mobile,
          coalesce(f.whatsapp, s.father_whatsapp) as father_whatsapp,
          m.uuid as mother_guardian_id,
          coalesce(m.mobile, s.mother_mobile) as mother_mobile,
          coalesce(m.whatsapp, s.mother_whatsapp) as mother_whatsapp,
          g.uuid as guardian_guardian_id,
          coalesce(g.mobile, s.guardian_mobile) as guardian_mobile,
          coalesce(g.whatsapp, s.guardian_whatsapp) as guardian_whatsapp
        from student_class sc
        join student s on s.uuid = sc.student_id and s.school_id = sc.school_id
        left join lateral (
          select uuid, mobile, whatsapp from student_guardian
          where student_id = s.uuid and school_id = s.school_id and status = 'active' and relation = 'father'
          order by created_at limit 1
        ) f on true
        left join lateral (
          select uuid, mobile, whatsapp from student_guardian
          where student_id = s.uuid and school_id = s.school_id and status = 'active' and relation = 'mother'
          order by created_at limit 1
        ) m on true
        left join lateral (
          select uuid, mobile, whatsapp from student_guardian
          where student_id = s.uuid and school_id = s.school_id and status = 'active' and relation = 'guardian'
          order by created_at limit 1
        ) g on true
        where sc.school_id = $1 and sc.class_id = $2 and sc.academic_year_id = $3
          and (sc.status is null or sc.status <> 'deleted') and s.status <> 'deleted'
        order by s.admission_date asc nulls last, s.admission_number asc
      `,
      [schoolId, classId, academicYearId]
    )) as BulkClassRosterRow[];
  }

  private isUniqueViolation(e: any): boolean {
    return !!e && (e.code === '23505' || /duplicate key|unique constraint/i.test(String(e?.message || '')));
  }

  // Apply staged grid edits for one class + year. Roll numbers, house and contacts
  // are written independently per student and failures are reported per row (a
  // duplicate roll never loses the rest). Roll numbers get a validate-then-write pass
  // so a re-sequencing / swap inside the selection can't trip the unique index, and a
  // roll that collides with a student OUTSIDE the selection is reported, not forced.
  public async bulkUpdate(
    data: BulkUpdateRequest,
    schoolId: string,
    userId: string
  ): Promise<BulkUpdateResult> {
    const { classId, academicYearId, items } = data;
    if (!classId || !academicYearId) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, 'classId and academicYearId are required');
    }
    await this.assertBelongsToSchool('class', classId, schoolId, 'class');
    await this.assertBelongsToSchool('academic_year', academicYearId, schoolId, 'academic year');
    if (!Array.isArray(items) || items.length === 0) {
      return { updated: 0, failed: 0, results: [] };
    }

    const errors = new Map<string, string>();
    const touched = new Set<string>();

    // Full roster for the class+year (not just the selection) — enrolment row + its
    // current roll, needed both to target roll writes and to validate roll conflicts
    // against students that weren't edited.
    const enrolRows = await DB.query(
      singleLineString`
        select student_id, uuid, roll_number from student_class
        where school_id = $1 and class_id = $2 and academic_year_id = $3
          and (status is null or status <> 'deleted')
      `,
      [schoolId, classId, academicYearId]
    );
    const enrolByStudent = new Map<string, { uuid: string; roll: number | null }>();
    for (const e of enrolRows) enrolByStudent.set(e.studentId, { uuid: e.uuid, roll: e.rollNumber ?? null });

    // Validate the houses referenced by the batch once.
    const houseIds = Array.from(new Set(items.map((it) => it.houseId).filter((h): h is string => !!h)));
    const validHouses = new Set<string>();
    if (houseIds.length > 0) {
      const rows = await DB.query(
        `select uuid from house where school_id = $1 and status = 'active' and uuid = any($2)`,
        [schoolId, houseIds]
      );
      for (const r of rows) validHouses.add(r.uuid);
    }

    // ---- Roll numbers: build the final roll map for the whole class, then resolve
    // conflicts by reverting the (batch) students involved, until it's collision-free.
    const finalRoll = new Map<string, number | null>();
    for (const [sid, info] of enrolByStudent) finalRoll.set(sid, info.roll);
    const changers = new Set<string>(); // batch students whose roll change still stands
    for (const it of items) {
      if (it.rollNumber === undefined) continue;
      if (!enrolByStudent.has(it.studentId)) continue; // handled in the per-student pass
      finalRoll.set(it.studentId, it.rollNumber === null ? null : it.rollNumber);
      changers.add(it.studentId);
    }
    // Iteratively drop conflicting changers (converges: each pass reverts ≥1 changer).
    for (;;) {
      const byRoll = new Map<string, string[]>();
      for (const [sid, roll] of finalRoll) {
        if (roll === null || roll === undefined) continue;
        const k = String(roll);
        const arr = byRoll.get(k);
        if (arr) arr.push(sid); else byRoll.set(k, [sid]);
      }
      let reverted = false;
      for (const [k, sids] of byRoll) {
        if (sids.length < 2) continue;
        for (const sid of sids) {
          if (changers.has(sid)) {
            errors.set(sid, `Roll number ${k} is already taken in this class`);
            finalRoll.set(sid, enrolByStudent.get(sid)!.roll); // revert to current
            changers.delete(sid);
            reverted = true;
          }
        }
      }
      if (!reverted) break;
    }

    // Apply the surviving roll changes: clear them all first so a permutation writes
    // cleanly, then set. The set is now guaranteed collision-free.
    const rollWriterIds = items
      .filter((it) => changers.has(it.studentId))
      .map((it) => enrolByStudent.get(it.studentId)!.uuid);
    if (rollWriterIds.length > 0) {
      await DB.query(
        `update student_class set roll_number = null, updatedby_userid = $1, updated_at = $2 where uuid = any($3) and school_id = $4`,
        [userId, new Date(), rollWriterIds, schoolId]
      );
      for (const it of items) {
        if (!changers.has(it.studentId)) continue;
        const enrol = enrolByStudent.get(it.studentId)!;
        const roll = finalRoll.get(it.studentId) ?? null;
        try {
          await DB.query(
            `update student_class set roll_number = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
            [roll, userId, new Date(), enrol.uuid, schoolId]
          );
          touched.add(it.studentId);
        } catch (e: any) {
          // Should not happen post-validation; restore the original roll so a clear
          // isn't left behind, and report it.
          errors.set(it.studentId, this.isUniqueViolation(e) ? `Roll number ${roll} is already taken in this class` : 'Failed to set roll number');
          await DB.query(
            `update student_class set roll_number = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5`,
            [enrol.roll, userId, new Date(), enrol.uuid, schoolId]
          ).catch(() => undefined);
        }
      }
    }

    // ---- House + exam-only + contacts, independent per student ----
    for (const it of items) {
      const sid = it.studentId;
      if (!enrolByStudent.has(sid)) {
        errors.set(sid, 'Not enrolled in this class for the selected year');
        continue;
      }
      if (it.examOnly !== undefined) {
        try {
          await DB.query(
            `update student set exam_only = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5 and status <> 'deleted'`,
            [!!it.examOnly, userId, new Date(), sid, schoolId]
          );
          touched.add(sid);
        } catch {
          errors.set(sid, 'Failed to set exam-only');
        }
      }
      if (it.rte !== undefined) {
        try {
          await DB.query(
            `update student set rte = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5 and status <> 'deleted'`,
            [!!it.rte, userId, new Date(), sid, schoolId]
          );
          touched.add(sid);
        } catch {
          errors.set(sid, 'Failed to set RTE');
        }
      }
      if (it.houseId !== undefined) {
        if (it.houseId && !validHouses.has(it.houseId)) {
          errors.set(sid, 'Invalid house');
        } else {
          try {
            await DB.query(
              `update student set house_id = $1, updatedby_userid = $2, updated_at = $3 where uuid = $4 and school_id = $5 and status <> 'deleted'`,
              [it.houseId || null, userId, new Date(), sid, schoolId]
            );
            touched.add(sid);
          } catch {
            errors.set(sid, 'Failed to set house');
          }
        }
      }
      if (it.contacts) {
        try {
          await studentGuardianService.setContacts(sid, it.contacts, schoolId, userId);
          touched.add(sid);
        } catch (e: any) {
          errors.set(sid, e?.message || 'Failed to update contacts');
        }
      }
    }

    const results = items.map((it) => ({
      studentId: it.studentId,
      ok: !errors.has(it.studentId),
      error: errors.get(it.studentId),
    }));
    const failed = results.filter((r) => !r.ok).length;
    const updated = results.filter((r) => r.ok && touched.has(r.studentId)).length;
    return { updated, failed, results };
  }

  public async getDetail(id: string, schoolId: string): Promise<StudentDetail | null> {
    const rows = await DB.query(
      singleLineString`
        select
          s.uuid, s.admission_number, s.name, s.gender, s.dob, s.family_unique_number,
          s.communication_preference, s.old_admission_number, s.status, s.school_id,
          s.house_id, h.name as house_name, h.color as house_color,
          s.student_email, s.student_mobile, s.student_whatsapp, s.category_code, s.nationality_code,
          s.mother_tongue_code, s.blood_group_code, s.aadhaar_number, s.previous_school,
          s.admission_date, s.withdrawal_date, s.withdrawal_remarks, s.exam_only, s.exam_only_reason, s.rte,
          cur.academic_year_id as current_academic_year_id,
          cur.academic_year_name as current_academic_year_name,
          cur.class_id as current_class_id,
          cur.class_name as current_class_name,
          cur.stream_code as current_stream_code,
          cur.stream_name as current_stream_name,
          cur.roll_number as current_roll_number,
          ct.class_teacher_name, ct.class_teacher_mobile, ct.class_teacher_whatsapp,
          ct.class_teacher_subjects,
          (select fs.uuid from file_storage fs
             where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id
               and (fs.variant = 'original' or fs.variant is null)
             order by fs.created_at desc limit 1) as photo_id,
          (select fs.uuid from file_storage fs
             where fs.entity_type = 'student' and fs.entity_id = s.uuid and fs.school_id = s.school_id
               and fs.variant = 'thumb'
             order by fs.created_at desc limit 1) as photo_thumb_id
        from student s
        left join house h on s.house_id = h.uuid
        left join lateral (
          select sc.academic_year_id, ay.name as academic_year_name,
                 sc.class_id, c.name as class_name, sc.stream_code, cs.name as stream_name, sc.roll_number
          from student_class sc
          join academic_year ay on sc.academic_year_id = ay.uuid
          left join class c on sc.class_id = c.uuid
          left join class_stream cs on cs.school_id = sc.school_id and lower(cs.code) = lower(sc.stream_code) and cs.status = 'active'
          where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
          order by ay.start_date desc nulls last limit 1
        ) cur on true
        left join lateral (
          select e.name as class_teacher_name, e.mobile as class_teacher_mobile,
                 e.whatsapp as class_teacher_whatsapp,
                 (select string_agg(distinct sub.name, ', ' order by sub.name)
                    from teaching_assignment ta
                    join subject sub on sub.uuid = ta.subject_id and sub.school_id = ta.school_id
                    where ta.school_id = s.school_id and ta.class_id = cur.class_id
                      and ta.academic_year_id = cur.academic_year_id
                      and ta.teacher_id = ct0.teacher_id and ta.status = 'active') as class_teacher_subjects
          from class_teacher ct0
          join employee e on e.uuid = ct0.teacher_id and e.school_id = ct0.school_id
          where ct0.school_id = s.school_id and ct0.class_id = cur.class_id
            and ct0.academic_year_id = cur.academic_year_id and ct0.status = 'active'
          limit 1
        ) ct on true
        where s.uuid = $1 and s.school_id = $2 and s.status <> 'deleted'
      `,
      [id, schoolId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];

    const currentEnrollments = (await DB.query(
      singleLineString`
        select sc.uuid, sc.student_id, sc.academic_year_id, ay.name as academic_year_name,
               sc.class_id, c.name as class_name, sc.stream_code, cs.name as stream_name, sc.roll_number, sc.join_date, sc.status
        from student_class sc
        left join academic_year ay on sc.academic_year_id = ay.uuid
        left join class c on sc.class_id = c.uuid
        left join class_stream cs on cs.school_id = sc.school_id and lower(cs.code) = lower(sc.stream_code) and cs.status = 'active'
        where sc.student_id = $1 and sc.school_id = $2 and (sc.status is null or sc.status <> 'deleted')
        order by ay.start_date desc nulls last
      `,
      [id, schoolId]
    )) as EnrollmentRow[];
    const enrollments = await this.buildEnrollmentHistory(
      id,
      schoolId,
      r.oldAdmissionNumber,
      currentEnrollments
    );

    const guardians = await studentGuardianService.list(id, schoolId);
    const addresses = await studentAddressService.list(id, schoolId);
    const siblings = await studentSiblingService.list(id, schoolId);

    // Class teacher of the student's current class (from the timetable module's
    // class_teacher link), with the subject(s) they teach that class. null when the
    // class has no class teacher assigned or the student has no current enrollment.
    const {
      classTeacherName,
      classTeacherMobile,
      classTeacherWhatsapp,
      classTeacherSubjects,
      ...rest
    } = r;
    const classTeacher = classTeacherName
      ? {
          name: classTeacherName,
          mobile: classTeacherMobile ?? null,
          whatsapp: classTeacherWhatsapp ?? null,
          subjects: classTeacherSubjects ?? null,
        }
      : null;

    // Effective (stream-specific) class for the current enrolment — the class whose
    // timetable/syllabus applies. Falls back to the base class when there is no stream.
    // Uses the shared resolver so this stays consistent with syllabus/timetable.
    let currentEffectiveClassId: string | undefined = rest.currentClassId || undefined;
    if (rest.currentClassId && rest.currentAcademicYearId) {
      const eff = await resolveEffectiveClassId(schoolId, id, rest.currentAcademicYearId);
      if (eff) currentEffectiveClassId = eff.classId;
    }

    return { ...rest, currentEffectiveClassId, classTeacher, enrollments, guardians, addresses, siblings } as StudentDetail;
  }

  // Stitches a re-admitted student's earlier years (which live under a separate,
  // now-inactive student row linked by old_admission_number) into one timeline,
  // marking the empty academic years between the two spans as 'gap'.
  //
  // A J->S promotion student (renumbered on reaching Class I, NO break) also carries an
  // old_admission_number; their old record's last year is ADJACENT to the new record's first, so
  // gapYears is empty and the timeline becomes current + historical (junior years), no gap markers.
  private async buildEnrollmentHistory(
    studentId: string,
    schoolId: string,
    oldAdmissionNumber: string | null | undefined,
    current: EnrollmentRow[]
  ): Promise<EnrollmentRow[]> {
    const currentTagged: EnrollmentRow[] = current.map((e) => ({ ...e, kind: 'current' }));
    if (!oldAdmissionNumber || current.length === 0) return currentTagged;

    // Old (superseded) record's years — already EnrollmentRow-shaped after case transform.
    const oldRows = (await DB.query(
      singleLineString`
        select sc.uuid, prev.uuid as student_id, sc.academic_year_id, ay.name as academic_year_name,
               sc.class_id, c.name as class_name, sc.stream_code, sc.roll_number, sc.join_date, sc.status
        from student prev
        join student_class sc on sc.student_id = prev.uuid and sc.school_id = prev.school_id
          and (sc.status is null or sc.status <> 'deleted')
        join academic_year ay on ay.uuid = sc.academic_year_id
        left join class c on c.uuid = sc.class_id
        where prev.school_id = $1 and lower(prev.admission_number) = lower($2)
        order by ay.start_date desc
      `,
      [schoolId, oldAdmissionNumber]
    )) as EnrollmentRow[];
    if (oldRows.length === 0) return currentTagged;

    // The gap = academic years the school ran STRICTLY BETWEEN the old record's last
    // year and the current record's first year. For a J->S promotion this is empty.
    const gapYears = (await DB.query(
      singleLineString`
        select ay.uuid, ay.name from academic_year ay
        where ay.school_id = $1
          and ay.start_date > (
            select max(a2.start_date) from student_class sc2
            join academic_year a2 on a2.uuid = sc2.academic_year_id
            join student prev on prev.uuid = sc2.student_id and prev.school_id = sc2.school_id
            where prev.school_id = $1 and lower(prev.admission_number) = lower($2)
              and (sc2.status is null or sc2.status <> 'deleted'))
          and ay.start_date < (
            select min(a3.start_date) from student_class sc3
            join academic_year a3 on a3.uuid = sc3.academic_year_id
            where sc3.student_id = $3 and sc3.school_id = $1
              and (sc3.status is null or sc3.status <> 'deleted'))
        order by ay.start_date desc
      `,
      [schoolId, oldAdmissionNumber, studentId]
    )) as Array<{ uuid: string; name: string }>;

    const gapRows: EnrollmentRow[] = gapYears.map((g) => ({
      uuid: `gap-${g.uuid}`,
      academicYearId: g.uuid,
      academicYearName: g.name,
      status: 'gap',
      kind: 'gap',
    }));
    // dedup: never show an old-record year the current record already covers (safety if the two
    // records ever overlap a year).
    const currentYearIds = new Set(current.map((e) => e.academicYearId));
    const historicalRows: EnrollmentRow[] = oldRows
      .filter((e) => !currentYearIds.has(e.academicYearId))
      .map((e) => ({ ...e, kind: 'historical' }));

    // newest-first: current years, then any gap markers, then the old (junior) years. A contiguous
    // J->S renumbering has no gap, so this is simply current + historical — one continuous timeline
    // (consistent with the Dues prev-years, which also chains to the old admission).
    return [...currentTagged, ...gapRows, ...historicalRows];
  }

  // ---- Credentials (god/admin only, gated in the UI — mirrors employee) ----

  // Resolve a student's family login row (username = family_unique_number).
  private async getFamilyNumber(studentId: string, schoolId: string): Promise<string | null> {
    const rows = await DB.query(
      singleLineString`
        select family_unique_number from student
        where uuid = $1 and school_id = $2 and (status is null or status <> 'deleted')
      `,
      [studentId, schoolId]
    );
    const family = (rows[0]?.familyUniqueNumber || '').trim();
    return family || null;
  }

  public async getCredentials(
    studentId: string,
    schoolId: string
  ): Promise<{ username: string; password: string; displayName: string } | null> {
    const family = await this.getFamilyNumber(studentId, schoolId);
    if (!family) return null;

    const logins = await DB.query(
      singleLineString`
        select username, password, display_name from student_login
        where username = $1 and school_id = $2
      `,
      [family, schoolId]
    );
    if (logins.length === 0) return null;

    return {
      username: logins[0].username,
      password: logins[0].password,
      displayName: logins[0].displayName,
    };
  }

  public async resetPassword(studentId: string, schoolId: string, userId: string): Promise<boolean> {
    const family = await this.getFamilyNumber(studentId, schoolId);
    if (!family) return false;

    const logins = await DB.query(
      singleLineString`select uuid from student_login where username = $1 and school_id = $2`,
      [family, schoolId]
    );
    if (logins.length === 0) return false;

    await DB.query(
      singleLineString`
        update student_login
        set password = $1, updatedby_userid = $2, updated_at = $3
        where username = $4 and school_id = $5
      `,
      [DEFAULT_PASSWORD, userId, new Date(), family, schoolId]
    );
    return true;
  }
}

export const studentAdminService = new StudentAdminService();
