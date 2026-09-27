import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import {
  CreateUnitRequest,
  ProgrammeUnit,
  TeachView,
  UpdateUnitRequest,
} from "./programmes-interfaces";
import {
  DEFAULTS,
  MONTHS,
  MONTH_VALUES,
  WORKFLOW_STATUS_VALUES,
} from "./programmes-constants";
import { getProgrammeByCode } from "./programme-service";
import { getCurrentAcademicYearId, academicYearExists } from "./programmes-common";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

const UNIT_COLS = singleLineString`
  uuid, school_id, programme_id, academic_year_id, grade, month, title, programme_focus,
  primary_domain_id, fields, focus_skill_ids, workflow_status, version, source_file_id, status
`;

class ProgrammeUnitService {
  // Admin editor list: a programme's units for a grade in a year (summary rows,
  // no field bodies), optionally filtered to one month.
  public async list(
    schoolId: string,
    opts: { programmeCode: string; grade: string; month?: string; academicYearId?: string },
  ): Promise<any[]> {
    const programme = await getProgrammeByCode(schoolId, opts.programmeCode);
    if (!programme) throw new BusinessErrorResult(ErrorCode.BusinessError, "Unknown programme");
    if (!opts.grade || !opts.grade.trim())
      throw new BusinessErrorResult(ErrorCode.BusinessError, "grade is required");
    const yearId = opts.academicYearId || (await getCurrentAcademicYearId(schoolId));
    if (!yearId) return [];

    const params: any[] = [programme.uuid, yearId, opts.grade.trim()];
    let query = singleLineString`
      select uuid, grade, month, title, programme_focus, primary_domain_id,
             coalesce(jsonb_array_length(focus_skill_ids), 0) as focus_skill_count,
             workflow_status, version, source_file_id
      from programme_unit
      where programme_id = $1 and academic_year_id = $2 and lower(grade) = lower($3) and status = 'active'
    `;
    if (opts.month && opts.month.trim()) {
      params.push(opts.month.trim().toLowerCase());
      query += ` and month = $4`;
    }
    query += ` order by array_position($${params.length + 1}::text[], month)`;
    params.push(`{${MONTH_VALUES.join(",")}}`);
    return DB.query(query, params);
  }

  public async getById(id: string, schoolId: string): Promise<ProgrammeUnit | null> {
    const rows = await DB.query(
      singleLineString`select ${UNIT_COLS} from programme_unit where uuid = $1 and school_id = $2 and status = 'active'`,
      [id, schoolId],
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async create(
    data: CreateUnitRequest,
    schoolId: string,
    userId: string,
  ): Promise<ProgrammeUnit> {
    const programme = await getProgrammeByCode(schoolId, data.programmeCode);
    if (!programme) throw new BusinessErrorResult(ErrorCode.BusinessError, "Unknown programme");
    const grade = (data.grade || "").trim();
    const month = (data.month || "").trim().toLowerCase();
    const title = (data.title || "").trim();
    if (!grade) throw new BusinessErrorResult(ErrorCode.BusinessError, "grade is required");
    if (!MONTH_VALUES.includes(month as any))
      throw new BusinessErrorResult(ErrorCode.BusinessError, "month is invalid");
    if (!title) throw new BusinessErrorResult(ErrorCode.BusinessError, "title is required");
    const workflow = this.validWorkflow(data.workflowStatus) || DEFAULTS.WORKFLOW_DRAFT;

    const yearId = data.academicYearId || (await getCurrentAcademicYearId(schoolId));
    if (!yearId) throw new BusinessErrorResult(ErrorCode.BusinessError, "No academic year for this school");
    if (data.academicYearId && !(await academicYearExists(schoolId, yearId)))
      throw new BusinessErrorResult(ErrorCode.BusinessError, "Unknown academic year");

    await this.assertSlotFree(programme.uuid, yearId, grade, month, null);

    const uuid = generateShortUuid(12);
    const rows = await DB.query(
      singleLineString`
        insert into programme_unit
          (uuid, school_id, programme_id, academic_year_id, grade, month, title, programme_focus,
           primary_domain_id, fields, focus_skill_ids, workflow_status, version, source_file_id, status,
           createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        returning ${UNIT_COLS}
      `,
      [
        uuid,
        schoolId,
        programme.uuid,
        yearId,
        grade,
        month,
        title,
        data.programmeFocus?.trim() || null,
        data.primaryDomainId || null,
        JSON.stringify(data.fields || {}),
        JSON.stringify(data.focusSkillIds || []),
        workflow,
        1,
        null,
        DEFAULTS.STATUS,
        userId,
        new Date(),
      ],
    );
    return rows[0];
  }

  public async update(
    id: string,
    data: UpdateUnitRequest,
    schoolId: string,
    userId: string,
  ): Promise<ProgrammeUnit | null> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return null;

    const updates: string[] = [];
    const params: any[] = [];
    let i = 1;
    const set = (col: string, val: any) => {
      updates.push(`${col} = $${i++}`);
      params.push(val);
    };

    if (data.title !== undefined) {
      if (!data.title.trim())
        throw new BusinessErrorResult(ErrorCode.BusinessError, "title cannot be blank");
      set("title", data.title.trim());
    }
    if (data.programmeFocus !== undefined) set("programme_focus", data.programmeFocus?.trim() || null);
    if (data.primaryDomainId !== undefined) set("primary_domain_id", data.primaryDomainId || null);
    if (data.fields !== undefined) set("fields", JSON.stringify(data.fields || {}));
    if (data.focusSkillIds !== undefined) set("focus_skill_ids", JSON.stringify(data.focusSkillIds || []));
    if (data.workflowStatus !== undefined) {
      const w = this.validWorkflow(data.workflowStatus);
      if (!w) throw new BusinessErrorResult(ErrorCode.BusinessError, "workflowStatus is invalid");
      set("workflow_status", w);
    }

    if (updates.length === 0) return existing;
    set("version", (existing.version || 1) + 1);
    set("updatedby_userid", userId);
    set("updated_at", new Date());
    params.push(id, schoolId);

    const rows = await DB.query(
      singleLineString`
        update programme_unit set ${updates.join(", ")}
        where uuid = $${i++} and school_id = $${i++} and status = 'active'
        returning ${UNIT_COLS}
      `,
      params,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  public async delete(id: string, schoolId: string, userId: string): Promise<boolean> {
    const existing = await this.getById(id, schoolId);
    if (!existing) return false;
    await DB.query(
      singleLineString`
        update programme_unit set status = 'deleted', updatedby_userid = $1, updated_at = $2
        where uuid = $3 and school_id = $4 and status = 'active'
      `,
      [userId, new Date(), id, schoolId],
    );
    return true;
  }

  // The teacher page: the unit for (programme, grade, month) resolved into ordered
  // fields (labels from the field-type master), focus-skill names and the domain.
  public async teach(
    schoolId: string,
    opts: { programmeCode: string; grade: string; month: string; academicYearId?: string },
  ): Promise<TeachView | null> {
    const programme = await getProgrammeByCode(schoolId, opts.programmeCode);
    if (!programme) return null;
    const grade = (opts.grade || "").trim();
    const month = (opts.month || "").trim().toLowerCase();
    if (!grade || !MONTH_VALUES.includes(month as any))
      throw new BusinessErrorResult(ErrorCode.BusinessError, "grade and a valid month are required");
    const monthLabel = MONTHS.find((m) => m.value === month)?.label || month;

    const yearId = opts.academicYearId || (await getCurrentAcademicYearId(schoolId));
    const base = {
      programme: { code: programme.code, name: programme.name, motto: programme.motto },
      academicYearId: yearId,
      grade,
      month: month as any,
      monthLabel,
    };
    if (!yearId) return { ...base, unit: null };

    const fieldTypes = await DB.query(
      singleLineString`select code, name, seq from programme_field_type where programme_id = $1 and status = 'active' order by seq`,
      [programme.uuid],
    );

    const unitRows = await DB.query(
      singleLineString`
        select uuid, title, programme_focus, primary_domain_id, fields, focus_skill_ids, workflow_status
        from programme_unit
        where programme_id = $1 and academic_year_id = $2 and lower(grade) = lower($3) and month = $4 and status = 'active'
        limit 1
      `,
      [programme.uuid, yearId, grade, month],
    );
    if (unitRows.length === 0) return { ...base, unit: null };
    const u = unitRows[0];
    const fieldsMap: Record<string, string> = u.fields || {};
    const focusIds: string[] = Array.isArray(u.focusSkillIds) ? u.focusSkillIds : [];

    // Ordered fields, labelled from the field-type master (skip empty ones).
    const fields = fieldTypes
      .map((ft: any) => ({ code: ft.code, name: ft.name, content: (fieldsMap[ft.code] || "").trim() }))
      .filter((f: any) => f.content);

    // Focus skills, in the unit's stored order.
    let focusSkills: { name: string; category: string }[] = [];
    if (focusIds.length > 0) {
      const placeholders = focusIds.map((_, k) => `$${k + 2}`).join(", ");
      const skillRows = await DB.query(
        singleLineString`select uuid, name, category from programme_skill where programme_id = $1 and uuid in (${placeholders})`,
        [programme.uuid, ...focusIds],
      );
      const byId: Record<string, any> = {};
      for (const s of skillRows) byId[s.uuid] = s;
      focusSkills = focusIds
        .map((id) => byId[id])
        .filter(Boolean)
        .map((s) => ({ name: s.name, category: s.category }));
    }

    let primaryDomain: { code: string; name: string } | null = null;
    if (u.primaryDomainId) {
      const dRows = await DB.query(
        singleLineString`select code, name from programme_domain where uuid = $1 and programme_id = $2`,
        [u.primaryDomainId, programme.uuid],
      );
      if (dRows.length > 0) primaryDomain = { code: dRows[0].code, name: dRows[0].name };
    }

    return {
      ...base,
      unit: {
        uuid: u.uuid,
        title: u.title,
        programmeFocus: u.programmeFocus,
        workflowStatus: u.workflowStatus,
        primaryDomain,
        focusSkills,
        fields,
      },
    };
  }

  private validWorkflow(w?: string): string | null {
    if (!w) return null;
    return WORKFLOW_STATUS_VALUES.includes(w as any) ? w : null;
  }

  private async assertSlotFree(
    programmeId: string,
    yearId: string,
    grade: string,
    month: string,
    excludeId: string | null,
  ): Promise<void> {
    const params: any[] = [programmeId, yearId, grade, month];
    let query = singleLineString`
      select uuid from programme_unit
      where programme_id = $1 and academic_year_id = $2 and lower(grade) = lower($3) and month = $4 and status = 'active'
    `;
    if (excludeId) {
      params.push(excludeId);
      query += ` and uuid != $5`;
    }
    const rows = await DB.query(query, params);
    if (rows.length > 0)
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        `A unit already exists for ${grade} / ${month}`,
      );
  }
}

export const programmeUnitService = new ProgrammeUnitService();
