/**
 * Clean up student_tc pollution from the (now-fixed) sync-students-full.js, which (a) created a TC
 * for any export row with a "Reason for leaving" value — phantom "applied" TCs even for active,
 * attending students — and (b) re-inserted on every run with a fresh uuid, so rows multiplied.
 *
 * Two phases, both soft-delete (status='deleted' — the module filters those out; reversible):
 *   1. PURGE phantoms — sync-created (createdby_userid='0'), status='applied', no SRN, no issue_date.
 *      These carry no real certificate identity (no number, not issued).
 *   2. DEDUP the rest — one row per (student, srn), keeping the most-progressed status
 *      (issued > cancelled > applied), then the earliest created.
 *
 *   node modules/transfer/scripts/dedup-student-tc.js
 *   node modules/transfer/scripts/dedup-student-tc.js --apply --yes
 */
const fs = require('fs'), path = require('path'), yaml = require('js-yaml');
const { Pool } = require('pg');
const has = (k) => process.argv.includes(k);
const APPLY = has('--apply') && has('--yes');
const SCHOOL = '2qy0xfycrq88';
const cfg = yaml.load(fs.readFileSync(path.join(__dirname, `../../../configs/prod/prod.yml`), 'utf8'));
const pool = new Pool({ host: cfg.POSTGRES_ENDPOINT||cfg.POSTGRES_HOST, database: cfg.POSTGRES_DATABASE, user: cfg.POSTGRES_USERNAME||cfg.POSTGRES_USER, password: cfg.POSTGRES_PASSWORD, port: parseInt(cfg.POSTGRES_PORT||'5432'), ssl: cfg.POSTGRES_SSL==='false'?false:{rejectUnauthorized:false} });
const RANK = { issued: 0, cancelled: 1, applied: 2 };
const isPhantom = (r) => r.createdby_userid === '0' && r.status === 'applied' && (!r.srn_number || !String(r.srn_number).trim()) && !r.issue_date;

(async () => {
  const rows = (await pool.query(`select uuid, student_id, coalesce(srn_number,'') srn, srn_number, issue_date, status, createdby_userid, created_at from student_tc where school_id=$1 and status<>'deleted'`, [SCHOOL])).rows;

  const phantom = rows.filter(isPhantom);
  const real = rows.filter((r) => !isPhantom(r));

  // dedup within real, per (student, srn)
  const groups = {};
  real.forEach((r) => { const k = r.student_id + '|' + r.srn; (groups[k] = groups[k] || []).push(r); });
  const dupDelete = [];
  let dupGroups = 0;
  for (const k of Object.keys(groups)) {
    const g = groups[k];
    if (g.length < 2) continue;
    dupGroups++;
    g.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || String(a.created_at).localeCompare(String(b.created_at)));
    dupDelete.push(...g.slice(1).map((r) => r.uuid));
  }

  const toDelete = [...phantom.map((r) => r.uuid), ...dupDelete];
  console.log(`================ CLEAN student_tc ${APPLY ? 'APPLY' : 'DRY-RUN'} ================`);
  console.log(`active rows: ${rows.length}`);
  console.log(`  phase 1 — phantom purge: ${phantom.length} rows (${new Set(phantom.map((r) => r.student_id)).size} students)`);
  console.log(`  phase 2 — real dedup: ${dupDelete.length} rows across ${dupGroups} (student,srn) groups`);
  console.log(`  total to soft-delete: ${toDelete.length}  ·  remaining after: ${rows.length - toDelete.length}`);

  if (APPLY && toDelete.length) {
    let done = 0;
    for (let i = 0; i < toDelete.length; i += 500) {
      const chunk = toDelete.slice(i, i + 500);
      const r = await pool.query(`update student_tc set status='deleted', updated_at=now() where school_id=$1 and uuid = any($2::text[]) and status<>'deleted'`, [SCHOOL, chunk]);
      done += r.rowCount;
    }
    console.log(`\nAPPLIED: soft-deleted ${done} rows (${phantom.length} phantom + ${dupDelete.length} dup).`);
  } else if (!APPLY) {
    console.log('\n(dry-run — pass --apply --yes to write)');
  }
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
