/** For each missing student we have a detail file for, find the LATEST session (of the 6
 * all-students reports in out/raw/) in which their admission number appears — that's their true
 * last-active academic year + class — and compare to the class in their detail file. Guides which
 * --academic-session to import each under. READ-ONLY (files only). */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const RAW = path.join(__dirname, 'out', 'raw');
const DETAIL = path.join(RAW, 'detail');
const admKey = (v) => String(v ?? '').trim().toUpperCase().replace(/\s+/g, '');
const SESS = { '2021-22': 7, '2022-23': 8, '2023-24': 9, '2024-25': 10, '2025-26': 11, '2026-27': 12 };

function readReport(file) {
  const raw = fs.readFileSync(file, 'utf8'); const s = raw.indexOf('"Sr. No."');
  return parse(s >= 0 ? raw.slice(s) : raw, { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true });
}
// session reports: adm -> {year -> class}
const perSession = {};
for (const n of fs.readdirSync(RAW)) {
  const m = n.match(/^studentReport-all-(\d{4}-\d{2})\)?\.csv$/i);
  if (!m) continue;
  const year = m[1];
  for (const r of readReport(path.join(RAW, n))) { const k = admKey(r['Adm. No.']); if (!k) continue; (perSession[k] = perSession[k] || {})[year] = (r['Class Name'] || '').trim(); }
}
// detail files: adm -> {name, class}
const detail = {};
for (const n of fs.readdirSync(DETAIL)) {
  if (!/\.csv$/i.test(n) || n.startsWith('_')) continue;
  for (const r of readReport(path.join(DETAIL, n))) { const k = admKey(r['Adm. No.']); if (!k) continue; detail[k] = { name: (r['Student Name'] || '').trim(), cls: (r['Class Name'] || '').trim(), adm: (r['Adm. No.'] || '').trim() }; }
}
const yearsDesc = Object.keys(SESS).sort((a, b) => SESS[b] - SESS[a]);
console.log('adm\tname\tlastSession\tclass@lastSession\tdetailClass\tallSessions');
const groups = {};
for (const k of Object.keys(detail)) {
  const d = detail[k]; const sess = perSession[k] || {};
  const last = yearsDesc.find((y) => sess[y] != null);
  const clsLast = last ? sess[last] : '';
  const all = Object.keys(sess).sort((a, b) => SESS[a] - SESS[b]).map((y) => `${y}:${sess[y]}`).join(' | ');
  const flag = clsLast && d.cls && clsLast !== d.cls ? '  <-- class differs' : '';
  console.log(`${d.adm}\t${d.name}\t${last || 'NOT-IN-REPORTS'}\t${clsLast}\t${d.cls}\t${all}${flag}`);
  (groups[last || '??'] = groups[last || '??'] || []).push(d.adm);
}
console.log('\n=== would import per last-active session ===');
for (const y of Object.keys(groups).sort()) console.log(`  ${y}: ${groups[y].length}  (${groups[y].join(', ')})`);
