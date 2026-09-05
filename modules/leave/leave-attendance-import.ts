import * as ExcelJS from "exceljs";
import { DB, singleLineString } from "../../shared/lib/db";
import {
  getCurrentAcademicYearId,
  weeklyOffDays,
  fullHolidaysInRange,
  datesInRange,
} from "./leave-common";
import { leaveAttendanceService } from "./leave-attendance-service";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Column-mapping biometric importer. The device's exact headers are supplied by the
// caller (mapping), so this works for ANY export shape without a hard-coded format.
// Punched days -> present (with in/out); within the declared coverage period, active
// mapped employees with no punch on a working day are inferred absent; a day where
// too few punched (device down) is held as 'suspect'. See DESIGN §3.

export interface ImportMapping {
  codeHeader: string;
  dateHeader: string;
  inHeader?: string;
  outHeader?: string;
  statusHeader?: string; // optional explicit present/absent column
}

export interface ImportOptions {
  fileName?: string;
  mapping: ImportMapping;
  coverageFrom: string; // YYYY-MM-DD
  coverageTo: string; // YYYY-MM-DD
  inferAbsent?: boolean; // default true
  userId?: string;
}

export interface ImportResult {
  batchId: string;
  totalRows: number;
  matchedRows: number;
  unmatchedCodes: string[];
  daysCreated: number;
  suspectDates: string[];
}

const SUSPECT_COVERAGE = 0.4; // < 40% of mapped employees punched -> device-down day

function toText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((rt: any) => rt.text || "").join("");
    if (typeof v.text === "string") return v.text;
    if (v.result != null) return toText(v.result);
    return "";
  }
  return String(v);
}
const clean = (v: any) => toText(v).replace(/\s+/g, " ").trim();
const normHeader = (s: any) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

function cellToISODate(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v.result instanceof Date) return v.result.toISOString().slice(0, 10);
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const s = clean(v);
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); // dd/mm/yyyy or dd-mm-yyyy
  if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
  return null;
}

// A HH:MM(:SS) time from a cell, combined with the row's date -> ISO timestamp string.
function timeOn(date: string, v: any): string | null {
  if (v == null) return null;
  let hh: number | null = null, mm = 0;
  if (v instanceof Date) { hh = v.getUTCHours(); mm = v.getUTCMinutes(); }
  else if (typeof v === "number") { const mins = Math.round((v % 1) * 24 * 60); hh = Math.floor(mins / 60); mm = mins % 60; }
  else {
    const m = clean(v).match(/(\d{1,2}):(\d{2})/);
    if (m) { hh = parseInt(m[1], 10); mm = parseInt(m[2], 10); }
  }
  if (hh == null || isNaN(hh)) return null;
  return `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

interface DayAgg { present: boolean; firstIn: string | null; lastOut: string | null; }

export async function importBiometric(schoolId: string, buffer: Buffer, opts: ImportOptions): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("No worksheet in the uploaded file");

  // Locate columns by header name (row 1).
  const headerRow = ws.getRow(1);
  const colByHeader = new Map<string, number>();
  headerRow.eachCell((cell, col) => colByHeader.set(normHeader(toText(cell.value)), col));
  const col = (h?: string): number | null => (h ? colByHeader.get(normHeader(h)) ?? null : null);

  const codeCol = col(opts.mapping.codeHeader);
  const dateCol = col(opts.mapping.dateHeader);
  if (!codeCol) throw new Error(`Code column "${opts.mapping.codeHeader}" not found in the sheet header`);
  if (!dateCol) throw new Error(`Date column "${opts.mapping.dateHeader}" not found in the sheet header`);
  const inCol = col(opts.mapping.inHeader);
  const outCol = col(opts.mapping.outHeader);
  const statusCol = col(opts.mapping.statusHeader);

  const enrollMap = await leaveAttendanceService.resolveEnroll(schoolId);

  // Aggregate punches per (employeeId, date).
  const agg = new Map<string, DayAgg>(); // key = employeeId|date
  const unmatched = new Set<string>();
  let totalRows = 0, matchedRows = 0;
  const key = (e: string, d: string) => `${e}|${d}`;

  ws.eachRow((row, idx) => {
    if (idx === 1) return; // header
    const codeRaw = clean(row.getCell(codeCol).value);
    if (!codeRaw) return;
    const date = cellToISODate(row.getCell(dateCol).value);
    if (!date || date < opts.coverageFrom || date > opts.coverageTo) return;
    totalRows++;
    const empId = enrollMap.get(codeRaw);
    if (!empId) { unmatched.add(codeRaw); return; }
    matchedRows++;

    const statusTxt = statusCol ? clean(row.getCell(statusCol).value).toLowerCase() : "";
    const isAbsentMark = /^a(bsent)?$/.test(statusTxt) || statusTxt === "leave";
    const inTs = inCol ? timeOn(date, row.getCell(inCol).value) : null;
    const outTs = outCol ? timeOn(date, row.getCell(outCol).value) : null;
    const present = !isAbsentMark && (!statusCol || /^p(resent)?$/.test(statusTxt) || (!!inTs || !!outTs) || statusTxt === "");

    const k = key(empId, date);
    const cur = agg.get(k) || { present: false, firstIn: null, lastOut: null };
    cur.present = cur.present || present;
    if (inTs && (!cur.firstIn || inTs < cur.firstIn)) cur.firstIn = inTs;
    if (outTs && (!cur.lastOut || outTs > cur.lastOut)) cur.lastOut = outTs;
    if (present && !cur.firstIn && inTs) cur.firstIn = inTs;
    agg.set(k, cur);
  });

  const batchId = generateShortUuid(12);
  const now = new Date();
  let daysCreated = 0;

  // Persist punched days as present. Present punches override any prior row for the day.
  const presentByDate = new Map<string, number>();
  for (const [k, a] of agg.entries()) {
    const [empId, date] = k.split("|");
    if (!a.present) continue;
    presentByDate.set(date, (presentByDate.get(date) || 0) + 1);
    const firstIn = a.firstIn ? new Date(a.firstIn) : null;
    const lastOut = a.lastOut ? new Date(a.lastOut) : null;
    const minutes = firstIn && lastOut ? Math.max(0, Math.round((lastOut.getTime() - firstIn.getTime()) / 60000)) : null;
    await this_upsert(schoolId, empId, date, "present", firstIn, lastOut, minutes, batchId, now);
    daysCreated++;
  }

  // Infer absences within coverage for mapped employees who did not punch on a working day.
  const suspectDates = new Set<string>();
  if (opts.inferAbsent !== false) {
    const ay = await getCurrentAcademicYearId(schoolId);
    const weeklyOff = ay ? await weeklyOffDays(schoolId, ay) : [0];
    const holidays = await fullHolidaysInRange(schoolId, opts.coverageFrom, opts.coverageTo);
    const mappedEmployees = [...new Set(enrollMap.values())];
    const threshold = SUSPECT_COVERAGE * mappedEmployees.length;

    for (const date of datesInRange(opts.coverageFrom, opts.coverageTo)) {
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (weeklyOff.includes(dow) || holidays.has(date)) continue; // not a working day
      const presentCount = presentByDate.get(date) || 0;
      const deviceDown = mappedEmployees.length > 0 && presentCount < threshold;
      if (deviceDown) suspectDates.add(date);
      for (const empId of mappedEmployees) {
        if (agg.get(key(empId, date))?.present) continue; // punched -> already present
        const existing = await DB.query(
          singleLineString`select uuid, source from employee_attendance_day where school_id = $1 and employee_id = $2 and att_date = $3`,
          [schoolId, empId, date],
        );
        // Never overwrite a manual override; only fill gaps this import owns.
        if (existing.length && existing[0].source === "manual") continue;
        await this_upsert(schoolId, empId, date, deviceDown ? "suspect" : "absent", null, null, null, batchId, now);
        daysCreated++;
      }
    }
  }

  await DB.query(
    singleLineString`insert into employee_attendance_import_batch
      (uuid, school_id, file_name, total_rows, matched, unmatched, suspect, applied_by, applied_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [batchId, schoolId, opts.fileName || null, totalRows, matchedRows, unmatched.size, suspectDates.size > 0, opts.userId || "system", now],
  );

  return {
    batchId,
    totalRows,
    matchedRows,
    unmatchedCodes: [...unmatched],
    daysCreated,
    suspectDates: [...suspectDates],
  };
}

async function this_upsert(
  schoolId: string, employeeId: string, date: string, status: string,
  firstIn: Date | null, lastOut: Date | null, minutes: number | null, batchId: string, now: Date,
): Promise<void> {
  await DB.query(
    singleLineString`insert into employee_attendance_day
      (uuid, school_id, employee_id, att_date, status, first_in, last_out, minutes_worked, source, import_batch_id, created_at, updated_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, 'biometric', $9, $10, $10)
      on conflict (school_id, employee_id, att_date) do update set
        status = excluded.status, first_in = excluded.first_in, last_out = excluded.last_out,
        minutes_worked = excluded.minutes_worked, source = 'biometric', import_batch_id = excluded.import_batch_id, updated_at = excluded.updated_at`,
    [generateShortUuid(12), schoolId, employeeId, date, status, firstIn, lastOut, minutes, batchId, now],
  );
}
