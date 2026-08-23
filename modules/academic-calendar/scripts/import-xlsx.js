/**
 * Academic-Calendar xlsx importer.
 *
 * Parses a monthly-sheet activity-calendar workbook and loads it into the calendar
 * for a (school, academic-year). Columns are matched by HEADER NAME (not position),
 * because the source sheets drift (some months drop/reorder columns). Holidays are
 * derived from the Festivals column's (H)/(RH) markers (and a "Holiday" type cell).
 * Remembrance + Personality are bundled into one entry (value + detail).
 *
 * Dry-run (default) prints the diff/summary only. Pass --apply to write.
 *
 *   node modules/academic-calendar/scripts/import-xlsx.js \
 *     --stage prod --school DBPASN --ayName 2026-27 \
 *     --file "C:/path/Activity Calendar 2026-2027.xlsx"          # dry-run
 *   ...same... --apply                                            # writes
 *   ...same... --apply --replace                                  # wipe AY calendar first
 *   ...add--include-academic-activities to import the "Academic Activities" column
 */

const path = require("path");
const ExcelJS = require("exceljs");
const { loadConfig, createPool } = require("../../../scripts/run-sql");
const { generateShortUuid } = require("../../../shared/util/generate-uuid.js");

// ── Header -> type mapping (normalized header text) ───────────────────────────
// __x = structural/skip; value strings are calendar_type codes.
const HEADER_MAP = {
  "month": "__ctx", "date": "__date", "day": "__ctx",
  "festivals celebrations": "festival",
  "festival celebrations": "festival",
  "important days": "important_day",
  "important day": "important_day",
  "type of celebrations": "celebration_type",
  "type of celebration": "celebration_type",
  "remembrance": "remembrance",
  "personality": "__personality",         // folded into remembrance.detail
  "theme": "theme",
  "academics": "academics",
  "academic activities": "academic_activity", // opt-in via flag
  "assembly duty": "__skip",
  "saturday activities": "__skip",
  "saturday activity": "__skip",
  "monday tests": "__skip",
  "monday test": "__skip",
};

// Type codes we auto-ensure exist (name shown in the grid). academic_activity added
// only when --include-academic-activities is set.
const TYPE_NAMES = {
  festival: "Festivals/Celebrations",
  important_day: "Important Days",
  celebration_type: "Type of Celebration",
  remembrance: "Remembrance",
  theme: "Theme",
  academics: "Academics",
  academic_activity: "Academic Activities",
};

const MONTHS = { april: 3, may: 4, june: 5, july: 6, august: 7, sep: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
  jan: 0, january: 0, feb: 1, february: 1, march: 2 };

function normHeader(s) {
  return String(s || "").toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();
}

// A cell value is "empty" if blank or just dashes / n-a.
function isBlank(v) {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s) return true;
  if (/^-+$/.test(s)) return true;
  if (/^n\/?a$/i.test(s)) return true;
  return false;
}
function clean(v) {
  return String(v).replace(/\s+/g, " ").trim();
}

// exceljs gives Date objects (UTC) for date cells, or a number (serial). Normalize
// both to 'YYYY-MM-DD'.
function cellToISO(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object" && v.result instanceof Date) return v.result.toISOString().slice(0, 10);
  if (typeof v === "number") {
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = clean(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseArgs(argv) {
  const a = { stage: null, school: null, ayName: null, ayId: null, file: null,
    apply: false, replace: false, includeAcademicActivities: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--stage") a.stage = argv[++i];
    else if (k === "--school") a.school = argv[++i];
    else if (k === "--ayName") a.ayName = argv[++i];
    else if (k === "--ay") a.ayId = argv[++i];
    else if (k === "--file") a.file = argv[++i];
    else if (k === "--apply") a.apply = true;
    else if (k === "--replace") a.replace = true;
    else if (k === "--include-academic-activities") a.includeAcademicActivities = true;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.stage || !args.school || !args.file) {
    console.error("Usage: --stage <s> --school <CODE> --file <xlsx> [--ayName 2026-27|--ay <id>] [--apply] [--replace] [--include-academic-activities]");
    process.exit(1);
  }
  if (!HEADER_MAP["academic activities"] || !args.includeAcademicActivities) {
    // academic_activity handled below by flag
  }

  const config = loadConfig(args.stage);
  const pool = createPool(config);
  console.log(`\n=== Academic-Calendar xlsx import (${args.apply ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`Stage: ${args.stage} | School: ${args.school} | File: ${path.basename(args.file)}`);

  // Resolve school + academic year.
  const sch = await pool.query("select uuid from school where lower(code)=lower($1)", [args.school]);
  if (!sch.rows.length) throw new Error(`School ${args.school} not found`);
  const schoolId = sch.rows[0].uuid;
  let ayId = args.ayId;
  if (!ayId) {
    const ayq = args.ayName
      ? await pool.query("select uuid, to_char(start_date,'YYYY-MM-DD') sd, to_char(end_date,'YYYY-MM-DD') ed from academic_year where school_id=$1 and name=$2", [schoolId, args.ayName])
      : await pool.query("select uuid, to_char(start_date,'YYYY-MM-DD') sd, to_char(end_date,'YYYY-MM-DD') ed from academic_year where school_id=$1 order by (case when current_date between start_date and end_date then 0 else 1 end), start_date desc limit 1", [schoolId]);
    if (!ayq.rows.length) throw new Error("Academic year not found");
    ayId = ayq.rows[0].uuid;
    var ayStart = ayq.rows[0].sd, ayEnd = ayq.rows[0].ed;
  } else {
    const ayq = await pool.query("select to_char(start_date,'YYYY-MM-DD') sd, to_char(end_date,'YYYY-MM-DD') ed from academic_year where uuid=$1", [ayId]);
    var ayStart = ayq.rows[0].sd, ayEnd = ayq.rows[0].ed;
  }
  console.log(`School id: ${schoolId} | AY id: ${ayId} | AY range: ${ayStart}..${ayEnd}`);

  // Ensure types exist -> code -> uuid.
  const typeIdByCode = await ensureTypes(pool, schoolId, args.includeAcademicActivities);

  // Parse workbook.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(args.file);

  const entries = [];   // {date, code, value, detail}
  const holidays = new Map(); // date -> {name, kind}
  const skipped = { outOfMonth: 0, outOfRange: 0, blankDate: 0 };
  const perTypeCount = {};
  const unknownHeaders = new Set();

  wb.eachSheet((ws) => {
    const sheetMonth = MONTHS[ws.name.toLowerCase().trim()];
    if (sheetMonth === undefined) return; // skip Sheet1 / non-month sheets

    // Build column-index -> code from the header row (row 1).
    const colCode = {};
    const headerRow = ws.getRow(1);
    headerRow.eachCell((cell, colNumber) => {
      const norm = normHeader(cell.value);
      let code = HEADER_MAP[norm];
      if (code === undefined) { unknownHeaders.add(norm); return; }
      if (code === "academic_activity" && !args.includeAcademicActivities) code = "__skip";
      colCode[colNumber] = code;
    });
    // Find the date column.
    const dateCol = Object.keys(colCode).find((c) => colCode[c] === "__date");
    if (!dateCol) return;

    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const iso = cellToISO(row.getCell(Number(dateCol)).value);
      if (!iso) { skipped.blankDate++; return; }
      // Dedupe lead-in/trailing rows: only accept a row from the sheet whose month
      // matches the date's month (sheets carry a few prior/next-month context rows).
      const d = new Date(`${iso}T00:00:00Z`);
      if (d.getUTCMonth() !== sheetMonth) { skipped.outOfMonth++; return; }
      if (iso < ayStart || iso > ayEnd) { skipped.outOfRange++; return; }

      // Gather remembrance + personality to bundle.
      let remembrance = null, personality = null;
      for (const colNum of Object.keys(colCode)) {
        const code = colCode[colNum];
        if (code.startsWith("__") && code !== "__personality") continue;
        const raw = row.getCell(Number(colNum)).value;
        if (isBlank(raw)) continue;
        const val = clean(raw);
        if (code === "remembrance") { remembrance = val; continue; }
        if (code === "__personality") { personality = val; continue; }
        entries.push({ date: iso, code, value: val });
        perTypeCount[code] = (perTypeCount[code] || 0) + 1;
        // Derive a holiday from the Festivals column markers.
        if (code === "festival") {
          const kind = /\(rh\)/i.test(val) ? "restricted" : /\(h\)/i.test(val) ? "full" : null;
          if (kind) {
            const name = val.replace(/\((rh|h)\)/gi, "").replace(/\s+/g, " ").trim();
            const prev = holidays.get(iso);
            // full beats restricted if both seen for a date.
            if (!prev || (prev.kind === "restricted" && kind === "full")) holidays.set(iso, { name, kind });
          }
        }
        // A "Holiday" celebration-type cell also means a full holiday.
        if (code === "celebration_type" && /^holiday$/i.test(val)) {
          if (!holidays.has(iso)) holidays.set(iso, { name: "Holiday", kind: "full" });
        }
      }
      if (remembrance) {
        entries.push({ date: iso, code: "remembrance", value: remembrance, detail: personality || null });
        perTypeCount.remembrance = (perTypeCount.remembrance || 0) + 1;
      }
    });
  });

  // ── Summary (the "differences before sync") ─────────────────────────────────
  const existing = await pool.query("select count(*) c from calendar_entry where school_id=$1 and academic_year_id=$2 and status='active'", [schoolId, ayId]);
  const existingHol = await pool.query("select count(*) c from calendar_holiday where school_id=$1 and academic_year_id=$2 and status='active'", [schoolId, ayId]);
  console.log(`\n-- Existing in this AY: ${existing.rows[0].c} entries, ${existingHol.rows[0].c} holidays --`);
  console.log(`\nParsed ${entries.length} entries across ${new Set(entries.map(e=>e.date)).size} dates:`);
  for (const code of Object.keys(perTypeCount).sort()) {
    console.log(`   ${(TYPE_NAMES[code]||code).padEnd(24)} ${perTypeCount[code]}`);
  }
  const hf = [...holidays.values()].filter(h=>h.kind==="full").length;
  const hr = [...holidays.values()].filter(h=>h.kind==="restricted").length;
  console.log(`Holidays derived: ${holidays.size} (full=${hf}, restricted=${hr})`);
  console.log(`Skipped rows: out-of-month(dedupe)=${skipped.outOfMonth}, out-of-AY-range=${skipped.outOfRange}, no-date=${skipped.blankDate}`);
  if (unknownHeaders.size) console.log(`Unmapped headers (ignored): ${[...unknownHeaders].filter(Boolean).join(" | ")}`);

  console.log(`\nSample (first 8 entries):`);
  for (const e of entries.slice(0, 8)) console.log(`   ${e.date}  ${(TYPE_NAMES[e.code]||e.code).padEnd(22)} ${e.value}${e.detail?`  ::${e.detail}`:""}`);
  console.log(`\nSample holidays (first 8):`);
  for (const [date, h] of [...holidays.entries()].slice(0, 8)) console.log(`   ${date}  [${h.kind}]  ${h.name}`);

  if (!args.apply) {
    console.log(`\n(DRY-RUN — nothing written. Re-run with --apply to load, --apply --replace to wipe this AY first.)\n`);
    await pool.end();
    return;
  }

  // ── Apply ───────────────────────────────────────────────────────────────────
  if (args.replace) {
    const de = await pool.query("delete from calendar_entry where school_id=$1 and academic_year_id=$2", [schoolId, ayId]);
    const dh = await pool.query("delete from calendar_holiday where school_id=$1 and academic_year_id=$2", [schoolId, ayId]);
    console.log(`\n--replace: deleted ${de.rowCount} entries, ${dh.rowCount} holidays for this AY.`);
  } else if (Number(existing.rows[0].c) > 0) {
    console.log(`\n! This AY already has ${existing.rows[0].c} entries. Re-run with --replace to overwrite, or --ay a fresh year. Aborting.`);
    await pool.end();
    process.exit(1);
  }

  const now = new Date();
  const seq = {}; // per (date|code) sort_order counter
  let wroteE = 0;
  for (const e of entries) {
    const key = `${e.date}|${e.code}`;
    seq[key] = (seq[key] || 0) + 10;
    await pool.query(
      `insert into calendar_entry (uuid, school_id, academic_year_id, entry_date, end_date, type_id, value, detail, sort_order, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,null,$5,$6,$7,$8,'active','import',$9)`,
      [generateShortUuid(12), schoolId, ayId, e.date, typeIdByCode[e.code], e.value.slice(0, 512), e.detail ? e.detail.slice(0, 512) : null, seq[key], now],
    );
    wroteE++;
  }
  let wroteH = 0;
  for (const [date, h] of holidays.entries()) {
    await pool.query(
      `insert into calendar_holiday (uuid, school_id, academic_year_id, holiday_date, name, kind, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,$5,$6,'active','import',$7)`,
      [generateShortUuid(12), schoolId, ayId, date, (h.name || "Holiday").slice(0, 256), h.kind, now],
    );
    wroteH++;
  }
  console.log(`\n✓ Wrote ${wroteE} entries and ${wroteH} holidays.\n`);
  await pool.end();
}

async function ensureTypes(pool, schoolId, includeAA) {
  const codes = ["festival", "important_day", "celebration_type", "remembrance", "theme", "academics"];
  if (includeAA) codes.push("academic_activity");
  const existing = await pool.query("select uuid, code from calendar_type where school_id=$1 and status='active'", [schoolId]);
  const byCode = {};
  for (const r of existing.rows) byCode[r.code] = r.uuid;
  let sort = 10;
  for (const code of codes) {
    if (byCode[code]) { sort += 10; continue; }
    const uuid = generateShortUuid(12);
    await pool.query(
      `insert into calendar_type (uuid, school_id, code, name, sort_order, status, createdby_userid, created_at)
       values ($1,$2,$3,$4,$5,'active','import',$6) on conflict do nothing`,
      [uuid, schoolId, code, TYPE_NAMES[code], sort, new Date()],
    );
    byCode[code] = uuid;
    sort += 10;
  }
  return byCode;
}

main().catch((e) => { console.error("\n✗", e.message, "\n"); process.exit(1); });
