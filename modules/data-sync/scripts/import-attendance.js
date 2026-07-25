/**
 * Import daily attendance from the ERP "StudentAttendanceReport.xls" exports.
 *
 * The export is an HTML <table> saved with a .xls extension (NOT real Excel).
 * A file may contain ONE class or MANY (each row carries its own Class in col 3;
 * rows are grouped by that Class name). Columns: Adm. No. | Name | Roll No |
 * Class | <one column per calendar day> | <summary columns>. Daily cell codes:
 *   P  -> present     A  -> absent
 *   HD/HL (half day)  -> present
 *   DL (duty leave)   -> leave       L (leave) -> leave
 *   H  (holiday)      -> SKIP (no session)     NJ (not joined) -> SKIP (no record)
 *   -  (not marked)   -> SKIP (no record)      '' (blank)      -> SKIP
 *
 * We write one attendance_session per class/date (status 'finalized') and one
 * attendance_record per marked student — directly, mirroring the app's tables
 * but WITHOUT the finalize/notify path, so NO absence SMS/WhatsApp is ever sent.
 * Idempotent: sessions upsert on (school, year, class, date); records on
 * (session, student). Holidays/Sundays (no marks) create no session.
 *
 * Join key: Adm. No. == student.admission_number (per school).
 *
 * Usage (dry-run is the default — nothing is written without --commit):
 *   node import-attendance.js --stage prod --school-code DBPASN \
 *     --academic-session 2026-27 --dir "C:/path/to/attendance-files" [--commit]
 *   node import-attendance.js --stage prod --school-code DBPASN \
 *     --academic-session 2026-27 --file "C:/.../StudentAttendanceReport.xls"
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid.js');

// ---- args ----
function parseArgs(argv) {
  const a = { stage: null, schoolCode: null, session: null, dir: null, file: null, commit: false, createdBy: 'att-import', allowUnknown: false, aliases: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === '--stage') a.stage = argv[++i];
    else if (v === '--school-code') a.schoolCode = argv[++i];
    else if (v === '--academic-session') a.session = argv[++i];
    else if (v === '--dir') a.dir = argv[++i];
    else if (v === '--file') a.file = argv[++i];
    else if (v === '--commit') a.commit = true;
    else if (v === '--created-by') a.createdBy = argv[++i];
    else if (v === '--allow-unknown') a.allowUnknown = true;
    // Map a file's class name onto a different DB class, e.g. --class-alias "IX-B=IX-A"
    // (repeatable). Attendance for the aliased file lands in the target class.
    else if (v === '--class-alias') a.aliases.push(argv[++i]);
  }
  return a;
}
function loadConfig(stage) {
  const p = path.join(__dirname, `../../../configs/${stage}/${stage}.yml`);
  const cfg = fs.readFileSync(p, 'utf8');
  const env = {};
  for (const line of cfg.split('\n')) {
    const m = line.match(/^(\w+):\s*['"]?([^'"]*?)['"]?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

// ---- HTML table parsing (no external libs) ----
const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ').trim();
function parseRows(html) {
  const table = (html.match(/<table[\s\S]*?<\/table>/i) || [html])[0];
  return (table.match(/<tr[\s\S]*?<\/tr>/gi) || []).map((r) =>
    (r.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map((c) => strip(c))
  );
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ADM_RE = /^\d+\/[A-Za-z]?\/?2K\d{2}$/i;

// code -> record status, or null to skip. Unknown -> undefined (flagged).
function mapCode(raw) {
  const c = (raw || '').trim().toUpperCase();
  if (c === '' || c === '-' || c === 'H' || c === 'NJ') return null; // skip: blank/not-marked/holiday/not-joined
  if (c === 'P') return 'present';
  if (c === 'A') return 'absent';
  if (c === 'HD' || c === 'HL') return 'present'; // half day -> present
  if (c === 'DL' || c === 'L' || c === 'LEAVE') return 'leave'; // duty leave / leave
  return undefined; // unknown -> report
}

// "01 Apr Wed" -> { iso, weekday } using the session's start year (Apr-Dec) or +1 (Jan-Mar)
function parseDateHeader(h, startYear) {
  const m = h.match(/^(\d{2})\s+([A-Za-z]{3})\s+([A-Za-z]{3})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return null;
  const year = mon >= 4 ? startYear : startYear + 1;
  const iso = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { iso, weekday: m[3] };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.stage || !args.schoolCode || !args.session || (!args.dir && !args.file)) {
    console.error('Required: --stage --school-code --academic-session and (--dir <folder> | --file <path>)');
    process.exit(1);
  }
  args.createdBy = String(args.createdBy).slice(0, 12); // createdby_userid is varchar(12)
  const startYear = parseInt(String(args.session).slice(0, 4), 10); // "2026-27" -> 2026
  if (!startYear) { console.error(`Bad --academic-session "${args.session}" (expected e.g. 2026-27)`); process.exit(1); }

  const env = loadConfig(args.stage);
  const pool = new Pool({
    host: env.POSTGRES_ENDPOINT || env.POSTGRES_HOST,
    database: env.POSTGRES_DATABASE,
    user: env.POSTGRES_USERNAME || env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD,
    port: parseInt(env.POSTGRES_PORT || '5432', 10),
    ssl: env.POSTGRES_SSL === 'false' ? false : { rejectUnauthorized: false },
  });

  // resolve school + academic year
  const sc = await pool.query('select uuid from school where lower(code) = lower($1)', [args.schoolCode]);
  if (!sc.rows.length) { console.error(`School ${args.schoolCode} not found`); process.exit(1); }
  const schoolId = sc.rows[0].uuid;
  const ay = await pool.query(
    'select uuid, name from academic_year where school_id = $1 and (lower(name) = lower($2) or lower(code) = lower($2))',
    [schoolId, args.session]
  );
  if (!ay.rows.length) { console.error(`Academic year "${args.session}" not found for ${args.schoolCode}`); process.exit(1); }
  const academicYearId = ay.rows[0].uuid;

  // class name -> uuid, admission_number -> student uuid
  const classRows = (await pool.query('select uuid, name from class where school_id = $1', [schoolId])).rows;
  const classByName = new Map(classRows.map((r) => [String(r.name).trim().toLowerCase(), r.uuid]));
  const studRows = (await pool.query(
    "select uuid, admission_number from student where school_id = $1 and status <> 'deleted'", [schoolId]
  )).rows;
  const studByAdm = new Map(studRows.map((r) => [String(r.admission_number).trim().toLowerCase(), r.uuid]));

  // class-name aliases (file class name -> DB class name), lowercased
  const aliasMap = new Map();
  for (const a of args.aliases) {
    const [from, to] = a.split('=');
    if (from && to) aliasMap.set(from.trim().toLowerCase(), to.trim());
  }

  const files = args.file
    ? [args.file]
    : fs.readdirSync(args.dir).filter((f) => /\.xls$|\.html?$/i.test(f)).map((f) => path.join(args.dir, f));
  if (!files.length) { console.error('No .xls/.html files found'); process.exit(1); }

  console.log(`\nSchool ${args.schoolCode} (${schoolId})  |  session ${ay.rows[0].name}  |  ${files.length} file(s)  |  mode: ${args.commit ? 'COMMIT' : 'DRY-RUN'}\n`);

  // aggregate plan
  const plan = []; // { className, classId, sessions: Map<iso, [{studentId, status}]> }
  const problems = { unknownCodes: {}, unmatchedAdm: new Set(), noClass: new Set(), weekdayMismatch: [] };
  const tally = { present: 0, absent: 0, leave: 0, sessions: 0, records: 0, holidayDates: 0, skippedDates: 0 };

  for (const fp of files) {
    const html = fs.readFileSync(fp, 'latin1');
    const rows = parseRows(html);
    if (!rows.length) { console.log(`  ${path.basename(fp)}: no rows, skipped`); continue; }

    const header = rows[0];
    const dateCols = [];
    header.forEach((h, i) => {
      const d = parseDateHeader(h, startYear);
      if (d) {
        if (WD[new Date(d.iso + 'T00:00:00Z').getUTCDay()] !== d.weekday) problems.weekdayMismatch.push(`${path.basename(fp)}: ${h} -> ${d.iso}`);
        dateCols.push({ i, iso: d.iso });
      }
    });

    const dataRows = rows.filter((r) => ADM_RE.test((r[0] || '').trim()));

    // A file may hold MANY classes (each row carries its own Class in col 3).
    // Group rows by their own class name and plan one class-block per group.
    const rowsByClass = new Map(); // className -> rows[]
    for (const r of dataRows) {
      const cn = (r[3] || '').trim() || path.basename(fp);
      if (!rowsByClass.has(cn)) rowsByClass.set(cn, []);
      rowsByClass.get(cn).push(r);
    }

    for (const [className, clsRows] of rowsByClass) {
      const targetName = aliasMap.get(String(className).trim().toLowerCase()) || className;
      const classId = classByName.get(String(targetName).trim().toLowerCase());
      if (!classId) { problems.noClass.add(className); console.log(`  ${path.basename(fp)}: class "${className}" not found — skipped`); continue; }
      const aliasNote = targetName !== className ? ` (→ ${targetName})` : '';

      const sessions = new Map(); // iso -> [{studentId, status}]
      for (const r of clsRows) {
        const adm = (r[0] || '').trim().toLowerCase();
        const studentId = studByAdm.get(adm);
        if (!studentId) { problems.unmatchedAdm.add(`${r[0]} (${r[1]})`); continue; }
        for (const dc of dateCols) {
          const status = mapCode(r[dc.i]);
          if (status === undefined) { const k = (r[dc.i] || '').trim(); problems.unknownCodes[k] = (problems.unknownCodes[k] || 0) + 1; continue; }
          if (status === null) continue;
          if (!sessions.has(dc.iso)) sessions.set(dc.iso, []);
          sessions.get(dc.iso).push({ studentId, status });
        }
      }

      // tally
      for (const [, marks] of sessions) {
        tally.sessions++;
        for (const m of marks) { tally.records++; tally[m.status]++; }
      }
      const markedDates = new Set([...sessions.keys()]);
      tally.holidayDates += dateCols.length - markedDates.size;

      plan.push({ className, classId, fileName: path.basename(fp), sessions });
      console.log(`  ${path.basename(fp)}: class ${className}${aliasNote} | ${clsRows.length} students | ${markedDates.size} working-day sessions | ${[...sessions.values()].reduce((s, a) => s + a.length, 0)} records`);
    }
  }

  // report problems
  console.log('\n--- summary ---');
  console.log(`sessions: ${tally.sessions}  records: ${tally.records}  (present ${tally.present}, absent ${tally.absent}, leave ${tally.leave})`);
  console.log(`non-working days skipped (holiday/not-taken): ${tally.holidayDates}`);
  if (Object.keys(problems.unknownCodes).length)
    console.log(`⚠ UNKNOWN codes (not written):`, JSON.stringify(problems.unknownCodes));
  if (problems.unmatchedAdm.size)
    console.log(`⚠ unmatched admission numbers (${problems.unmatchedAdm.size}): ${[...problems.unmatchedAdm].slice(0, 15).join(', ')}${problems.unmatchedAdm.size > 15 ? ' …' : ''}`);
  if (problems.noClass.size) console.log(`⚠ classes not found: ${[...problems.noClass].join(', ')}`);
  if (problems.weekdayMismatch.length) console.log(`⚠ weekday/date mismatches (year mapping?):`, problems.weekdayMismatch.slice(0, 5));

  const hasUnknown = Object.keys(problems.unknownCodes).length > 0;
  if (!args.commit) {
    console.log('\nDRY-RUN — nothing written. Re-run with --commit to apply.');
    await pool.end();
    return;
  }
  if (problems.weekdayMismatch.length) { console.error('\nABORT: weekday mismatches indicate a date-parse/year error. Fix before committing.'); await pool.end(); process.exit(2); }
  if (hasUnknown && !args.allowUnknown) { console.error('\nABORT: unknown codes present. Confirm their mapping (or pass --allow-unknown to skip them).'); await pool.end(); process.exit(2); }

  // ---- write (idempotent, no notifications, no audit) ----
  // Two queries per session (session upsert + one multi-row record upsert), each
  // retried on transient connection errors so a network blip skips rather than
  // aborts the run. Idempotent, so a re-run safely fills any gaps.
  const now = new Date();
  let wroteSessions = 0, wroteRecords = 0, failed = 0;

  const runWithRetry = async (fn, label) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return await fn(); }
      catch (e) {
        const transient = /ECONNRESET|termination|timeout|Connection terminated|socket|ETIMEDOUT|EPIPE/i.test(e.message || '');
        if (attempt < 3 && transient) { await new Promise((r) => setTimeout(r, 500 * attempt)); continue; }
        throw e;
      }
    }
  };

  for (const cls of plan) {
    for (const [iso, marks] of cls.sessions) {
      try {
        const sessionId = await runWithRetry(async () => {
          const sess = await pool.query(
            `insert into attendance_session (uuid, school_id, academic_year_id, class_id, attendance_date, status, finalized_at, createdby_userid, created_at)
             values ($1,$2,$3,$4,$5,'finalized',$6,$7,$6)
             on conflict (school_id, academic_year_id, class_id, attendance_date)
             do update set status = 'finalized', finalized_at = coalesce(attendance_session.finalized_at, $6), updatedby_userid = $7, updated_at = $6
             returning uuid`,
            [generateShortUuid(12), schoolId, academicYearId, cls.classId, iso, now, args.createdBy]
          );
          return sess.rows[0].uuid;
        }, `${cls.className} ${iso} session`);

        // one multi-row upsert for all records of this session
        const params = [];
        const tuples = marks.map((m) => {
          const b = params.length;
          params.push(generateShortUuid(12), schoolId, sessionId, m.studentId, m.status, args.createdBy, now);
          return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
        });
        await runWithRetry(() => pool.query(
          `insert into attendance_record (uuid, school_id, session_id, student_id, status, createdby_userid, created_at)
           values ${tuples.join(',')}
           on conflict (session_id, student_id)
           do update set status = excluded.status, updatedby_userid = excluded.createdby_userid, updated_at = excluded.created_at`,
          params
        ), `${cls.className} ${iso} records`);

        wroteSessions++; wroteRecords += marks.length;
      } catch (e) {
        failed++;
        console.error(`  ✗ ${cls.className} ${iso}: ${e.message}`);
      }
    }
  }
  console.log(`\n✔ COMMITTED: ${wroteSessions} sessions, ${wroteRecords} records${failed ? `, ${failed} session(s) failed (re-run to fill)` : ''}. No notifications sent.`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
