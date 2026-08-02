/**
 * roll.js — consolidate extractor chunk files + update the incremental manifest.
 *
 *   node scripts/fees-migration/roll.js <sweep> <year>
 *   e.g. node scripts/fees-migration/roll.js A 2024-2025
 *
 * Merges out/<sweep>-<year>-*.json (arrays of receipt records) into out/<sweep>-<year>.ndjson
 * (deduped by internalId), deletes the chunk files, and records a watermark
 * (highest internalId pulled) in state/manifest.json so a later run can resume incrementally.
 *
 * NOTE: raw data (out/, *.ndjson) is gitignored — it is student financial PII. Only the
 * manifest (counts + watermarks + timestamps, no PII) is committed.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const OUT = path.join(DIR, 'out');
const MANIFEST = path.join(DIR, 'state', 'manifest.json');

const sweep = process.argv[2];
const year = process.argv[3];
const stamp = process.argv[4] || 'unstamped'; // pass an ISO date; Date.now() avoided for determinism
if (!sweep || !year) { console.error('usage: roll.js <sweep A|B|C> <year yyyy-yyyy> [isoDate]'); process.exit(1); }

const chunks = fs.readdirSync(OUT).filter((f) => f.startsWith(`${sweep}-${year}-`) && f.endsWith('.json'));
if (!chunks.length) { console.error('no chunk files for', sweep, year); process.exit(1); }

const byId = new Map();
for (const f of chunks) {
  const arr = JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
  for (const r of arr) if (r && r.internalId != null) byId.set(r.internalId, r);
}
const records = [...byId.values()].sort((a, b) => a.internalId - b.internalId);
const outFile = path.join(OUT, `${sweep}-${year}.ndjson`);
fs.writeFileSync(outFile, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
for (const f of chunks) fs.unlinkSync(path.join(OUT, f));

const watermark = records.reduce((m, r) => Math.max(m, r.internalId || 0), 0);
const errors = records.filter((r) => r.error).length;
const empties = records.filter((r) => r.empty).length;
const clean = records.filter((r) => !r.error && !r.empty);

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const key = sweep === 'A' ? 'A_receipts' : sweep === 'B' ? 'B_adhoc' : 'C_refunds';
manifest.sweeps[key][year] = { watermark, count: clean.length, errors, empties, file: path.basename(outFile), lastRun: stamp };
manifest.runs.push({ sweep, year, count: clean.length, watermark, at: stamp });
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

console.log(`${sweep} ${year}: ${clean.length} receipts -> ${path.basename(outFile)} | watermark=${watermark} | errors=${errors} empties=${empties} | merged ${chunks.length} chunks`);
