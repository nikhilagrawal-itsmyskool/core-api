import { DB, singleLineString } from '../../shared/lib/db';
import { BusinessErrorResult } from '../../shared/lib/errors';
import { ErrorCode } from '../../shared/lib/error-codes';
import { Guardian, CreateGuardianRequest, UpdateGuardianRequest, BulkContacts } from './student-interfaces';
import { GUARDIAN_RELATIONS, DEFAULTS } from './student-constants';
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

class StudentGuardianService {
  // Only one active guardian per student may be the primary contact — clear the
  // flag on the others when a new primary is set.
  private async demoteOtherPrimaries(
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
        update student_guardian set is_primary_contact = false, updatedby_userid = $1, updated_at = $2
        where student_id = $3 and school_id = $4 and status = 'active' and is_primary_contact = true ${exclude}
      `,
      params
    );
  }

  // Mirror the active guardians' phone numbers into the denormalised
  // student.{father,mother,guardian}_{mobile,whatsapp} columns — the ONLY columns
  // the communication ladder reads for reachability. Called after every guardian
  // mutation so a number entered here is actually reachable.
  //
  // Fill-only: a relation's columns are (re)written from its first active guardian
  // row (by created_at) — even to blank if that row's number was cleared — but a
  // relation with NO active guardian row is left untouched. This deliberately does
  // not null out denormalised values that have no backing guardian row (a handful
  // of legacy-synced students), so it can never wipe data.
  private async syncStudentContacts(studentId: string, schoolId: string, userId: string): Promise<void> {
    const guardians = await DB.query(
      singleLineString`
        select relation, mobile, whatsapp from student_guardian
        where student_id = $1 and school_id = $2 and status = 'active'
        order by case relation when 'father' then 1 when 'mother' then 2 when 'guardian' then 3 else 4 end, created_at
      `,
      [studentId, schoolId]
    );

    const fields: string[] = [];
    const params: any[] = [];
    const norm = (v: any) => (v && String(v).trim() ? String(v).trim() : null);
    for (const rel of ['father', 'mother', 'guardian'] as const) {
      const g = guardians.find((row: any) => row.relation === rel);
      if (!g) continue; // no row for this relation → leave its columns as-is
      params.push(norm(g.mobile));
      fields.push(`${rel}_mobile = $${params.length}`);
      params.push(norm(g.whatsapp));
      fields.push(`${rel}_whatsapp = $${params.length}`);
    }
    if (fields.length === 0) return;

    params.push(userId, new Date());
    fields.push(`updatedby_userid = $${params.length - 1}`, `updated_at = $${params.length}`);
    params.push(studentId, schoolId);
    await DB.query(
      `update student set ${fields.join(', ')} where uuid = $${params.length - 1} and school_id = $${params.length}`,
      params
    );
  }

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
    if (data.isPrimaryContact) await this.demoteOtherPrimaries(studentId, schoolId, uuid, userId);
    await this.syncStudentContacts(studentId, schoolId, userId);
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
    if (rows.length > 0 && data.isPrimaryContact) {
      await this.demoteOtherPrimaries(rows[0].studentId, schoolId, id, userId);
    }
    if (rows.length > 0) await this.syncStudentContacts(rows[0].studentId, schoolId, userId);
    return rows.length > 0 ? rows[0] : null;
  }

  // Bulk-edit helper: set a student's father / mother / guardian phone numbers in
  // one shot. For each relation present in `contacts`, updates the FIRST active
  // guardian row (by created_at — the same row syncStudentContacts mirrors), or
  // creates one with a default name ("Father"/"Mother"/"Guardian") when the student
  // has none yet (Decision 1 of the bulk-edit design). Only the fields present in
  // each relation object are written; the contact mirror runs once at the end so the
  // denormalised student.*_mobile/whatsapp columns the comms ladder reads stay in
  // step. No-op relations (nothing to create) are skipped.
  public async setContacts(
    studentId: string,
    contacts: BulkContacts,
    schoolId: string,
    userId: string
  ): Promise<void> {
    const norm = (v: any) => (v !== undefined && v !== null && String(v).trim() ? String(v).trim() : null);
    const has = (o: any, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    let changed = false;

    for (const rel of ['father', 'mother', 'guardian'] as const) {
      const c = (contacts as any)[rel];
      if (!c) continue;
      const setMobile = has(c, 'mobile');
      const setWhatsapp = has(c, 'whatsapp');
      if (!setMobile && !setWhatsapp) continue;

      const existing = await DB.query(
        singleLineString`
          select uuid from student_guardian
          where student_id = $1 and school_id = $2 and status = 'active' and relation = $3
          order by created_at limit 1
        `,
        [studentId, schoolId, rel]
      );

      if (existing.length > 0) {
        const fields: string[] = [];
        const params: any[] = [];
        const set = (col: string, val: any) => { params.push(val); fields.push(`${col} = $${params.length}`); };
        if (setMobile) set('mobile', norm(c.mobile));
        if (setWhatsapp) set('whatsapp', norm(c.whatsapp));
        set('updatedby_userid', userId);
        set('updated_at', new Date());
        params.push(existing[0].uuid, schoolId);
        await DB.query(
          `update student_guardian set ${fields.join(', ')} where uuid = $${params.length - 1} and school_id = $${params.length} and status = 'active'`,
          params
        );
        changed = true;
      } else {
        const mobile = setMobile ? norm(c.mobile) : null;
        const whatsapp = setWhatsapp ? norm(c.whatsapp) : null;
        if (!mobile && !whatsapp) continue; // nothing worth a new record
        const label = rel.charAt(0).toUpperCase() + rel.slice(1); // Father / Mother / Guardian
        await DB.query(
          singleLineString`
            insert into student_guardian
            (uuid, school_id, student_id, relation, name, mobile, whatsapp,
             is_primary_contact, status, createdby_userid, created_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          `,
          [generateShortUuid(12), schoolId, studentId, rel, label, mobile, whatsapp, null, DEFAULTS.STATUS, userId, new Date()]
        );
        changed = true;
      }
    }

    if (changed) await this.syncStudentContacts(studentId, schoolId, userId);
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const rows = await DB.query(
      singleLineString`
        update student_guardian set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
        returning uuid, student_id
      `,
      [userId, new Date(), id, schoolId]
    );
    if (rows.length > 0) await this.syncStudentContacts(rows[0].studentId, schoolId, userId);
    return rows.length > 0;
  }
}

export const studentGuardianService = new StudentGuardianService();
