import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import {
  CreateStudentRequest,
  UpdateStudentRequest,
  StudentDetail,
} from './student-interfaces';
import { DEFAULTS } from './student-constants';
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
         student_email, student_mobile, category_code, nationality_code,
         mother_tongue_code, blood_group_code, aadhaar_number, previous_school,
         admission_date, withdrawal_date, withdrawal_remarks, status,
         school_id, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22, $23, $24)
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
        data.categoryCode || null,
        data.nationalityCode || null,
        data.motherTongueCode || null,
        data.bloodGroupCode || null,
        data.aadhaarNumber || null,
        data.previousSchool || null,
        data.admissionDate || null,
        data.withdrawalDate || null,
        data.withdrawalRemarks || null,
        DEFAULTS.STATUS,
        schoolId,
        userId,
        now,
      ]
    );

    // Optional initial enrollment.
    if (data.classId && data.academicYearId) {
      await DB.query(
        singleLineString`
          insert into student_class
          (uuid, student_id, academic_year_id, class_id, roll_number, join_date, status,
           school_id, createdby_userid, created_at)
          values ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9)
          on conflict (student_id, academic_year_id, class_id, school_id) do nothing
        `,
        [
          generateShortUuid(12),
          uuid,
          data.academicYearId,
          data.classId,
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
    if (data.categoryCode !== undefined) set('category_code', data.categoryCode);
    if (data.nationalityCode !== undefined) set('nationality_code', data.nationalityCode);
    if (data.motherTongueCode !== undefined) set('mother_tongue_code', data.motherTongueCode);
    if (data.bloodGroupCode !== undefined) set('blood_group_code', data.bloodGroupCode);
    if (data.aadhaarNumber !== undefined) set('aadhaar_number', data.aadhaarNumber);
    if (data.previousSchool !== undefined) set('previous_school', data.previousSchool);
    if (data.admissionDate !== undefined) set('admission_date', data.admissionDate);
    if (data.withdrawalDate !== undefined) set('withdrawal_date', data.withdrawalDate);
    if (data.withdrawalRemarks !== undefined) set('withdrawal_remarks', data.withdrawalRemarks);
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

  public async getDetail(id: string, schoolId: string): Promise<StudentDetail | null> {
    const rows = await DB.query(
      singleLineString`
        select
          s.uuid, s.admission_number, s.name, s.gender, s.dob, s.family_unique_number,
          s.communication_preference, s.old_admission_number, s.status, s.school_id,
          s.house_id, h.name as house_name, h.color as house_color,
          s.student_email, s.student_mobile, s.category_code, s.nationality_code,
          s.mother_tongue_code, s.blood_group_code, s.aadhaar_number, s.previous_school,
          s.admission_date, s.withdrawal_date, s.withdrawal_remarks,
          cur.academic_year_id as current_academic_year_id,
          cur.academic_year_name as current_academic_year_name,
          cur.class_id as current_class_id,
          cur.class_name as current_class_name,
          cur.roll_number as current_roll_number,
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
                 sc.class_id, c.name as class_name, sc.roll_number
          from student_class sc
          join academic_year ay on sc.academic_year_id = ay.uuid
          left join class c on sc.class_id = c.uuid
          where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
          order by ay.start_date desc nulls last limit 1
        ) cur on true
        where s.uuid = $1 and s.school_id = $2 and s.status <> 'deleted'
      `,
      [id, schoolId]
    );
    if (rows.length === 0) return null;
    const r = rows[0];

    const enrollments = await DB.query(
      singleLineString`
        select sc.uuid, sc.academic_year_id, ay.name as academic_year_name,
               sc.class_id, c.name as class_name, sc.roll_number, sc.join_date, sc.status
        from student_class sc
        left join academic_year ay on sc.academic_year_id = ay.uuid
        left join class c on sc.class_id = c.uuid
        where sc.student_id = $1 and sc.school_id = $2 and (sc.status is null or sc.status <> 'deleted')
        order by ay.start_date desc nulls last
      `,
      [id, schoolId]
    );

    const guardians = await studentGuardianService.list(id, schoolId);
    const addresses = await studentAddressService.list(id, schoolId);
    const siblings = await studentSiblingService.list(id, schoolId);

    return { ...r, enrollments, guardians, addresses, siblings } as StudentDetail;
  }
}

export const studentAdminService = new StudentAdminService();
