/**
 * roll-ledgers.js <year> — consolidate L-<year>-*.json ledger chunk files into L-<year>.ndjson
 * (deduped by studentId), cross-check paid-total vs the A-<year> receipts, update manifest,
 * delete chunks. Usage: node scripts/fees-migration/roll-ledgers.js 2025-2026
 */
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, 'out'), MANIFEST = path.join(__dirname, 'state', 'manifest.json');
const year = process.argv[2];
if (!year) { console.error('usage: roll-ledgers.js <yyyy-yyyy>'); process.exit(1); }

let all = [], aborted = false;
const chunks = fs.readdirSync(OUT).filter((f) => new RegExp(`^L-${year}-\\d+\\.json$`).test(f));
if (!chunks.length) { console.error('no ledger chunks for', year); process.exit(1); }
for (const f of chunks) { const o = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8')); if (o.ABORTED_LOGGEDOUT) { aborted = true; console.log('!!! LOGGED OUT in', f, '- got', o.got); } all = all.concat(o.results || []); }

const byId = new Map(); for (const r of all) if (r.studentId != null) byId.set(r.studentId, r);
const recs = [...byId.values()].sort((a, b) => a.studentId - b.studentId);
fs.writeFileSync(path.join(OUT, `L-${year}.ndjson`), recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
for (const f of chunks) fs.unlinkSync(path.join(OUT, f));

const charged = recs.reduce((s, r) => s + (r.totalDebit || 0), 0);
const paid = recs.reduce((s, r) => s + (r.totalPaid || 0), 0);
const bal = recs.reduce((s, r) => s + (r.balance || 0), 0);

// cross-check vs receipts
let crosscheck = 'no receipts file';
const af = path.join(OUT, `A-${year}.ndjson`);
if (fs.existsSync(af)) {
  const recPaid = {};
  fs.readFileSync(af, 'utf8').trim().split('\n').map(JSON.parse).forEach((r) => { if (r.admissionNo) recPaid[r.admissionNo] = (recPaid[r.admissionNo] || 0) + (r.totalPaid || 0); });
  let checked = 0, match = 0;
  for (const r of recs) if (recPaid[r.admissionNo] != null) { checked++; if (Math.abs(recPaid[r.admissionNo] - (r.totalPaid || 0)) < 1) match++; }
  crosscheck = `${match}/${checked} paid-total match vs receipts`;
}

const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
m.sweeps.L_ledgers = m.sweeps.L_ledgers || {};
m.sweeps.L_ledgers[year] = { students: recs.length, file: `L-${year}.ndjson`, crosscheck, aborted, lastRun: '2026-08-01' };
fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2));

console.log(`${year} LEDGERS: ${recs.length} students | charged ${(charged / 1e7).toFixed(2)}cr paid ${(paid / 1e7).toFixed(2)}cr outstanding ${(bal / 1e7).toFixed(2)}cr | ${crosscheck}${aborted ? ' | !!ABORTED-LOGGEDOUT' : ''}`);
