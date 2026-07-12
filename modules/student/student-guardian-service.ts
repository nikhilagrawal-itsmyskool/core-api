import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { Guardian, CreateGuardianRequest, UpdateGuardianRequest } from './student-interfaces';
import { GUARDIAN_RELATIONS, DEFAULTS } from './student-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class StudentGuardianService {
  public async list(studentId: string, schoolId: string): Promise<Guardian[]> {
    return DB.query(
      singleLineString`
        select g.*,
          (select fs.uuid from file_storage fs
             where fs.entity_type = 'guardian' and fs.entity_id = g.uuid and fs.school_id = g.school_id
               and (fs.variant = 'original' or fs.variant is null)
             order by fs.created_at desc limit 1) as photo_id,
          (select fs.uuid from file_storage fs
             where fs.entity_type = 'guardian' and fs.entity_id = g.uuid and fs.school_id = g.school_id
               and fs.variant = 'thumb'
             order by fs.created_at desc limit 1) as photo_thumb_id
        from student_guardian g
        where g.student_id = $1 and g.school_id = $2 and g.status = 'active'
        order by
          case g.relation when 'father' then 1 when 'mother' then 2 when 'guardian' then 3 else 4 end,
          g.created_at
      `,
      [studentId, schoolId]
    );
  }

  public async getById(id: string, schoolId: string): Promise<Guardian | null> {
    const rows = await DB.query(
      singleLineString`
        select * from student_guardian
        where uuid = $1 and school_id = $2 and status = 'active'
      `,
      [id, schoolId]
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async create(
    studentId: string,
    data: CreateGuardianRequest,
    schoolId: string,
    userId: string
  ): Promise<Guardian> {
    if (!data.relation || !(GUARDIAN_RELATIONS as readonly string[]).includes(data.relation)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `relation must be one of: ${GUARDIAN_RELATIONS.join(', ')}`
      );
    }

    const uuid = generateShortUuid(12);
    const now = new Date();
    const rows = await DB.query(
      singleLineString`
        insert into student_guardian
        (uuid, school_id, student_id, relation, relationship, name, occupation,
         designation, organisation, education, address,
         mobile, whatsapp, email, is_primary_contact, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        returning *
      `,
      [
        uuid,
        schoolId,
        studentId,
        data.relation,
        data.relationship || null,
        data.name || null,
        data.occupation || null,
        data.designation || null,
        data.organisation || null,
        data.education || null,
        data.address || null,
        data.mobile || null,
        data.whatsapp || null,
        data.email || null,
        data.isPrimaryContact ?? null,
        DEFAULTS.STATUS,
        userId,
        now,
      ]
    );
    return rows[0];
  }

  public async update(
    id: string,
    data: UpdateGuardianRequest,
    schoolId: string,
    userId: string
  ): Promise<Guardian | null> {
    if (data.relation !== undefined && !(GUARDIAN_RELATIONS as readonly string[]).includes(data.relation)) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `relation must be one of: ${GUARDIAN_RELATIONS.join(', ')}`
      );
    }

    const fields: string[] = [];
    const params: any[] = [];
    const set = (col: string, val: any) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };

    if (data.relation !== undefined) set('relation', data.relation);
    if (data.relationship !== undefined) set('relationship', data.relationship);
    if (data.name !== undefined) set('name', data.name);
    if (data.occupation !== undefined) set('occupation', data.occupation);
    if (data.designation !== undefined) set('designation', data.designation);
    if (data.organisation !== undefined) set('organisation', data.organisation);
    if (data.education !== undefined) set('education', data.education);
    if (data.address !== undefined) set('address', data.address);
    if (data.mobile !== undefined) set('mobile', data.mobile);
    if (data.whatsapp !== undefined) set('whatsapp', data.whatsapp);
    if (data.email !== undefined) set('email', data.email);
    if (data.isPrimaryContact !== undefined) set('is_primary_contact', data.isPrimaryContact);

    if (fields.length === 0) return this.getById(id, schoolId);

    set('updatedby_userid', userId);
    set('updated_at', new Date());
    params.push(id, schoolId);

    const rows = await DB.query(
      `update student_guardian set ${fields.join(', ')}
       where uuid = $${params.length - 1} and school_id = $${params.length} and status = 'active'
       returning *`,
      params
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`
        update student_guardian set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
        returning uuid
      `,
      [userId, new Date(), id, schoolId]
    );
    return rows.length > 0;
  }
}

export const studentGuardianService = new StudentGuardianService();
