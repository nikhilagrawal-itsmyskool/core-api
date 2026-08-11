/**
 * Apply-Fine job (persisted). For an academic year, levy the Late Fee on overdue, unpaid cycles:
 * one fine PER overdue cycle = min(days_after_due × ₹10, ₹1,010), created/updated as a
 * head_label='Late Fee Fine' charge on the "Late Fee Fine" fee_head. Grows daily while the cycle is
 * unpaid; freezes once the cycle's base dues are fully paid (the job simply stops touching it);
 * never touches an exempted fine (one that already carries a waiver).
 *
 * Fineable cycles (2026-27): the 11 months May–March + Biannual-1 + Biannual-2 (NOT TOA, April
 * [parked this year], Full Term). Idempotent: re-running for the same as-of date is a no-op.
 *
 *   node modules/fees/scripts/apply-fines.js                 # dry-run, AY 2026-27, as-of today
 *   node modules/fees/scripts/apply-fines.js --apply --yes
 *   node modules/fees/scripts/apply-fines.js --asof 2026-09-16   # simulate a later run
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const { generateShortUuid } = require('../../../shared/util/generate-uuid');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const AY = arg('--ay', 'w3ajbki9xhbm'); // 2026-27
const ASOF = arg('--asof', new Date().toISOString().slice(0, 10));
const RATE = 10, CAP = 1010;
const FINEABLE = ['may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'january', 'feburary', 'march', 'biannual - 1', 'biannual - 2'];
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const inr = (x) => '₹' + Number(x || 0).toLocaleString('en-IN');
const n = (x) => Number(x || 0);
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const daysBetween = (a, b) => Math.floor((new Date(a) - new Date(b)) / 86400000);

(async () => {
  console.log(`Apply-Fine  ·  AY ${AY}  ·  as-of ${ASOF}  ·  ₹${RATE}/day cap ${inr(CAP)}  ·  mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}\n`);
  const client = await pool.connect();
  try {
    // ensure the Late Fee Fine head for this AY
    let head = (await client.query(`select uuid from fee_head where school_id=$1 and academic_year_id=$2 and lower(name)='late fee fine' and status='active'`, [SCHOOL, AY])).rows[0]?.uuid;
    if (!head) { head = generateShortUuid(12); if (APPLY) await client.query(`insert into fee_head (uuid,school_id,academic_year_id,name,kind,refundable,one_time,status,createdby_userid,created_at) values ($1,$2,$3,'Late Fee Fine','other',false,false,'active','apply-fine',now())`, [head, SCHOOL, AY]); }

    // students with base charges this AY
    const studs = (await client.query(`select distinct student_id from student_ledger_entry where school_id=$1 and academic_year_id=$2 and kind='charge' and status='active' and head_label not ilike '%late%'`, [SCHOOL, AY])).rows.map((r) => r.student_id);

    let create = 0, grow = 0, unchanged = 0, exemptSkip = 0, paidSkip = 0, createAmt = 0, growAmt = 0;
    const perCycle = {}; const samples = [];
    for (const sid of studs) {
      // base charged/settled per cycle + due date
      const cyc = (await client.query(
        `select c.cycle_id, c.cycle_label, coalesce(fc.due_date, fc.from_date) due,
           sum(c.debit) charged,
           sum(coalesce((select sum(cr.credit) from student_ledger_entry cr where cr.settles_entry_id=c.uuid and cr.status='active' and cr.kind in('payment','concession','waiver')),0)) settled
         from student_ledger_entry c left join fee_cycle fc on fc.uuid=c.cycle_id and fc.status='active'
         where c.school_id=$1 and c.student_id=$2 and c.academic_year_id=$3 and c.kind='charge' and c.status='active' and c.head_label not ilike '%late%'
         group by c.cycle_id, c.cycle_label, coalesce(fc.due_date, fc.from_date)`, [SCHOOL, sid, AY])).rows;

      for (const cy of cyc) {
        if (!FINEABLE.includes(norm(cy.cycle_label))) continue;
        if (!cy.due || daysBetween(ASOF, cy.due) <= 0) continue; // not overdue yet
        const unpaid = n(cy.charged) - n(cy.settled);
        if (unpaid <= 0.5) { paidSkip++; continue; } // cycle paid -> freeze (leave any existing fine)
        const computed = Math.min(daysBetween(ASOF, cy.due) * RATE, CAP);

        const ex = (await client.query(
          `select uuid, debit,
             coalesce((select sum(credit) from student_ledger_entry w where w.settles_entry_id=c.uuid and w.kind='waiver' and w.status='active'),0) waived
           from student_ledger_entry c where c.school_id=$1 and c.student_id=$2 and c.academic_year_id=$3 and c.kind='charge' and c.status='active' and c.head_label ilike '%late%' and c.cycle_id=$4`,
          [SCHOOL, sid, AY, cy.cycle_id])).rows[0];

        perCycle[cy.cycle_label] = perCycle[cy.cycle_label] || { n: 0, amt: 0 };
        if (ex) {
          if (n(ex.waived) > 0.5) { exemptSkip++; continue; } // exempted -> never touch
          if (Math.abs(n(ex.debit) - computed) < 0.5) { unchanged++; continue; }
          grow++; growAmt += (computed - n(ex.debit)); perCycle[cy.cycle_label].n++; perCycle[cy.cycle_label].amt += computed;
          if (APPLY) await client.query(`update student_ledger_entry set debit=$1, updated_at=now(), updatedby_userid='apply-fine' where uuid=$2`, [computed, ex.uuid]);
        } else {
          create++; createAmt += computed; perCycle[cy.cycle_label].n++; perCycle[cy.cycle_label].amt += computed;
          if (samples.length < 6) samples.push(`${cy.cycle_label} due ${String(cy.due).slice(0,10)} overdue ${daysBetween(ASOF, cy.due)}d → ${inr(computed)}`);
          if (APPLY) await client.query(
            `insert into student_ledger_entry (uuid,school_id,student_id,academic_year_id,entry_date,category,fee_head_id,cycle_id,head_label,cycle_label,kind,debit,source_module,allocation,status,createdby_userid,created_at)
             values ($1,$2,$3,$4,now(),'fee',$5,$6,'Late Fee Fine',$7,'charge',$8,'fees','explicit','active','apply-fine',now())`,
            [generateShortUuid(12), SCHOOL, sid, AY, head, cy.cycle_id, cy.cycle_label, computed]);
        }
      }
    }

    console.log(`students scanned: ${studs.length}`);
    console.log(`fines to CREATE: ${create} = ${inr(createAmt)}  ·  to GROW: ${grow} (+${inr(growAmt)})  ·  unchanged: ${unchanged}  ·  paid(freeze): ${paidSkip}  ·  exempted(skip): ${exemptSkip}`);
    console.log('\nby cycle:');
    Object.entries(perCycle).filter(([, v]) => v.n).sort((a, b) => b[1].amt - a[1].amt).forEach(([c, v]) => console.log(`  ${c.padEnd(14)} ${String(v.n).padStart(4)} fines  ${inr(v.amt)}`));
    console.log('\nsample new fines:'); samples.forEach((s) => console.log('  ' + s));
    if (!APPLY) console.log('\nDRY-RUN only. Re-run with --apply --yes to write.');
  } finally { client.release(); await pool.end(); }
})().catch((e) => { console.error(e); process.exit(1); });
