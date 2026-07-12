import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { StudentTc, CreateTcRequest, UpdateTcRequest } from './transfer-interfaces';
import { TC_STATUS_VALUES, DEFAULTS } from './transfer-constants';
import { findStudent } from './transfer-common';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const TC_COLUMNS = singleLineString`
  uuid, school_id, student_id, application_date, srn_number, issue_date,
  reason_for_leaving, total_attendance_days, total_working_days, status
`;

// Transfer Certificate lifecycle for a student. Issuing a TC withdraws the
// student (student.status -> inactive, withdrawal_date set) via the shared DB.
class TransferService {
  private assertStatus(status: string | undefined): void {
    if (status !== undefined && !(TC_STATUS_VALUES as readonly string[]).includes(status)) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `status must be one of: ${TC_STATUS_VALUES.join(', ')}`);
    }
  }

  public async listForStudent(studentId: string, schoolId: string): Promise<StudentTc[]> {
    return DB.query(
      singleLineString`
        select ${TC_COLUMNS} from student_tc
        where student_id = $1 and school_id = $2 and status <> 'deleted'
        order by created_at desc
      `,
      [studentId, schoolId]
    );
  }

  // School-wide TC list with optional text search (student name / admission number)
  // and status filter. Returns denormalized student name + admission + current class.
  public async listAll(
    schoolId: string,
    opts: { query?: string; status?: string } = {}
  ): Promise<any[]> {
    const params: any[] = [schoolId];
    const filters: string[] = [`tc.school_id = $1`, `tc.status <> 'deleted'`, `s.status <> 'deleted'`];
    if (opts.query && opts.query.trim()) {
      params.push(`%${opts.query.trim()}%`);
      filters.push(`(s.name ilike $${params.length} or s.admission_number ilike $${params.length})`);
    }
    if (opts.status && (TC_STATUS_VALUES as readonly string[]).includes(opts.status)) {
      params.push(opts.status);
      filters.push(`tc.status = $${params.length}`);
    }
    return DB.query(
      singleLineString`
        select tc.uuid, tc.student_id, tc.application_date, tc.srn_number, tc.issue_date,
               tc.reason_for_leaving, tc.total_attendance_days, tc.total_working_days, tc.status,
               s.name as student_name, s.admission_number,
               cur.class_name
        from student_tc tc
        join student s on s.uuid = tc.student_id and s.school_id = tc.school_id
        left join lateral (
          select c.name as class_name
          from student_class sc
          join academic_year ay on sc.academic_year_id = ay.uuid
          left join class c on sc.class_id = c.uuid
          where sc.student_id = s.uuid and (sc.status is null or sc.status <> 'deleted')
          order by ay.start_date desc nulls last limit 1
        ) cur on true
        where ${filters.join(' and ')}
        order by tc.created_at desc
      `,
      params
    );
  }

  public async getById(tcId: string, schoolId: string): Promise<StudentTc | null> {
    const rows = await DB.query(
      singleLineString`select ${TC_COLUMNS} from student_tc where uuid = $1 and school_id = $2 and status <> 'deleted'`,
      [tcId, schoolId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  // Mark the student as withdrawn. Owns the write to the shared `student` row.
  private async withdrawStudent(
    studentId: string,
    schoolId: string,
    withdrawalDate: string | null,
    withdrawalRemarks: string | null,
    userId: string
  ): Promise<void> {
    const fields = ["status = 'inactive'", 'withdrawal_date = $1'];
    const params: any[] = [withdrawalDate || new Date()];
    if (withdrawalRemarks) {
      params.push(withdrawalRemarks);
      fields.push(`withdrawal_remarks = $${params.length}`);
    }
    params.push(userId);
    fields.push(`updatedby_userid = $${params.length}`);
    params.push(new Date());
    fields.push(`updated_at = $${params.length}`);
    params.push(studentId, schoolId);
    await DB.query(
      `update student set ${fields.join(', ')}
       where uuid = $${params.length - 1} and school_id = $${params.length} and status <> 'deleted'`,
      params
    );
  }

  public async create(
    studentId: string,
    data: CreateTcRequest,
    schoolId: string,
    userId: string
  ): Promise<StudentTc> {
    const student = await findStudent(schoolId, studentId);
    if (!student) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Student not found');
    this.assertStatus(data.status);

    const status = data.status || DEFAULTS.STATUS;
    const uuid = generateShortUuid(12);
    const now = new Date();
    await DB.query(
      singleLineString`
        insert into student_tc
        (uuid, school_id, student_id, application_date, srn_number, issue_date,
         reason_for_leaving, total_attendance_days, total_working_days, status,
         createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      [
        uuid,
        schoolId,
        studentId,
        data.applicationDate || null,
        data.srnNumber || null,
        data.issueDate || null,
        data.reasonForLeaving || null,
        data.totalAttendanceDays ?? null,
        data.totalWorkingDays ?? null,
        status,
        userId,
        now,
      ]
    );

    if (status === 'issued') {
      await this.withdrawStudent(studentId, schoolId, data.issueDate || null, null, userId);
    }
    return this.getById(uuid, schoolId) as Promise<StudentTc>;
  }

  public async update(
    tcId: string,
    data: UpdateTcRequest,
    schoolId: string,
    userId: string
  ): Promise<StudentTc | null> {
    const existing = await this.getById(tcId, schoolId);
    if (!existing) return null;
    this.assertStatus(data.status);

    const fields: string[] = [];
    const params: any[] = [];
    const set = (col: string, val: any) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };
    if (data.applicationDate !== undefined) set('application_date', data.applicationDate);
    if (data.srnNumber !== undefined) set('srn_number', data.srnNumber);
    if (data.issueDate !== undefined) set('issue_date', data.issueDate);
    if (data.reasonForLeaving !== undefined) set('reason_for_leaving', data.reasonForLeaving);
    if (data.totalAttendanceDays !== undefined) set('total_attendance_days', data.totalAttendanceDays);
    if (data.totalWorkingDays !== undefined) set('total_working_days', data.totalWorkingDays);
    if (data.status !== undefined) set('status', data.status);

    if (fields.length > 0) {
      set('updatedby_userid', userId);
      set('updated_at', new Date());
      params.push(tcId, schoolId);
      await DB.query(
        `update student_tc set ${fields.join(', ')}
         where uuid = $${params.length - 1} and school_id = $${params.length} and status <> 'deleted'`,
        params
      );
    }

    // Transition into 'issued' withdraws the student.
    if (data.status === 'issued' && existing.status !== 'issued') {
      const issueDate = data.issueDate || existing.issueDate || null;
      await this.withdrawStudent(existing.studentId, schoolId, data.withdrawalDate || issueDate, data.withdrawalRemarks || null, userId);
    }
    return this.getById(tcId, schoolId);
  }
}

export const transferService = new TransferService();
