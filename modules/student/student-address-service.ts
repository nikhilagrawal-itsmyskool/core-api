import { DB, singleLineString } from '../../shared/lib/db';
import { StudentAddress, CreateAddressRequest, UpdateAddressRequest } from './student-interfaces';
import { DEFAULTS } from './student-constants';
import { studentLookupService } from './student-lookup-service';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

// Household addresses for a student. Each row carries is_permanent /
// is_communication flags; a single row can be both (no duplication). At most one
// active row may hold each flag — setting it demotes the others.
class StudentAddressService {
  public async list(studentId: string, schoolId: string): Promise<StudentAddress[]> {
    return DB.query(
      singleLineString`
        select uuid, student_id, school_id, is_permanent, is_communication, line,
               locality_code, city_code, state_code, country_code, pincode, status
        from student_address
        where student_id = $1 and school_id = $2 and status = 'active'
        order by is_communication desc nulls last, created_at
      `,
      [studentId, schoolId]
    );
  }

  private async demoteFlag(
    flag: 'is_permanent' | 'is_communication',
    studentId: string,
    schoolId: string,
    exceptUuid: string | null,
    userId: string
  ): Promise<void> {
    const params: any[] = [userId, new Date(), studentId, schoolId];
    let exclude = '';
    if (exceptUuid) {
      params.push(exceptUuid);
      exclude = `and uuid <> $${params.length}`;
    }
    await DB.query(
      singleLineString`
        update student_address set ${flag} = false, updatedby_userid = $1, updated_at = $2
        where student_id = $3 and school_id = $4 and status = 'active' and ${flag} = true ${exclude}
      `,
      params
    );
  }

  public async create(
    studentId: string,
    data: CreateAddressRequest,
    schoolId: string,
    userId: string
  ): Promise<StudentAddress> {
    const localityCode = await studentLookupService.resolveCode('locality', data.localityCode, schoolId, userId);
    const cityCode = await studentLookupService.resolveCode('city', data.cityCode, schoolId, userId);
    const stateCode = await studentLookupService.resolveCode('state', data.stateCode, schoolId, userId);
    const countryCode = (await studentLookupService.resolveCode('country', data.countryCode, schoolId, userId)) || DEFAULTS.COUNTRY_CODE;

    const uuid = generateShortUuid(12);
    const now = new Date();
    if (data.isPermanent) await this.demoteFlag('is_permanent', studentId, schoolId, null, userId);
    if (data.isCommunication) await this.demoteFlag('is_communication', studentId, schoolId, null, userId);

    const rows = await DB.query(
      singleLineString`
        insert into student_address
        (uuid, school_id, student_id, is_permanent, is_communication, line,
         locality_code, city_code, state_code, country_code, pincode, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        returning uuid, student_id, school_id, is_permanent, is_communication, line,
                  locality_code, city_code, state_code, country_code, pincode, status
      `,
      [
        uuid,
        schoolId,
        studentId,
        data.isPermanent ?? null,
        data.isCommunication ?? null,
        data.line || null,
        localityCode,
        cityCode,
        stateCode,
        countryCode,
        data.pincode || null,
        DEFAULTS.STATUS,
        userId,
        now,
      ]
    );
    return rows[0];
  }

  public async update(
    id: string,
    data: UpdateAddressRequest,
    schoolId: string,
    userId: string
  ): Promise<StudentAddress | null> {
    const existing = await DB.query(
      singleLineString`select student_id from student_address where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId]
    );
    if (existing.length === 0) return null;
    const studentId = existing[0].studentId;

    const fields: string[] = [];
    const params: any[] = [];
    const set = (col: string, val: any) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };

    if (data.isPermanent !== undefined) {
      if (data.isPermanent) await this.demoteFlag('is_permanent', studentId, schoolId, id, userId);
      set('is_permanent', data.isPermanent);
    }
    if (data.isCommunication !== undefined) {
      if (data.isCommunication) await this.demoteFlag('is_communication', studentId, schoolId, id, userId);
      set('is_communication', data.isCommunication);
    }
    if (data.line !== undefined) set('line', data.line);
    if (data.localityCode !== undefined) set('locality_code', await studentLookupService.resolveCode('locality', data.localityCode, schoolId, userId));
    if (data.cityCode !== undefined) set('city_code', await studentLookupService.resolveCode('city', data.cityCode, schoolId, userId));
    if (data.stateCode !== undefined) set('state_code', await studentLookupService.resolveCode('state', data.stateCode, schoolId, userId));
    if (data.countryCode !== undefined) set('country_code', await studentLookupService.resolveCode('country', data.countryCode, schoolId, userId));
    if (data.pincode !== undefined) set('pincode', data.pincode);

    if (fields.length === 0) {
      const rows = await DB.query(
        singleLineString`
          select uuid, student_id, school_id, is_permanent, is_communication, line,
                 locality_code, city_code, state_code, country_code, pincode, status
          from student_address where uuid = $1 and school_id = $2 and status = 'active'
        `,
        [id, schoolId]
      );
      return rows.length > 0 ? rows[0] : null;
    }

    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);
    const rows = await DB.query(
      `update student_address set ${fields.join(', ')}
       where uuid = $${params.length - 1} and school_id = $${params.length} and status = 'active'
       returning uuid, student_id, school_id, is_permanent, is_communication, line,
                 locality_code, city_code, state_code, country_code, pincode, status`,
      params
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`
        update student_address set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
        returning uuid
      `,
      [userId, new Date(), id, schoolId]
    );
    return rows.length > 0;
  }
}

export const studentAddressService = new StudentAddressService();
