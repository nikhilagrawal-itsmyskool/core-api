import * as ExcelJS from "exceljs";

// Parses a monthly-sheet activity-calendar workbook into calendar entries + derived
// holidays. Columns are matched by HEADER NAME (sheets drift), Remembrance bundles the
// adjacent Personality column into `detail`, holidays come from the Festivals column's
// (H)/(RH) markers (and a "Holiday" celebration cell). Mirrors scripts/import-xlsx.js.

export interface ParsedEntry { date: string; code: string; value: string; detail: string | null; }
export interface ParsedHoliday { name: string; kind: "full" | "restricted"; }
export interface ParseResult {
  entries: ParsedEntry[];
  holidays: Map<string, ParsedHoliday>;
  skipped: { outOfMonth: number; outOfRange: number; blankDate: number };
  unknownHeaders: string[];
  dates: number;
}

const HEADER_MAP: Record<string, string> = {
  "month": "__ctx", "date": "__date", "day": "__ctx",
  "festivals celebrations": "festival", "festival celebrations": "festival",
  "important days": "important_day", "important day": "important_day",
  "type of celebrations": "celebration_type", "type of celebration": "celebration_type",
  "remembrance": "remembrance", "personality": "__personality",
  "theme": "theme", "academics": "academics", "academic activities": "academic_activity",
  "assembly duty": "__skip", "saturday activities": "__skip", "saturday activity": "__skip",
  "monday tests": "__skip", "monday test": "__skip",
};

const MONTHS: Record<string, number> = {
  april: 3, may: 4, june: 5, july: 6, august: 7, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  jan: 0, january: 0, feb: 1, february: 1, march: 2,
};

const normHeader = (s: any) => String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

function toText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((rt: any) => rt.text || "").join("");
    if (typeof v.text === "string") return v.text;
    if (v.result != null) return toText(v.result);
    return "";
  }
  return String(v);
}
const clean = (v: any) => toText(v).replace(/\s+/g, " ").trim();
function isBlank(v: any): boolean {
  const s = toText(v).trim();
  return !s || /^-+$/.test(s) || /^n\/?a$/i.test(s);
}
function cellToISO(v: any): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v.result instanceof Date) return v.result.toISOString().slice(0, 10);
  if (typeof v === "number") return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const s = clean(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

export async function parseWorkbook(
  buffer: Buffer,
  ayStart: string,
  ayEnd: string,
  opts: { includeAcademicActivities?: boolean } = {},
): Promise<ParseResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as any);

  const entries: ParsedEntry[] = [];
  const holidays = new Map<string, ParsedHoliday>();
  const skipped = { outOfMonth: 0, outOfRange: 0, blankDate: 0 };
  const unknownHeaders = new Set<string>();

  wb.eachSheet((ws) => {
    const sheetMonth = MONTHS[ws.name.toLowerCase().trim()];
    if (sheetMonth === undefined) return;

    const colCode: Record<number, string> = {};
    ws.getRow(1).eachCell((cell, colNumber) => {
      const norm = normHeader(cell.value);
      let code = HEADER_MAP[norm];
      if (code === undefined) { if (norm) unknownHeaders.add(norm); return; }
      if (code === "academic_activity" && !opts.includeAcademicActivities) code = "__skip";
      colCode[colNumber] = code;
    });
    const dateCol = Object.keys(colCode).find((c) => colCode[Number(c)] === "__date");
    if (!dateCol) return;

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const iso = cellToISO(row.getCell(Number(dateCol)).value);
      if (!iso) { skipped.blankDate++; return; }
      const d = new Date(`${iso}T00:00:00Z`);
      if (d.getUTCMonth() !== sheetMonth) { skipped.outOfMonth++; return; }
      if (iso < ayStart || iso > ayEnd) { skipped.outOfRange++; return; }

      let remembrance: string | null = null, personality: string | null = null;
      for (const colNumStr of Object.keys(colCode)) {
        const colNum = Number(colNumStr);
        const code = colCode[colNum];
        if (code.startsWith("__") && code !== "__personality") continue;
        const raw = row.getCell(colNum).value;
        if (isBlank(raw)) continue;
        const val = clean(raw);
        if (code === "remembrance") { remembrance = val; continue; }
        if (code === "__personality") { personality = val; continue; }
        entries.push({ date: iso, code, value: val, detail: null });
        if (code === "festival") {
          const kind = /\(rh\)/i.test(val) ? "restricted" : /\(h\)/i.test(val) ? "full" : null;
          if (kind) {
            const name = val.replace(/\((rh|h)\)/gi, "").replace(/\s+/g, " ").trim();
            const prev = holidays.get(iso);
            if (!prev || (prev.kind === "restricted" && kind === "full")) holidays.set(iso, { name, kind });
          }
        }
        if (code === "celebration_type" && /^holiday$/i.test(val) && !holidays.has(iso)) {
          holidays.set(iso, { name: "Holiday", kind: "full" });
        }
      }
      if (remembrance) entries.push({ date: iso, code: "remembrance", value: remembrance, detail: personality });
    });
  });

  return { entries, holidays, skipped, unknownHeaders: [...unknownHeaders], dates: new Set(entries.map((e) => e.date)).size };
}
