/**
 * Read-only cross-year analysis (no DB writes): match 2025-26 UKG students to
 * 2026-27 Class-I students by normalized name + DOB, to surface the
 * "new admission number on promotion" cases that admission-number matching misses.
 *
 * Usage:
 *   node analyze-ukg-transition.js --old "<2025-26 csv>" --new "<2026-27 csv>"
 */
const fs = require('fs');
const { parse } = require('csv-parse/sync');

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : null; }
const clean = (v) => { const s = String(v ?? '').trim(); return s === '---' || s === '' ? '' : s; };
const stripHon = (v) => clean(v).replace(/^(mr|mrs|ms|dr|late|smt|shri|km|master)\.?\s*/i, '').trim();
const norm = (v) => stripHon(v).toLowerCase().replace(/\s+/g, ' ').replace(/[.,]/g, '').trim();
const parseDate = (raw) => {
  const s = clean(raw).replace(/'/g, '').trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
};
function load(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return parse(raw.slice(raw.indexOf('"Sr. No."')), { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true });
}
const baseClass = (c) => clean(c).toUpperCase().split('-')[0]; // "I-A" -> "I", "UKG-B" -> "UKG"
const key = (r) => norm(r['Student Name']) + '|' + (parseDate(r['D.O.B']) || '');

const oldRows = load(arg('--old'));
const newRows = load(arg('--new'));

// index new-year rows by name+DOB
const newByKey = new Map();
for (const r of newRows) { const k = key(r); if (!newByKey.has(k)) newByKey.set(k, []); newByKey.get(k).push(r); }
const newByAdm = new Map(newRows.map((r) => [clean(r['Adm. No.']).toLowerCase(), r]));

const ukg = oldRows.filter((r) => baseClass(r['Class Name']) === 'UKG');
console.log(`\n2025-26 UKG students: ${ukg.length}\n`);

const promotedSameAdm = [];  // UKG -> I, admission number unchanged
const promotedNewAdm = [];   // UKG -> I, NEW admission number (the link-me case)
const matchedNotI = [];      // name+DOB match in new year but not Class I
const noMatch = [];          // no name+DOB match in 2026-27 at all (left/held back/renamed)

for (const r of ukg) {
  const adm = clean(r['Adm. No.']);
  const k = key(r);
  const cands = newByKey.get(k) || [];
  if (!cands.length) { noMatch.push({ adm, name: clean(r['Student Name']), dob: parseDate(r['D.O.B']) }); continue; }
  // prefer a Class-I candidate
  const iCand = cands.find((c) => baseClass(c['Class Name']) === 'I');
  if (iCand) {
    const newAdm = clean(iCand['Adm. No.']);
    const rec = { name: clean(r['Student Name']), dob: parseDate(r['D.O.B']), oldAdm: adm, newAdm, oldCls: clean(r['Class Name']), newCls: clean(iCand['Class Name']) };
    if (newAdm.toLowerCase() === adm.toLowerCase()) promotedSameAdm.push(rec); else promotedNewAdm.push(rec);
  } else {
    matchedNotI.push({ name: clean(r['Student Name']), dob: parseDate(r['D.O.B']), oldAdm: adm, oldCls: clean(r['Class Name']), newCls: cands.map((c) => clean(c['Class Name'])).join(',') , newAdm: cands.map((c)=>clean(c['Adm. No.'])).join(',') });
  }
}

const P = (s) => console.log(s);
P(`UKG(2025-26) -> I(2026-27), SAME admission number: ${promotedSameAdm.length}`);
P(`UKG(2025-26) -> I(2026-27), NEW admission number:  ${promotedNewAdm.length}   <-- the link/merge cases`);
P(`UKG matched in 2026-27 but NOT into Class I:        ${matchedNotI.length}`);
P(`UKG with NO name+DOB match in 2026-27:              ${noMatch.length}`);

if (promotedNewAdm.length) {
  P(`\n=== UKG -> I with NEW admission number (${promotedNewAdm.length}) ===`);
  for (const x of promotedNewAdm) P(`  ${x.name}  (DOB ${x.dob})   ${x.oldCls} ${x.oldAdm}  ->  ${x.newCls} ${x.newAdm}`);
}
if (promotedSameAdm.length) {
  P(`\n=== UKG -> I, SAME admission number (${promotedSameAdm.length}) ===`);
  for (const x of promotedSameAdm) P(`  ${x.name}  (DOB ${x.dob})   ${x.oldAdm}  ${x.oldCls} -> ${x.newCls}`);
}
if (matchedNotI.length) {
  P(`\n=== UKG matched to a NON-I class in 2026-27 (${matchedNotI.length}) ===`);
  for (const x of matchedNotI) P(`  ${x.name}  (DOB ${x.dob})   ${x.oldCls} ${x.oldAdm}  ->  ${x.newCls} (${x.newAdm})`);
}
if (noMatch.length) {
  P(`\n=== UKG with NO match in 2026-27 (left / held back / name mismatch) (${noMatch.length}) ===`);
  for (const x of noMatch) P(`  ${x.name}  (DOB ${x.dob})   ${x.oldAdm}`);
}
P('');
