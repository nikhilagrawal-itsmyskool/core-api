/**
 * DRY RUN: propose DBPASN employee numbers + device tokens from the handwritten staff sheet.
 * Sort matched staff by (year, month) of joining, ties A→Z by name; assign DBPASN/101.. and
 * device 101.. in that order. Prints a review table + unmatched report. WRITES NOTHING.
 *
 * Run (export SSO creds first, PowerShell):
 *   node scripts/employee-numbering/propose.js
 */
const { Pool } = require('pg');
const { getCreds } = require('../student-migration/db-creds');

// Transcribed from the sheet. y/m = year/month; d = day (0 = month-only, stored as the 1st).
// flag = needs human confirmation. Titles are stripped for matching.
const SHEET = [
  { sn: 1, name: 'Akashdeep Sharma', raw: 'April 2023', y: 2023, m: 4, d: 0 },
  { sn: 2, name: 'D.C. Agnihotri', raw: '12 Aug 2022', y: 2022, m: 8, d: 12 },
  { sn: 3, name: 'Ashok Kr. Pal', raw: '1 April 2024', y: 2024, m: 4, d: 1 },
  { sn: 4, name: 'Shivendra Kumar', raw: 'Jul 2023', y: 2023, m: 7, d: 0 },
  { sn: 5, name: 'Rajkamal Trivedi', raw: '01 Sep 2021', y: 2021, m: 9, d: 1 },
  { sn: 6, name: 'Ajay Kumar Saini', raw: 'Aug 2018', y: 2018, m: 8, d: 0 },
  { sn: 7, name: 'Saloni', raw: 'July 2019 / Feb 2024', y: 2019, m: 7, d: 0, flag: 'two dates on sheet (Jul 2019 / Feb 2024) — using Jul 2019' },
  { sn: 8, name: 'Rashmi Mishra', raw: '11 October 2021', y: 2021, m: 10, d: 11 },
  { sn: 9, name: 'Sachina Rajput', raw: '27 Dec 2021', y: 2021, m: 12, d: 27 },
  { sn: 10, name: 'Sarika Yadav', raw: '01 May 2023', y: 2023, m: 5, d: 1 },
  { sn: 11, name: 'Shweta Mishra', raw: 'Feb 2022', y: 2022, m: 2, d: 0 },
  { sn: 12, name: 'Jigyasa Singh', raw: '04 April 2022', y: 2022, m: 4, d: 4 },
  { sn: 13, name: 'Mohini Panday', raw: '13 July 2022', y: 2022, m: 7, d: 13 },
  { sn: 14, name: 'Manju Singh', raw: '11/07/2022', y: 2022, m: 7, d: 11 },
  { sn: 15, name: 'Noorafsha', raw: '3/05/2023', y: 2023, m: 5, d: 3 },
  { sn: 16, name: 'Samiksha Tiwari', raw: '16/02/2024', y: 2024, m: 2, d: 16 },
  { sn: 17, name: 'Priyanshu Srivastava', raw: '01/07/2024', y: 2024, m: 7, d: 1 },
  { sn: 18, name: 'Nitin Kumar Gupta', raw: '01 April 2026', y: 2026, m: 4, d: 1 },
  { sn: 19, name: 'Nem Singh Yadav', raw: '12/4/2022', y: 2022, m: 4, d: 12 },
  { sn: 20, name: 'Satendra Singh', raw: '22/03/2024', y: 2024, m: 3, d: 22 },
  { sn: 21, name: 'Ambika Chitransh', raw: '12 Mar 2020', y: 2020, m: 3, d: 12 },
  { sn: 22, name: 'Suryansh Mishra', raw: '23/06/2024', y: 2024, m: 6, d: 23 },
  { sn: 23, name: 'Shradha', raw: '03/09/2024', y: 2024, m: 9, d: 3 },
  { sn: 24, name: 'Shruti Pandey', raw: '07/04/2025', y: 2025, m: 4, d: 7 },
  { sn: 25, name: 'Rani Singh', raw: '15/04/2025', y: 2025, m: 4, d: 15 },
  { sn: 26, name: 'Ashma Kapoor', raw: '23/06/2025', y: 2025, m: 6, d: 23 },
  { sn: 27, name: 'Parijat Gupta', raw: '11 Nov 2025', y: 2025, m: 11, d: 11 },
  { sn: 28, name: 'Supriya Chaturvedi', raw: '12 Nov 2025', y: 2025, m: 11, d: 12 },
  { sn: 29, name: 'Reena Yadav', raw: '1 May 2026', y: 2026, m: 5, d: 1 },
  { sn: 30, name: 'Kadambari', raw: '11 Apr 2026', y: 2026, m: 4, d: 11 },
  { sn: 31, name: 'Rana Hijab', raw: '02 Apr 2026', y: 2026, m: 4, d: 2 },
  { sn: 32, name: 'Mandakini Saxena', raw: '02 Apr 2026', y: 2026, m: 4, d: 2, flag: 'corrected on sheet from 11 Apr to 02 Apr 2026' },
  { sn: 33, name: 'Hema Singh', raw: '17 Apr 2026', y: 2026, m: 4, d: 17 },
  { sn: 34, name: 'Vikram Dubey', raw: '2 May 2026', y: 2026, m: 5, d: 2 },
  { sn: 35, name: 'Mahek Verma', raw: '1 July 2026', y: 2026, m: 7, d: 1 },
  { sn: 36, name: 'Mansi Sharma', raw: '1 July 2026', y: 2026, m: 7, d: 1 },
  { sn: 37, name: 'Prakhar Mishra', raw: '25 June 2026', y: 2026, m: 6, d: 25 },
  { sn: 38, name: 'Ajeet Singh', raw: 'June 2026', y: 2026, m: 6, d: 0 },
  { sn: 39, name: 'Amit Kumar Pandey', raw: '03 July 2026', y: 2026, m: 7, d: 3 },
  { sn: 40, name: 'Arpit Tiwari', raw: '8 July 2026', y: 2026, m: 7, d: 8 },
  { sn: 41, name: 'Manisha Gurah', raw: '18 Aug 2026', y: 2026, m: 8, d: 18 },
  { sn: 42, name: 'Satakshi Pandey', raw: '24 Sep 2026', y: 2026, m: 9, d: 24 },
  { sn: 43, name: 'Aneet Kumar Singh', raw: 'Oct 2026', y: 2026, m: 10, d: 0, flag: 'corrected on sheet from Sep to Oct 2026' },
  { sn: 44, name: 'Ritik Agnihotri', raw: 'October 2026', y: 2026, m: 10, d: 0 },
];

// User-confirmed name links (sheet sn -> exact system name) and exclusions (sheet sn).
const CONFIRMED = { 2: 'Dinesh Chandra Agnihotri', 23: 'Shraddha Pandey' };
const EXCLUDE = new Set([16]); // Samiksha Tiwari — match not confirmed yet

const TITLES = /^(mr|mrs|ms|miss|dr|smt|shri|sri)\.?\s+/i;
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(TITLES, '')
    .replace(/\b(kr|kumari)\b/g, 'kumar')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

(async () => {
  const pool = new Pool(await getCreds('prod'));
  try {
    const sch = await pool.query(`select uuid from school where lower(code) = 'dbpasn'`);
    if (!sch.rows.length) throw new Error('DBPASN school not found');
    const schoolId = sch.rows[0].uuid;
    const emps = (await pool.query(
      `select uuid, name, employee_number, device_number, status from employee
       where school_id = $1 and status <> 'deleted' order by name`,
      [schoolId]
    )).rows;

    const byNorm = new Map();
    for (const e of emps) {
      const k = norm(e.name);
      if (!byNorm.has(k)) byNorm.set(k, []);
      byNorm.get(k).push(e);
    }

    const lev = (a, b) => {
      const m = a.length, n = b.length; const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
        dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      return dp[m][n];
    };
    const score = (a, b) => {
      const na = norm(a), nb = norm(b);
      const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
      const inter = [...ta].filter((t) => tb.has(t)).length;
      const jacc = inter / (new Set([...ta, ...tb]).size || 1);
      const strScore = 1 - lev(na, nb) / Math.max(na.length, nb.length, 1);
      // token-level fuzzy: any token pair within edit-distance 1 counts as a soft hit
      let soft = 0;
      for (const x of ta) for (const y of tb) if (x !== y && lev(x, y) <= 1 && Math.max(x.length, y.length) > 2) { soft++; break; }
      const softScore = (inter + soft) / Math.max(ta.size, tb.size);
      return Math.max(jacc, strScore, softScore * 0.95);
    };

    // User-confirmed links first; excluded sheet rows are skipped entirely.
    const empByName = new Map(emps.map((e) => [norm(e.name), e]));
    const empDone = new Set(), rowDone = new Set();
    const assign = new Map(); // sheet sn -> { emp, scoreVal, confirmed }
    for (const [snStr, sysName] of Object.entries(CONFIRMED)) {
      const sn = Number(snStr); const e = empByName.get(norm(sysName));
      if (e) { assign.set(sn, { emp: e, scoreVal: 1, confirmed: true }); empDone.add(e.uuid); rowDone.add(sn); }
      else console.warn(`CONFIRMED name not in system: "${sysName}" (sheet #${sn})`);
    }

    // Global assignment for the rest: score every (sheet, employee) pair, take best-first so exact
    // matches claim their person before weaker ones can (avoids the greedy-by-order swap).
    const pairs = [];
    for (const row of SHEET) {
      if (EXCLUDE.has(row.sn) || rowDone.has(row.sn)) continue;
      for (const e of emps) pairs.push({ row, e, s: score(row.name, e.name) });
    }
    pairs.sort((a, b) => b.s - a.s);
    for (const p of pairs) {
      if (p.s < 0.55) break;
      if (rowDone.has(p.row.sn) || empDone.has(p.e.uuid)) continue;
      assign.set(p.row.sn, { emp: p.e, scoreVal: p.s });
      rowDone.add(p.row.sn); empDone.add(p.e.uuid);
    }
    const matched = [], unmatched = [];
    for (const row of SHEET) {
      if (EXCLUDE.has(row.sn)) { unmatched.push({ ...row, candidates: ['(excluded — match not confirmed)'] }); continue; }
      const a = assign.get(row.sn);
      if (a) matched.push({ ...row, emp: a.emp, confident: a.confirmed || a.scoreVal >= 0.85, scoreVal: a.scoreVal });
      else {
        let best = null, bestScore = 0;
        for (const e of emps) { if (empDone.has(e.uuid)) continue; const s = score(row.name, e.name); if (s > bestScore) { bestScore = s; best = e; } }
        unmatched.push({ ...row, candidates: best ? [`${best.name} (${bestScore.toFixed(2)})`] : [] });
      }
    }

    // Sort for numbering: those WITH a date, by (year, month), ties A→Z by name.
    const datable = matched.filter((r) => r.y > 0).sort((a, b) =>
      a.y - b.y || a.m - b.m || a.name.localeCompare(b.name));
    const noDate = matched.filter((r) => r.y === 0);

    let serial = 101;
    console.log('\n=== PROPOSED NUMBERING (matched, by date of joining) ===');
    console.log('ser  empNo        device  joining        name                     (current empNo / device)');
    const fuzzy = [];
    for (const r of datable) {
      const doj = r.d ? `${String(r.d).padStart(2,'0')}/${String(r.m).padStart(2,'0')}/${r.y}` : `01/${String(r.m).padStart(2,'0')}/${r.y}*`;
      const mark = r.confident ? ' ' : '~';
      console.log(
        `${serial}${mark} DBPASN/${serial}   ${serial}     ${doj.padEnd(13)}  ${r.name.padEnd(22)}${r.confident ? '' : ' → ' + r.emp.name}${r.flag ? '  ⚠ ' + r.flag : ''}`
      );
      if (!r.confident) fuzzy.push(r);
      serial++;
    }
    if (fuzzy.length) {
      console.log('\n=== FUZZY MATCHES (~) — please confirm these name links ===');
      for (const r of fuzzy) console.log(`  sheet "${r.name}"  →  system "${r.emp.name}"  (score ${r.scoreVal.toFixed(2)})`);
    }
    console.log(`\n* = month-only on the sheet; date of joining would be stored as the 1st of that month.`);

    if (noDate.length) {
      console.log('\n=== MATCHED BUT NO DATE (excluded from numbering) ===');
      for (const r of noDate) console.log(`  ${r.name}  — ${r.flag || 'no date'}  (current ${r.emp.employeeNumber || '-'} / ${r.emp.deviceNumber || '-'})`);
    }

    if (unmatched.length) {
      console.log('\n=== UNMATCHED sheet names (need resolution) ===');
      for (const r of unmatched) console.log(`  #${r.sn} ${r.name}  → candidates: ${r.candidates.length ? r.candidates.join(', ') : 'NONE'}`);
    }

    const sheetNorms = new Set(SHEET.map((r) => norm(r.name)));
    const extra = emps.filter((e) => !sheetNorms.has(norm(e.name)) && !matched.some((m) => m.emp.uuid === e.uuid));
    console.log(`\n=== DBPASN employees NOT on the sheet (${extra.length}) — will be left unchanged ===`);
    for (const e of extra) console.log(`  ${e.name}  (${e.employeeNumber || '-'} / ${e.deviceNumber || '-'})`);

    const WRITE = process.argv.includes('--write');
    if (!WRITE) {
      console.log(`\nSummary: ${datable.length} to number (101..${100 + datable.length}), ${noDate.length} no-date, ${unmatched.length} unmatched, ${extra.length} not on sheet. DRY RUN — nothing written. Pass --write to apply.`);
    } else {
      console.log(`\n=== WRITING ${datable.length} updates ===`);
      let n = 101, done = 0;
      for (const r of datable) {
        const dateStr = `${r.y}-${String(r.m).padStart(2, '0')}-${String(r.d || 1).padStart(2, '0')}`;
        await pool.query(
          `update employee set employee_number = $1, device_number = $2, date_of_joining = $3::date,
             updatedby_userid = 'numbering', updated_at = now() where uuid = $4 and school_id = $5`,
          [`DBPASN/${n}`, String(n), dateStr, r.emp.uuid, schoolId]
        );
        done++; n++;
      }
      console.log(`Wrote ${done} rows (DBPASN/101..DBPASN/${100 + done}, device 101..${100 + done}). Excluded: ${unmatched.map((u) => u.name).join(', ') || 'none'}.`);
    }
  } finally {
    await pool.end();
  }
})().catch((e) => { console.error(e); process.exit(1); });
