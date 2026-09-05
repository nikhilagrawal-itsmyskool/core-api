import { DB, singleLineString } from "../../shared/lib/db";
const { generateShortUuid } = require("../../shared/util/generate-uuid.js");

// Parser + importer for the school's biometric device export: a TimeWatch Infocom
// "Monthly Performance" fixed-width TEXT report. Unlike a raw punch log it already
// carries an explicit per-day status for every employee, so there is NO absence
// inference and no device-down guard — the device's own A/P/WO/... is authoritative.
//
// Layout (measured): In@32-39, Out@40-45, status = the trailing token. Employee blocks
// start with "** CODE & NAME :-<code> <NAME>"; the period is in "Monthly Performance
// from DD/MM/YYYY To DD/MM/YYYY". Codes map to employees via employee_biometric_map;
// on import we auto-map by (normalised) name and surface the rest for one-time mapping.

// Device status -> our employee_attendance_day.status. HLF/MIS/POW all mean the person
// physically punched, so they count as present (half-day handling is deferred).
const STATUS_MAP: Record<string, string> = {
  P: "present", HLF: "present", MIS: "present", POW: "off",
  WO: "off", A: "absent", H: "holiday", L: "absent",
};

export interface TwDay { date: string; status: string; deviceStatus: string; firstIn: string | null; lastOut: string | null; }
export interface TwEmployee { code: string; name: string; days: TwDay[] }
export interface TwParse { period: { from: string | null; to: string | null }; employees: TwEmployee[]; unknownStatuses: string[] }

const dmyToIso = (s: string): string | null => {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const timeAt = (line: string, start: number, end: number): string | null => {
  const seg = line.slice(start, end);
  const m = seg.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
};
export const normName = (s: string): string =>
  String(s || "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();

export function parseTimewatchReport(text: string): TwParse {
  const lines = text.split(/\r?\n/);
  const employees: TwEmployee[] = [];
  const unknown = new Set<string>();
  let period: { from: string | null; to: string | null } = { from: null, to: null };
  let cur: TwEmployee | null = null;

  for (const line of lines) {
    if (!period.from) {
      const p = line.match(/Monthly Performance from\s+(\d{2}\/\d{2}\/\d{4})\s+To\s+(\d{2}\/\d{2}\/\d{4})/i);
      if (p) period = { from: dmyToIso(p[1]), to: dmyToIso(p[2]) };
    }
    const cn = line.match(/CODE\s*&\s*NAME\s*:-\s*(\d+)\s+(.*\S)/i);
    if (cn) { cur = { code: cn[1], name: cn[2].trim(), days: [] }; employees.push(cur); continue; }
    if (!cur) continue;
    if (!/^\s+\d{2}\/\d{2}\/\d{4}/.test(line)) continue; // day rows only (skips the summary line)

    const date = dmyToIso(line.slice(0, 14));
    if (!date) continue;
    const deviceStatus = line.trim().split(/\s+/).pop() || "";
    const mapped = STATUS_MAP[deviceStatus];
    if (!mapped) { unknown.add(deviceStatus); continue; }
    const inHM = timeAt(line, 30, 40);
    const outHM = timeAt(line, 40, 47);
    const firstIn = mapped === "present" && inHM ? `${date}T${inHM}:00` : null;
    const lastOut = mapped === "present" && outHM ? `${date}T${outHM}:00` : null;
    cur.days.push({ date, status: mapped, deviceStatus, firstIn, lastOut });
  }
  return { period, employees, unknownStatuses: [...unknown] };
}

export interface TwImportResult {
  batchId: string;
  period: { from: string | null; to: string | null };
  totalEmployees: number;
  daysWritten: number;
  autoMapped: { code: string; name: string; employeeName: string }[];
  unmatched: { code: string; name: string }[];
  unknownStatuses: string[];
}

export async function importTimewatchReport(
  schoolId: string,
  text: string,
  opts: { fileName?: string; autoMapByName?: boolean; userId?: string } = {},
): Promise<TwImportResult> {
  const parsed = parseTimewatchReport(text);
  if (!parsed.employees.length) throw new Error("No employee blocks found — is this a TimeWatch monthly report?");

  // Existing code -> employeeId.
  const mapRows = await DB.query(
    singleLineString`select enroll_code, employee_id from employee_biometric_map where school_id = $1 and status = 'active'`,
    [schoolId],
  );
  const codeToEmp = new Map<string, string>(mapRows.map((r: any) => [String(r.enrollCode), r.employeeId]));

  // Auto-map by unique normalised name.
  let nameToEmp = new Map<string, string>();
  let empName = new Map<string, string>();
  if (opts.autoMapByName !== false) {
    const emps = await DB.query(
      singleLineString`select uuid, name from employee where school_id = $1 and status <> 'deleted'`,
      [schoolId],
    );
    const counts = new Map<string, number>();
    for (const e of emps) { const n = normName(e.name); counts.set(n, (counts.get(n) || 0) + 1); empName.set(e.uuid, e.name); }
    for (const e of emps) { const n = normName(e.name); if (counts.get(n) === 1) nameToEmp.set(n, e.uuid); }
  }

  const batchId = generateShortUuid(12);
  const now = new Date();
  const autoMapped: { code: string; name: string; employeeName: string }[] = [];
  const unmatched: { code: string; name: string }[] = [];
  let daysWritten = 0;

  for (const emp of parsed.employees) {
    let empId = codeToEmp.get(emp.code);
    if (!empId && opts.autoMapByName !== false) {
      const guess = nameToEmp.get(normName(emp.name));
      if (guess) {
        empId = guess;
        await DB.query(
          singleLineString`insert into employee_biometric_map (uuid, school_id, enroll_code, employee_id, status, createdby_userid, created_at)
            values ($1, $2, $3, $4, 'active', $5, $6)`,
          [generateShortUuid(12), schoolId, emp.code, empId, opts.userId || "system", now],
        );
        codeToEmp.set(emp.code, empId);
        autoMapped.push({ code: emp.code, name: emp.name, employeeName: empName.get(empId) || emp.name });
      }
    }
    if (!empId) { unmatched.push({ code: emp.code, name: emp.name }); continue; }

    for (const d of emp.days) {
      const firstIn = d.firstIn ? new Date(d.firstIn) : null;
      const lastOut = d.lastOut ? new Date(d.lastOut) : null;
      const minutes = firstIn && lastOut ? Math.max(0, Math.round((lastOut.getTime() - firstIn.getTime()) / 60000)) : null;
      await DB.query(
        singleLineString`insert into employee_attendance_day
          (uuid, school_id, employee_id, att_date, status, first_in, last_out, minutes_worked, source, import_batch_id, created_at, updated_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8, 'biometric', $9, $10, $10)
          on conflict (school_id, employee_id, att_date) do update set
            status = excluded.status, first_in = excluded.first_in, last_out = excluded.last_out,
            minutes_worked = excluded.minutes_worked, source = 'biometric', import_batch_id = excluded.import_batch_id, updated_at = excluded.updated_at`,
        [generateShortUuid(12), schoolId, empId, d.date, d.status, firstIn, lastOut, minutes, batchId, now],
      );
      daysWritten++;
    }
  }

  await DB.query(
    singleLineString`insert into employee_attendance_import_batch
      (uuid, school_id, file_name, total_rows, matched, unmatched, suspect, applied_by, applied_at)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [batchId, schoolId, opts.fileName || "timewatch.txt", parsed.employees.reduce((s, e) => s + e.days.length, 0),
      parsed.employees.length - unmatched.length, unmatched.length, false, opts.userId || "system", now],
  );

  return {
    batchId, period: parsed.period, totalEmployees: parsed.employees.length,
    daysWritten, autoMapped, unmatched, unknownStatuses: parsed.unknownStatuses,
  };
}
