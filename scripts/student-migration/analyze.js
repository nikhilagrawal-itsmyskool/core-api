/** Quick analysis of an extracted studentReport CSV: distinct adm numbers, 2Kyy year spread,
 * status + withdrawal distribution — to learn whether studentStatus=5 is global or session-scoped. */
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const file = process.argv[2] || path.join(__dirname, 'out', 'students-2026-27.csv');
const raw = fs.readFileSync(file, 'utf8');
const records = parse(raw.slice(raw.indexOf('"Sr. No."')), { columns: true, relax_column_count: true, skip_empty_lines: true, trim: true, relax_quotes: true });
console.log('file:', path.basename(file), '| rows:', records.length);
const cols = Object.keys(records[0]);
console.log('columns:', cols.length);

const adm = new Set();
const dup = {};
const byYear = {};
const byStatus = {};
let withdrawn = 0, blankAdm = 0;
const enrolledYears = {};
for (const r of records) {
  const a = (r['Adm. No.'] || '').trim();
  if (!a) { blankAdm++; continue; }
  if (adm.has(a)) dup[a] = (dup[a] || 1) + 1; else adm.add(a);
  const ym = a.match(/2K(\d{2})\s*$/i); const y = ym ? '20' + ym[1] : '??';
  byYear[y] = (byYear[y] || 0) + 1;
  const st = (r['Status'] || '').trim() || '(blank)';
  byStatus[st] = (byStatus[st] || 0) + 1;
  if ((r['Date Of Withdrawal'] || '').replace(/-+/g, '').trim()) withdrawn++;
  const en = (r['Enrolled In Class'] || '').match(/\((\d{4}-\d{4})\)/);
  if (en) enrolledYears[en[1]] = (enrolledYears[en[1]] || 0) + 1;
}
console.log('distinct adm numbers:', adm.size, '| blank adm:', blankAdm, '| duplicate-adm rows:', Object.keys(dup).length);
console.log('withdrawn (has withdrawal date):', withdrawn);
console.log('\nby admission 2Kyy year:', JSON.stringify(byYear));
console.log('\nby Status:', JSON.stringify(byStatus));
console.log('\nby Enrolled-In-Class year:', JSON.stringify(enrolledYears));
if (Object.keys(dup).length) console.log('\nsample dup adm:', Object.entries(dup).slice(0, 10));
