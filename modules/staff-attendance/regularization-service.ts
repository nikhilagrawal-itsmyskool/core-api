import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult, NotFoundResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';

const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const KINDS = ['missing_in', 'missing_out', 'missing_both', 'late', 'absent', 'other'];

function assertHHMM(label: string, v: any): void {
  if (v == null || v === '') return;
  if (!/^\d{1,2}:\d{2}$/.test(String(v)) || Number(String(v).split(':')[0]) > 23 || Number(String(v).split(':')[1]) > 59) {
    throw new BusinessErrorResult(ErrorCode.InvalidInput, `${label} must be HH:MM`);
  }
}

class RegularizationService {
  private async audit(schoolId: string, id: string, action: string, actor: string, detail: any): Promise<void> {
    await DB.query(
      singleLineString`insert into staff_attendance_audit
        (uuid, school_id, entity_type, entity_id, action, actor_userid, detail, created_at)
        values ($1,$2,'regularization',$3,$4,$5,$6, now())`,
      [generateShortUuid(12), schoolId, id, action, actor, JSON.stringify(detail || {})],
    );
  }

  async apply(schoolId: string, employeeId: string, data: any): Promise<any> {
    if (!data.attDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(data.attDate))) {
      throw new BusinessErrorResult(ErrorCode.InvalidInput, 'attDate (YYYY-MM-DD) is required');
    }
    if (!KINDS.includes(data.kind)) throw new BusinessErrorResult(ErrorCode.InvalidInput, `kind must be one of ${KINDS.join(', ')}`);
    if (!data.reason || !String(data.reason).trim()) throw new BusinessErrorResult(ErrorCode.InvalidInput, 'A reason is required');
    assertHHMM('claimedIn', data.claimedIn);
    assertHHMM('claimedOut', data.claimedOut);

    const open = await DB.query(
      singleLineString`select uuid from staff_attendance_regularization
        where employee_id = $1 and att_date = $2 and status = 'open'`,
      [employeeId, data.attDate],
    );
    if (open.length) throw new BusinessErrorResult(ErrorCode.BusinessError, 'A regularization request for this date is already pending');

    const uuid = generateShortUuid(12);
    await DB.query(
      singleLineString`insert into staff_attendance_regularization
        (uuid, school_id, employee_id, att_date, kind, claimed_in, claimed_out, reason, status, createdby_userid, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9, now(), now())`,
      [uuid, schoolId, employeeId, data.attDate, data.kind, data.claimedIn || null, data.claimedOut || null, String(data.reason).trim(), employeeId],
    );
    await this.audit(schoolId, uuid, 'apply', employeeId, { attDate: data.attDate, kind: data.kind });
    return this.getOne(schoolId, uuid);
  }

  async cancel(schoolId: string, employeeId: string, id: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select * from staff_attendance_regularization where uuid = $1 and school_id = $2`, [id, schoolId]);
    if (!rows.length) throw new NotFoundResult(ErrorCode.InvalidId, 'Request not found');
    const r = rows[0];
    if (r.employeeId !== employeeId) throw new BusinessErrorResult(ErrorCode.BusinessError, 'Not your request');
    if (r.status !== 'open') throw new BusinessErrorResult(ErrorCode.BusinessError, `Cannot cancel a ${r.status} request`);
    await DB.query(
      singleLineString`update staff_attendance_regularization set status = 'cancelled', updated_at = now() where uuid = $1`, [id]);
    await this.audit(schoolId, id, 'cancel', employeeId, {});
    return this.getOne(schoolId, id);
  }

  async decide(schoolId: string, userId: string, id: string, approve: boolean, comment?: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select * from staff_attendance_regularization where uuid = $1 and school_id = $2`, [id, schoolId]);
    if (!rows.length) throw new NotFoundResult(ErrorCode.InvalidId, 'Request not found');
    if (rows[0].status !== 'open') throw new BusinessErrorResult(ErrorCode.BusinessError, `Request is already ${rows[0].status}`);
    const status = approve ? 'approved' : 'rejected';
    await DB.query(
      singleLineString`update staff_attendance_regularization
        set status = $2, decided_by = $3, decided_at = now(), decision_comment = $4, updatedby_userid = $3, updated_at = now()
        where uuid = $1`,
      [id, status, userId, comment || null],
    );
    await this.audit(schoolId, id, approve ? 'approve' : 'reject', userId, { comment: comment || null });
    return this.getOne(schoolId, id);
  }

  async getOne(schoolId: string, id: string): Promise<any> {
    const rows = await DB.query(
      singleLineString`select r.*, to_char(r.att_date,'YYYY-MM-DD') as att_date, e.name as employee_name
        from staff_attendance_regularization r
        left join employee e on e.uuid = r.employee_id
        where r.uuid = $1 and r.school_id = $2`,
      [id, schoolId],
    );
    return rows[0] || null;
  }

  // Oversight queue (default: open requests).
  async list(schoolId: string, filter: { status?: string; employeeId?: string }): Promise<any[]> {
    return DB.query(
      singleLineString`select r.*, to_char(r.att_date,'YYYY-MM-DD') as att_date, e.name as employee_name
        from staff_attendance_regularization r
        left join employee e on e.uuid = r.employee_id
        where r.school_id = $1
          and ($2::text is null or r.status = $2)
          and ($3::text is null or r.employee_id = $3)
        order by (case when r.status = 'open' then 0 else 1 end), r.att_date desc, r.created_at desc
        limit 500`,
      [schoolId, filter.status || null, filter.employeeId || null],
    );
  }

  async myList(schoolId: string, employeeId: string): Promise<any[]> {
    return this.list(schoolId, { employeeId });
  }
}

export const regularizationService = new RegularizationService();
