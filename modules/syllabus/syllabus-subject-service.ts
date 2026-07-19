import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  CreateSubjectRequest,
  SyllabusSubject,
  UpdateSubjectRequest,
} from "./syllabus-interfaces";
import { DEFAULTS } from "./syllabus-constants";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const SUBJECT_COLS = singleLineString`
  uuid, school_id, name, description, status
`;

class SyllabusSubjectService {
  public async create(
    data: CreateSubjectRequest,
    schoolId: string,
    userId: string,
  ): Promise<SyllabusSubject> {
    if (!data.name || !data.name.trim()) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "name is required",
      );
    }
    await this.assertNameFree(schoolId, data.name, null);
    const uuid = generateShortUuid(12);
    const rows = await DB.query(
      singleLineString`
        insert into syllabus_subject (uuid, school_id, name, description, status, createdby_userid, created_at)
        values ($1, $2, $3, $4, $5, $6, $7)
        returning ${SUBJECT_COLS}
      `,
      [
        uuid,
        schoolId,
        data.name.trim(),
        data.description?.trim() || null,
        DEFAULTS.STATUS,
        userId,
        new Date(),
      ],
    );
    return rows[0];
  }

  public async update(
    id: string,
    data: UpdateSubjectRequest,
    schoolId: string,
    userId: string,
  ): Promise<SyllabusSubject | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;
    if (data.name !== undefined) {
      if (!data.name.trim())
        throw new BusinessErrorResult(
          ErrorCode.BusinessError,
          "name cannot be blank",
        );
      await this.assertNameFree(schoolId, data.name, id);
    }

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => {
      updates.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (data.name !== undefined) set("name", data.name.trim());
    if (data.description !== undefined)
      set("description", data.description?.trim() || null);

    if (updates.length === 0) return existing;
    set("updatedby_userid", userId);
    set("updated_at", new Date());
    params.push(id, schoolId);

    const rows = await DB.query(
      singleLineString`
        update syllabus_subject set ${updates.join(", ")}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning ${SUBJECT_COLS}
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(
    id: string,
    schoolId: string,
    userId: string,
  ): Promise<boolean> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;
    const inUse = await DB.query(
      singleLineString`select 1 from syllabus where subject_id = $1 and school_id = $2 and status = 'active' limit 1`,
      [id, schoolId],
    );
    if (inUse.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "Subject is used by a syllabus plan and cannot be deleted",
      );
    }
    await DB.query(
      singleLineString`
        update syllabus_subject set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
    return true;
  }

  public async getById(
    id: string,
    schoolId: string,
  ): Promise<SyllabusSubject | null> {
    const rows = await DB.query(
      singleLineString`select ${SUBJECT_COLS} from syllabus_subject where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async list(
    schoolId: string,
    search?: string,
  ): Promise<SyllabusSubject[]> {
    const params: any[] = [schoolId];
    let query = singleLineString`select ${SUBJECT_COLS} from syllabus_subject where school_id = $1 and status = 'active'`;
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      query += ` and lower(name) like lower($2)`;
    }
    query += ` order by name`;
    return DB.query(query, params);
  }

  private async assertNameFree(
    schoolId: string,
    name: string,
    excludeId: string | null,
  ): Promise<void> {
    const params: any[] = [schoolId, name.trim()];
    let query = singleLineString`
      select uuid from syllabus_subject where school_id = $1 and lower(name) = lower($2) and status = 'active'
    `;
    if (excludeId) {
      params.push(excludeId);
      query += ` and uuid != $3`;
    }
    const rows = await DB.query(query, params);
    if (rows.length > 0) {
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `A subject named "${name.trim()}" already exists`,
      );
    }
  }
}

export const syllabusSubjectService = new SyllabusSubjectService();
