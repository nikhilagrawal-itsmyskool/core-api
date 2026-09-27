import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import { DEFAULTS, MONTH_VALUES } from "./programmes-constants";
import { getProgrammeByCode } from "./programme-service";
import { getCurrentAcademicYearId } from "./programmes-common";
import { SourceDoc } from "./programmes-interfaces";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");
const { parseDocx } = require("./programmes-parse.js");
const { SKILL_ALIASES } = require("./programmes-selc-seed.js");

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const ENTITY_TYPE = "programme_source";
const stripDataUri = (b64: string) => (b64 || "").replace(/^data:[^;]+;base64,/, "");

export interface UploadResult {
  grade: string;
  version: number;
  monthsImported: number;
  months: string[];
  unmatchedFocusSkills: string[];
}

class ProgrammeSourceService {
  // List the stored class-module documents for a programme in a year (one per grade).
  public async list(
    schoolId: string,
    programmeCode: string,
    academicYearId?: string,
  ): Promise<SourceDoc[]> {
    const programme = await getProgrammeByCode(schoolId, programmeCode);
    if (!programme) throw new BusinessErrorResult(ErrorCode.BusinessError, "Unknown programme");
    const yearId = academicYearId || (await getCurrentAcademicYearId(schoolId));
    if (!yearId) return [];
    const rows = await DB.query(
      singleLineString`
        select d.uuid, d.grade, d.version, d.file_id, d.updated_at, f.file_name
        from programme_source_doc d
        left join file_storage f on f.uuid = d.file_id
        where d.programme_id = $1 and d.academic_year_id = $2 and d.status = 'active'
        order by d.grade
      `,
      [programme.uuid, yearId],
    );
    return rows.map((r: any) => ({
      uuid: r.uuid,
      grade: r.grade,
      version: r.version,
      fileId: r.fileId,
      fileName: r.fileName,
      updatedAt: r.updatedAt,
    }));
  }

  // The stored .docx bytes for a grade (base64), for download.
  public async download(
    schoolId: string,
    programmeCode: string,
    grade: string,
    academicYearId?: string,
  ): Promise<{ fileName: string; mimeType: string; base64: string } | null> {
    const programme = await getProgrammeByCode(schoolId, programmeCode);
    if (!programme) return null;
    const yearId = academicYearId || (await getCurrentAcademicYearId(schoolId));
    if (!yearId) return null;
    const rows = await DB.query(
      singleLineString`
        select file_id from programme_source_doc
        where programme_id = $1 and academic_year_id = $2 and lower(grade) = lower($3) and status = 'active'
      `,
      [programme.uuid, yearId, grade],
    );
    if (rows.length === 0 || !rows[0].fileId) return null;
    const file = await fileStorageService.getWithData(rows[0].fileId, schoolId);
    if (!file) return null;
    return { fileName: file.fileName, mimeType: file.mimeType, base64: file.data };
  }

  // Re-upload a grade's class-module .docx: parse it and OVERWRITE that grade's
  // monthly units wholesale (upsert by month), then store the file and bump the
  // source-doc version. The client confirms the overwrite before calling this.
  public async upload(
    schoolId: string,
    programmeCode: string,
    grade: string,
    input: { base64Data: string; fileName?: string; academicYearId?: string },
    userId: string,
  ): Promise<UploadResult> {
    const programme = await getProgrammeByCode(schoolId, programmeCode);
    if (!programme) throw new BusinessErrorResult(ErrorCode.BusinessError, "Unknown programme");
    if (!grade || !grade.trim())
      throw new BusinessErrorResult(ErrorCode.BusinessError, "grade is required");
    if (!input.base64Data)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "file data is required");
    const yearId = input.academicYearId || (await getCurrentAcademicYearId(schoolId));
    if (!yearId)
      throw new BusinessErrorResult(ErrorCode.BusinessError, "No academic year for this school");

    let parsed: any;
    try {
      parsed = parseDocx(Buffer.from(stripDataUri(input.base64Data), "base64"));
    } catch (e: any) {
      throw new BusinessErrorResult(ErrorCode.BusinessError, `Could not read the .docx: ${e.message}`);
    }
    const validMonths = (parsed.months || []).filter((m: any) =>
      MONTH_VALUES.includes(m.month),
    );
    if (validMonths.length === 0)
      throw new BusinessErrorResult(
        ErrorCode.BusinessError,
        "No monthly units found in the document",
      );

    // Skill name -> uuid map for this programme (to resolve focus skills).
    const skillRows = await DB.query(
      singleLineString`select uuid, name from programme_skill where programme_id = $1 and status = 'active'`,
      [programme.uuid],
    );
    const skillByName: Record<string, string> = {};
    for (const s of skillRows) skillByName[s.name.trim().toLowerCase()] = s.uuid;
    // Alias a few non-canonical focus-skill wordings onto master skills.
    for (const [from, to] of Object.entries(SKILL_ALIASES || {})) {
      const target = skillByName[String(to).toLowerCase()];
      if (target) skillByName[String(from).toLowerCase()] = target;
    }

    const unmatched = new Set<string>();
    const importedMonths: string[] = [];

    for (const m of validMonths) {
      const focusIds: string[] = [];
      for (const name of m.focusSkills || []) {
        const id = skillByName[String(name).trim().toLowerCase()];
        if (id) focusIds.push(id);
        else unmatched.add(name);
      }
      await this.upsertUnit(
        schoolId,
        programme.uuid,
        yearId,
        grade.trim(),
        m,
        parsed.programmeFocus || null,
        focusIds,
        userId,
      );
      importedMonths.push(m.month);
    }

    const version = await this.storeSourceFile(
      schoolId,
      programme.uuid,
      yearId,
      grade.trim(),
      input.base64Data,
      input.fileName || `${programmeCode}-${grade}.docx`,
      userId,
    );

    return {
      grade: grade.trim(),
      version,
      monthsImported: importedMonths.length,
      months: importedMonths,
      unmatchedFocusSkills: [...unmatched],
    };
  }

  // Upsert one month's unit (overwrite content; preserve primary_domain_id if the
  // admin has set one). Keyed on (programme, year, grade, month).
  private async upsertUnit(
    schoolId: string,
    programmeId: string,
    yearId: string,
    grade: string,
    parsedMonth: any,
    programmeFocus: string | null,
    focusIds: string[],
    userId: string,
  ): Promise<void> {
    const existing = await DB.query(
      singleLineString`
        select uuid, version from programme_unit
        where programme_id = $1 and academic_year_id = $2 and lower(grade) = lower($3) and month = $4 and status = 'active'
      `,
      [programmeId, yearId, grade, parsedMonth.month],
    );
    const fieldsJson = JSON.stringify(parsedMonth.fields || {});
    const focusJson = JSON.stringify(focusIds || []);
    const title = (parsedMonth.title || parsedMonth.month).trim();

    if (existing.length > 0) {
      await DB.query(
        singleLineString`
          update programme_unit
          set title = $1, programme_focus = $2, fields = $3, focus_skill_ids = $4,
              workflow_status = $5, version = $6, updatedby_userid = $7, updated_at = $8
          where uuid = $9 and school_id = $10 and status = 'active'
        `,
        [
          title,
          programmeFocus,
          fieldsJson,
          focusJson,
          DEFAULTS.WORKFLOW_PUBLISHED,
          (existing[0].version || 1) + 1,
          userId,
          new Date(),
          existing[0].uuid,
          schoolId,
        ],
      );
    } else {
      await DB.query(
        singleLineString`
          insert into programme_unit
            (uuid, school_id, programme_id, academic_year_id, grade, month, title, programme_focus,
             primary_domain_id, fields, focus_skill_ids, workflow_status, version, source_file_id, status,
             createdby_userid, created_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        `,
        [
          generateShortUuid(12),
          schoolId,
          programmeId,
          yearId,
          grade,
          parsedMonth.month,
          title,
          programmeFocus,
          null,
          fieldsJson,
          focusJson,
          DEFAULTS.WORKFLOW_PUBLISHED,
          1,
          null,
          DEFAULTS.STATUS,
          userId,
          new Date(),
        ],
      );
    }
  }

  // Store the uploaded file and upsert the per-grade source-doc row (bump version,
  // delete the previously stored file).
  private async storeSourceFile(
    schoolId: string,
    programmeId: string,
    yearId: string,
    grade: string,
    base64Data: string,
    fileName: string,
    userId: string,
  ): Promise<number> {
    const existing = await DB.query(
      singleLineString`
        select uuid, version, file_id from programme_source_doc
        where programme_id = $1 and academic_year_id = $2 and lower(grade) = lower($3) and status = 'active'
      `,
      [programmeId, yearId, grade],
    );
    const docId = existing.length > 0 ? existing[0].uuid : generateShortUuid(12);

    const stored = await fileStorageService.upload({
      fileName,
      mimeType: DOCX_MIME,
      base64Data: stripDataUri(base64Data),
      entityType: ENTITY_TYPE,
      entityId: docId,
      schoolId,
      userId,
    });

    if (existing.length > 0) {
      const version = (existing[0].version || 1) + 1;
      await DB.query(
        singleLineString`
          update programme_source_doc set file_id = $1, version = $2, updatedby_userid = $3, updated_at = $4
          where uuid = $5 and school_id = $6
        `,
        [stored.uuid, version, userId, new Date(), docId, schoolId],
      );
      if (existing[0].fileId) await fileStorageService.delete(existing[0].fileId, schoolId);
      return version;
    }

    await DB.query(
      singleLineString`
        insert into programme_source_doc
          (uuid, school_id, programme_id, academic_year_id, grade, file_id, version, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [docId, schoolId, programmeId, yearId, grade, stored.uuid, 1, DEFAULTS.STATUS, userId, new Date()],
    );
    return 1;
  }
}

export const programmeSourceService = new ProgrammeSourceService();
