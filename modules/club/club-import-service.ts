import { DB, singleLineString } from "../../shared/lib/db";
import { BusinessErrorResult } from "../../shared/lib/errors";
import { ErrorCode } from "../../shared/lib/error-codes";
import { fileStorageService } from "../../shared/lib/file-storage";
import { clubActivityService } from "./club-activity-service";
import { writeAudit } from "./club-common";
import { FILE_ENTITY_IMPORT } from "./club-constants";
import { VersionContent } from "./club-interfaces";
const ExcelJS = require("exceljs");
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Round-trip bulk import/export for a club's activity bank (the SRIJAN workbook shape). Export
// → edit offline → re-import; every upload is stored (file_storage) and logged (club_import).
// Re-import never auto-approves: new codes create a hidden Draft, changed codes refresh/revise
// a Draft — releasing stays an explicit in-charge action.

const SHEET_NAME = "Activity_Master_ERP";
const norm = (s: any): string => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const str = (v: any): string => {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((t: any) => t.text).join("");
    if (v.text) return v.text;
    if (v.result != null) return String(v.result);
  }
  return String(v).trim();
};

// normalized header -> VersionContent field (plus the special activityCode)
const HEADER_MAP: Record<string, string> = {
  activitycode: "activityCode",
  level: "gradeLevel",
  grade: "gradeLevel",
  recommendedsequence: "recommendedSequence",
  activitytitle: "title",
  title: "title",
  category: "category",
  difficultylevel: "difficulty",
  difficulty: "difficulty",
  preparationburden: "prepBurden",
  learningoutcome: "learningOutcome",
  materials: "materialsSummary",
  teacherpreparation: "teacherPreparation",
  procedure: "procedure",
  risksafety: "riskSafety",
  assessmentchecklist: "assessmentChecklist",
  relatedvocabulary: "relatedVocabulary",
  materialquantityplan: "materialQuantityPlan",
  evidencepracticality: "evidenceNote",
  evidence: "evidenceNote",
  supportenrichment: "supportEnrichment",
  cleanupstorage: "cleanupStorage",
};

// The export column order (SRIJAN developer-clean workbook).
const EXPORT_COLUMNS: Array<{ header: string; field: string }> = [
  { header: "Activity_Code", field: "activityCode" },
  { header: "Level", field: "gradeLevel" },
  { header: "Recommended_Sequence", field: "recommendedSequence" },
  { header: "Activity_Title", field: "title" },
  { header: "Category", field: "category" },
  { header: "Difficulty_Level", field: "difficulty" },
  { header: "Preparation_Burden", field: "prepBurden" },
  { header: "Learning_Outcome", field: "learningOutcome" },
  { header: "Materials", field: "materialsSummary" },
  { header: "Teacher_Preparation", field: "teacherPreparation" },
  { header: "Procedure", field: "procedure" },
  { header: "Risk_Safety", field: "riskSafety" },
  { header: "Assessment_Checklist", field: "assessmentChecklist" },
  { header: "Related_Vocabulary", field: "relatedVocabulary" },
  { header: "Material_Quantity_Plan", field: "materialQuantityPlan" },
  { header: "Evidence_Practicality", field: "evidenceNote" },
  { header: "Support_Enrichment", field: "supportEnrichment" },
  { header: "Cleanup_Storage", field: "cleanupStorage" },
];

interface ParsedRow { rowNo: number; activityCode: string; content: VersionContent; }
interface ParseResult { rows: ParsedRow[]; errors: Array<{ rowNo: number; message: string }>; }

class ClubImportService {
  // ── Export ───────────────────────────────────────────────────────────────────
  async exportBank(schoolId: string, clubId: string): Promise<{ fileName: string; base64: string; count: number }> {
    const club = await DB.query(singleLineString`select club_code from club where uuid = $1 and school_id = $2`, [clubId, schoolId]);
    if (!club.length) throw new BusinessErrorResult(ErrorCode.InvalidId, "Club not found");
    const items = await clubActivityService.listActivities(schoolId, { clubId });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(SHEET_NAME);
    ws.addRow(EXPORT_COLUMNS.map((c) => c.header));
    for (const it of items) {
      const detail = await clubActivityService.getActivity(schoolId, it.uuid);
      const c: any = detail?.currentVersion || {};
      ws.addRow(EXPORT_COLUMNS.map((col) => (col.field === "activityCode" ? it.activityCode : c[col.field] ?? "")));
    }
    const buf = await wb.xlsx.writeBuffer();
    return {
      fileName: `${club[0].clubCode}-activities.xlsx`,
      base64: Buffer.from(buf).toString("base64"),
      count: items.length,
    };
  }

  // ── Parse (shared by preview + commit) ─────────────────────────────────────────
  private async _parse(base64: string): Promise<ParseResult> {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(base64, "base64"));
    const ws = wb.getWorksheet(SHEET_NAME) || wb.worksheets[0];
    if (!ws) throw new BusinessErrorResult(ErrorCode.InvalidInput, "No worksheet found in the file");

    const headerRow = ws.getRow(1);
    const colToField: Record<number, string> = {};
    headerRow.eachCell((cell: any, col: number) => {
      const field = HEADER_MAP[norm(str(cell.value))];
      if (field) colToField[col] = field;
    });
    if (!Object.values(colToField).includes("activityCode") || !Object.values(colToField).includes("title")) {
      throw new BusinessErrorResult(ErrorCode.InvalidInput, "The sheet must have Activity_Code and Activity_Title columns");
    }

    const rows: ParsedRow[] = [];
    const errors: Array<{ rowNo: number; message: string }> = [];
    const seen = new Set<string>();
    const lastRow = ws.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const row = ws.getRow(r);
      const rec: any = {};
      let anyValue = false;
      for (const [colStr, field] of Object.entries(colToField)) {
        const v = str(row.getCell(Number(colStr)).value);
        if (v) anyValue = true;
        rec[field] = v || undefined; // blanks -> undefined (never "" into numeric/typed columns)
      }
      if (!anyValue) continue; // skip blank rows
      const activityCode = (rec.activityCode || "").trim();
      if (!activityCode) { errors.push({ rowNo: r, message: "Missing Activity_Code" }); continue; }
      if (!rec.title) { errors.push({ rowNo: r, message: `${activityCode}: missing Activity_Title` }); continue; }
      if (seen.has(activityCode.toLowerCase())) { errors.push({ rowNo: r, message: `Duplicate Activity_Code in file: ${activityCode}` }); continue; }
      seen.add(activityCode.toLowerCase());
      // Recommended_Sequence is the one numeric column — coerce to int or drop it.
      rec.recommendedSequence = rec.recommendedSequence ? (parseInt(String(rec.recommendedSequence), 10) || undefined) : undefined;
      const { activityCode: _ac, ...content } = rec;
      rows.push({ rowNo: r, activityCode, content: content as VersionContent });
    }
    return { rows, errors };
  }

  // ── Preview (no writes) ────────────────────────────────────────────────────────
  async preview(schoolId: string, clubId: string, base64: string): Promise<any> {
    const { rows, errors } = await this._parse(base64);
    const existing = await DB.query(
      singleLineString`select lower(activity_code) as code from club_activity where school_id = $1 and club_id = $2`,
      [schoolId, clubId],
    );
    const existingCodes = new Set(existing.map((e: any) => e.code));
    let added = 0, updated = 0;
    for (const r of rows) (existingCodes.has(r.activityCode.toLowerCase()) ? updated++ : added++);
    return { total: rows.length, added, updated, errors, valid: errors.length === 0 };
  }

  // ── Commit (transactional-ish: all valid rows applied; file stored + logged) ─────
  async commit(schoolId: string, clubId: string, base64: string, fileName: string, userId: string): Promise<any> {
    const club = await DB.query(singleLineString`select uuid from club where uuid = $1 and school_id = $2`, [clubId, schoolId]);
    if (!club.length) throw new BusinessErrorResult(ErrorCode.InvalidId, "Club not found");
    const { rows, errors } = await this._parse(base64);
    if (errors.length) throw new BusinessErrorResult(ErrorCode.BusinessError, `Fix ${errors.length} row error(s) before importing`);

    const existing = await DB.query(
      singleLineString`select uuid, lower(activity_code) as code from club_activity where school_id = $1 and club_id = $2`,
      [schoolId, clubId],
    );
    const byCode = new Map<string, string>(existing.map((e: any) => [e.code, e.uuid]));

    let added = 0, updated = 0;
    for (const r of rows) {
      const existingId = byCode.get(r.activityCode.toLowerCase());
      if (!existingId) {
        await clubActivityService.createActivity(schoolId, { clubId, activityCode: r.activityCode, content: r.content }, userId);
        added++;
      } else {
        const detail = await clubActivityService.getActivity(schoolId, existingId);
        const latest = detail?.versions?.[0];
        if (latest && latest.status === "draft") {
          await clubActivityService.updateDraft(schoolId, existingId, r.content, userId);
        } else {
          await clubActivityService.createRevision(schoolId, existingId, userId);
          await clubActivityService.updateDraft(schoolId, existingId, r.content, userId);
        }
        updated++;
      }
    }

    // Store the uploaded file + log the import revision.
    const importId = generateShortUuid(12);
    let fileRef: string | null = null;
    try {
      const stored = await fileStorageService.upload({
        fileName: fileName || "import.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        base64Data: base64,
        entityType: FILE_ENTITY_IMPORT,
        entityId: importId,
        schoolId, userId,
      });
      fileRef = stored.uuid;
    } catch { /* storing the artifact is best-effort; the data import already succeeded */ }

    await DB.query(
      singleLineString`insert into club_import
          (uuid, school_id, club_id, file_storage_ref, file_name, row_count, added_count, updated_count, status, createdby_userid, created_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,'committed',$9,now())`,
      [importId, schoolId, clubId, fileRef, fileName || null, rows.length, added, updated, userId],
    );
    await writeAudit(schoolId, userId, "activity.import", "club", clubId, { after: { added, updated, rows: rows.length } });
    return { total: rows.length, added, updated, importId };
  }

  async listImports(schoolId: string, clubId: string): Promise<any[]> {
    return DB.query(
      singleLineString`select uuid, file_name, row_count, added_count, updated_count, status, created_at, createdby_userid
        from club_import where school_id = $1 and club_id = $2 order by created_at desc`,
      [schoolId, clubId],
    );
  }
}

export const clubImportService = new ClubImportService();
