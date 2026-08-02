/**
 * Fees CONFIG loader — populates the definition tables the admin config screens read:
 * fee_head, fee_cycle, fee_concession (from the extracted config-*.json grids) and
 * fee_structure (RECONSTRUCTED from the migrated ledger charges, since the SchoolPad
 * structure grid was scraped collapsed — "N classes at amount" — without the per-class rows).
 *
 *   node scripts/fees-migration/load-config.js --stage prod --school-code DBPASN [--years 2026-2027] [--apply]
 *
 * DRY-RUN by default. Idempotent per (school, academic-year, table): a year whose fee_head
 * already exists is skipped (existing rows are still read to build the name→uuid maps).
 *
 * NOT loaded: concession student ROSTERS (only counts were scraped) — templates load with 0
 * students; historical concession amounts are already in the ledger. Waivers were never
 * extracted (per-student, going-forward only).
 */
const fs = require('fs');
const path = require('path');
const { loadConfig, createPool } = require('../run-sql');
const { generateShortUuid } = require('../../shared/util/generate-uuid.js');

const OUT = path.join(__dirname, 'out');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i === -1 ? d : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const STAGE = arg('stage', 'local');
const SCHOOL_CODE = arg('school-code', 'DBPASN');
const APPLY = !!arg('apply', false);

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const isRow = (r) => Array.isArray(r) && /^\d+$/.test(String(r[0] || '').trim());
const readCfg = (kind, year) => { const p = path.join(OUT, `config-${kind}-${year}.json`); return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf8')).rows || []) : null; };

function toISO(d) {
  const m = String(d || '').match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (!m) return null;
  if (m[1] === '00' || m[2] === '00') return null; // e.g. "00-00-2027"
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
function inferKind(name) {
  const s = norm(name);
  if (/tuition/.test(s)) return 'recurring';
  if (/admis|admission/.test(s)) return 'admission';
  if (/caution/.test(s)) return 'caution';
  if (/exam/.test(s)) return 'exam';
  if (/annual/.test(s)) return 'annual';
  if (/registration/.test(s)) return 'admission';
  if (/transport|van|bus/.test(s)) return 'transport';
  return 'other';
}
function inferConcType(name) {
  const s = norm(name);
  if (/staff/.test(s)) return 'staff';
  if (/sibling/.test(s)) return 'sibling';
  if (/ews/.test(s)) return 'ews';
  return 'other';
}
// digit-led so "Rs.225" -> 225 (not ".225"); handles "Rs.2,500.00" -> 2500
const parseRs = (v) => { const m = String(v || '').match(/(\d[\d,]*(?:\.\d+)?)/); return m ? Number(m[1].replace(/,/g, '')) : 0; };

(async () => {
  const pool = createPool(loadConfig(STAGE));
  const school = (await pool.query('select uuid from school where lower(code)=lower($1)', [SCHOOL_CODE])).rows[0];
  if (!school) { console.error(`school ${SCHOOL_CODE} not found in ${STAGE}`); process.exit(1); }
  const schoolId = school.uuid;

  const ayRows = (await pool.query('select uuid, name from academic_year where school_id=$1', [schoolId])).rows;
  const ayByStart = {}; ayRows.forEach((a) => { const m = String(a.name || '').match(/(20\d\d)/); if (m) ayByStart[m[1]] = a.uuid; });

  const years = (arg('years', null) ? String(arg('years')).split(',') : fs.readdirSync(OUT).filter((f) => /^config-cycles-\d{4}-\d{4}\.json$/.test(f)).map((f) => f.slice(14, 23))).sort();
  const now = new Date();
  const user = 'system';
  let g = { heads: 0, cycles: 0, concessions: 0, structure: 0, structureUnmapped: 0 };

  for (const year of years) {
    const ay = ayByStart[year.slice(0, 4)];
    if (!ay) { console.log(`${year}: academic_year MISSING — skipped`); continue; }
    const y = { heads: 0, cycles: 0, concessions: 0, structure: 0, unmapped: 0 };

    // ---- HEADS ----
    const headByName = {};
    const existingHeads = (await pool.query("select uuid, name from fee_head where school_id=$1 and academic_year_id=$2 and status='active'", [schoolId, ay])).rows;
    if (existingHeads.length) {
      existingHeads.forEach((h) => (headByName[norm(h.name)] = h.uuid));
    } else {
      const rows = (readCfg('heads', year) || []).filter(isRow);
      const vals = [];
      rows.forEach((r, i) => {
        const name = String(r[1] || '').trim(); if (!name) return;
        const uuid = generateShortUuid(12); headByName[norm(name)] = uuid;
        const kind = inferKind(name);
        vals.push([uuid, schoolId, ay, name, String(r[2] || '').trim() || null, kind, kind === 'caution', ['admission', 'annual'].includes(kind), null, i, 'active', user, now]);
        y.heads++;
      });
      if (APPLY && vals.length) await insertMany(pool, 'fee_head', ['uuid', 'school_id', 'academic_year_id', 'name', 'abbreviation', 'kind', 'refundable', 'one_time', 'amount_editable', 'sort_order', 'status', 'createdby_userid', 'created_at'], vals);
      else if (!APPLY) rows.forEach((r) => { const n = norm(r[1]); if (n && !headByName[n]) headByName[n] = 'dry-' + n; }); // ensure map for dry structure
    }

    // ---- CYCLES ----
    const cycleByName = {};
    const existingCycles = (await pool.query("select uuid, name from fee_cycle where school_id=$1 and academic_year_id=$2 and status='active'", [schoolId, ay])).rows;
    if (existingCycles.length) {
      existingCycles.forEach((c) => (cycleByName[norm(c.name)] = c.uuid));
    } else {
      const rows = (readCfg('cycles', year) || []).filter(isRow);
      const vals = [];
      rows.forEach((r, i) => {
        const name = String(r[1] || '').trim(); if (!name) return;
        const uuid = generateShortUuid(12); cycleByName[norm(name)] = uuid;
        vals.push([uuid, schoolId, ay, name, String(r[2] || '').trim() || null, toISO(r[4]), toISO(r[5]), toISO(r[6]), i, 'active', user, now]);
        y.cycles++;
      });
      if (APPLY && vals.length) await insertMany(pool, 'fee_cycle', ['uuid', 'school_id', 'academic_year_id', 'name', 'abbreviation', 'from_date', 'to_date', 'due_date', 'sort_order', 'status', 'createdby_userid', 'created_at'], vals);
    }

    // ---- CONCESSIONS (templates only; rosters not scraped) ----
    const existingConc = (await pool.query("select count(*) c from fee_concession where school_id=$1 and academic_year_id=$2 and status='active'", [schoolId, ay])).rows[0].c;
    if (Number(existingConc) === 0) {
      const rows = (readCfg('concessions', year) || []).filter(isRow);
      const vals = [];
      rows.forEach((r) => {
        const name = String(r[1] || '').trim(); if (!name) return;
        const headId = headByName[norm(r[3])] || null;
        const val = parseRs(r[2]);
        vals.push([generateShortUuid(12), schoolId, ay, name, inferConcType(name), 'amount', val, (headId && !String(headId).startsWith('dry-')) ? headId : null, 'active', user, now]);
        y.concessions++;
      });
      if (APPLY && vals.length) await insertMany(pool, 'fee_concession', ['uuid', 'school_id', 'academic_year_id', 'name', 'type', 'value_type', 'value', 'fee_head_id', 'status', 'createdby_userid', 'created_at'], vals);
    }

    // ---- STRUCTURE (reconstruct from ledger charges) ----
    const existingStruct = (await pool.query("select count(*) c from fee_structure where school_id=$1 and academic_year_id=$2 and status='active'", [schoolId, ay])).rows[0].c;
    if (Number(existingStruct) === 0) {
      const charges = (await pool.query(
        `select sc.class_id, e.head_label, e.cycle_label, max(e.debit) amount
         from student_ledger_entry e
         join student_class sc on sc.student_id=e.student_id and sc.academic_year_id=e.academic_year_id and sc.school_id=e.school_id
         where e.school_id=$1 and e.academic_year_id=$2 and e.kind='charge' and e.status='active'
         group by sc.class_id, e.head_label, e.cycle_label`,
        [schoolId, ay]
      )).rows;
      const vals = [];
      for (const c of charges) {
        const headId = headByName[norm(c.head_label)];
        const cycleId = cycleByName[norm(c.cycle_label)];
        if (!headId || String(headId).startsWith('dry-') || !cycleId || String(cycleId).startsWith('dry-')) { y.unmapped++; continue; }
        vals.push([generateShortUuid(12), schoolId, ay, c.class_id, headId, cycleId, Number(c.amount), 'active', user, now]);
        y.structure++;
      }
      if (APPLY && vals.length) await insertMany(pool, 'fee_structure', ['uuid', 'school_id', 'academic_year_id', 'class_id', 'fee_head_id', 'cycle_id', 'amount', 'status', 'createdby_userid', 'created_at'], vals);
    }

    Object.keys(g).forEach((k) => (g[k] += (k === 'structureUnmapped' ? y.unmapped : y[k] || 0)));
    console.log(`${year}: heads=${y.heads} cycles=${y.cycles} concessions=${y.concessions} structure=${y.structure} (unmapped ${y.unmapped})${existingHeads.length ? ' [heads already present]' : ''}`);
  }

  console.log(`\n${APPLY ? 'APPLIED' : 'DRY-RUN (nothing written — pass --apply)'} | heads=${g.heads} cycles=${g.cycles} concessions=${g.concessions} structure=${g.structure} (unmapped ${g.structureUnmapped})`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });

async function insertMany(pool, table, cols, rows) {
  if (!rows.length) return;
  const chunk = Math.max(1, Math.floor(60000 / cols.length));
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const values = slice.map((_, ri) => '(' + cols.map((__, ci) => `$${ri * cols.length + ci + 1}`).join(',') + ')').join(',');
    await pool.query(`insert into ${table} (${cols.join(',')}) values ${values}`, slice.flat());
  }
}
